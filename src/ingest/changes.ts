import { posix } from 'node:path';
import type { GitHubCommitDetail } from '../github/client.js';
import type { Block } from './chunking.js';
import type { SensitiveFile } from './codebase.js';
import { classifyPath, isTestPath, sensitivity } from './filters.js';

export interface CommitLine {
  sha: string;
  title: string;
  author: string;
  date: string;
  additions: number;
  deletions: number;
  files: number;
  isMerge: boolean;
}

export interface ChangeStats {
  commits: number;
  authors: string[];
  additions: number;
  deletions: number;
  filesTouched: number;
  /** Status of each touched file the first time it appears in the range (added, modified, removed, renamed). */
  byStatus: Record<string, number>;
  testFilesTouched: number;
  manifestsTouched: string[];
  /** Diffs left out because the character budget ran out. */
  patchesOmitted: number;
}

export interface ChangeSet {
  commits: CommitLine[];
  stats: ChangeStats;
  sensitiveFiles: Array<SensitiveFile & { sha: string }>;
  blocks: Block[];
}

export interface ChangeSetOptions {
  /** Longest diff kept for a single file. */
  maxPatchChars: number;
  /** Total diff characters sent to the model. */
  maxTotalChars: number;
}

const MANIFESTS = new Set([
  'package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'cargo.toml', 'gemfile', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'composer.json', 'pubspec.yaml', 'mix.exs', 'dockerfile',
]);

function truncatePatch(patch: string, maxChars: number): string {
  if (patch.length <= maxChars) return patch;
  const cut = patch.lastIndexOf('\n', maxChars);
  const kept = patch.slice(0, cut > 0 ? cut : maxChars);
  const remaining = patch.slice(kept.length).split('\n').length - 1;
  return `${kept}\n[... ${remaining} more diff lines truncated]`;
}

/**
 * Turn commits (oldest first) into model-ready blocks. The diff budget is spent newest-first, so if a
 * range is too large it is the oldest commits that lose their diffs, not the latest agent work.
 */
export function buildChangeSet(details: GitHubCommitDetail[], options: ChangeSetOptions): ChangeSet {
  let budget = options.maxTotalChars;
  let patchesOmitted = 0;
  const blocks: Block[] = [];
  const sensitiveFiles: ChangeSet['sensitiveFiles'] = [];

  for (const commit of [...details].reverse()) {
    const isMerge = commit.parents.length > 1;
    const lines = ['Message:', commit.message.trim().slice(0, 2_000), '', `Files changed: ${commit.files.length} (+${commit.additions} -${commit.deletions})`];

    if (isMerge) {
      lines.push('Merge commit: per-file diff omitted.');
    } else {
      for (const file of commit.files) {
        const status = file.previousPath ? `${file.status} from ${file.previousPath}` : file.status;
        lines.push('', `--- ${file.path} [${status}, +${file.additions} -${file.deletions}]`);

        const severity = sensitivity(file.path);
        if (severity) {
          sensitiveFiles.push({ path: file.path, severity, sha: commit.sha });
          lines.push('[diff withheld: sensitive file, review it manually]');
          continue;
        }
        const verdict = classifyPath(file.path, 0);
        if (!verdict.include) {
          lines.push(`[diff omitted: ${verdict.reason}]`);
          continue;
        }
        if (file.patch === undefined) {
          lines.push('[no textual diff available: binary or very large change]');
          continue;
        }
        const patch = truncatePatch(file.patch, options.maxPatchChars);
        if (patch.length > budget) {
          patchesOmitted++;
          lines.push('[diff omitted: size budget for this cast reached]');
          continue;
        }
        budget -= patch.length;
        lines.push(patch);
      }
    }

    blocks.push({
      label: `COMMIT ${commit.sha.slice(0, 7)} by ${commit.author} on ${commit.date.slice(0, 10)}`,
      body: lines.join('\n'),
      refs: [commit.sha],
    });
  }
  blocks.reverse();

  const firstStatus = new Map<string, string>();
  let additions = 0;
  let deletions = 0;
  for (const commit of details) {
    if (commit.parents.length > 1) continue;
    additions += commit.additions;
    deletions += commit.deletions;
    for (const file of commit.files) if (!firstStatus.has(file.path)) firstStatus.set(file.path, file.status);
  }
  const byStatus: Record<string, number> = {};
  for (const status of firstStatus.values()) byStatus[status] = (byStatus[status] ?? 0) + 1;
  const touched = [...firstStatus.keys()];

  return {
    commits: details.map((commit) => ({
      sha: commit.sha,
      title: commit.message.split('\n')[0]?.slice(0, 200) ?? '',
      author: commit.author,
      date: commit.date,
      additions: commit.additions,
      deletions: commit.deletions,
      files: commit.files.length,
      isMerge: commit.parents.length > 1,
    })),
    stats: {
      commits: details.length,
      authors: [...new Set(details.map((commit) => commit.author))],
      additions,
      deletions,
      filesTouched: touched.length,
      byStatus,
      testFilesTouched: touched.filter((path) => isTestPath(path)).length,
      manifestsTouched: touched.filter((path) => MANIFESTS.has(posix.basename(path).toLowerCase())),
      patchesOmitted,
    },
    sensitiveFiles,
    blocks,
  };
}
