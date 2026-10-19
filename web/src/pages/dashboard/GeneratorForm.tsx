import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import type { Cast, CreateCastInput, RepoSummary } from '../../lib/types';
import { Button } from '../../components/ui';
import { Icon } from '../../components/icons';

interface GeneratorFormProps {
  onCreated: (cast: Cast) => void;
  onUnauthorized: () => void;
}

const kindMeta = {
  codebase: {
    icon: 'map' as const,
    title: 'Codebase tour',
    hint: 'Architecture, components, data flow and risks for the whole repository.',
  },
  changes: {
    icon: 'git-compare' as const,
    title: 'Recent changes',
    hint: 'What the latest commits changed, what to verify before trusting them.',
  },
};

export function GeneratorForm({ onCreated, onUnauthorized }: GeneratorFormProps) {
  const [kind, setKind] = useState<'codebase' | 'changes'>('codebase');
  const [repoUrl, setRepoUrl] = useState('');
  const [ref, setRef] = useState('');
  const [base, setBase] = useState('');
  const [commitLimit, setCommitLimit] = useState(10);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ repos: RepoSummary[] }>('/api/repos')
      .then((data) => setRepos(data.repos))
      .catch((err) => {
        if (!(err instanceof ApiError)) return;
        if (err.status === 401) onUnauthorized();
        // 503 = repository browsing not configured; leave the datalist empty.
      });
  }, [onUnauthorized]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const payload: CreateCastInput = { repoUrl: repoUrl.trim(), kind, audio: true };
    const trimmedRef = ref.trim();
    if (trimmedRef) payload.ref = trimmedRef;
    if (kind === 'changes') {
      const trimmedBase = base.trim();
      if (trimmedBase) payload.base = trimmedBase;
      payload.commitLimit = commitLimit;
    }

    setSubmitting(true);
    try {
      const data = await api<{ cast: Cast }>('/api/casts', { method: 'POST', body: JSON.stringify(payload) });
      onCreated(data.cast);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="panel generator-panel">
      <div className="generator-header">
        <h2>Generate an audio summary</h2>
        <p>Select any GitHub repository to analyze and listen to an AI-narrated audio briefing.</p>
      </div>

      <form onSubmit={submit} autoComplete="off">
        <div className="field">
          <label htmlFor="repo-url">GitHub repository</label>
          <input
            id="repo-url"
            className="input"
            list="repo-options"
            required
            placeholder="owner/repo or https://github.com/owner/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <datalist id="repo-options">
            {repos.map((r) => (
              <option key={r.fullName} value={r.fullName}>
                {r.description ? `${r.fullName} — ${r.description}` : r.fullName}
              </option>
            ))}
          </datalist>
        </div>

        <fieldset>
          <legend>What should CodeStream explain?</legend>
          <div className="kind-options" role="radiogroup" aria-label="Cast kind">
            {(Object.keys(kindMeta) as Array<keyof typeof kindMeta>).map((k) => {
              const meta = kindMeta[k];
              return (
                <label key={k} className={`kind-card${kind === k ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                  />
                  <strong>
                    <Icon name={meta.icon} size={15} />
                    {meta.title}
                  </strong>
                  <span>{meta.hint}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="cast-ref">Branch, tag or commit</label>
          <input
            id="cast-ref"
            className="input"
            placeholder="default branch"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </div>

        {kind === 'changes' && (
          <div className="form-row">
            <div className="field">
              <label htmlFor="commit-limit">Commits to review</label>
              <input
                id="commit-limit"
                className="input"
                type="number"
                min={1}
                max={50}
                value={commitLimit}
                onChange={(e) => setCommitLimit(Number(e.target.value) || 10)}
              />
            </div>
            <div className="field">
              <label htmlFor="cast-base">Or everything since</label>
              <input
                id="cast-base"
                className="input"
                placeholder="commit, tag or branch (optional)"
                value={base}
                onChange={(e) => setBase(e.target.value)}
              />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Button type="submit" size="lg" loading={submitting}>
            <Icon name="mic" size={16} />
            Generate audio summary
          </Button>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
            Typically 2–6 minutes depending on repository size.
          </span>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
