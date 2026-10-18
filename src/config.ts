import { z } from 'zod';
import { loadDotEnv } from './env.js';

const optionalString = z.string().trim().min(1).optional();

/** Accepts 1/true/yes/on (case-insensitive); unset or empty falls back to `fallback`. */
const enabledFlag = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    return Boolean(value);
  }, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017'),
  MONGODB_DB: z.string().default('codestream'),

  // TEMPORAL_ADDRESS / TEMPORAL_NAMESPACE / TEMPORAL_API_KEY are read by @temporalio/envconfig.
  TEMPORAL_TASK_QUEUE: z.string().default('codestream'),

  // Shared secret for the HTTP API. When unset the API is open (fine for local use only).
  CODESTREAM_API_TOKEN: optionalString,
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,
  GITHUB_CALLBACK_URL: z.string().url().default('http://localhost:3000/auth/github/callback'),
  SESSION_SECRET: z.string().min(32).optional(),

  // Mastra model-router id. The Google provider reads GOOGLE_GENERATIVE_AI_API_KEY.
  CODESTREAM_MODEL: z.string().default('google/gemma-4-31b-it'),
  LLM_CHUNK_CHARS: z.coerce.number().int().min(4_000).default(24_000),
  LLM_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  CODEBASE_MAX_CHARS: z.coerce.number().int().min(10_000).default(600_000),
  CHANGES_MAX_CHARS: z.coerce.number().int().min(10_000).default(400_000),

  GITHUB_TOKEN: optionalString,

  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_VOICE_ID: z.string().default('JBFqnCBsd6RMkjVDRZzb'),
  ELEVENLABS_MODEL_ID: z.string().default('eleven_multilingual_v2'),

  // MongoDB Voyage AI embedding models (https://docs.voyageai.com). Used for codebase Q&A retrieval.
  VOYAGE_API_KEY: optionalString,
  VOYAGE_EMBEDDING_MODEL: z.string().default('voyage-code-3'),
  VOYAGE_EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .refine((value) => [256, 512, 1024, 2048].includes(value), { message: 'must be one of 256, 512, 1024, 2048' })
    .default(1024),

  // Sentry is opt-in: set SENTRY_ENABLED=true (and a DSN) to turn observability back on.
  SENTRY_ENABLED: enabledFlag(false),
  SENTRY_DSN: optionalString,
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env) loadDotEnv();
  // Treat empty strings (common in dashboards and .env templates) as unset.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''));
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
