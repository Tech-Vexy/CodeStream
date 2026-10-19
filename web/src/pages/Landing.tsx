import { useState } from 'react';
import { GithubIcon, Icon, LogoMark } from '../components/icons';
import { TopBar } from '../components/TopBar';
import { useMe } from '../lib/hooks';
import type { AuthUser } from '../lib/types';

interface LandingProps {
  /** Bumped when the auth state changes elsewhere; re-fetches /auth/me. */
  epoch?: number;
}

function heroTarget(user: AuthUser | null, authEnabled: boolean): { href: string; github: boolean; label: string } {
  if (user || !authEnabled) return { href: '/app', github: false, label: 'Open Dashboard' };
  return { href: '/auth/github', github: true, label: 'Get Started with GitHub' };
}

function GithubCta({ user, authEnabled, large = false }: { user: AuthUser | null; authEnabled: boolean; large?: boolean }) {
  const target = heroTarget(user, authEnabled);
  return (
    <a href={target.href} className={`btn ${target.github ? 'btn-github' : 'btn-primary'} ${large ? 'btn-lg' : ''}`}>
      {target.github && <GithubIcon size={20} />}
      <span>{target.label}</span>
      {!target.github && <Icon name="arrow-right" size={16} />}
    </a>
  );
}

function Wave({ playing = false, bars = 14 }: { playing?: boolean; bars?: number }) {
  return (
    <div className={`audio-wave${playing ? ' playing' : ''}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="bar" />
      ))}
    </div>
  );
}

function Mockup() {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="mockup-window">
      <div className="mockup-header">
        <div className="mockup-dots">
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
        </div>
        <div className="mockup-tab">
          <span className="mockup-repo">facebook/react</span>
          <span className="pill ready">Ready</span>
        </div>
        <div className="mockup-meta">Branch: main &middot; commit 7a3f89b</div>
      </div>
      <div className="mockup-body">
        <div className="mockup-audio">
          <button
            type="button"
            className={`audio-play-btn${playing ? ' playing' : ''}`}
            aria-label={playing ? 'Pause preview' : 'Play preview'}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <Wave playing={playing} />
          <span className="audio-timer">03:42 / 05:18</span>
          <span className="audio-badge">ElevenLabs Voice Briefing</span>
        </div>

        <div className="mockup-grid">
          <div className="mockup-panel">
            <h4>Architecture &amp; Components</h4>
            <p className="mockup-prose">
              React is structured around a declarative component model decoupled from execution targets. Core
              reconciliation logic coordinates fiber trees, lane prioritization, and work loops.
            </p>
            <div className="mockup-chips">
              <span className="chip">TypeScript</span>
              <span className="chip">Fiber Reconciler</span>
              <span className="chip">Concurrent Lanes</span>
              <span className="chip">Scheduler</span>
            </div>
          </div>

          <div className="mockup-panel">
            <h4>Audited Risks</h4>
            <ul className="mockup-risks">
              <li className="mockup-risk">
                <span className="sev high">high</span>
                <div>
                  <strong>Unhandled error boundary propagation</strong>
                  <p>Async lane transitions can bypass top-level recovery boundaries under heavy load.</p>
                  <code>packages/react-reconciler/ReactFiberWorkLoop.js</code>
                </div>
              </li>
              <li className="mockup-risk">
                <span className="sev medium">medium</span>
                <div>
                  <strong>Fallback scheduler starvation</strong>
                  <p>Timer resolution degrades under nested microtasks.</p>
                  <code>packages/scheduler/Scheduler.js</code>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

const features = [
  {
    icon: 'map' as const,
    title: 'Codebase guided tours',
    body: 'Dissect entire repositories in minutes. Architectural summaries, component responsibility breakdowns, data flow paths, and prioritized reading orders for human reviewers.',
  },
  {
    icon: 'git-compare' as const,
    title: 'Commit & PR audits',
    body: 'Inspect ranges of commits and diffs with surgical precision. Catch modified manifests, untested files, and breaking changes, with an interactive "Before You Trust It" checklist.',
  },
  {
    icon: 'mic' as const,
    title: 'Narrated audio briefings',
    body: 'Listen to your code briefings like a podcast on the commute or between reviews. Scripts are written for the ear and voiced by ElevenLabs with instant playback and scrubbing.',
  },
  {
    icon: 'message' as const,
    title: 'Grounded Q&A with citations',
    body: 'Ask questions directly about any finished cast. Answers are grounded in Voyage AI code embeddings and cited against real files — no hallucinations.',
  },
];

const steps = [
  {
    title: 'Connect your repository',
    body: 'Paste any public or private GitHub repository URL. Choose a branch, commit SHA, or diff range.',
  },
  {
    title: 'Multi-agent deep analysis',
    body: 'Mastra AI agents running Google Gemma read, summarize, and synthesize code chunks with strict grounding.',
  },
  {
    title: 'Listen, inspect & interrogate',
    body: 'Stream the narrated audio, review concrete risks, and ask technical questions with verified citations.',
  },
];

export function Landing({ epoch = 0 }: LandingProps) {
  const { user, authEnabled } = useMe(epoch);
  document.title = 'CodeStream · Know what your coding agent built';

  return (
    <div className="landing">
      <TopBar user={user} authEnabled={authEnabled} variant="landing" />

      {/* Hero */}
      <section className="hero container">
        <div className="hero-badge">
          <span className="badge-dot" />
          <span>Know what your coding agent actually built</span>
        </div>
        <h1 className="hero-title">
          Stop blindly trusting
          <br />
          <span className="gradient-text">agent-written code.</span>
        </h1>
        <p className="hero-subtitle">
          Autonomous coding agents can produce thousands of lines in seconds. CodeStream analyzes the full architecture,
          pinpoints concrete risks, generates narrated audio briefings, and answers your questions with source-cited
          precision.
        </p>
        <div className="hero-actions">
          <GithubCta user={user} authEnabled={authEnabled} large />
          <a href="#preview" className="btn btn-secondary btn-lg">
            <span>Explore preview</span>
          </a>
        </div>
        <p className="hero-microcopy">
          Works with public and private repositories &middot; Zero credentials leaked to LLMs &middot; No credit card
          required
        </p>
      </section>

      {/* Preview */}
      <section id="preview" className="preview-section container">
        <Mockup />
      </section>

      {/* Features */}
      <section id="features" className="features-section container">
        <div className="section-header">
          <h2 className="section-title">Built for the age of autonomous coding agents</h2>
          <p className="section-subtitle">
            Everything you need to review, understand, and trust agent-generated code before shipping.
          </p>
        </div>
        <div className="features-grid">
          {features.map((f) => (
            <div className="feature-card" key={f.title}>
              <div className="feature-icon">
                <Icon name={f.icon} size={20} />
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Security */}
      <section className="security-section container">
        <div className="security-card">
          <div className="security-content">
            <span className="badge-dot green" />
            <h3>Security by design: zero-leak redaction</h3>
            <p>
              CodeStream deterministically scans for credential files (<code>.env</code>, private keys, certificates,
              service accounts) and quarantines them. They are <strong>never sent to the LLM</strong> — instead they are
              flagged directly in your audit report.
            </p>
          </div>
          <div className="security-content">
            <span className="badge-dot purple" />
            <h3>Enterprise workflow reliability</h3>
            <p>
              Powered by <strong>Temporal</strong> distributed workflows. Ingestion, model calls, and voice synthesis
              ride out rate limits and provider hiccups with resilient exponential backoffs and durable state machines.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="steps-section container">
        <div className="section-header">
          <h2 className="section-title">How CodeStream works</h2>
          <p className="section-subtitle">From git repository to actionable briefing in three automated steps.</p>
        </div>
        <div className="steps-grid">
          {steps.map((s, i) => (
            <div className="step-card" key={s.title}>
              <div className="step-num">{String(i + 1).padStart(2, '0')}</div>
              <h4>{s.title}</h4>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container">
        <div className="cta-banner">
          <h2>Stop guessing what your agent changed.</h2>
          <p>Start listening to your codebase and review pull requests with complete confidence.</p>
          <GithubCta user={user} authEnabled={authEnabled} large />
        </div>
      </section>

      {/* Footer */}
      <footer className="site-footer">
        <div className="footer-content container">
          <div className="brand">
            <LogoMark />
            CodeStream
          </div>
          <p className="footer-text">
            Engineered with Hono, Temporal, Mastra, Google Gemma, ElevenLabs, and MongoDB.
          </p>
        </div>
      </footer>
    </div>
  );
}
