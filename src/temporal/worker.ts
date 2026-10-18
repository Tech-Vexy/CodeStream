import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import { NativeConnection, Worker } from '@temporalio/worker';
import { ElevenLabsNarrator, ElevenLabsVoiceAgentManager } from '../audio/elevenlabs.js';
import { loadConfig } from '../config.js';
import { Store } from '../db/store.js';
import { VoyageEmbedder } from '../embeddings/voyage.js';
import { GitHubClient } from '../github/client.js';
import { createCodestreamMastra } from '../mastra/agents.js';
import { Analyst } from '../mastra/analyst.js';
import { createQaService } from '../qa/service.js';
import { createActivities } from './activities.js';
import { temporalConnectConfig } from './connection.js';
import { sentryActivityInterceptor } from './sentry.js';

const config = loadConfig();
const mastra = createCodestreamMastra({ model: config.CODESTREAM_MODEL, sentry: Sentry.isInitialized() });
const logger = mastra.getLogger();

if (config.CODESTREAM_MODEL.startsWith('google/') && !process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.GOOGLE_API_KEY) {
  logger.warn('GOOGLE_GENERATIVE_AI_API_KEY is not set, so every Gemma call will fail.');
}
if (!config.ELEVENLABS_API_KEY) logger.warn('ELEVENLABS_API_KEY is not set; casts will be delivered without audio.');
if (!config.VOYAGE_API_KEY) logger.info('VOYAGE_API_KEY is not set; Q&A retrieval falls back to the chunk notes.');

const store = await Store.connect(config.MONGODB_URI, config.MONGODB_DB);
const analyst = new Analyst(mastra);
const embedder = config.VOYAGE_API_KEY
  ? new VoyageEmbedder({
      apiKey: config.VOYAGE_API_KEY,
      model: config.VOYAGE_EMBEDDING_MODEL,
      dimensions: config.VOYAGE_EMBEDDING_DIMENSIONS,
    })
  : undefined;
const activities = createActivities({
  store,
  github: new GitHubClient(config.GITHUB_TOKEN ? { token: config.GITHUB_TOKEN } : {}),
  analyst,
  ...(embedder ? { embedder } : {}),
  qa: createQaService({ store, analyst, ...(embedder ? { embedder } : {}) }),
  ...(config.ELEVENLABS_API_KEY
    ? {
        speech: new ElevenLabsNarrator({
          apiKey: config.ELEVENLABS_API_KEY,
          voiceId: config.ELEVENLABS_VOICE_ID,
          modelId: config.ELEVENLABS_MODEL_ID,
        }),
        voiceAgent: new ElevenLabsVoiceAgentManager({
          apiKey: config.ELEVENLABS_API_KEY,
          voiceId: config.ELEVENLABS_VOICE_ID,
          modelId: config.ELEVENLABS_MODEL_ID,
          agentTtsModel: config.ELEVENLABS_AGENT_TTS_MODEL,
          agentLlm: config.ELEVENLABS_AGENT_LLM,
        }),
      }
    : {}),
  limits: {
    chunkChars: config.LLM_CHUNK_CHARS,
    codebaseMaxChars: config.CODEBASE_MAX_CHARS,
    changesMaxChars: config.CHANGES_MAX_CHARS,
    maxTarballBytes: 100_000_000,
    maxUnpackedBytes: 300_000_000,
  },
  ...(config.SESSION_SECRET ? { sessionSecret: config.SESSION_SECRET } : {}),
});

const { connectionOptions, namespace } = temporalConnectConfig();
const connection = await NativeConnection.connect(connectionOptions);
const worker = await Worker.create({
  connection,
  namespace,
  taskQueue: config.TEMPORAL_TASK_QUEUE,
  // workflows.ts under tsx in development, workflows.js once compiled.
  workflowsPath: fileURLToPath(new URL(`./workflows${extname(fileURLToPath(import.meta.url))}`, import.meta.url)),
  activities,
  // Bounds memory on small instances: repository ingestion holds the unpacked archive in memory.
  maxConcurrentActivityTaskExecutions: 8,
  interceptors: { activity: [sentryActivityInterceptor] },
});

logger.info(`CodeStream worker polling "${config.TEMPORAL_TASK_QUEUE}" in namespace "${namespace}" with ${config.CODESTREAM_MODEL}`);
try {
  await worker.run();
} finally {
  await connection.close();
  await store.close();
  await Sentry.flush(2_000);
}
