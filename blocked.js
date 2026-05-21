// ─────────────────────────────────────────────
//  FocusLock — Blocked Page Logic
// ─────────────────────────────────────────────

const params      = new URLSearchParams(location.search);
const blockedUrl  = decodeURIComponent(params.get('blocked') || '');
const returnUrl   = decodeURIComponent(params.get('return')  || '');
const hostname    = decodeURIComponent(params.get('host')    || blockedUrl);

// UI refs
const elHost      = document.getElementById('blocked-host');
const elSession   = document.getElementById('session-time');
const elBlocks    = document.getElementById('block-count');
const elBreakStat = document.getElementById('break-status');
const btnReturn   = document.getElementById('btn-return');
const btnBreak    = document.getElementById('btn-break');
const overlay     = document.getElementById('break-overlay');
const countdown   = document.getElementById('break-countdown');
const fill        = document.getElementById('break-fill');

let state = null;
let tickInterval = null;

// ── Init ─────────────────────────────────────

elHost.textContent = hostname || '(unknown)';

async function init() {
  state = await msg('GET_STATE');

  // If break is already active, show break overlay
  if (state.breakRemaining > 0) {
    showBreakOverlay(state.breakRemaining, state.breakDuration * 60000);
    return;
  }

  updateStatus();
  renderBreakButton();
}

// ── Helpers ──────────────────────────────────

function msg(type, extra = {}) {
  return new Promise(resolve =>
    chrome.runtime.sendMessage({ type, ...extra }, resolve)
  );
}

function fmtMs(ms) {
  if (ms <= 0) return '00:00';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function fmtDuration(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (m >= 60) return `${Math.floor(m/60)}h ${m%60}m`;
  if (m > 0)   return `${m}m ${s}s`;
  return `${s}s`;
}

function updateStatus() {
  if (!state) return;
  elBlocks.textContent = state.blockCount ?? 0;

  if (state.sessionStart) {
    elSession.textContent = fmtDuration(Date.now() - state.sessionStart);
  } else {
    elSession.textContent = '—';
  }
}

function renderBreakButton() {
  if (!state) return;
  const cd = state.cooldownRemaining;
  if (cd > 0) {
    btnBreak.disabled   = true;
    btnBreak.textContent = `☕ Break (${fmtMs(cd)})`;
  } else {
    btnBreak.disabled   = false;
    btnBreak.textContent = `☕ Take Break (${state.breakDuration}m)`;
  }
}

// ── Break overlay ────────────────────────────

function showBreakOverlay(remaining, totalMs) {
  overlay.classList.add('active');

  clearInterval(tickInterval);

  const endMs = Date.now() + remaining;

  function tick() {
    const left = Math.max(0, endMs - Date.now());
    countdown.textContent = fmtMs(left);
    const pct = (1 - left / totalMs) * 100;
    fill.style.width = Math.min(100, pct) + '%';

    if (left <= 0) {
      clearInterval(tickInterval);
      // Break ended — redirect to blocked URL if user clicked break from blocked page
      if (blockedUrl) {
        location.href = blockedUrl;
      } else {
        overlay.classList.remove('active');
      }
    }
  }

  tick();
  tickInterval = setInterval(tick, 500);

  // If user navigates away from this page after break, allow them
  // (they're free during break, the overlay is just informational)
}

// ── Return to Focus ──────────────────────────

btnReturn.addEventListener('click', () => {
  if (returnUrl && returnUrl !== location.href) {
    location.href = returnUrl;
  } else {
    // Fall back: go to configured YouTube playlist or Spotify
    if (!state) { history.back(); return; }
    const yt = state.sites?.find(s => s.type === 'youtube-playlist');
    const sp = state.sites?.find(s => s.id === 'spotify');

    if (yt?.value) {
      location.href = `https://www.youtube.com/playlist?list=${yt.value}`;
    } else if (sp) {
      location.href = 'https://open.spotify.com';
    } else {
      history.back();
    }
  }
});

// ── Take Break ───────────────────────────────

btnBreak.addEventListener('click', async () => {
  btnBreak.disabled    = true;
  btnBreak.textContent = 'Starting...';

  const res = await msg('START_BREAK');

  if (res.ok) {
    const durMs = (state?.breakDuration ?? 5) * 60000;
    showBreakOverlay(res.endTime - Date.now(), durMs);
  } else if (res.reason === 'cooldown') {
    state.cooldownRemaining = res.cooldownRemaining;
    renderBreakButton();
  } else {
    btnBreak.textContent = 'Error — try again';
    setTimeout(() => {
      btnBreak.disabled    = false;
      btnBreak.textContent = `☕ Take Break (${state?.breakDuration ?? 5}m)`;
    }, 2000);
  }
});

// ── Tick session & cooldown in status bar ────

setInterval(async () => {
  state = await msg('GET_STATE');
  updateStatus();
  renderBreakButton();
}, 3000);

init();
