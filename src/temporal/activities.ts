import { posix } from 'node:path';
import { log } from '@temporalio/activity';
import type { SpeechSynthesizer } from '../audio/elevenlabs.js';
import type { Store } from '../db/store.js';
import type { CastDoc, CastKind, ContextDoc, QaAnswer } from '../domain.js';
import { ConfigError, InputError } from '../errors.js';
import { VoyageEmbedder } from '../embeddings/voyage.js';
import { GitHubClient, type GitHubCommit } from '../github/client.js';
import { decryptGitHubToken } from '../auth/session.js';
import { buildChangeSet } from '../ingest/changes.js';
import { packBlocks } from '../ingest/chunking.js';
import { buildSnapshot, filesFromTarball, type SensitiveFile } from '../ingest/codebase.js';
import type { Analyst } from '../mastra/analyst.js';
import { tidyRisks, type Risk } from '../mastra/schemas.js';
import type { QaResult } from '../qa/service.js';

export interface PipelineLimits {
  /** Characters of source or diff per model request. */
  chunkChars: number;
  codebaseMaxChars: number;
  changesMaxChars: number;
  maxTarballBytes: number;
  maxUnpackedBytes: number;
}

export interface ActivityDeps {
  store: Store;
  github: GitHubClient;
  analyst: Analyst;
  /** Absent when ELEVENLABS_API_KEY is not configured. */
  speech?: SpeechSynthesizer;
  /** Absent when VOYAGE_API_KEY is not configured; Q&A retrieval then falls back to chunk notes. */
  embedder?: Pick<VoyageEmbedder, 'embed' | 'model'>;
  /** Grounded Q&A over the stored chunks (src/qa/service.ts). */
  qa?: (cast: CastDoc, question: string) => Promise<QaResult>;
  limits: PipelineLimits;
  sessionSecret?: string;
}

type CodebaseContext = Extract<ContextDoc, { kind: 'codebase' }>;
type ChangesContext = Extract<ContextDoc, { kind: 'changes' }>;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(lanes);
  return results;
}

function describeRefs(kind: CastKind, refs: string[]): string {
  if (kind === 'changes') return `commits ${refs.map((sha) => sha.slice(0, 7)).join(', ')}`;
  const shown = refs.slice(0, 6).join(', ');
  return refs.length > 6 ? `${shown} and ${refs.length - 6} more files` : shown;
}

function groupTexts(texts: string[], maxChars: number): string[] {
  const groups: string[] = [];
  let current = '';
  for (const text of texts) {
    if (current && current.length + text.length + 2 > maxChars) {
      groups.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${text}` : text;
  }
  if (current) groups.push(current);
  return groups;
}

/** Shrink chunk notes until they fit one synthesis request, condensing groups with the model. */
async function fitNotes(sections: string[], budget: number, groupChars: number, condense: (text: string) => Promise<string>): Promise<string> {
  let current = sections;
  for (let round = 0; round < 3 && current.join('\n\n').length > budget; round++) {
    const condensed: string[] = [];
    for (const group of groupTexts(current, groupChars)) condensed.push(await condense(group));
    current = condensed;
  }
  const text = current.join('\n\n');
  return text.length > budget ? `${text.slice(0, budget)}\n[notes truncated]` : text;
}

/** Deterministic findings that do not depend on the model reading anything. */
function sensitiveFileRisks(files: Array<SensitiveFile & { sha?: string }>): Risk[] {
  const risks: Risk[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path) || risks.length >= 10) continue;
    seen.add(file.path);
    risks.push({
      severity: file.severity,
      title: `Possible secrets committed: ${posix.basename(file.path)}`,
      detail: `${file.path}${file.sha ? ` (changed in ${file.sha.slice(0, 7)})` : ''} looks like a credentials or key file. CodeStream did not send it to the model. Confirm it holds no real secrets, rotate any that it does, and keep it out of git.`,
      paths: [file.path],
    });
  }
  return risks;
}

function codebaseCoverage(context: CodebaseContext): string {
  const { stats } = context;
  const skipped = Object.entries(stats.skipped)
    .map(([reason, count]) => `${count} ${reason}`)
    .join(', ');
  return [
    `${stats.totalFiles} files in the repository; ${stats.includedFiles} were read (${Math.round(stats.chars / 1000)}k characters).`,
    skipped ? `Not read: ${skipped}.` : '',
    stats.omittedForBudget
      ? `${stats.omittedForBudget} readable files were skipped to stay within the size budget, for example ${context.omittedPaths.slice(0, 8).join(', ')}.`
      : '',
    context.sensitiveFiles.length ? `Sensitive-looking files present but not read: ${context.sensitiveFiles.map((file) => file.path).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function changeStats(context: ChangesContext): string {
  const s = context.stats;
  const statuses = Object.entries(s.byStatus)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');
  return [
    `${s.commits} commits by ${s.authors.join(', ')}; +${s.additions} -${s.deletions} lines across ${s.filesTouched} files (${statuses || 'no file changes'}).`,
    `Test files touched: ${s.testFilesTouched}.`,
    s.manifestsTouched.length ? `Dependency or build manifests changed: ${s.manifestsTouched.join(', ')}.` : 'No dependency manifests changed.',
    s.patchesOmitted ? `${s.patchesOmitted} file diffs were not read because of the size budget.` : '',
    context.sensitiveFiles.length
      ? `Sensitive-looking files touched (diffs not read): ${[...new Set(context.sensitiveFiles.map((file) => file.path))].join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createActivities(deps: ActivityDeps) {
  const { store, github, analyst, limits, embedder, qa } = deps;

  async function requireCast(castId: string): Promise<CastDoc> {
    const cast = await store.getCast(castId);
    if (!cast) throw new InputError(`Cast ${castId} does not exist.`);
    return cast;
  }

  return {
    async setStage(input: { castId: string; stage: string; progress?: { done: number; total: number } }): Promise<void> {
      await store.updateCast(
        input.castId,
        { status: 'running', stage: input.stage, ...(input.progress ? { progress: input.progress } : {}) },
        input.progress ? [] : ['progress'],
      );
    },

    async ingestCodebase({ castId }: { castId: string }): Promise<{ chunks: number }> {
      const cast = await requireCast(castId);
      const { owner, name } = cast.repo;
      const castGithub = deps.sessionSecret ? decryptGitHubToken(cast.githubToken, deps.sessionSecret) : null;
      const repoClient = castGithub ? new GitHubClient({ token: castGithub }) : github;
      const repo = await repoClient.getRepo(owner, name);
      const branch = cast.request.ref ?? repo.defaultBranch;
      const sha = await repoClient.resolveCommitSha(owner, name, branch);

      const tarball = await repoClient.downloadTarball(owner, name, sha, limits.maxTarballBytes);
      const files = filesFromTarball(tarball, limits.maxUnpackedBytes);
      const { chunks, ...snapshot } = buildSnapshot(files, { maxChars: limits.codebaseMaxChars, chunkChars: limits.chunkChars });
      if (chunks.length === 0) throw new InputError(`${cast.repo.fullName} has no readable source files at ${branch}.`);

      await store.replaceIngest(castId, { _id: castId, kind: 'codebase', createdAt: new Date(), ...snapshot }, chunks);
      const warnings = snapshot.stats.omittedForBudget
        ? [
            `${snapshot.stats.omittedForBudget} files were not read to stay within CODEBASE_MAX_CHARS (${limits.codebaseMaxChars.toLocaleString('en-US')} characters).`,
          ]
        : [];
      await store.updateCast(castId, {
        source: { sha, branch, description: repo.description, files: snapshot.stats.totalFiles },
        warnings,
      });
      log.info('Ingested codebase', { castId, files: snapshot.stats.totalFiles, read: snapshot.stats.includedFiles, chunks: chunks.length });
      return { chunks: chunks.length };
    },

    async ingestChanges({ castId }: { castId: string }): Promise<{ chunks: number }> {
      const cast = await requireCast(castId);
      const { owner, name } = cast.repo;
      const { base, commitLimit } = cast.request;
      const castGithub = deps.sessionSecret ? decryptGitHubToken(cast.githubToken, deps.sessionSecret) : null;
      const repoClient = castGithub ? new GitHubClient({ token: castGithub }) : github;
      const repo = await repoClient.getRepo(owner, name);
      const head = cast.request.ref ?? repo.defaultBranch;
      const headSha = await repoClient.resolveCommitSha(owner, name, head);

      let commits: GitHubCommit[];
      let range: string;
      let baseSha: string | undefined;
      let rangeTotal: number | undefined;
      if (base) {
        baseSha = await repoClient.resolveCommitSha(owner, name, base);
        const compared = await repoClient.compareCommits(owner, name, baseSha, headSha, commitLimit);
        commits = compared.commits;
        rangeTotal = compared.totalCommits;
        range =
          rangeTotal > commits.length
            ? `the latest ${commits.length} of ${rangeTotal} commits between ${base} and ${head}`
            : `the ${commits.length} commits between ${base} and ${head}`;
      } else {
        commits = (await repoClient.listCommits(owner, name, headSha, commitLimit)).reverse();
        range = `the latest ${commits.length} commits on ${head}`;
      }
      if (commits.length === 0) {
        throw new InputError(base ? `There are no commits between ${base} and ${head}.` : `No commits found on ${head}.`);
      }

      const details = await mapLimit(commits, 4, (commit) => repoClient.getCommit(owner, name, commit.sha));
      const { blocks, ...changeSet } = buildChangeSet(details, {
        maxPatchChars: Math.min(8_000, Math.floor(limits.chunkChars / 3)),
        maxTotalChars: limits.changesMaxChars,
      });
      const chunks = packBlocks(blocks, limits.chunkChars);

      await store.replaceIngest(castId, { _id: castId, kind: 'changes', createdAt: new Date(), rangeNote: range, ...changeSet }, chunks);
      const warnings = [
        ...(rangeTotal !== undefined && rangeTotal > commits.length
          ? [`Only the latest ${commits.length} of ${rangeTotal} commits in the range were reviewed (commit limit ${commitLimit}).`]
          : []),
        ...(changeSet.stats.patchesOmitted
          ? [`${changeSet.stats.patchesOmitted} file diffs were not read to stay within CHANGES_MAX_CHARS; the oldest commits were trimmed first.`]
          : []),
      ];
      await store.updateCast(castId, {
        source: { sha: headSha, branch: head, ...(baseSha ? { baseSha } : {}), description: repo.description, commits: commits.length },
        warnings,
      });
      log.info('Ingested changes', { castId, commits: commits.length, chunks: chunks.length });
      return { chunks: chunks.length };
    },

    async summarizeChunk({ castId, index, total }: { castId: string; index: number; total: number }): Promise<void> {
      const chunk = await store.getChunk(castId, index);
      if (!chunk) throw new InputError(`Part ${index + 1} of cast ${castId} is missing; its data may have expired.`);

      // Notes survive activity retries, so a retry after a crash does not pay for the model call twice.
      if (chunk.notes === undefined) {
        const cast = await requireCast(castId);
        const part = { part: index + 1, parts: total, content: chunk.content, repo: cast.repo.fullName };
        const notes =
          cast.kind === 'codebase' ? await analyst.codeNotes({ ...part, sha: cast.source?.sha ?? '' }) : await analyst.changeNotes(part);
        await store.saveChunkNotes(castId, index, notes);
      }
      await store.updateCast(castId, { progress: { done: await store.countSummarized(castId), total } });
    },

    /** Build the Q&A vector index once every chunk has been summarized. A no-op without Voyage. */
    async indexEmbeddings({ castId }: { castId: string }): Promise<void> {
      if (!embedder) return; // VOYAGE_API_KEY is not configured: Q&A falls back to the chunk notes.
      const chunks = await store.listChunks(castId);
      if (chunks.length === 0) return;
      const texts = chunks.map((chunk) => (chunk.content.trim() || chunk.notes?.trim() || '').slice(0, limits.chunkChars));
      const vectors = await embedder.embed(texts, 'document');
      await store.replaceEmbeddings(
        castId,
        chunks.map((chunk, i) => ({
          castId,
          index: chunk.index,
          refs: chunk.refs,
          text: texts[i] ?? '',
          vector: vectors[i] ?? [],
          model: embedder.model,
        })),
      );
      log.info('Indexed embeddings for Q&A', { castId, embeddings: chunks.length });
    },

    async synthesizeReport({ castId }: { castId: string }): Promise<void> {
      const cast = await requireCast(castId);
      if (cast.report) return;
      const context = await store.getContext(castId);
      if (!context) throw new InputError(`The analysis data for cast ${castId} is missing; it may have expired.`);

      const sections = (await store.listNotes(castId)).map(
        (chunk) => `## Part ${chunk.index + 1}: ${describeRefs(cast.kind, chunk.refs)}\n${chunk.notes ?? '(no notes)'}`,
      );
      const notes = await fitNotes(sections, limits.chunkChars * 2, limits.chunkChars, (text) =>
        analyst.condense(cast.kind, cast.repo.fullName, text),
      );

      if (context.kind === 'codebase') {
        const report = await analyst.codebaseReport({
          repo: cast.repo.fullName,
          ...(cast.source?.branch ? { branch: cast.source.branch } : {}),
          sha: cast.source?.sha ?? '',
          description: cast.source?.description ?? null,
          fileTree: context.fileTree,
          coverage: codebaseCoverage(context),
          notes,
        });
        report.risks = [...sensitiveFileRisks(context.sensitiveFiles), ...tidyRisks(report.risks)];
        await store.updateCast(castId, { report });
      } else {
        const report = await analyst.changeReport({
          repo: cast.repo.fullName,
          range: context.rangeNote ?? `${context.commits.length} commits`,
          commits: context.commits
            .map(
              (c) =>
                `${c.sha.slice(0, 7)} ${c.date.slice(0, 10)} ${c.author}: ${c.title} (+${c.additions} -${c.deletions}, ${c.files} files${c.isMerge ? ', merge' : ''})`,
            )
            .join('\n'),
          stats: changeStats(context),
          notes,
        });
        report.risks = [...sensitiveFileRisks(context.sensitiveFiles), ...tidyRisks(report.risks)];
        await store.updateCast(castId, { report });
      }
    },

    async writeScript({ castId }: { castId: string }): Promise<void> {
      const cast = await requireCast(castId);
      if (cast.script) return;
      if (!cast.report) throw new Error(`Cast ${castId} has no report to narrate.`);
      const script = await analyst.script({ kind: cast.kind, repo: cast.repo.fullName, report: cast.report });
      await store.updateCast(castId, { script });
    },

    async recordAudio({ castId }: { castId: string }): Promise<void> {
      if (!deps.speech) throw new ConfigError('ELEVENLABS_API_KEY is not configured on the worker.');
      const cast = await requireCast(castId);
      if (cast.audio) return;
      if (!cast.script) throw new Error(`Cast ${castId} has no script to record.`);
      const { audio, contentType, segments } = await deps.speech.synthesize(cast.script);
      const { fileId, bytes } = await store.saveAudio(castId, audio, contentType);
      await store.updateCast(castId, { audio: { fileId, bytes, contentType } });
      log.info('Recorded audio', { castId, bytes, segments });
    },

    /** One grounded answer about a finished cast; the service persists the exchange as history. */
    async answerQuestion({ castId, question }: { castId: string; question: string }): Promise<QaAnswer> {
      if (!qa) throw new ConfigError('The Q&A service is not configured on this worker.');
      const cast = await requireCast(castId);
      const result = await qa(cast, question);
      return {
        ...(result.id ? { id: result.id } : {}),
        answer: result.answer,
        citations: result.citations,
        ...(result.createdAt ? { createdAt: result.createdAt.toISOString() } : {}),
      };
    },

    async addWarning({ castId, warning }: { castId: string; warning: string }): Promise<void> {
      await store.addWarning(castId, warning);
    },

    async completeCast({ castId }: { castId: string }): Promise<void> {
      await store.updateCast(castId, { status: 'ready', stage: 'Ready', completedAt: new Date() }, ['progress']);
    },

    async failCast({ castId, message }: { castId: string; message: string }): Promise<void> {
      await store.updateCast(castId, { status: 'failed', stage: 'Failed', error: message, completedAt: new Date() }, ['progress']);
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
