// ─────────────────────────────────────────────
//  FocusLock — Popup Logic (v2 with PIN + Commit Lock)
// ─────────────────────────────────────────────

let state = null;
let tickInterval = null;

// ── Helpers ──────────────────────────────────

function msg(type, extra = {}) {
  return new Promise(resolve =>
    chrome.runtime.sendMessage({ type, ...extra }, resolve)
  );
}

function fmtMs(ms) {
  if (ms <= 0) return '00:00';
  const s   = Math.ceil(ms / 1000);
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function fmtMsLong(ms) {
  if (ms <= 0) return '00:00';
  const totalSec = Math.ceil(ms / 1000);
  const h  = Math.floor(totalSec / 3600);
  const m  = Math.floor((totalSec % 3600) / 60);
  const s  = totalSec % 60;
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtDuration(ms) {
  const m = Math.floor(ms / 60000);
  if (m >= 60) return `${Math.floor(m/60)}h ${m%60}m`;
  if (m > 0)   return `${m}m`;
  return `${Math.floor((ms%60000)/1000)}s`;
}

function extractPlaylistId(raw) {
  raw = raw.trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
    if (u.hostname.includes('youtube.com')) {
      const list = u.searchParams.get('list');
      if (list) return list;
    }
  } catch {}
  if (/^[A-Za-z0-9_-]{13,}$/.test(raw)) return raw;
  return '';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Collapsible sections ──────────────────────

document.querySelectorAll('.section-header').forEach(header => {
  header.addEventListener('click', () => {
    const targetId = header.dataset.target;
    const body     = document.getElementById(targetId);
    const arrowKey = 'arrow-' + targetId.replace('-body','');
    const arrow    = document.getElementById(arrowKey);
    const isOpen   = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    if (arrow) arrow.classList.toggle('open', !isOpen);
  });
});

// ── Init ─────────────────────────────────────

async function init() {
  state = await msg('GET_STATE');
  render();
  clearInterval(tickInterval);
  tickInterval = setInterval(async () => {
    state = await msg('GET_STATE');
    render();
  }, 1000);
}

// ── Main render ───────────────────────────────

function render() {
  if (!state) return;

  const toggle     = document.getElementById('focus-toggle');
  const powerLabel = document.getElementById('power-label');
  const indicator  = document.getElementById('indicator');

  toggle.checked         = state.focusEnabled;
  powerLabel.textContent = state.focusEnabled ? 'ON' : 'OFF';
  powerLabel.className   = 'power-label ' + (state.focusEnabled ? 'on' : 'off');

  if (state.commitLockRemaining > 0) {
    indicator.className = 'indicator locked';
  } else if (state.focusEnabled) {
    indicator.className = 'indicator on';
  } else {
    indicator.className = 'indicator';
  }

  // Stats
  document.getElementById('stat-blocks').textContent = state.focusEnabled ? (state.blockCount ?? 0) : '—';
  document.getElementById('stat-session').textContent =
    (state.sessionStart && state.focusEnabled) ? fmtDuration(Date.now() - state.sessionStart) : '—';

  const statusEl = document.getElementById('stat-status');
  if (state.breakRemaining > 0) {
    statusEl.textContent = 'Break';
    statusEl.style.color = 'var(--amber)';
  } else if (state.commitLockRemaining > 0) {
    statusEl.textContent = 'Locked';
    statusEl.style.color = 'var(--purple)';
  } else if (state.focusEnabled) {
    statusEl.textContent = 'Active';
    statusEl.style.color = 'var(--green)';
  } else {
    statusEl.textContent = 'Idle';
    statusEl.style.color = 'var(--text)';
  }

  // Commitment lock banner
  const banner     = document.getElementById('commit-banner');
  const bannerTime = document.getElementById('banner-time');
  if (state.commitLockRemaining > 0) {
    banner.classList.add('visible');
    bannerTime.textContent = fmtMsLong(state.commitLockRemaining) + ' remaining';
  } else {
    banner.classList.remove('visible');
  }

  // ── FIX: Update lock modal timer while it's open ──
  const lockModal = document.getElementById('lock-modal');
  if (lockModal.classList.contains('visible')) {
    const lockDisplay = document.getElementById('lock-time-display');
    if (state.commitLockRemaining > 0) {
      lockDisplay.textContent = fmtMsLong(state.commitLockRemaining);
    } else {
      // Lock expired while modal was open — close it
      lockModal.classList.remove('visible');
    }
  }

  // Settings
  document.getElementById('s-break-dur').value = state.breakDuration ?? 5;
  document.getElementById('s-break-cd').value  = state.breakCooldown ?? 45;
  const commitSel = document.getElementById('s-commit');
  if (commitSel) commitSel.value = String(state.commitDuration ?? 0);

  // PIN status
  const pinStatusEl  = document.getElementById('pin-status-text');
  const pinClearBtn  = document.getElementById('pin-clear-btn');
  if (state.hasPinSet) {
    pinStatusEl.textContent = '✓ PIN is set';
    pinStatusEl.className   = 'pin-status set';
    pinClearBtn.style.display = 'block';
  } else {
    pinStatusEl.textContent = 'No PIN set — anyone can disable';
    pinStatusEl.className   = 'pin-status unset';
    pinClearBtn.style.display = 'none';
  }

  renderPlaylist();
  renderCustomSites();
  renderBreak();
}

function renderPlaylist() {
  const ytSite = state.sites?.find(s => s.type === 'youtube-playlist');
  const input  = document.getElementById('yt-input');
  const status = document.getElementById('yt-status');
  const dot    = document.getElementById('yt-dot');

  if (document.activeElement !== input) input.value = ytSite?.value || '';

  if (ytSite?.value) {
    status.textContent = '✓ Active — ' + ytSite.value.slice(0,22) + (ytSite.value.length > 22 ? '…' : '');
    status.className   = 'playlist-status ok';
    dot.className      = 'site-dot';
  } else {
    status.textContent = 'Paste playlist ID or full URL';
    status.className   = 'playlist-status dim';
    dot.className      = 'site-dot inactive';
  }
}

function renderCustomSites() {
  const container = document.getElementById('custom-sites');
  const customs   = (state.sites || []).filter(s => s.deletable);
  container.innerHTML = '';
  customs.forEach(site => {
    const div = document.createElement('div');
    div.className = 'site-item';
    div.innerHTML = `
      <div class="site-dot"></div>
      <div class="site-name">${escHtml(site.name||site.value)}<div class="site-sub">${escHtml(site.value)}</div></div>
      <button class="site-del" data-id="${escHtml(site.id)}">✕</button>
    `;
    div.querySelector('.site-del').addEventListener('click', () => deleteSite(site.id));
    container.appendChild(div);
  });
}

function renderBreak() {
  const btn      = document.getElementById('btn-break');
  const activeEl = document.getElementById('break-active-state');
  const cdEl     = document.getElementById('break-countdown');
  const fillEl   = document.getElementById('break-fill');
  const msgEl    = document.getElementById('break-msg');

  if (state.breakRemaining > 0) {
    activeEl.style.display = 'block';
    btn.style.display      = 'none';
    msgEl.textContent      = '';
    const totalMs  = (state.breakDuration ?? 5) * 60000;
    const left     = state.breakRemaining;
    cdEl.textContent       = fmtMs(left);
    fillEl.style.width     = Math.min(100, (1 - left / totalMs) * 100) + '%';
  } else {
    activeEl.style.display = 'none';
    btn.style.display      = 'block';
    const cd = state.cooldownRemaining ?? 0;
    if (cd > 0) {
      btn.disabled     = true;
      btn.textContent  = `☕ Break in ${fmtMs(cd)}`;
    } else {
      btn.disabled     = false;
      btn.textContent  = `☕ Take Break · ${state.breakDuration ?? 5} min`;
    }
  }
}

// ── Focus toggle ──────────────────────────────

document.getElementById('focus-toggle').addEventListener('change', async e => {
  const wantEnable = e.target.checked;

  if (!wantEnable) {
    if (state.commitLockRemaining > 0) {
      e.target.checked = true;
      showLockModal();
      return;
    }
    if (state.hasPinSet) {
      e.target.checked = true;
      showPinModal();
      return;
    }
  }

  const res = await msg('SET_FOCUS', { enabled: wantEnable });
  if (!res?.ok) e.target.checked = !wantEnable;
  state = await msg('GET_STATE');
  render();
});

// ── PIN modal ─────────────────────────────────

function showPinModal() {
  const modal = document.getElementById('pin-modal');
  const input = document.getElementById('pin-entry');
  const err   = document.getElementById('pin-entry-error');
  input.value   = '';
  err.textContent = '';
  modal.classList.add('visible');
  setTimeout(() => input.focus(), 50);
}

function hidePinModal() {
  document.getElementById('pin-modal').classList.remove('visible');
}

document.getElementById('pin-cancel').addEventListener('click', hidePinModal);

document.getElementById('pin-entry').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('pin-submit').click();
});

document.getElementById('pin-submit').addEventListener('click', async () => {
  const input = document.getElementById('pin-entry');
  const err   = document.getElementById('pin-entry-error');
  const pin   = input.value;

  const res = await msg('SET_FOCUS', { enabled: false, pin });

  if (res.ok) {
    hidePinModal();
    state = await msg('GET_STATE');
    render();
  } else if (res.reason === 'wrong_pin') {
    err.textContent = '✗ Wrong PIN';
    input.value     = '';
    input.focus();
    input.style.borderColor = 'var(--red)';
    setTimeout(() => input.style.borderColor = '', 800);
  } else {
    err.textContent = 'Something went wrong';
  }
});

// ── Commitment lock modal ─────────────────────

function showLockModal() {
  document.getElementById('lock-modal').classList.add('visible');
  // Seed immediately; the render() loop will keep it updated
  if (state) {
    document.getElementById('lock-time-display').textContent =
      fmtMsLong(state.commitLockRemaining);
  }
}

document.getElementById('lock-close').addEventListener('click', () => {
  document.getElementById('lock-modal').classList.remove('visible');
});

// ── YouTube playlist ──────────────────────────

document.getElementById('yt-input').addEventListener('blur', savePlaylist);
document.getElementById('yt-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') savePlaylist();
});

async function savePlaylist() {
  const raw    = document.getElementById('yt-input').value.trim();
  const id     = extractPlaylistId(raw);
  const status = document.getElementById('yt-status');
  const dot    = document.getElementById('yt-dot');

  const sites = (state.sites || []).map(s =>
    s.type === 'youtube-playlist' ? { ...s, value: id } : s
  );
  await msg('SAVE_SITES', { sites });
  state.sites = sites;

  if (id) {
    status.textContent = '✓ Saved — ' + id.slice(0,22);
    status.className   = 'playlist-status ok';
    dot.className      = 'site-dot';
  } else if (raw) {
    status.textContent = '✗ Could not extract playlist ID';
    status.className   = 'playlist-status err';
    dot.className      = 'site-dot inactive';
  } else {
    status.textContent = 'Paste playlist ID or full URL';
    status.className   = 'playlist-status dim';
    dot.className      = 'site-dot inactive';
  }
}

// ── Add custom domain ──────────────────────────

document.getElementById('add-btn').addEventListener('click', addDomain);
document.getElementById('add-domain').addEventListener('keydown', e => {
  if (e.key === 'Enter') addDomain();
});

async function addDomain() {
  const input = document.getElementById('add-domain');
  const msgEl = document.getElementById('add-msg');
  let raw = input.value.trim().toLowerCase();
  msgEl.textContent = '';
  if (!raw) return;
  try {
    const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
    raw = u.hostname.replace(/^www\./, '');
  } catch {
    msgEl.textContent = 'Invalid domain';
    return;
  }
  if (!raw.includes('.')) { msgEl.textContent = 'Enter a valid domain (e.g. notion.so)'; return; }
  const sites = state.sites || [];
  if (sites.some(s => s.value === raw)) { msgEl.textContent = 'Already in list'; return; }
  const updated = [...sites, { id: 'custom-' + Date.now(), name: raw, type: 'domain', value: raw, deletable: true }];
  await msg('SAVE_SITES', { sites: updated });
  state.sites = updated;
  input.value = '';
  renderCustomSites();
}

async function deleteSite(id) {
  const updated = (state.sites || []).filter(s => s.id !== id);
  await msg('SAVE_SITES', { sites: updated });
  state.sites = updated;
  renderCustomSites();
}

// ── Break ──────────────────────────────────────

document.getElementById('btn-break').addEventListener('click', async () => {
  const btn   = document.getElementById('btn-break');
  const msgEl = document.getElementById('break-msg');
  btn.disabled = true;
  btn.textContent = 'Starting...';
  msgEl.textContent = '';
  const res = await msg('START_BREAK');
  if (res.ok) {
    state = await msg('GET_STATE');
    render();
  } else if (res.reason === 'cooldown') {
    msgEl.textContent = `Next break in ${fmtMs(res.cooldownRemaining)}`;
    btn.disabled = false;
    renderBreak();
  } else {
    msgEl.textContent = 'Could not start break';
    btn.disabled = false;
    renderBreak();
  }
});

// ── Settings ───────────────────────────────────

document.getElementById('save-settings').addEventListener('click', async () => {
  const dur    = Math.max(1,  Math.min(60,  parseInt(document.getElementById('s-break-dur').value) || 5));
  const cd     = Math.max(5,  Math.min(180, parseInt(document.getElementById('s-break-cd').value)  || 45));
  const commit = parseInt(document.getElementById('s-commit').value) || 0;
  const conf   = document.getElementById('save-confirm');
  await msg('SAVE_TIMING', { breakDuration: dur, breakCooldown: cd, commitDuration: commit });
  state.breakDuration  = dur;
  state.breakCooldown  = cd;
  state.commitDuration = commit;
  conf.textContent  = '✓ Saved';
  conf.className    = 'save-confirm ok';
  setTimeout(() => { conf.textContent = ''; conf.className = 'save-confirm'; }, 2000);
});

// ── PIN setup ─────────────────────────────────

document.getElementById('set-pin-btn').addEventListener('click', async () => {
  const input = document.getElementById('new-pin-input');
  const msgEl = document.getElementById('pin-setup-msg');
  const pin   = input.value.trim();
  msgEl.textContent = '';

  if (!pin) return;
  if (pin.length < 4) {
    msgEl.textContent = 'PIN must be at least 4 characters';
    return;
  }

  if (state.hasPinSet) {
    msgEl.textContent = 'Remove current PIN first before setting a new one';
    return;
  }

  const res = await msg('SET_PIN', { pin });
  if (res.ok) {
    input.value        = '';
    msgEl.textContent  = '✓ PIN set — keep it somewhere safe!';
    msgEl.className    = 'msg ok';
    state.hasPinSet    = true;
    render();
    setTimeout(() => { msgEl.textContent = ''; msgEl.className = 'msg'; }, 3000);
  } else {
    msgEl.textContent = 'Could not set PIN';
  }
});

document.getElementById('pin-clear-btn').addEventListener('click', async () => {
  const msgEl   = document.getElementById('pin-setup-msg');
  const current = prompt('Enter your current PIN to remove it:');
  if (current === null) return;

  const res = await msg('CLEAR_PIN', { currentPin: current });
  if (res.ok) {
    msgEl.textContent = '✓ PIN removed';
    msgEl.className   = 'msg ok';
    state.hasPinSet   = false;
    render();
    setTimeout(() => { msgEl.textContent = ''; msgEl.className = 'msg'; }, 2500);
  } else {
    msgEl.textContent = '✗ Wrong PIN';
    setTimeout(() => { msgEl.textContent = ''; }, 2000);
  }
});

// ── Boot ──────────────────────────────────────
init();