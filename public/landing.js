const $ = (selector) => document.querySelector(selector);

async function initLanding() {
  const accountEl = $('#account');
  const heroCta = $('#hero-cta');
  const bannerCta = $('#banner-cta');

  try {
    const res = await fetch('/auth/me');
    if (!res.ok) return;
    const { user, authEnabled } = await res.json();

    if (user) {
      // User is authenticated
      if (heroCta) {
        heroCta.href = '/app';
        heroCta.classList.remove('btn-github');
        heroCta.classList.add('btn-primary');
        heroCta.innerHTML = '<span>Open Dashboard &rarr;</span>';
      }
      if (bannerCta) {
        bannerCta.href = '/app';
        bannerCta.classList.remove('btn-github');
        bannerCta.classList.add('btn-primary');
        bannerCta.innerHTML = '<span>Open Dashboard &rarr;</span>';
      }

      if (accountEl) {
        const avatar = user.avatarUrl
          ? `<img src="${user.avatarUrl}" class="user-avatar" alt="${user.login}" />`
          : `<span class="user-avatar">${user.login.slice(0, 1).toUpperCase()}</span>`;

        accountEl.innerHTML = `
          <div class="user-badge">
            ${avatar}
            <span class="user-login">${user.login}</span>
            <a href="/auth/logout" class="btn-signout">Sign out</a>
          </div>
          <a href="/app" class="btn btn-primary" style="padding: 0.45rem 0.95rem; font-size: 0.88rem;">Open Dashboard</a>
        `;
      }
    } else if (authEnabled) {
      // Unauthenticated, OAuth is enabled
      if (accountEl) {
        accountEl.innerHTML = `
          <a href="/auth/github" class="btn btn-github btn-signout" style="padding: 0.45rem 0.95rem;">
            <span>Sign in with GitHub</span>
          </a>
        `;
      }
    } else {
      // Open mode or token mode
      if (heroCta) {
        heroCta.href = '/app';
        heroCta.innerHTML = '<span>Open Dashboard &rarr;</span>';
      }
      if (bannerCta) {
        bannerCta.href = '/app';
        bannerCta.innerHTML = '<span>Open Dashboard &rarr;</span>';
      }
      if (accountEl) {
        accountEl.innerHTML = `
          <a href="/app" class="btn btn-primary" style="padding: 0.45rem 0.95rem; font-size: 0.88rem;">Open Dashboard</a>
        `;
      }
    }
  } catch {
    // network fallback
  }

  // Interactive mockup audio play button toggle
  const playBtn = $('.audio-play-btn');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      const isPlaying = playBtn.textContent === '⏸';
      playBtn.textContent = isPlaying ? '▶' : '⏸';
      const wave = $('.audio-wave');
      if (wave) {
        wave.style.filter = isPlaying ? 'none' : 'brightness(1.3) drop-shadow(0 0 8px var(--accent))';
      }
    });
  }
}

initLanding();
