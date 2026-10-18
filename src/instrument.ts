// Loaded with `node --import` before the app so Sentry could instrument http, MongoDB and Mastra.
// Sentry is DISABLED by default: nothing is initialized unless SENTRY_ENABLED=true and a DSN is set.
import * as Sentry from '@sentry/node';
import { loadDotEnv } from './env.js';

loadDotEnv();

const enabled = ['1', 'true', 'yes', 'on'].includes((process.env.SENTRY_ENABLED ?? '').trim().toLowerCase());
const dsn = process.env.SENTRY_DSN?.trim();
if (enabled && dsn) {
  const sampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.2);
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    // Render exposes the deployed commit; fall back to an explicit release if one is set.
    release: process.env.SENTRY_RELEASE || process.env.RENDER_GIT_COMMIT,
    tracesSampleRate: Number.isFinite(sampleRate) ? sampleRate : 0.2,
  });
}
