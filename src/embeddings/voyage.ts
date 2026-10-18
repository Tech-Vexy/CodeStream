import { ConfigError } from '../errors.js';

export interface VoyageOptions {
  apiKey: string;
  /** MongoDB Voyage AI embedding model id, e.g. voyage-code-3 for source code. */
  model?: string;
  /** Truncation dimension; voyage-code-3 supports 256, 512, 1024 and 2048. */
  dimensions?: number;
  baseUrl?: string;
  /** The API accepts up to 128 inputs per request; stay below to keep requests small. */
  maxBatch?: number;
  fetch?: typeof fetch;
}

interface VoyageResponse {
  data?: Array<{ index: number; embedding: number[] }>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/**
 * Client for the MongoDB Voyage AI embedding models (voyageai.com). Documents are embedded with
 * input_type "document" and questions with "query"; the vectors land in MongoDB for retrieval.
 */
export class VoyageEmbedder {
  readonly model: string;
  readonly dimensions: number;

  private readonly maxBatch: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: VoyageOptions) {
    if (!options.apiKey) throw new ConfigError('VOYAGE_API_KEY is required for embeddings.');
    this.model = options.model ?? 'voyage-code-3';
    this.dimensions = options.dimensions ?? 1024;
    this.maxBatch = options.maxBatch ?? 64;
    this.baseUrl = (options.baseUrl ?? 'https://api.voyageai.com/v1').replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Embed texts in batches, preserving order. */
  async embed(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
    const out: number[][] = [];
    for (const batch of chunk(texts, this.maxBatch)) out.push(...(await this.embedBatch(batch, inputType)));
    return out;
  }

  private async embedBatch(batch: string[], inputType: 'document' | 'query'): Promise<number[][]> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: batch,
          model: this.model,
          input_type: inputType,
          output_dtype: 'float',
          output_dimension: this.dimensions,
        }),
      });
    } catch (err) {
      throw new Error(`Could not reach the Voyage embedding API: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      if (response.status === 401 || response.status === 403) {
        throw new ConfigError(`Voyage rejected the API key (${response.status}). Check VOYAGE_API_KEY. ${detail}`);
      }
      const message = `Voyage embedding request failed (${response.status}): ${detail}`;
      // 429 and 5xx are transient; Temporal retries them, a bad model id is not.
      const error = new Error(message) as Error & { transient?: boolean };
      error.transient = response.status === 429 || response.status >= 500;
      throw error;
    }

    const body = (await response.json().catch(() => ({}))) as VoyageResponse;
    const data = body.data ?? [];
    if (data.length !== batch.length) {
      throw new Error(`Voyage returned ${data.length} embeddings for ${batch.length} inputs.`);
    }
    return [...data].sort((a, b) => a.index - b.index).map((entry) => entry.embedding);
  }
}
