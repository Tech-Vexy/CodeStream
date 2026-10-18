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
                el('span', { class: 'cast-title', text: cast.title ?? kindLabel(cast.kind) }),
                el('time', { datetime: cast.createdAt, text: `${kindLabel(cast.kind)} · ${timeAgo(cast.createdAt)}` }),
              ),
            ),
          )
        : [el('li', { class: 'empty', text: 'No casts yet. Point CodeStream at a repo to get started.' })]),
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

const section = (title, ...content) => el('section', { class: 'block' }, el('h3', { text: title }), content);

const pathList = (paths) => (paths?.length ? el('p', { class: 'paths' }, paths.map((path) => el('code', { text: path }))) : null);

function risks(list) {
  if (!list?.length) return el('p', { class: 'muted', text: 'Nothing flagged.' });
  return el(
    'ul',
    { class: 'risks' },
    list.map((risk) =>
      el(
        'li',
        { class: `risk ${risk.severity}` },
        el('span', { class: 'sev', text: risk.severity }),
        el('div', {}, el('strong', { text: risk.title }), el('p', {}, inline(risk.detail)), pathList(risk.paths)),
      ),
    ),
  );
}

function codebaseSections(report) {
  return [
    section('TL;DR', prose(report.tldr)),
    section('What it does', prose(report.purpose)),
    section('Architecture', prose(report.architecture)),
    report.techStack?.length &&
      section('Tech stack', el('p', { class: 'chips' }, report.techStack.map((tech) => el('span', { class: 'chip', text: tech })))),
    report.components?.length &&
      section(
        'Components',
        el(
          'ul',
          { class: 'items' },
          report.components.map((c) => el('li', {}, el('strong', { text: c.name }), ' ', inline(c.responsibility), pathList(c.paths))),
        ),
      ),
    report.dataFlow && section('How data flows', prose(report.dataFlow)),
    report.entryPoints?.length &&
      section(
        'Entry points',
        el('ul', { class: 'items' }, report.entryPoints.map((e) => el('li', {}, el('code', { text: e.path }), ' ', inline(e.description)))),
      ),
    section('Risks to review', risks(report.risks)),
    report.readingOrder?.length &&
      section('Read these first', el('ol', { class: 'items' }, report.readingOrder.map((r) => el('li', {}, el('code', { text: r.path }), ' ', inline(r.why))))),
    report.openQuestions?.length && section('Open questions', el('ul', { class: 'items' }, report.openQuestions.map((q) => el('li', {}, inline(q))))),
  ];
}

function changeSections(report) {
  return [
    section('TL;DR', prose(report.tldr)),
    section('What changed', prose(report.overview)),
    report.highlights?.length &&
      section(
        'Highlights',
        el('ul', { class: 'items' }, report.highlights.map((h) => el('li', {}, el('strong', { text: h.title }), ' ', inline(h.detail), pathList(h.paths)))),
      ),
    section('Risks to review', risks(report.risks)),
    report.reviewChecklist?.length &&
      section(
        'Before you trust it',
        el('ul', { class: 'checklist' }, report.reviewChecklist.map((item) => el('li', {}, el('label', {}, el('input', { type: 'checkbox' }), ' ', inline(item))))),
      ),
    report.testing && section('Tests', prose(report.testing)),
    report.timeline?.length &&
      section('Commit by commit', el('ol', { class: 'timeline' }, report.timeline.map((t) => el('li', {}, el('code', { text: t.sha }), ' ', inline(t.summary))))),
  ];
}

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

// ---------------------------------------------------------------- Q&A

const qaItem = (exchange) =>
  el(
    'li',
    { class: 'qa-item' },
    el('p', { class: 'qa-question' }, el('strong', { text: 'Q: ' }), exchange.question),
    el('div', { class: 'qa-answer' }, prose(exchange.answer)),
    exchange.citations?.length && pathList(exchange.citations),
  );

function qaPanel(cast) {
  const list = el('ul', { class: 'qa-list' }, [el('li', { class: 'empty', text: 'Loading questions…' })]);
  const input = el('input', {
    name: 'question',
    placeholder: 'Ask about this codebase…',
    disabled: cast.status !== 'ready',
  });
  const button = el('button', { type: 'submit', text: 'Ask', disabled: cast.status !== 'ready' });
  const error = el('p', { class: 'form-error', hidden: true });
  const form = el('form', { class: 'qa-form' }, input, button, error);

  async function loadHistory() {
    try {
      const { qa } = await api(`/api/casts/${encodeURIComponent(cast.id)}/qa`);
      const ordered = [...qa].reverse();
      list.replaceChildren(
        ...(ordered.length ? ordered.map(qaItem) : [el('li', { class: 'empty', text: 'No questions yet. Ask the first one below.' })]),
      );
    } catch {
      list.replaceChildren();
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || button.disabled) return;
    error.hidden = true;
    button.disabled = true;
    button.textContent = 'Thinking…';
    try {
      const { qa } = await api(`/api/casts/${encodeURIComponent(cast.id)}/qa`, {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      input.value = '';
      const previous = [...list.children].filter((child) => !child.classList.contains('empty'));
      list.replaceChildren(qaItem(qa), ...previous);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Ask';
    }
  });

  loadHistory();
  return section('Ask about this cast (Text Mode)', list, form);
}

// ---------------------------------------------------------------- Voice Agent

let activeVoiceSession = null;
let activeVoiceCastId = null;

function voiceAgentPanel(cast) {
  const container = el('div', { class: 'voice-panel' });
  const isReady = cast.status === 'ready';
  const statusPill = el('span', {
    class: `pill ${isReady ? 'ready' : 'running'}`,
    text: isReady ? 'Ready to discuss' : 'Cast processing…',
  });

  const header = el(
    'div',
    { class: 'voice-header' },
    el(
      'div',
      { class: 'voice-title-group' },
      el('span', { class: 'voice-badge', text: 'Voice Agent' }),
      el('h4', { text: 'ElevenLabs Voice Agent' }),
      el('p', {
        class: 'voice-desc',
        text: 'Interactive spoken discussion. Powered by ElevenLabs Conversational AI using Google Gemma 4 Code Analyser tool for grounded technical answers.',
      }),
    ),
    statusPill,
  );

  const startBtn = el('button', {
    class: 'voice-btn start',
    text: '🎙️ Start Voice Conversation',
    disabled: !isReady,
  });

  const endBtn = el('button', {
    class: 'voice-btn end',
    text: 'End Conversation',
    hidden: true,
  });

  const muteBtn = el('button', {
    class: 'voice-btn mute',
    text: 'Mute',
    hidden: true,
  });

  let isMuted = false;

  const visualizer = el(
    'div',
    { class: 'voice-visualizer', hidden: true },
    el('span', { class: 'wave wave-1' }),
    el('span', { class: 'wave wave-2' }),
    el('span', { class: 'wave wave-3' }),
    el('span', { class: 'wave wave-4' }),
    el('span', { class: 'wave wave-5' }),
  );

  const toolBox = el('div', { class: 'tool-call-banner', hidden: true });
  const errorBox = el('p', { class: 'form-error', hidden: true });

  const transcriptList = el('div', { class: 'voice-transcript-list' });
  const transcriptDetails = el(
    'details',
    { class: 'voice-transcript-details', open: true },
    el('summary', { text: 'Live Conversation Transcript & Gemma Tool Invocations' }),
    transcriptList,
  );

  function addTranscriptEntry(speaker, text, citations = []) {
    const isTool = speaker === 'tool';
    const isAgent = speaker === 'ai' || speaker === 'agent';
    const speakerLabel = isTool ? 'Gemma Tool' : isAgent ? 'ElevenLabs Agent' : 'You';
    const badgeClass = isTool ? 'tool-pill' : isAgent ? 'agent-pill' : 'user-pill';

    const entry = el(
      'div',
      { class: `transcript-entry ${isTool ? 'tool' : isAgent ? 'agent' : 'user'}` },
      el(
        'div',
        { class: 'transcript-meta' },
        el('span', { class: `speaker-pill ${badgeClass}`, text: speakerLabel }),
        el('time', { text: new Date().toLocaleTimeString() }),
      ),
      el('div', { class: 'transcript-body' }, prose(text)),
      citations?.length ? pathList(citations) : null,
    );
    transcriptList.appendChild(entry);
    transcriptList.scrollTop = transcriptList.scrollHeight;
  }

  startBtn.addEventListener('click', async () => {
    errorBox.hidden = true;
    startBtn.disabled = true;
    startBtn.textContent = 'Connecting to ElevenLabs…';
    statusPill.textContent = 'Connecting…';
    statusPill.className = 'pill running';

    try {
      const { session } = await api(`/api/casts/${encodeURIComponent(cast.id)}/voice/session`, { method: 'POST' });
      const ConvClass = window.ElevenLabsClient?.Conversation;
      if (!ConvClass) {
        throw new Error('ElevenLabs client library could not be loaded. Please refresh or check network.');
      }

      await navigator.mediaDevices.getUserMedia({ audio: true });

      activeVoiceCastId = cast.id;
      activeVoiceSession = await ConvClass.startSession({
        signedUrl: session.signedUrl,
        clientTools: {
          gemma_code_analyser: async ({ question }) => {
            statusPill.textContent = 'Gemma Analyzing…';
            statusPill.className = 'pill queued';
            toolBox.hidden = false;
            toolBox.replaceChildren(
              el('span', { class: 'tool-icon', text: '⚡' }),
              el('span', { text: `Gemma Code Analyser invoked: "${question}"` }),
            );

            try {
              const res = await api(`/api/casts/${encodeURIComponent(cast.id)}/tool/gemma`, {
                method: 'POST',
                body: JSON.stringify({ question }),
              });
              addTranscriptEntry('tool', `Gemma grounded answer:\n${res.result}`, res.citations);
              return res.result;
            } catch (err) {
              const errMsg = `Gemma analysis error: ${err.message}`;
              addTranscriptEntry('tool', errMsg);
              return errMsg;
            } finally {
              toolBox.hidden = true;
              statusPill.textContent = 'Listening…';
              statusPill.className = 'pill ready';
            }
          },
        },
        onConnect: () => {
          statusPill.textContent = 'Connected · Listening';
          statusPill.className = 'pill ready';
          startBtn.hidden = true;
          endBtn.hidden = false;
          muteBtn.hidden = false;
          visualizer.hidden = false;
        },
        onDisconnect: () => {
          statusPill.textContent = 'Call Ended';
          statusPill.className = 'pill';
          startBtn.hidden = false;
          startBtn.disabled = false;
          startBtn.textContent = '🎙️ Start Voice Conversation';
          endBtn.hidden = true;
          muteBtn.hidden = true;
          visualizer.hidden = true;
          visualizer.classList.remove('speaking');
          activeVoiceSession = null;
          activeVoiceCastId = null;
        },
        onError: (err) => {
          errorBox.textContent = String(err?.message || err || 'Voice connection error.');
          errorBox.hidden = false;
          statusPill.textContent = 'Error';
          statusPill.className = 'pill failed';
        },
        onMessage: (msg) => {
          if (msg?.message) {
            addTranscriptEntry(msg.source || 'agent', msg.message);
          }
        },
        onModeChange: (mode) => {
          const m = mode?.mode || mode;
          if (m === 'speaking') {
            statusPill.textContent = 'Agent Speaking…';
            statusPill.className = 'pill running';
            visualizer.classList.add('speaking');
          } else {
            statusPill.textContent = 'Listening…';
            statusPill.className = 'pill ready';
            visualizer.classList.remove('speaking');
          }
        },
      });
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      statusPill.textContent = 'Failed to connect';
      statusPill.className = 'pill failed';
      startBtn.disabled = false;
      startBtn.textContent = '🎙️ Start Voice Conversation';
      activeVoiceSession = null;
      activeVoiceCastId = null;
    }
  });

  endBtn.addEventListener('click', async () => {
    if (activeVoiceSession) {
      try {
        await activeVoiceSession.endSession();
      } catch {}
      activeVoiceSession = null;
      activeVoiceCastId = null;
    }
  });

  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
    if (activeVoiceSession?.setVolume) {
      try {
        activeVoiceSession.setVolume({ volume: isMuted ? 0 : 1 });
      } catch {}
    }
  });

  const controls = el('div', { class: 'voice-controls' }, startBtn, endBtn, muteBtn, visualizer);
  container.append(header, controls, toolBox, errorBox, transcriptDetails);
  return section('Interactive Voice Briefing', container);
}

function renderCast(cast) {
  const report = cast.report;
  const source = cast.source?.sha ? ` @ ${cast.source.sha.slice(0, 7)}` : '';
  return [
    el(
      'header',
      { class: 'detail-head' },
      el('p', { class: 'eyebrow' }, `${kindLabel(cast.kind)} · `, el('a', { href: cast.repo.url, target: '_blank', rel: 'noopener', text: cast.repo.fullName }), source),
      el('h2', { text: report?.title ?? cast.repo.fullName }),
      statusLine(cast),
    ),
    cast.status === 'failed' && el('p', { class: 'error-box', text: cast.error ?? 'This cast failed.' }),
    cast.hasAudio && el('audio', { controls: true, preload: 'metadata', src: audioUrl(cast.id) }),
    cast.warnings?.length && el('ul', { class: 'warnings' }, cast.warnings.map((w) => el('li', { text: w }))),
    voiceAgentPanel(cast),
    report && (cast.kind === 'codebase' ? codebaseSections(report) : changeSections(report)),
    cast.script && el('details', { class: 'script' }, el('summary', { text: 'Narration script' }), prose(cast.script)),
    qaPanel(cast),
  ];
}

async function showCast(id) {
  clearTimeout(state.pollTimer);
  if (state.currentId !== id) {
    state.pollMs = POLL_MS_MIN;
    if (activeVoiceSession && activeVoiceCastId !== id) {
      try {
        await activeVoiceSession.endSession();
      } catch {}
      activeVoiceSession = null;
      activeVoiceCastId = null;
    }
  }
  state.currentId = id;
  const detail = $('#detail');
  let cast;
  try {
    ({ cast } = await api(`/api/casts/${encodeURIComponent(id)}`));
  } catch (err) {
    detail.replaceChildren(el('p', { class: 'error-box', text: err.message }));
    return;
  }
  if (state.currentId !== id) return;
  detail.replaceChildren(...renderCast(cast).flat(Infinity).filter(Boolean));
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
      audio: data.get('audio') === 'on',
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
    try {
      const { cast } = await api('/api/casts', { method: 'POST', body: JSON.stringify(payload) });
      location.hash = `#/casts/${encodeURIComponent(cast.id)}`;
      loadList();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

function route() {
  const match = /^#\/casts\/([^/]+)$/.exec(location.hash);
  if (match) {
    showCast(decodeURIComponent(match[1]));
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
