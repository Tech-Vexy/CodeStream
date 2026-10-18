import { InputError } from '../errors.js';
import type { Store } from '../db/store.js';
import type { CastDoc } from '../domain.js';
import { topK } from '../embeddings/similarity.js';
import type { VoyageEmbedder } from '../embeddings/voyage.js';
import type { Analyst } from '../mastra/analyst.js';

export interface QaResult {
  id?: string;
  createdAt?: Date;
  answer: string;
  citations: string[];
}

export interface QaDeps {
  store: Pick<Store, 'getEmbeddings' | 'listNotes' | 'insertQa'>;
  analyst: Pick<Analyst, 'answer'>;
  /** Present when VOYAGE_API_KEY is configured; without it retrieval falls back to chunk notes. */
  embedder?: Pick<VoyageEmbedder, 'embed'>;
  topK?: number;
  maxPassageChars?: number;
}

/**
 * Answer a question about a finished cast: rank the cast's stored embeddings (MongoDB Voyage AI
 * vectors) against the question, then have Gemma answer strictly from the retrieved passages.
 * Every exchange is persisted to the `qa` collection as history.
 */
export function createQaService(deps: QaDeps): (cast: CastDoc, question: string) => Promise<QaResult> {
  const k = deps.topK ?? 6;
  const maxPassageChars = deps.maxPassageChars ?? 2_500;

  return async (cast: CastDoc, question: string): Promise<QaResult> => {
    const passages: Array<{ refs: string[]; text: string }> = [];

    if (deps.embedder) {
      const [queryVectors, docs] = await Promise.all([
        deps.embedder.embed([question], 'query'),
        deps.store.getEmbeddings(cast._id),
      ]);
      const query = queryVectors[0];
      if (query && docs.length > 0) {
        for (const hit of topK(query, docs, (doc) => doc.vector, k)) {
          passages.push({ refs: hit.item.refs, text: hit.item.text.slice(0, maxPassageChars) });
        }
      }
    }

    if (passages.length === 0) {
      // No embeddings (indexing not configured or still running): fall back to the chunk notes.
      for (const note of (await deps.store.listNotes(cast._id)).slice(0, k)) {
        if (note.notes) passages.push({ refs: note.refs, text: note.notes.slice(0, maxPassageChars) });
      }
    }

    if (passages.length === 0) {
      throw new InputError('This cast has no indexed knowledge to answer from yet. Try again shortly.');
    }

    const formatted = passages.map((p, i) => `[${i + 1}] (${p.refs.slice(0, 6).join(', ')})\n${p.text}`).join('\n\n');
    const answer = await deps.analyst.answer({ kind: cast.kind, repo: cast.repo.fullName, question, passages: formatted });
    const citations = [...new Set(passages.flatMap((p) => p.refs))].slice(0, 12);
    const stored = await deps.store.insertQa({ castId: cast._id, question, answer, citations });
    return { id: stored._id, createdAt: stored.createdAt, answer, citations };
  };
}
