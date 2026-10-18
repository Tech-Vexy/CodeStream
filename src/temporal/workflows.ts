import { ActivityFailure, CancellationScope, isCancellation, proxyActivities } from '@temporalio/workflow';
import type { QaAnswer, QaInput, WorkflowInput } from '../domain.js';
import type { Activities } from './activities.js';

// Error class names from src/errors.ts: retrying them cannot help.
const nonRetryableErrorTypes = ['InputError', 'ConfigError'];

const bookkeeping = proxyActivities<Activities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '2 seconds', maximumAttempts: 10 },
});

const ingest = proxyActivities<Activities>({
  startToCloseTimeout: '15 minutes',
  retry: { initialInterval: '10 seconds', backoffCoefficient: 2, maximumAttempts: 5, nonRetryableErrorTypes },
});

// Model calls ride out rate limits (429) and provider hiccups with long, patient backoff.
const model = proxyActivities<Activities>({
  startToCloseTimeout: '15 minutes',
  retry: { initialInterval: '20 seconds', backoffCoefficient: 2, maximumInterval: '5 minutes', maximumAttempts: 8, nonRetryableErrorTypes },
});

const voice = proxyActivities<Activities>({
  startToCloseTimeout: '20 minutes',
  retry: { initialInterval: '15 seconds', backoffCoefficient: 2, maximumAttempts: 4, nonRetryableErrorTypes },
});

// Q&A indexing is best-effort: retrieval falls back to the chunk notes when it fails.
const indexing = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes',
  retry: { initialInterval: '5 seconds', backoffCoefficient: 2, maximumAttempts: 2, nonRetryableErrorTypes },
});

// One interactive question about a finished cast; retried briefly so provider hiccups stay invisible to the asker.
const qa = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: { initialInterval: '5 seconds', backoffCoefficient: 2, maximumAttempts: 4, nonRetryableErrorTypes },
});

/** The innermost failure message: ActivityFailure wraps the error the activity actually threw. */
function failureMessage(err: unknown): string {
  let current = err;
  while (current instanceof ActivityFailure && current.cause) current = current.cause;
  return current instanceof Error ? current.message : String(current);
}

/**
 * One cast: ingest the repo (or commit range), let Gemma take notes on each chunk with bounded
 * parallelism, synthesize the report, then optionally write and record the narration.
 */
export async function codestreamWorkflow(input: WorkflowInput): Promise<void> {
  const { castId } = input;
  try {
    const codebase = input.kind === 'codebase';
    await bookkeeping.setStage({ castId, stage: codebase ? 'Downloading the repository' : 'Fetching commits and diffs' });
    const { chunks } = codebase ? await ingest.ingestCodebase({ castId }) : await ingest.ingestChanges({ castId });

    await bookkeeping.setStage({
      castId,
      stage: codebase ? 'Gemma is reading the code' : 'Gemma is reading the diffs',
      progress: { done: 0, total: chunks },
    });
    let next = 0;
    const lane = async () => {
      while (next < chunks) {
        const index = next++;
        await model.summarizeChunk({ castId, index, total: chunks });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(input.concurrency, chunks)) }, lane));

    // Parallel Stage: Index embeddings for Q&A and synthesize the full report concurrently with Gemma
    await bookkeeping.setStage({
      castId,
      stage: codebase ? 'Gemma is synthesizing report and indexing codebase in parallel' : 'Gemma is synthesizing report and indexing diffs in parallel',
    });

    await Promise.all([
      (async () => {
        try {
          await indexing.indexEmbeddings({ castId });
        } catch (err) {
          if (isCancellation(err)) throw err;
          // Retrieval falls back to the chunk notes, so indexing trouble must not fail the cast.
          await bookkeeping.addWarning({ castId, warning: `Q&A indexing failed: ${failureMessage(err)}` });
        }
      })(),
      (async () => {
        await model.synthesizeReport({ castId });
      })(),
    ]);

    // Parallel Stage: Now that Gemma's report is ready, run audio briefing and ElevenLabs Voice Agent sync in parallel
    const postReportTasks: Promise<void>[] = [];

    if (input.audio) {
      postReportTasks.push(
        (async () => {
          try {
            await bookkeeping.setStage({ castId, stage: 'Writing the narration script' });
            await model.writeScript({ castId });
            await bookkeeping.setStage({ castId, stage: 'Recording audio with ElevenLabs' });
            await voice.recordAudio({ castId });
          } catch (err) {
            if (isCancellation(err)) throw err;
            // The written report is still worth delivering without audio.
            await bookkeeping.addWarning({ castId, warning: `Audio could not be recorded: ${failureMessage(err)}` });
          }
        })(),
      );
    }

    postReportTasks.push(
      (async () => {
        try {
          await bookkeeping.setStage({ castId, stage: 'Syncing Gemma analysis to ElevenLabs Voice Agent' });
          await voice.syncVoiceAgent({ castId });
        } catch (err) {
          if (isCancellation(err)) throw err;
          await bookkeeping.addWarning({ castId, warning: `Voice agent sync: ${failureMessage(err)}` });
        }
      })(),
    );

    await Promise.all(postReportTasks);

    await bookkeeping.completeCast({ castId });
  } catch (err) {
    const message = isCancellation(err) ? 'Cancelled.' : failureMessage(err);
    await CancellationScope.nonCancellable(() => bookkeeping.failCast({ castId, message }));
    throw err;
  }
}

/**
 * Answer one developer question about a finished cast. The API starts this workflow per question and
 * awaits the result, so model access stays on the worker where the model key is configured.
 */
export async function qaWorkflow(input: QaInput): Promise<QaAnswer> {
  return qa.answerQuestion(input);
}
