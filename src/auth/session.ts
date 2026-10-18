import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface GitHubSession {
  user: { id: number; login: string; name?: string | null; avatarUrl?: string };
  accessToken: string;
  expiresAt: number;
}

function key(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function sealSession(session: GitHubSession, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function openSession(value: string | undefined, secret: string): GitHubSession | null {
  if (!value) return null;
  try {
    const [ivText, tagText, ciphertextText] = value.split('.');
    if (!ivText || !tagText || !ciphertextText) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const session = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8')) as GitHubSession;
    if (session.user?.id === undefined || !session.user.login || !session.accessToken || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function encryptGitHubToken(token: string, secret: string): string {
  return sealSession({ user: { id: 0, login: 'token' }, accessToken: token, expiresAt: Number.MAX_SAFE_INTEGER }, secret);
}

export function decryptGitHubToken(value: string, secret: string): string | null {
  return openSession(value, secret)?.accessToken ?? null;
}

export function signState(state: string, secret: string): string {
  return `${state}.${createHmac('sha256', secret).update(state).digest('base64url')}`;
}

export function verifyState(value: string | undefined, secret: string): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const state = value.slice(0, dot);
  const supplied = Buffer.from(value.slice(dot + 1), 'base64url');
  const expected = createHmac('sha256', secret).update(state).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? state : null;
}
