import { describe, expect, it } from 'vitest';
import { decryptGitHubToken, encryptGitHubToken, openSession, sealSession } from '../src/auth/session.js';

const SECRET = 'a'.repeat(32);

describe('GitHub OAuth session protection', () => {
  it('seals and opens an authenticated session', () => {
    const session = {
      user: { id: 42, login: 'octocat', name: 'Octo Cat' },
      accessToken: 'github-token',
      expiresAt: Date.now() + 60_000,
    };

    expect(openSession(sealSession(session, SECRET), SECRET)).toEqual(session);
  });

  it('rejects tampering and expired sessions', () => {
    const value = sealSession(
      { user: { id: 42, login: 'octocat' }, accessToken: 'github-token', expiresAt: Date.now() - 1 },
      SECRET,
    );
    expect(openSession(value, SECRET)).toBeNull();
    expect(openSession(`${value}x`, SECRET)).toBeNull();
  });

  it('encrypts GitHub tokens without exposing the plaintext', () => {
    const encrypted = encryptGitHubToken('github-token', SECRET);

    expect(encrypted).not.toContain('github-token');
    expect(decryptGitHubToken(encrypted, SECRET)).toBe('github-token');
  });
});
