import { randomBytes } from 'node:crypto';
import { serve } from '@hono/node-server';
import * as Sentry from '@sentry/node';
import { Client, Connection } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import { loadConfig } from '../config.js';
import { Store } from '../db/store.js';
import { ConfigError, InputError } from '../errors.js';
import { temporalConnectConfig } from '../temporal/connection.js';
import type { codestreamWorkflow, qaWorkflow } from '../temporal/workflows.js';
import { createApp } from './app.js';
import { GitHubOAuth } from '../github/oauth.js';
import { GitHubClient } from '../github/client.js';

/**
 * Re-surface a failed workflow's non-retryable InputError or ConfigError as
 * the API's own 400/503-carrying types; everything else keeps bubbling as a 500.
 */
function unwrapInputError(err: unknown): unknown {
  let cause: unknown = err instanceof Error ? err.cause : undefined;
  while (cause) {
    if (cause instanceof ApplicationFailure) {
      if (cause.type === 'InputError') return new InputError(cause.message || 'The request could not be completed.');
      if (cause.type === 'ConfigError') return new ConfigError(cause.message || 'Service is not configured.');
    }
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return err;
}

const config = loadConfig();
const store = await Store.connect(config.MONGODB_URI, config.MONGODB_DB);

// Lazy: the UI and read APIs keep working while Temporal is briefly unreachable.
const { connectionOptions, namespace } = temporalConnectConfig();
const connection = Connection.lazy(connectionOptions);
const temporal = new Client({ connection, namespace });

if (!config.CODESTREAM_API_TOKEN && config.NODE_ENV === 'production') {
  console.warn('CODESTREAM_API_TOKEN is not set: anyone who can reach this server can start casts and spend your API credits.');
}

const app = createApp({
  store,
  concurrency: config.LLM_CONCURRENCY,
  ...(config.CODESTREAM_API_TOKEN ? { apiToken: config.CODESTREAM_API_TOKEN } : {}),
  ...(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET && config.SESSION_SECRET
    ? { githubOAuth: new GitHubOAuth({ clientId: config.GITHUB_CLIENT_ID, clientSecret: config.GITHUB_CLIENT_SECRET, callbackUrl: config.GITHUB_CALLBACK_URL }), sessionSecret: config.SESSION_SECRET, secureCookies: config.NODE_ENV === 'production' && config.GITHUB_CALLBACK_URL.startsWith('https://') }
    : {}),
  ...(config.GITHUB_TOKEN ? { githubToken: config.GITHUB_TOKEN } : {}),
  listRepos: async (token?: string) => {
    if (!token) throw new InputError('Repository browsing requires GitHub sign-in or a GitHub token.');
    return new GitHubClient({ token }).listUserRepos();
  },
  startCast: async (workflowId, input) => {
    await temporal.workflow.start<typeof codestreamWorkflow>('codestreamWorkflow', {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId,
      args: [input],
    });
  },
  askQuestion: async (cast, question) => {
    const handle = await temporal.workflow.start<typeof qaWorkflow>('qaWorkflow', {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: `qa-${cast._id}-${randomBytes(6).toString('hex')}`,
      args: [{ castId: cast._id, question }],
    });
    try {
      return await handle.result();
    } catch (err) {
      throw unwrapInputError(err);
    }
  },
});

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`CodeStream is listening on http://localhost:${info.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await Promise.allSettled([connection.close(), store.close(), Sentry.flush(2_000)]);
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
