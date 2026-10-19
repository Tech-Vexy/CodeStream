import { useCallback, useEffect, useState } from 'react';
import { TopBar } from '../components/TopBar';
import { TokenDialog } from '../components/TokenDialog';
import { useHashRoute, useMe } from '../lib/hooks';
import { setToken } from '../lib/api';
import type { Cast } from '../lib/types';
import { Sidebar } from './dashboard/Sidebar';
import { GeneratorForm } from './dashboard/GeneratorForm';
import { CastDetail } from './dashboard/CastDetail';

/** Parse "#/casts/<id>" from a location hash; null means the generator view. */
function castIdFromHash(hash: string): string | null {
  const match = /^#\/casts\/([^/]+)$/.exec(hash);
  return match ? decodeURIComponent(match[1] ?? '') : null;
}

export function Dashboard() {
  document.title = 'CodeStream · Dashboard';

  const [epoch, setEpoch] = useState(0);
  const { user, authEnabled, loaded } = useMe(epoch);
  const hash = useHashRoute();
  const castId = castIdFromHash(hash);

  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [listKey, setListKey] = useState(0);

  const onUnauthorized = useCallback(() => setTokenDialogOpen(true), []);
  const onActivity = useCallback(() => setListKey((k) => k + 1), []);

  // The production server redirects signed-out visitors away from /app already;
  // this covers direct SPA loads (e.g. the Vite dev server) for parity.
  useEffect(() => {
    if (loaded && authEnabled && !user) location.href = '/';
  }, [loaded, authEnabled, user]);

  // Fresh view per route: start at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [castId]);

  const handleCreated = useCallback((cast: Cast) => {
    location.hash = `#/casts/${encodeURIComponent(cast.id)}`;
    setListKey((k) => k + 1);
  }, []);

  return (
    <>
      <TopBar user={user} authEnabled={authEnabled} variant="app" />
      <div className="layout">
        <Sidebar currentId={castId} refreshKey={listKey} onUnauthorized={onUnauthorized} />
        <main className="main-content">
          {castId ? (
            <CastDetail
              key={castId}
              castId={castId}
              epoch={epoch}
              onUnauthorized={onUnauthorized}
              onActivity={onActivity}
            />
          ) : (
            <GeneratorForm onCreated={handleCreated} onUnauthorized={onUnauthorized} />
          )}
        </main>
      </div>

      <TokenDialog
        open={tokenDialogOpen}
        onClose={() => setTokenDialogOpen(false)}
        onSaved={() => {
          setTokenDialogOpen(false);
          setEpoch((e) => e + 1);
          setListKey((k) => k + 1);
        }}
      />
    </>
  );
}
