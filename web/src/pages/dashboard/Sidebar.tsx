import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import type { CastSummary } from '../../lib/types';
import { StatusPill } from '../../components/ui';

interface SidebarProps {
  currentId: string | null;
  /** Bump to force a refresh (after creating a cast, poll ticks, token changes). */
  refreshKey: number;
  onUnauthorized: () => void;
}

export function Sidebar({ currentId, refreshKey, onUnauthorized }: SidebarProps) {
  const [casts, setCasts] = useState<CastSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ casts: CastSummary[] }>('/api/casts');
      setCasts(data.casts);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setError(err instanceof Error ? err.message : 'Could not load history.');
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <aside className="sidebar">
      <a href="#/new" className="btn btn-primary btn-new-summary">
        <span>+ New audio summary</span>
      </a>

      <div className="sidebar-history">
        <div className="sidebar-title-row">
          <h3>Previous summaries</h3>
        </div>
        <ul className="cast-list">
          {casts === null && !error ? (
            <>
              {[64, 52, 58, 46].map((w, i) => (
                <li key={i} style={{ padding: '10px 12px' }}>
                  <span className="skeleton" style={{ display: 'block', width: '100%', height: 13, marginBottom: 7 }} />
                  <span className="skeleton" style={{ display: 'block', width: `${w}%`, height: 10 }} />
                </li>
              ))}
            </>
          ) : error ? (
            <li className="empty">{error}</li>
          ) : casts && casts.length > 0 ? (
            casts.map((cast) => (
              <li key={cast.id}>
                <a href={`#/casts/${encodeURIComponent(cast.id)}`} className={cast.id === currentId ? 'active' : ''}>
                  <span className="cast-repo">{cast.repo.fullName}</span>
                  <span className="cast-row">
                    <StatusPill status={cast.status} />
                    <time dateTime={cast.createdAt}>{timeAgo(cast.createdAt)}</time>
                  </span>
                </a>
              </li>
            ))
          ) : (
            <li className="empty">No audio summaries yet.</li>
          )}
        </ul>
      </div>
    </aside>
  );
}
