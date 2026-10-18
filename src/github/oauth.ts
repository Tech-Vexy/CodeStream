import { ConfigError } from '../errors.js';

export interface GitHubUser {
  id: number;
  login: string;
  name?: string | null;
  avatarUrl?: string;
}

export interface GitHubOAuthOptions {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  fetch?: typeof fetch;
}

export class GitHubOAuth {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GitHubOAuthOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  authorizationUrl(state: string): string {
    const params = new URLSearchParams({ client_id: this.options.clientId, redirect_uri: this.options.callbackUrl, state, scope: 'repo read:user user:email' });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async exchange(code: string): Promise<{ accessToken: string; user: GitHubUser }> {
    const tokenResponse = await this.fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.options.clientId, client_secret: this.options.clientSecret, code }),
    });
    const tokenBody = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokenBody.access_token) throw new ConfigError(`GitHub OAuth token exchange failed: ${tokenBody.error_description ?? tokenResponse.statusText}`);

    const userResponse = await this.fetchImpl('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenBody.access_token}`, 'User-Agent': 'codestream', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    const raw = (await userResponse.json().catch(() => ({}))) as { id?: number; login?: string; name?: string | null; avatar_url?: string };
    if (!userResponse.ok || !raw.id || !raw.login) throw new ConfigError(`GitHub user lookup failed: ${userResponse.statusText}`);
    return { accessToken: tokenBody.access_token, user: { id: raw.id, login: raw.login, name: raw.name, avatarUrl: raw.avatar_url } };
  }
}
