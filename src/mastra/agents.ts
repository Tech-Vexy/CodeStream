import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { createLogger } from '@mastra/core/logger';
import { Mastra } from '@mastra/core/mastra';
import type { ObservabilityExporter } from '@mastra/core/observability';
import { Observability } from '@mastra/observability';
import { SentryMastraExporter } from '@sentry/node';
import { ANALYST_INSTRUCTIONS, NARRATOR_INSTRUCTIONS, REVIEWER_INSTRUCTIONS } from './prompts.js';

export interface CodestreamMastraOptions {
  /** Mastra model-router id such as "google/gemma-4-31b-it", or a model instance (tests). */
  model: MastraModelConfig;
  /** Send agent runs and model calls to Sentry as AI spans (the Sentry SDK must be initialized). */
  sentry?: boolean;
}

export function createCodestreamMastra(options: CodestreamMastraOptions) {
  const agents = {
    codebaseAnalyst: new Agent({
      id: 'codebase-analyst',
      name: 'Codebase Analyst',
      instructions: ANALYST_INSTRUCTIONS,
      model: options.model,
    }),
    changeReviewer: new Agent({
      id: 'change-reviewer',
      name: 'Change Reviewer',
      instructions: REVIEWER_INSTRUCTIONS,
      model: options.model,
    }),
    narrator: new Agent({
      id: 'narrator',
      name: 'Narrator',
      instructions: NARRATOR_INSTRUCTIONS,
      model: options.model,
    }),
  };

  return new Mastra({
    agents,
    logger: createLogger({ name: 'CodeStream', level: 'info' }),
    ...(options.sentry
      ? {
          observability: new Observability({
            configs: {
              sentry: {
                serviceName: 'codestream-worker',
                // Sentry currently targets Mastra's newer exporter signatures; the runtime contract is compatible.
                exporters: [new SentryMastraExporter() as unknown as ObservabilityExporter],
              },
            },
          }),
        }
      : {}),
  });
}

export type CodestreamMastra = ReturnType<typeof createCodestreamMastra>;
export type AgentName = 'codebaseAnalyst' | 'changeReviewer' | 'narrator';
