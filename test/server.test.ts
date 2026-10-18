import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import type { CastDoc } from '../src/domain.js';
import type { GitHubOAuth } from '../src/github/oauth.js';

function makeDeps(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  const casts = new Map<string, CastDoc>();
  const store = {
    insertCast: vi.fn(async (cast: CastDoc) => {
      casts.set(cast._id, cast);
    }),
    getCast: vi.fn(async (id: string) => casts.get(id) ?? null),
    listCasts: vi.fn(async () => []),
    updateCast: vi.fn(async () => {}),
    openAudio: vi.fn(),
    listQa: vi.fn(async () => []),
  };
  return {
    deps: {
      store,
      startCast: vi.fn(async () => {}),
      askQuestion: vi.fn(async () => ({ id: 'qa1', answer: 'Because of the retry loop.', citations: ['src/worker.ts'] })),
      concurrency: 2,
      ...overrides,
    },
    casts,
  };
}

describe('HTTP API', () => {
  it('starts GitHub OAuth when configured', async () => {
    const oauth = {
      authorizationUrl: vi.fn((state: string) => `https://github.com/login/oauth/authorize?state=${state}`),
      exchange: vi.fn(),
    } as unknown as GitHubOAuth;
    const { deps } = makeDeps({ githubOAuth: oauth, sessionSecret: 'a'.repeat(32) });
    const response = await createApp(deps).request('/auth/github');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('https://github.com/login/oauth/authorize');
    expect(response.headers.get('set-cookie')).toContain('codestream_oauth_state=');
  });

  it('completes GitHub OAuth callback when state is valid', async () => {
    const oauth = {
      authorizationUrl: vi.fn(),
      exchange: vi.fn(async () => ({
        accessToken: 'mock-gh-token',
        user: { id: 123, login: 'testuser', name: 'Test User' },
      })),
    } as unknown as GitHubOAuth;
    const { deps } = makeDeps({ githubOAuth: oauth, sessionSecret: 'a'.repeat(32) });
    const app = createApp(deps);

    const initRes = await app.request('/auth/github');
    expect(initRes.status).toBe(302);
    const setCookie = initRes.headers.get('set-cookie')!;
    const stateMatch = setCookie.match(/codestream_oauth_state=([^;]+)/);
    expect(stateMatch?.[1]).toBeTruthy();
    const cookieState = decodeURIComponent(stateMatch![1] as string);

    const callbackRes = await app.request(`/auth/github/callback?code=mock_code&state=${cookieState}`, {
      headers: { Cookie: `codestream_oauth_state=${cookieState}` },
    });

    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('location')).toBe('/app');
    expect(callbackRes.headers.get('set-cookie')).toContain('codestream_session=');
    expect(oauth.exchange).toHaveBeenCalledWith('mock_code');
  });

  it('rejects GitHub OAuth callback with invalid state', async () => {
    const oauth = {
      authorizationUrl: vi.fn(),
      exchange: vi.fn(),
    } as unknown as GitHubOAuth;
    const { deps } = makeDeps({ githubOAuth: oauth, sessionSecret: 'a'.repeat(32) });
    const app = createApp(deps);

    const res = await app.request('/auth/github/callback?code=mock_code&state=badstate', {
      headers: { Cookie: 'codestream_oauth_state=forged' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid OAuth state.' });
    expect(oauth.exchange).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users from /app to / when OAuth is enabled', async () => {
    const oauth = {} as unknown as GitHubOAuth;
    const { deps } = makeDeps({ githubOAuth: oauth, sessionSecret: 'a'.repeat(32) });
    const app = createApp(deps);

    const res = await app.request('/app');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('serves health checks without API authentication', async () => {
    const { deps } = makeDeps({ apiToken: 'secret' });
    const response = await createApp(deps).request('/healthz');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('requires a configured API token for API routes', async () => {
    const { deps } = makeDeps({ apiToken: 'secret' });
    const app = createApp(deps);

    expect((await app.request('/api/casts')).status).toBe(401);
    expect((await app.request('/api/casts', { headers: { Authorization: 'Bearer secret' } })).status).toBe(200);
  });

  it('creates a cast and starts the workflow with normalized repository data', async () => {
    const { deps, casts } = makeDeps();
    const app = createApp(deps);
    const response = await app.request('/api/casts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/acme/widget.git', audio: false }),
    });
    const body = (await response.json()) as { cast: CastDoc & { id: string; hasAudio: boolean } };

    expect(response.status).toBe(202);
    expect(body.cast.repo).toMatchObject({
      owner: 'acme',
      name: 'widget',
      fullName: 'acme/widget',
      url: 'https://github.com/acme/widget',
    });
    expect(body.cast.hasAudio).toBe(false);
    expect(deps.startCast).toHaveBeenCalledWith(
      expect.stringMatching(/^codestream-/),
      expect.objectContaining({ castId: body.cast.id, kind: 'codebase', audio: false, concurrency: 2 }),
    );
    expect(casts.has(body.cast.id)).toBe(true);
  });

  it('rejects invalid repository input before persistence or workflow start', async () => {
    const { deps } = makeDeps();
    const response = await createApp(deps).request('/api/casts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://gitlab.com/acme/widget' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringContaining('Only GitHub repositories') });
    expect(deps.store.insertCast).not.toHaveBeenCalled();
    expect(deps.startCast).not.toHaveBeenCalled();
  });

  it('provides a signed voice session URL for a ready cast', async () => {
    const readyCast: CastDoc = {
      _id: 'test-cast-12345678',
      owner: { id: 1, login: 'user' },
      githubToken: '',
      kind: 'codebase',
      repo: { owner: 'acme', name: 'widget', fullName: 'acme/widget', url: 'https://github.com/acme/widget' },
      request: { commitLimit: 10, audio: true },
      status: 'ready',
      stage: 'Ready',
      workflowId: 'wf-1',
      report: {
        title: 'Acme Widget',
        tldr: 'Widget tool',
        purpose: 'Build widgets',
        architecture: 'Modular',
        techStack: ['TypeScript'],
        components: [],
        dataFlow: 'Direct',
        entryPoints: [],
        risks: [],
        readingOrder: [],
        openQuestions: [],
      },
      warnings: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { deps, casts } = makeDeps({
      getVoiceSession: vi.fn(async () => ({ signedUrl: 'wss://api.elevenlabs.io/v1/convai/test', agentId: 'agent-123' })),
    });
    casts.set(readyCast._id, readyCast);
    const app = createApp(deps);

    const res = await app.request(`/api/casts/${readyCast._id}/voice/session`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      session: { signedUrl: 'wss://api.elevenlabs.io/v1/convai/test', agentId: 'agent-123' },
    });
    expect(deps.getVoiceSession).toHaveBeenCalledWith(readyCast);
  });

  it('returns 503 when ElevenLabs voice agent is not configured', async () => {
    const readyCast: CastDoc = {
      _id: 'test-cast-12345678',
      owner: { id: 1, login: 'user' },
      githubToken: '',
      kind: 'codebase',
      repo: { owner: 'acme', name: 'widget', fullName: 'acme/widget', url: 'https://github.com/acme/widget' },
      request: { commitLimit: 10, audio: true },
      status: 'ready',
      stage: 'Ready',
      workflowId: 'wf-1',
      warnings: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { deps, casts } = makeDeps({ getVoiceSession: undefined });
    casts.set(readyCast._id, readyCast);
    const app = createApp(deps);

    const res = await app.request(`/api/casts/${readyCast._id}/voice/session`, { method: 'POST' });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('ELEVENLABS_API_KEY');
  });

  it('executes the Gemma Code Analyser tool for grounded queries', async () => {
    const readyCast: CastDoc = {
      _id: 'test-cast-12345678',
      owner: { id: 1, login: 'user' },
      githubToken: '',
      kind: 'codebase',
      repo: { owner: 'acme', name: 'widget', fullName: 'acme/widget', url: 'https://github.com/acme/widget' },
      request: { commitLimit: 10, audio: true },
      status: 'ready',
      stage: 'Ready',
      workflowId: 'wf-1',
      warnings: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { deps, casts } = makeDeps();
    casts.set(readyCast._id, readyCast);
    const app = createApp(deps);

    const res = await app.request(`/api/casts/${readyCast._id}/tool/gemma`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'How is authentication handled?' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      tool: 'gemma_code_analyser',
      question: 'How is authentication handled?',
      result: 'Because of the retry loop.',
      citations: ['src/worker.ts'],
    });
    expect(deps.askQuestion).toHaveBeenCalledWith(readyCast, 'How is authentication handled?');
  });
});
