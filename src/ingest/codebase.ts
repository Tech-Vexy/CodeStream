import { gunzipSync } from 'node:zlib';
import { InputError } from '../errors.js';
import { readTar } from '../github/tar.js';
import { packBlocks, type Chunk } from './chunking.js';
import { classifyPath, looksBinary, sensitivity, type SkipReason } from './filters.js';
import { renderTree } from './tree.js';

export interface SensitiveFile {
  path: string;
  severity: 'high' | 'medium';
}

export interface CodebaseStats {
  totalFiles: number;
  includedFiles: number;
  /** Readable files left out because the character budget ran out. */
  omittedForBudget: number;
  skipped: Partial<Record<SkipReason, number>>;
  chars: number;
}

export interface CodebaseSnapshot {
  fileTree: string;
  stats: CodebaseStats;
  sensitiveFiles: SensitiveFile[];
  omittedPaths: string[];
  chunks: Chunk[];
}

export interface SnapshotOptions {
  /** Total characters of source to send to the model. */
  maxChars: number;
  /** Characters per model request. */
  chunkChars: number;
}

interface Candidate {
  path: string;
  content: string;
  priority: number;
  depth: number;
}

export function buildSnapshot(files: Array<{ path: string; data: Buffer }>, options: SnapshotOptions): CodebaseSnapshot {
  const skipped: Partial<Record<SkipReason, number>> = {};
  const sensitiveFiles: SensitiveFile[] = [];
  const candidates: Candidate[] = [];

  for (const { path, data } of files) {
    const verdict = classifyPath(path, data.length);
    if (!verdict.include) {
      skipped[verdict.reason] = (skipped[verdict.reason] ?? 0) + 1;
      const severity = verdict.reason === 'sensitive' ? sensitivity(path) : undefined;
      if (severity) sensitiveFiles.push({ path, severity });
      continue;
    }
    if (looksBinary(data)) {
      skipped.binary = (skipped.binary ?? 0) + 1;
      continue;
    }
    const content = data.toString('utf8');
    if (content.trim() === '') continue;
    candidates.push({ path, content, priority: verdict.priority, depth: path.split('/').length - 1 });
  }

  // Spend the budget on the most informative files first, then restore path order for chunking
  // so that files from the same directory end up in the same model request.
  candidates.sort((a, b) => a.priority - b.priority || a.depth - b.depth || a.path.localeCompare(b.path));
  const selected: Candidate[] = [];
  const omittedPaths: string[] = [];
  let chars = 0;
  for (const candidate of candidates) {
    if (chars + candidate.content.length > options.maxChars) {
      omittedPaths.push(candidate.path);
      continue;
    }
    selected.push(candidate);
    chars += candidate.content.length;
  }
  selected.sort((a, b) => a.path.localeCompare(b.path));

  const chunks = packBlocks(
    selected.map((file) => ({ label: `FILE ${file.path}`, body: file.content, refs: [file.path] })),
    options.chunkChars,
  );

  return {
    fileTree: renderTree(files.map((file) => file.path)),
    stats: {
      totalFiles: files.length,
      includedFiles: selected.length,
      omittedForBudget: omittedPaths.length,
      skipped,
      chars,
    },
    sensitiveFiles,
    omittedPaths,
    chunks,
  };
}

/** Unpack a GitHub tarball (gzip + tar, with a single "<owner>-<repo>-<sha>/" root folder). */
export function filesFromTarball(tarball: Buffer, maxUnpackedBytes: number): Array<{ path: string; data: Buffer }> {
  let archive: Buffer;
  try {
    archive = gunzipSync(tarball, { maxOutputLength: maxUnpackedBytes });
  } catch (err) {
    if (err instanceof RangeError) {
      throw new InputError(`The repository unpacks to more than ${Math.round(maxUnpackedBytes / 1e6)} MB.`);
    }
    throw err;
  }
  const files: Array<{ path: string; data: Buffer }> = [];
  for (const entry of readTar(archive)) {
    if (entry.type !== 'file') continue;
    const path = entry.path.slice(entry.path.indexOf('/') + 1);
    if (path) files.push({ path, data: entry.data });
  }
  return files;
}
