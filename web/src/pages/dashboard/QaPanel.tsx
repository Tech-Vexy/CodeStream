import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { inline, paragraphs } from '../../lib/format';
import type { Cast, QaExchange } from '../../lib/types';
import { Button, Skeleton } from '../../components/ui';
import { Icon } from '../../components/icons';

interface QaPanelProps {
  cast: Cast;
  /** Bump to re-fetch history (e.g. after the API token changes). */
  epoch: number;
  onUnauthorized: () => void;
}

/** Grounded Q&A: ask anything about a finished cast; answers cite the analyzed files. */
export function QaPanel({ cast, epoch, onUnauthorized }: QaPanelProps) {
  const ready = cast.status === 'ready';
  const [history, setHistory] = useState<QaExchange[] | null>(null);
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    api<{ qa: QaExchange[] }>(`/api/casts/${encodeURIComponent(cast.id)}/qa`)
      .then((data) => {
        if (!cancelled) setHistory(data.qa);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorized();
          return;
        }
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, cast.id, epoch, onUnauthorized]);

  const ask = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = question.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await api<{ qa: QaExchange }>(`/api/casts/${encodeURIComponent(cast.id)}/qa`, {
        method: 'POST',
        body: JSON.stringify({ question: text }),
      });
      setHistory((prev) => [...(prev ?? []), data.qa]);
      setQuestion('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setError(err instanceof Error ? err.message : 'Could not get an answer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="qa-card" aria-label="Questions and answers">
      <div className="qa-header">
        <div>
          <h3>Ask about this cast</h3>
          <p className="qa-sub">Grounded in the analyzed code — answers cite the exact files and functions.</p>
        </div>
      </div>

      {!ready ? (
        <p className="qa-empty">Q&amp;A unlocks once the analysis finishes. Keep an eye on the status above.</p>
      ) : (
        <>
          {history === null ? (
            <div className="qa-thread" aria-hidden="true">
              <Skeleton height={14} width="70%" />
              <Skeleton height={12} width="92%" />
              <Skeleton height={12} width="85%" />
            </div>
          ) : history.length === 0 ? (
            <p className="qa-empty">
              No questions yet. Try &ldquo;Where does authentication happen?&rdquo; or ask about any file in the report.
            </p>
          ) : (
            <div className="qa-thread">
              {history.map((qa) => (
                <div className="qa-item" key={qa.id}>
                  <p className="qa-question">
                    <Icon name="message" size={15} />
                    {qa.question}
                  </p>
                  <div className="qa-answer">
                    {paragraphs(qa.answer).map((p, i) => (
                      <p key={i}>{inline(p)}</p>
                    ))}
                  </div>
                  {qa.citations.length > 0 && (
                    <div className="paths qa-cited">
                      {qa.citations.map((c) => (
                        <code key={c}>{c}</code>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <form className="qa-form" onSubmit={ask}>
            <input
              className="input"
              placeholder="Ask a question about this codebase…"
              maxLength={2000}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              aria-label="Your question"
            />
            <Button type="submit" loading={submitting} disabled={!question.trim()}>
              <Icon name="sparkles" size={15} />
              Ask
            </Button>
          </form>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
