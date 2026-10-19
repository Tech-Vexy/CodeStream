import { Avatar, Button } from './ui';
import { GithubIcon, LogoMark } from './icons';
import type { AuthUser } from '../lib/types';

interface TopBarProps {
  user: AuthUser | null;
  authEnabled: boolean;
  variant: 'landing' | 'app';
}

export function TopBar({ user, authEnabled, variant }: TopBarProps) {
  const isApp = variant === 'app';
  return (
    <header className="top">
      <div className="brand-group">
        <a className="brand" href={isApp ? '/app' : '/'}>
          <LogoMark />
          CodeStream
        </a>
        <nav className="nav-links" aria-label="Primary">
          {isApp ? (
            <>
              <a className="nav-link" href="/">
                &larr; Home
              </a>
              <a className="nav-link active" href="/app">
                Dashboard
              </a>
            </>
          ) : (
            <>
              <a className="nav-link" href="#features">
                Features
              </a>
              <a className="nav-link" href="#how-it-works">
                How it works
              </a>
              <a className="nav-link" href="#preview">
                Preview
              </a>
            </>
          )}
        </nav>
      </div>

      <div className="account">
        {user ? (
          <>
            <div className="user-badge">
              <Avatar login={user.login} avatarUrl={user.avatarUrl} />
              <span className="user-login">{user.login}</span>
              <a href="/auth/logout" className="btn-signout">
                Sign out
              </a>
            </div>
            {!isApp && (
              <Button size="sm" onClick={() => (location.href = '/app')}>
                Open dashboard
              </Button>
            )}
          </>
        ) : authEnabled ? (
          <a href="/auth/github" className="btn btn-github btn-sm">
            <GithubIcon size={15} />
            <span>Sign in with GitHub</span>
          </a>
        ) : isApp ? null : (
          <Button size="sm" onClick={() => (location.href = '/app')}>
            Open dashboard
          </Button>
        )}
      </div>
    </header>
  );
}
