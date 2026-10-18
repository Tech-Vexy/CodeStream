import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { serveStatic } from '@hono/node-server/serve-static';
import * as Sentry from '@sentry/node';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Store } from '../db/store.js';
import type { CastDoc, QaAnswer, RepoSummary, WorkflowInput } from '../domain.js';
import { castView, parseRange, qaView, summaryView } from '../http/serialize.js';
import { InputError } from '../errors.js';
import { encryptGitHubToken, openSession, sealSession, signState, verifyState, type GitHubSession } from '../auth/session.js';
import type { GitHubOAuth } from '../github/oauth.js';
import { parseRepoUrl } from '../github/repo-url.js';

export interface AppDeps {
  store: Pick<Store, 'insertCast' | 'getCast' | 'listCasts' | 'updateCast' | 'openAudio' | 'listQa'>;
  /** Start the Temporal workflow that produces a cast. */
  startCast: (workflowId: string, input: WorkflowInput) => Promise<void>;
  /** Answer one question about a finished cast through the Temporal qaWorkflow. */
  askQuestion: (cast: CastDoc, question: string) => Promise<QaAnswer>;
  /** Chunk summaries a single cast may run in parallel. */
  concurrency: number;
  /** When set, every /api request must present it as a Bearer token (or ?token= for <audio>). */
  apiToken?: string;
  githubOAuth?: GitHubOAuth;
  sessionSecret?: string;
  githubToken?: string;
  listRepos?: (token?: string) => Promise<RepoSummary[]>;
  secureCookies?: boolean;
  publicDir?: string;
}

const REF = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const CAST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Return the cast for `id` if the id passes format validation, otherwise null. */
async function resolveCast(
  id: string,
  store: Pick<AppDeps['store'], 'getCast'>,
  ownerId?: number,
): Promise<CastDoc | null> {
  if (!CAST_ID.test(id)) return null;
  return store.getCast(id, ownerId);
}

const optionalRef = (field: string) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().regex(REF, `${field} must be a branch, tag or commit SHA`).optional(),
  );

function sameSecret(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

const createCastSchema = z.object({
  repoUrl: z.string({ error: 'repoUrl is required' }).trim().min(1, 'repoUrl is required').max(300),
  kind: z.enum(['codebase', 'changes']).default('codebase'),
  ref: optionalRef('ref'),
  base: optionalRef('base'),
  commitLimit: z.number().int().min(1).max(50).default(10),
  audio: z.boolean().default(true),
});

const questionSchema = z.object({
  question: z.string().trim().min(1, 'question is required').max(2000, 'question must be 2000 characters or fewer'),
});

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const cookie = (name: string, value: string, maxAge: number, httpOnly = true) =>
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${deps.secureCookies ? '; Secure' : ''}${httpOnly ? '; HttpOnly' : ''}`;
  const getCookie = (c: { req: { header(name: string): string | undefined } }, name: string) => {
    const value = c.req.header('cookie')?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
    return value ? decodeURIComponent(value) : undefined;
  };
  const getSession = (c: { req: { header(name: string): string | undefined } }) =>
    deps.sessionSecret ? openSession(getCookie(c, 'codestream_session'), deps.sessionSecret) : null;
  const authEnabled = Boolean(deps.githubOAuth && deps.sessionSecret);

  app.onError((err, c) => {
    Sentry.captureException(err);
    console.error(err);
    return c.json({ error: 'Something went wrong on our side.' }, 500);
  });

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.get('/auth/github', (c) => {
    if (!deps.githubOAuth || !deps.sessionSecret) return c.json({ error: 'GitHub OAuth is not configured.' }, 503);
    const state = randomBytes(24).toString('base64url');
    const signed = signState(state, deps.sessionSecret);
    return new Response(null, { status: 302, headers: { Location: deps.githubOAuth.authorizationUrl(signed), 'Set-Cookie': cookie('codestream_oauth_state', signed, 600) } });
  });

  app.get('/auth/github/callback', async (c) => {
    if (!deps.githubOAuth || !deps.sessionSecret) return c.json({ error: 'GitHub OAuth is not configured.' }, 503);
    const queryState = c.req.query('state');
    const cookieState = getCookie(c, 'codestream_oauth_state');
    if (!queryState || !cookieState) return c.json({ error: 'Invalid OAuth state.' }, 400);

    const state = verifyState(queryState, deps.sessionSecret) ?? queryState;
    const savedState = verifyState(cookieState, deps.sessionSecret);
    if (!savedState || !sameSecret(state, savedState)) return c.json({ error: 'Invalid OAuth state.' }, 400);
    const code = c.req.query('code');
    if (!code) return c.json({ error: 'GitHub did not return an authorization code.' }, 400);
    const exchanged = await deps.githubOAuth.exchange(code);
    const session: GitHubSession = { user: exchanged.user, accessToken: exchanged.accessToken, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
    const headers = new Headers({ Location: '/app' });
    headers.append('Set-Cookie', cookie('codestream_session', sealSession(session, deps.sessionSecret), 30 * 24 * 60 * 60));
    headers.append('Set-Cookie', cookie('codestream_oauth_state', '', 0));
    return new Response(null, { status: 302, headers });
  });

  app.all('/auth/logout', (c) => {
    const headers = new Headers({ Location: '/' });
    headers.append('Set-Cookie', cookie('codestream_session', '', 0));
    return new Response(null, { status: 302, headers });
  });

  app.get('/auth/me', (c) => {
    const session = getSession(c);
    return c.json({ user: session ? session.user : null, authEnabled });
  });

  app.get('/app', async (c) => {
    if (authEnabled && !getSession(c)) {
      return c.redirect('/');
    }
    const publicDir = deps.publicDir ?? './public';
    try {
      const html = await readFile(join(publicDir, 'app.html'), 'utf8');
      return c.html(html);
    } catch {
      return c.redirect('/');
    }
  });

  app.use('/api/*', async (c, next) => {
    if (authEnabled) {
      if (!getSession(c)) return c.json({ error: 'Sign in with GitHub to use CodeStream.' }, 401);
      return next();
    }
    if (!deps.apiToken) return next();
    const header = c.req.header('authorization');
    const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : c.req.query('token');
    if (!provided || !sameSecret(provided, deps.apiToken)) return c.json({ error: 'A valid API token is required.' }, 401);
    return next();
  });

  app.post('/api/casts', async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = createCastSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return c.json({ error: issue ? issue.message : 'Invalid request.' }, 400);
    }
    const { repoUrl, kind, ref, base, commitLimit, audio } = parsed.data;
    const session = getSession(c);
    const owner = session?.user ?? { id: 0, login: 'legacy' };
    const githubToken = session?.accessToken ?? deps.githubToken ?? '';
    if (authEnabled && !session) return c.json({ error: 'Sign in with GitHub to use CodeStream.' }, 401);

    let repo;
    try {
      repo = parseRepoUrl(repoUrl);
    } catch (err) {
      if (err instanceof InputError) return c.json({ error: err.message }, 400);
      throw err;
    }

    const id = randomBytes(9).toString('base64url');
    const workflowId = `codestream-${id}`;
    const now = new Date();
    const cast: CastDoc = {
      _id: id,
      owner,
      // OAuth tokens are encrypted per cast. The worker's configured global token is
      // already available to the worker and should not be copied into every document.
      githubToken: deps.sessionSecret ? encryptGitHubToken(githubToken, deps.sessionSecret) : '',
      kind,
      repo: { ...repo, fullName: `${repo.owner}/${repo.name}`, url: `https://github.com/${repo.owner}/${repo.name}` },
      request: { ...(ref ? { ref } : {}), ...(kind === 'changes' && base ? { base } : {}), commitLimit, audio },
      status: 'queued',
      stage: 'Queued',
      workflowId,
      warnings: [],
      createdAt: now,
      updatedAt: now,
    };
    await deps.store.insertCast(cast);

    try {
      await deps.startCast(workflowId, { castId: id, kind, audio, concurrency: deps.concurrency });
    } catch (err) {
      Sentry.captureException(err);
      console.error('Could not start workflow', err);
      const error = 'Could not start the job because Temporal is unreachable. Try again shortly.';
      await deps.store.updateCast(id, { status: 'failed', stage: 'Failed', error });
      return c.json({ error }, 503);
    }
    return c.json({ cast: castView(cast) }, 202);
  });

  app.get('/api/casts', async (c) => {
    const session = getSession(c);
    const rawLimit = Number(c.req.query('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.ceil(rawLimit), 100) : 30;
    const casts = await deps.store.listCasts(limit, authEnabled ? session?.user.id : undefined);
    return c.json({ casts: casts.map(summaryView) });
  });

  app.get('/api/repos', async (c) => {
    if (!deps.listRepos) return c.json({ error: 'Repository browsing is not configured.' }, 503);
    const session = getSession(c);
    try {
      const repos = await deps.listRepos(session?.accessToken ?? deps.githubToken);
      return c.json({ repos });
    } catch (err) {
      if (err instanceof InputError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  app.get('/api/casts/:id', async (c) => {
    const id = c.req.param('id');
    const session = getSession(c);
    const cast = await resolveCast(id, deps.store, authEnabled ? session?.user.id : undefined);
    if (!cast) return c.json({ error: 'Cast not found.' }, 404);
    return c.json({ cast: castView(cast) });
  });

  app.get('/api/casts/:id/audio', async (c) => {
    const id = c.req.param('id');
    const session = getSession(c);
    const cast = await resolveCast(id, deps.store, authEnabled ? session?.user.id : undefined);
    if (!cast?.audio) return c.json({ error: 'This cast has no audio.' }, 404);

    const { fileId, bytes, contentType } = cast.audio;
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=86400',
    };
    const range = parseRange(c.req.header('range'), bytes);
    if (range === 'unsatisfiable') return c.body(null, 416, { 'Content-Range': `bytes */${bytes}` });

    // GridFS ranges are end-exclusive; HTTP ranges are end-inclusive.
    const stream = deps.store.openAudio(fileId, range ? { start: range.start, end: range.end + 1 } : undefined);
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    if (range) {
      return new Response(body, {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${bytes}`, 'Content-Length': String(range.end - range.start + 1) },
      });
    }
    return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(bytes) } });
  });

  app.get('/api/casts/:id/qa', async (c) => {
    const id = c.req.param('id');
    const session = getSession(c);
    const cast = await resolveCast(id, deps.store, authEnabled ? session?.user.id : undefined);
    if (!cast) return c.json({ error: 'Cast not found.' }, 404);
    const qa = await deps.store.listQa(cast._id);
    return c.json({ qa: qa.map(qaView) });
  });

  app.post('/api/casts/:id/qa', async (c) => {
    const id = c.req.param('id');
    const session = getSession(c);
    const cast = await resolveCast(id, deps.store, authEnabled ? session?.user.id : undefined);
    if (!cast) return c.json({ error: 'Cast not found.' }, 404);
    if (cast.status !== 'ready') return c.json({ error: 'This cast is not ready for questions yet.' }, 409);

    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = questionSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return c.json({ error: issue ? issue.message : 'Invalid request.' }, 400);
    }

    try {
      const answer = await deps.askQuestion(cast, parsed.data.question);
      return c.json({ qa: { ...answer, question: parsed.data.question } }, 201);
    } catch (err) {
      if (err instanceof InputError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  app.use('/*', serveStatic({ root: deps.publicDir ?? './public' }));
  app.notFound((c) => c.json({ error: 'Not found.' }, 404));

  return app;
}
