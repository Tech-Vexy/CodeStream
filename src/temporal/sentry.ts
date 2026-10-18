import * as Sentry from '@sentry/node';
import type { ActivityInterceptorsFactory } from '@temporalio/worker';

/**
 * Report activity failures to Sentry. User mistakes (InputError) are not incidents, and transient
 * errors are only reported once they have survived a few retries, so rate limits do not flood Sentry.
 */
export const sentryActivityInterceptor: ActivityInterceptorsFactory = (ctx) => ({
  inbound: {
    async execute(input, next) {
      try {
        return await next(input);
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name !== 'InputError' && (name === 'ConfigError' || ctx.info.attempt >= 3)) {
          const castId = (input.args[0] as { castId?: unknown } | undefined)?.castId;
          Sentry.withScope((scope) => {
            scope.setTags({
              'temporal.activity': ctx.info.activityType,
              'temporal.attempt': ctx.info.attempt,
              'temporal.workflow_id': ctx.info.workflowExecution?.workflowId ?? 'unknown',
              ...(typeof castId === 'string' ? { 'codestream.cast_id': castId } : {}),
            });
            Sentry.captureException(err);
          });
        }
        throw err;
      }
    },
  },
});
