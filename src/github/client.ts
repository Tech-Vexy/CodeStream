import { ConfigError, InputError } from '../errors.js';
import type { RepoSummary } from '../domain.js';

/** Retryable GitHub failure (rate limit, 5xx, network); Temporal retries these with backoff. */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface GitHubRepo {
  fullName: string;
  htmlUrl: string;
  description: string | null;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  parents: string[];
}

export interface GitHubCommitFile {
  path: string;
  previousPath?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface GitHubCommitDetail extends GitHubCommit {
  additions: number;
  deletions: number;
  files: GitHubCommitFile[];
}

export interface GitHubClientOptions {
  token?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface RawCommit {
  sha: string;
  parents?: Array<{ sha: string }>;
  author?: { login?: string } | null;
  commit: { message: string; author?: { name?: string; date?: string } | null };
  stats?: { additions?: number; deletions?: number };
  files?: Array<{
    filename: string;
    previous_filename?: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

function toCommit(raw: RawCommit): GitHubCommit {
  return {
    sha: raw.sha,
    message: raw.commit.message,
    author: raw.commit.author?.name ?? raw.author?.login ?? 'unknown',
    date: raw.commit.author?.date ?? '',
    parents: (raw.parents ?? []).map((parent) => parent.sha),
  };
}

const seg = encodeURIComponent;

export class GitHubClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GitHubClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://api.github.com';
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request(path: string, what: string, accept = 'application/vnd.github+json'): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: accept,
      'User-Agent': 'codestream',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`;

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { headers, redirect: 'follow' });
    if (res.ok) return res;

    const body = await res.text().catch(() => '');
    const detail = (() => {
      try {
        return (JSON.parse(body) as { message?: string }).message ?? body;
      } catch {
        return body;
      }
    })().slice(0, 300);

    if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const when = Number.isFinite(reset) && reset > 0 ? ` (resets ${new Date(reset * 1000).toISOString()})` : '';
      throw new GitHubError(`GitHub rate limit hit while fetching ${what}${when}. Setting GITHUB_TOKEN raises the limit.`, res.status);
    }
    if (res.status === 404) {
      throw new InputError(`GitHub could not find ${what}. Check the name and ref; private repos need a GITHUB_TOKEN with read access.`);
    }
    if (res.status === 409 || res.status === 422) throw new InputError(`GitHub rejected the request for ${what}: ${detail}`);
    if (res.status === 401 || res.status === 403) throw new ConfigError(`GitHub denied access to ${what} (${res.status}): ${detail}`);
    throw new GitHubError(`GitHub returned ${res.status} for ${what}: ${detail}`, res.status);
  }

  async getRepo(owner: string, name: string): Promise<GitHubRepo> {
    const res = await this.request(`/repos/${seg(owner)}/${seg(name)}`, `repository ${owner}/${name}`);
    const raw = (await res.json()) as {
      full_name: string;
      html_url: string;
      description: string | null;
      default_branch: string;
      private: boolean;
    };
    return {
      fullName: raw.full_name,
      htmlUrl: raw.html_url,
      description: raw.description,
      defaultBranch: raw.default_branch,
      isPrivate: raw.private,
    };
  }

  /** Resolve a branch, tag or (short) SHA to a full commit SHA. */
  async resolveCommitSha(owner: string, name: string, ref: string): Promise<string> {
    const res = await this.request(
      `/repos/${seg(owner)}/${seg(name)}/commits/${seg(ref)}`,
      `ref "${ref}" in ${owner}/${name}`,
      'application/vnd.github.sha',
    );
    return (await res.text()).trim();
  }

  /** Download the gzipped tarball of a commit, refusing archives larger than `maxBytes`. */
  async downloadTarball(owner: string, name: string, sha: string, maxBytes: number): Promise<Buffer> {
    const res = await this.request(`/repos/${seg(owner)}/${seg(name)}/tarball/${seg(sha)}`, `the source archive of ${owner}/${name}`);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new InputError(`The repository archive is ${Math.round(declared / 1e6)} MB; the limit is ${Math.round(maxBytes / 1e6)} MB.`);
    }
    if (!res.body) return Buffer.alloc(0);

    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of res.body) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        throw new InputError(`The repository archive exceeds the ${Math.round(maxBytes / 1e6)} MB limit.`);
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** The most recent `limit` commits reachable from `ref`, newest first. */
  async listCommits(owner: string, name: string, ref: string, limit: number): Promise<GitHubCommit[]> {
    const perPage = Math.min(Math.max(limit, 1), 100);
    const res = await this.request(
      `/repos/${seg(owner)}/${seg(name)}/commits?sha=${seg(ref)}&per_page=${perPage}`,
      `commits on "${ref}" in ${owner}/${name}`,
    );
    return ((await res.json()) as RawCommit[]).slice(0, limit).map(toCommit);
  }

  /**
   * Commits in `base...head`, oldest first, keeping only the most recent `limit`.
   * The compare API pages commits oldest-first, so the newest ones live on the last page(s).
   */
  async compareCommits(
    owner: string,
    name: string,
    base: string,
    head: string,
    limit: number,
  ): Promise<{ commits: GitHubCommit[]; totalCommits: number }> {
    const perPage = 100;
    const path = (page: number) =>
      `/repos/${seg(owner)}/${seg(name)}/compare/${seg(base)}...${seg(head)}?per_page=${perPage}&page=${page}`;
    const what = `the comparison ${base}...${head} in ${owner}/${name}`;

    const fetchPage = async (page: number) =>
      (await (await this.request(path(page), what)).json()) as { total_commits: number; commits: RawCommit[] };

    const first = await fetchPage(1);
    const total = first.total_commits;
    const lastPage = Math.ceil(total / perPage);

    // Commits are returned oldest-first; we want the newest `limit` commits, which live on the
    // last page(s). Collect pages from the end until we have enough, deduplicating by SHA.
    let raw: RawCommit[] = [];
    if (lastPage <= 1) {
      raw = first.commits;
    } else {
      const last = await fetchPage(lastPage);
      raw = last.commits;
      if (raw.length < limit && lastPage - 1 > 1) {
        const prev = await fetchPage(lastPage - 1);
        raw = [...prev.commits, ...raw];
      } else if (raw.length < limit && lastPage - 1 === 1) {
        // lastPage === 2: first.commits is page 1, already fetched.
        raw = [...first.commits, ...raw];
      }
      // Deduplicate by SHA (the two pages may overlap if the total is not a round multiple).
      const seen = new Set<string>();
      raw = raw.filter((c) => (seen.has(c.sha) ? false : (seen.add(c.sha), true)));
    }

    return { commits: raw.slice(-limit).map(toCommit), totalCommits: total };
  }

  async getCommit(owner: string, name: string, sha: string): Promise<GitHubCommitDetail> {
    const res = await this.request(`/repos/${seg(owner)}/${seg(name)}/commits/${seg(sha)}`, `commit ${sha.slice(0, 7)} in ${owner}/${name}`);
    const raw = (await res.json()) as RawCommit;
    return {
      ...toCommit(raw),
      additions: raw.stats?.additions ?? 0,
      deletions: raw.stats?.deletions ?? 0,
      files: (raw.files ?? []).map((file) => ({
        path: file.filename,
        ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        ...(file.patch !== undefined ? { patch: file.patch } : {}),
      })),
    };
  }

  /**
   * Repositories the authenticated account owns, collaborates on or can access through memberships,
   * most recently pushed first. Requires the `repo` scope of a user OAuth token.
   */
  async listUserRepos(limit = 100): Promise<RepoSummary[]> {
    const perPage = Math.min(Math.max(limit, 1), 100);
    const res = await this.request(
      `/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&direction=desc&per_page=${perPage}`,
      'your repositories',
    );
    const raw = (await res.json()) as Array<{
      full_name?: string;
      html_url?: string;
      description?: string | null;
      default_branch?: string;
      private?: boolean;
      language?: string | null;
      stargazers_count?: number;
      pushed_at?: string | null;
    }>;
    return raw
      .filter((repo): repo is typeof repo & { full_name: string; html_url: string; default_branch: string } =>
        Boolean(repo.full_name && repo.html_url && repo.default_branch),
      )
      .slice(0, limit)
      .map((repo) => ({
        fullName: repo.full_name,
        htmlUrl: repo.html_url,
        description: repo.description ?? null,
        defaultBranch: repo.default_branch,
        isPrivate: repo.private ?? false,
        language: repo.language ?? null,
        stars: repo.stargazers_count ?? 0,
        pushedAt: repo.pushed_at ?? null,
      }));
  }
}
