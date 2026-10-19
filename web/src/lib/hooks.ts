import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { MeResponse } from '../lib/types';

/** Fetch the signed-in user once per mount; re-runs when `epoch` changes (e.g. after token entry). */
export function useMe(epoch: number = 0): { user: MeResponse['user']; authEnabled: boolean; loaded: boolean } {
  const [state, setState] = useState<{ user: MeResponse['user']; authEnabled: boolean; loaded: boolean }>({
    user: null,
    authEnabled: false,
    loaded: false,
  });

  const load = useCallback(() => {
    api<MeResponse>('/auth/me')
      .then((me) => setState({ user: me.user, authEnabled: me.authEnabled, loaded: true }))
      .catch(() => setState((prev) => ({ ...prev, loaded: true })));
  }, []);

  useEffect(load, [load, epoch]);
  return state;
}

/** Mirror the current location hash (#/casts/xyz) into React state. */
export function useHashRoute(): string {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}
