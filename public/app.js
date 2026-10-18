const TOKEN_KEY = 'codestream.token';
const POLL_MS_MIN = 3000;
const POLL_MS_MAX = 30000;
const state = { currentId: null, pollTimer: null, pollMs: POLL_MS_MIN };

const $ = (selector) => document.querySelector(selector);

/** Build DOM nodes without ever interpreting strings as HTML (model output is untrusted). */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false || child === '') continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Inline text with `code` spans and **bold** markers stripped. */
function inline(text) {
  const parts = String(text ?? '').replace(/\*\*(.+?)\*\*/g, '$1').split('`');
  if (parts.length % 2 === 0) {
    const last = parts.pop();
    parts[parts.length - 1] += '`' + last;
  }
  return parts.map((part, i) => (i % 2 === 1 ? el('code', { text: part }) : document.createTextNode(part)));
}

function prose(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .filter((para) => para.trim())
    .map((para) => el('p', {}, inline(para.trim())));
}

const kindLabel = (kind) => (kind === 'changes' ? 'Change review' : 'Codebase tour');

function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  return '';
}

function askForToken() {
  const dialog = $('#token-dialog');
  const input = dialog.querySelector('input');
  input.value = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        if (dialog.returnValue === 'save' && input.value.trim()) {
          localStorage.setItem(TOKEN_KEY, input.value.trim());
          resolve(true);
        } else {
          resolve(false);
        }
      },
      { once: true },
    );
  });
}

async function api(path, options = {}) {
  const headers = options.body ? { 'Content-Type': 'application/json' } : {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    const message = (await res.clone().json().catch(() => ({}))).error;
    if (String(message).includes('Sign in with GitHub')) {
      location.href = '/';
      throw new Error('Redirecting to home page.');
    }
    if (await askForToken()) return api(path, options);
    throw new Error('This deployment requires an API token.');
  }
  const body = (res.headers.get('content-type') ?? '').includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

function audioUrl(id) {
  const token = localStorage.getItem(TOKEN_KEY);
  return `/api/casts/${encodeURIComponent(id)}/audio${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

function statusLabel(cast) {
  if (cast.status === 'ready') return 'Ready';
  if (cast.status === 'failed') return 'Failed';
  if (cast.status === 'queued') return 'Queued';
  return 'Working';
}

// ---------------------------------------------------------------- Auth

async function initAuth() {
  const accountEl = $('#account');
  try {
    const res = await fetch('/auth/me');
    if (!res.ok) return;
    const { user, authEnabled } = await res.json();

    if (authEnabled && !user) {
      // Unauthenticated visitor trying to view dashboard directly -> redirect to landing
      location.href = '/';
      return;
    }

    if (user && accountEl) {
      const avatar = user.avatarUrl
        ? el('img', { src: user.avatarUrl, class: 'user-avatar', alt: user.login })
        : el('span', { class: 'user-avatar', text: user.login.slice(0, 1).toUpperCase() });

      accountEl.replaceChildren(
        el(
          'div',
          { class: 'user-badge' },
          avatar,
          el('span', { class: 'user-login', text: user.login }),
          el('a', { href: '/auth/logout', class: 'btn-signout', text: 'Sign out' }),
        ),
      );
    }
  } catch {
    // network fallback
  }
}

// ---------------------------------------------------------------- Repositories

let reposLoaded = false;
async function loadRepos() {
  if (reposLoaded) return;
  try {
    const data = await api('/api/repos');
    if (data?.repos) {
      const datalist = $('#repo-options');
      if (datalist) {
        datalist.replaceChildren(
          ...data.repos.map((r) =>
            el('option', { value: r.fullName, text: r.description ? `${r.fullName} — ${r.description}` : r.fullName }),
          ),
        );
        reposLoaded = true;
      }
    }
  } catch {
    // Repository browsing may be unconfigured
  }
}

// ---------------------------------------------------------------- List

async function _loadList() {
  const list = $('#cast-list');
  if (!list) return;
  try {
    const { casts } = await api('/api/casts');
    list.replaceChildren(
      ...(casts.length
        ? casts.map((cast) =>
            el(
              'li',
              {},
              el(
                'a',
                { href: `#/casts/${encodeURIComponent(cast.id)}`, class: cast.id === state.currentId ? 'active' : '' },
                el('span', { class: 'cast-repo', text: cast.repo.fullName }),
                el('span', { class: `pill ${cast.status}`, text: statusLabel(cast) }),
                el('time', { datetime: cast.createdAt, text: timeAgo(cast.createdAt) }),
              ),
            ),
          )
        : [el('li', { class: 'empty', text: 'No audio summaries yet.' })]),
    );
  } catch (err) {
    list.replaceChildren(el('li', { class: 'empty', text: err.message }));
  }
}

// Debounced: rapid back-to-back calls collapse into a single fetch.
let _loadListTimer = null;
function loadList() {
  clearTimeout(_loadListTimer);
  _loadListTimer = setTimeout(() => _loadList(), 80);
}

// ---------------------------------------------------------------- Detail

const pathList = (paths) => (paths?.length ? el('p', { class: 'paths' }, paths.map((path) => el('code', { text: path }))) : null);

function statusLine(cast) {
  if (cast.status === 'ready') return el('p', { class: 'status ready', text: `Ready${cast.completedAt ? ` · ${timeAgo(cast.completedAt)}` : ''}` });
  if (cast.status === 'failed') return el('p', { class: 'status failed', text: 'Failed' });
  const progress = cast.progress;
  return el(
    'div',
    { class: 'status working' },
    el('p', { text: `${cast.stage}${progress ? ` (${progress.done}/${progress.total})` : ''}…` }),
    progress && progress.total > 0 ? el('progress', { max: progress.total, value: progress.done }) : el('progress'),
  );
}

// ---------------------------------------------------------------- Audio Player

function audioPlayerCard(cast) {
  const card = el('div', { class: 'audio-hero-card' });

  const header = el(
    'div',
    { class: 'audio-hero-header' },
    el(
      'div',
      { class: 'audio-hero-title' },
      el('span', { class: 'audio-icon', text: '🎙️' }),
      el('h3', { text: 'Audio Summary' }),
    ),
    el('span', { class: 'pill ready', text: 'ElevenLabs Audio' }),
  );

  if (cast.hasAudio) {
    const audio = el('audio', { controls: true, preload: 'metadata', src: audioUrl(cast.id), class: 'audio-element' });

    const speeds = [0.75, 1, 1.25, 1.5, 2];
    const speedButtons = speeds.map((speed) => {
      const btn = el('button', {
        type: 'button',
        class: `speed-btn ${speed === 1 ? 'active' : ''}`,
        text: `${speed}x`,
        onclick: () => {
          audio.playbackRate = speed;
          speedButtons.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
        },
      });
      return btn;
    });

    const skipBackBtn = el('button', {
      type: 'button',
      class: 'skip-btn',
      text: '↺ -10s',
      title: 'Rewind 10 seconds',
      onclick: () => {
        audio.currentTime = Math.max(0, audio.currentTime - 10);
      },
    });

    const skipForwardBtn = el('button', {
      type: 'button',
      class: 'skip-btn',
      text: '+10s ↻',
      title: 'Forward 10 seconds',
      onclick: () => {
        audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 10);
      },
    });

    const controlsBar = el(
      'div',
      { class: 'audio-controls-bar' },
      el('div', { class: 'skip-group' }, skipBackBtn, skipForwardBtn),
      el('div', { class: 'speed-group' }, el('span', { class: 'speed-label', text: 'Speed:' }), ...speedButtons),
    );

    card.append(header, audio, controlsBar);
  } else if (cast.status === 'queued' || cast.status === 'running') {
    const soundwave = el(
      'div',
      { class: 'soundwave-anim' },
      el('span', { class: 'bar bar-1' }),
      el('span', { class: 'bar bar-2' }),
      el('span', { class: 'bar bar-3' }),
      el('span', { class: 'bar bar-4' }),
      el('span', { class: 'bar bar-5' }),
    );
    card.append(
      header,
      el(
        'div',
        { class: 'audio-generating' },
        soundwave,
        el('p', { class: 'generating-text', text: 'Gemma is analyzing the code and ElevenLabs is generating your audio summary…' }),
      ),
    );
  } else {
    card.append(
      header,
      el('p', { class: 'muted', text: 'Audio was not generated for this summary.' }),
    );
  }

  return card;
}

// ---------------------------------------------------------------- Spoken Transcript

function transcriptCard(cast) {
  if (!cast.script && cast.status === 'ready') return null;

  const card = el('section', { class: 'transcript-card' });

  const copyBtn = el('button', {
    type: 'button',
    class: 'btn-copy-transcript',
    text: '📋 Copy transcript',
    onclick: async () => {
      if (!cast.script) return;
      try {
        await navigator.clipboard.writeText(cast.script);
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => {
          copyBtn.textContent = '📋 Copy transcript';
        }, 2000);
      } catch {
        // clipboard access restricted
      }
    },
  });

  const header = el(
    'div',
    { class: 'transcript-header' },
    el(
      'div',
      {},
      el('h3', { text: 'Narration Transcript' }),
      el('p', { class: 'transcript-sub', text: 'Follow along or read the full spoken briefing' }),
    ),
    cast.script ? copyBtn : null,
  );

  const content = cast.script
    ? el('div', { class: 'transcript-prose' }, prose(cast.script))
    : el('p', { class: 'muted', text: 'Gemma is generating the narration script…' });

  card.append(header, content);
  return card;
}

// ---------------------------------------------------------------- Risks Alert

function riskAlertCard(report) {
  if (!report?.risks?.length) return null;
  const highRisks = report.risks.filter((r) => r.severity === 'high');
  if (!highRisks.length) return null;

  return el(
    'section',
    { class: 'risk-alert-card' },
    el(
      'div',
      { class: 'risk-alert-head' },
      el('span', { class: 'risk-alert-icon', text: '⚠️' }),
      el('h4', { text: 'High-Severity Risks Flagged' }),
    ),
    el(
      'ul',
      { class: 'risk-alert-list' },
      highRisks.map((risk) =>
        el(
          'li',
          { class: 'risk-alert-item' },
          el('strong', { text: risk.title }),
          el('p', {}, inline(risk.detail)),
          pathList(risk.paths),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- Render Cast

function renderCast(cast) {
  const report = cast.report;
  const source = cast.source?.sha ? ` @ ${cast.source.sha.slice(0, 7)}` : '';
  return [
    el(
      'header',
      { class: 'detail-head' },
      el(
        'div',
        { class: 'detail-head-meta' },
        el('p', { class: 'eyebrow' }, `${kindLabel(cast.kind)} · `, el('a', { href: cast.repo.url, target: '_blank', rel: 'noopener', text: cast.repo.fullName }), source),
        el('a', { href: '#/new', class: 'btn-inline-new' }, '+ New Audio Summary'),
      ),
      el('h2', { text: report?.title ?? cast.repo.fullName }),
      statusLine(cast),
    ),
    cast.status === 'failed' && el('p', { class: 'error-box', text: cast.error ?? 'This audio summary failed to generate.' }),
    cast.warnings?.length && el('ul', { class: 'warnings' }, cast.warnings.map((w) => el('li', { text: w }))),
    audioPlayerCard(cast),
    transcriptCard(cast),
    riskAlertCard(report),
  ];
}

function showGenerator() {
  clearTimeout(state.pollTimer);
  state.currentId = null;
  const genView = $('#generator-view');
  const detail = $('#detail');
  if (genView) genView.hidden = false;
  if (detail) {
    detail.hidden = true;
    detail.replaceChildren();
  }
  loadList();
}

async function showCast(id) {
  clearTimeout(state.pollTimer);
  if (state.currentId !== id) {
    state.pollMs = POLL_MS_MIN;
  }
  state.currentId = id;
  const genView = $('#generator-view');
  const detail = $('#detail');
  if (genView) genView.hidden = true;
  if (detail) detail.hidden = false;

  let cast;
  try {
    ({ cast } = await api(`/api/casts/${encodeURIComponent(id)}`));
  } catch (err) {
    detail.replaceChildren(el('p', { class: 'error-box', text: err.message }));
    return;
  }
  if (state.currentId !== id) return;
  detail.replaceChildren(...renderCast(cast).flat(Infinity).filter(Boolean));
  loadList();
  if (cast.status === 'queued' || cast.status === 'running') {
    const delay = state.pollMs;
    state.pollMs = Math.min(state.pollMs * 2, POLL_MS_MAX);
    state.pollTimer = setTimeout(() => {
      showCast(id);
      loadList();
    }, delay);
  }
}

// ---------------------------------------------------------------- Form & Routing

function setupForm() {
  const form = $('#cast-form');
  if (!form) return;
  const changesOnly = form.querySelector('.changes-only');
  const error = $('#form-error');

  form.addEventListener('change', () => {
    changesOnly.hidden = form.elements.kind.value !== 'changes';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const data = new FormData(form);
    const kind = data.get('kind');
    const payload = {
      repoUrl: data.get('repoUrl').trim(),
      kind,
      audio: true, // Always generate audio immediately
    };
    const ref = data.get('ref').trim();
    if (ref) payload.ref = ref;
    if (kind === 'changes') {
      const base = data.get('base').trim();
      if (base) payload.base = base;
      payload.commitLimit = Number(data.get('commitLimit')) || 10;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Generating Audio Summary…';
    try {
      const { cast } = await api('/api/casts', { method: 'POST', body: JSON.stringify(payload) });
      location.hash = `#/casts/${encodeURIComponent(cast.id)}`;
      loadList();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Generate Audio Summary';
    }
  });
}

function route() {
  const match = /^#\/casts\/([^/]+)$/.exec(location.hash);
  if (match) {
    showCast(decodeURIComponent(match[1]));
  } else {
    showGenerator();
  }
}

// Initialization
setupForm();
window.addEventListener('hashchange', () => route());

// Boot
initAuth().then(() => {
  loadList();
  loadRepos();
  route();
});
