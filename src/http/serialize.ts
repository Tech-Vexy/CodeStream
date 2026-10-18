import type { CastDoc, QaDoc } from '../domain.js';
import type { CastSummary } from '../db/store.js';

/** Parse a single "bytes=start-end" range. Multi-range or malformed headers fall back to a full response. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | undefined {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match) return undefined;
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return undefined;
  let start: number;
  let end: number;
  if (from === '') {
    const suffix = Number(to);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/** The JSON shape of a cast for API responses: the encrypted token never leaves the server. */
export function castView(cast: CastDoc) {
  const { _id, audio, githubToken: _token, ...rest } = cast;
  return { id: _id, ...rest, hasAudio: Boolean(audio) };
}

export function summaryView(cast: CastSummary) {
  return {
    id: cast._id,
    kind: cast.kind,
    repo: cast.repo,
    status: cast.status,
    stage: cast.stage,
    progress: cast.progress,
    title: cast.report?.title,
    createdAt: cast.createdAt,
    completedAt: cast.completedAt,
  };
}

/** The JSON shape of one stored question/answer exchange. */
export function qaView(doc: QaDoc) {
  return { id: doc._id, question: doc.question, answer: doc.answer, citations: doc.citations, createdAt: doc.createdAt };
}
