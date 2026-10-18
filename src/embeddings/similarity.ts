/** Cosine similarity for embedding vectors; returns 0 when either vector is empty. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

export interface Scored<T> {
  item: T;
  score: number;
}

/** The `k` items whose vectors are most similar to `query`, best first. */
export function topK<T>(query: number[], items: T[], vectorOf: (item: T) => number[] | undefined, k: number): Array<Scored<T>> {
  if (k <= 0 || items.length === 0 || query.length === 0) return [];
  return items
    .map((item) => ({ item, score: cosineSimilarity(query, vectorOf(item) ?? []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
