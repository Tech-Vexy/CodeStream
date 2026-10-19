import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { kindLabel, timeAgo } from '../../lib/format';
import type { Cast } from '../../lib/types';
import { Icon } from '../../components/icons';
import { Progress } from '../../components/ui';
import { AudioCard } from './AudioCard';
import { TranscriptCard } from './TranscriptCard';
import { QaPanel } from './QaPanel';
import { ReportSections } from './ReportCards';
import { Skeleton } from '../../components/ui';

const POLL_MIN_MS = 3_000;
const POLL_MAX_MS = 30_000;

interface CastDetailProps {
  castId: string;
  /** Bumped to force a re-fetch (e.g. after the API token changes). */
  epoch: number;
  onUnauthorized: () => void;
  /** Notify the parent so the history list can refresh alongside polls. */
  onActivity: () => void;
}

function StatusLine({ cast }: { cast: Cast }) {
  if (cast.status === 'ready') {
    return <p className="status ready">Ready{cast.completedAt ? ` · ${timeAgo(cast.completedAt)}` : ''}</p>;
  }
  if (cast.status === 'failed') {
    return <p className="status failed">Failed</p>;
  }
  const { progress } = cast;
  return (
    <div className="status working">
      <p>
        {cast.stage}
        {progress ? ` (${progress.done}/${progress.total})` : ''}…
      </p>
      <Progress done={progress?.done} total={progress?.total} />
    </div>
  );
}

export function CastDetail({ castId, epoch, onUnauthorized, onActivity }: CastDetailProps) {
  const [cast, setCast] = useState<Cast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollMs = useRef(POLL_MIN_MS);
  const currentId = useRef(castId);

  const load = useCallback(async () => {
    try {
      const data = await api<{ cast: Cast }>(`/api/casts/${encodeURIComponent(castId)}`);
      if (currentId.current !== castId) return; // user navigated away mid-flight
      setCast(data.cast);
      setError(null);
      onActivity();
      return data.cast;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return null;
      }
      setError(err instanceof Error ? err.message : 'Could not load this cast.');
      return null;
    }
  }, [castId, onActivity, onUnauthorized]);

  // Reset backoff and state whenever the target cast changes.
  useEffect(() => {
    currentId.current = castId;
    pollMs.current = POLL_MIN_MS;
    setCast(null);
    setError(null);
  }, [castId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      const fresh = await load();
      if (cancelled) return;
      if (fresh && (fresh.status === 'queued' || fresh.status === 'running')) {
        const delay = pollMs.current;
        pollMs.current = Math.min(pollMs.current * 2, POLL_MAX_MS);
        timer = window.setTimeout(() => void tick(), delay);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [load, epoch]);

  if (error) {
    return (
      <section className="panel detail">
        <p className="error-box">{error}</p>
      </section>
    );
  }

  if (!cast) {
    return (
      <section className="panel detail" aria-busy="true">
        <header className="detail-head">
          <div className="detail-head-meta">
            <Skeleton width={230} height={12} />
            <Skeleton width={150} height={30} />
          </div>
          <Skeleton width={440} height={28} />
          <Skeleton width={130} height={14} />
        </header>

        <div className="audio-hero-card">
          <div className="audio-hero-header">
            <div className="audio-hero-title">
              <Skeleton width={26} height={26} />
              <Skeleton width={118} height={16} />
            </div>
            <Skeleton width={150} height={22} />
          </div>
          <div className="wv-row">
            <Skeleton width={46} height={46} />
            <div style={{ display: 'flex', gap: 3, flex: 1, alignItems: 'center', height: 46 }} aria-hidden="true">
              {Array.from({ length: 28 }, (_, i) => (
                <span key={i} className="skeleton" style={{ flex: 1, minWidth: 2, height: `${25 + ((i * 37) % 60)}%`, borderRadius: 2 }} />
              ))}
            </div>
          </div>
        </div>

        <div className="transcript-card">
          <Skeleton width={170} height={16} />
          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            {['100%', '94%', '97%', '88%', '60%'].map((w, i) => (
              <Skeleton key={i} width={w} height={12} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  const source = cast.source?.sha ? ` @ ${cast.source.sha.slice(0, 7)}` : '';
  const title = cast.report?.title ?? cast.repo.fullName;
  document.title = `${title} · CodeStream`;

  return (
    <section className="panel detail">
      <header className="detail-head">
        <div className="detail-head-meta">
          <p className="eyebrow">
            {kindLabel(cast.kind)} ·{' '}
            <a href={cast.repo.url} target="_blank" rel="noopener noreferrer">
              {cast.repo.fullName}
              <Icon name="external" size={11} style={{ marginLeft: 4, verticalAlign: '-1px' }} />
            </a>
            {source}
          </p>
          <a href="#/new" className="btn-inline-new">
            + New audio summary
          </a>
        </div>
        <h2>{title}</h2>
        <StatusLine cast={cast} />
      </header>

      {cast.status === 'failed' && <p className="error-box">{cast.error ?? 'This audio summary failed to generate.'}</p>}

      {cast.warnings.length > 0 && (
        <ul className="warnings">
          {cast.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <AudioCard cast={cast} />
      <TranscriptCard cast={cast} />
      <QaPanel cast={cast} epoch={epoch} onUnauthorized={onUnauthorized} />
      <ReportSections report={cast.report} />
    </section>
  );
}
