/** Typed fetch wrapper for the CodeStream REST API. */

const TOKEN_KEY = 'codestream.token';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable (private mode) — requests will simply stay unauthenticated
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    const body = (await res.clone().json().catch(() => ({}))) as { error?: string };
    if (String(body.error ?? '').includes('Sign in with GitHub')) {
      location.href = '/';
      throw new ApiError(401, 'Redirecting to sign in…');
    }
    throw new ApiError(401, body.error ?? 'This deployment requires an API token.');
  }

  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const body = isJson ? ((await res.json()) as unknown) : null;
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error;
    throw new ApiError(res.status, message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

/** Audio streams honor ?token= because <audio> cannot send headers. */
export function audioUrl(id: string): string {
  const token = getToken();
  const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
  return `/api/casts/${encodeURIComponent(id)}/audio${suffix}`;
}
