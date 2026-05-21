// ─────────────────────────────────────────────
//  FocusLock — Background Service Worker
// ─────────────────────────────────────────────

const BLOCKED_PAGE = chrome.runtime.getURL('blocked.html');
const tabLastAllowed = new Map();

// ── Storage helpers ──────────────────────────

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, data => {
      resolve({
        focusEnabled:   data.focusEnabled   ?? false,
        sites:          data.sites          ?? defaultSites(),
        breakDuration:  data.breakDuration  ?? 5,
        breakCooldown:  data.breakCooldown  ?? 45,
        breakState:     data.breakState     ?? null,
        lastBreakEnd:   data.lastBreakEnd   ?? null,
        sessionStart:   data.sessionStart   ?? null,
        blockCount:     data.blockCount     ?? 0,
        focusPin:       data.focusPin       ?? '',
        commitDuration: data.commitDuration ?? 0,
        commitLockEnd:  data.commitLockEnd  ?? null,
      });
    });
  });
}

function savePatch(patch) {
  return new Promise(resolve => chrome.storage.local.set(patch, resolve));
}

function defaultSites() {
  return [
    { id: 'spotify', name: 'Spotify',         type: 'domain',           value: 'open.spotify.com', deletable: false },
    { id: 'youtube', name: 'YouTube Playlist', type: 'youtube-playlist', value: '',                 deletable: false }
  ];
}

// ── URL allow / block logic ──────────────────

function isUrlAllowed(url, settings) {
  if (!url) return true;
  const internal = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'moz-extension://'];
  if (internal.some(p => url.startsWith(p))) return true;
  if (url.startsWith(BLOCKED_PAGE)) return true;
  if (!settings.focusEnabled) return true;
  if (settings.breakState && Date.now() < settings.breakState.endTime) return true;

  let urlObj;
  try { urlObj = new URL(url); } catch { return true; }

  for (const site of settings.sites) {
    if (!site.value) continue;
    if (site.type === 'domain') {
      const h = urlObj.hostname.replace(/^www\./, '');
      const p = site.value.replace(/^www\./, '');
      if (h === p || h.endsWith('.' + p)) return true;
    }
    if (site.type === 'youtube-playlist') {
      if (urlObj.hostname.includes('youtube.com')) {
        const list = urlObj.searchParams.get('list');
        if (list && list === site.value) return true;
      }
    }
  }
  return false;
}

// ── Shared block handler ─────────────────────

async function checkAndBlock(tabId, url) {
  if (!url || url.startsWith(BLOCKED_PAGE)) return;
  const settings = await getSettings();
  if (isUrlAllowed(url, settings)) { tabLastAllowed.set(tabId, url); return; }

  await savePatch({ blockCount: (settings.blockCount || 0) + 1 });
  const returnUrl  = encodeURIComponent(tabLastAllowed.get(tabId) || '');
  const blockedUrl = encodeURIComponent(url);
  let hostname = '';
  try { hostname = encodeURIComponent(new URL(url).hostname); } catch {}
  chrome.tabs.update(tabId, {
    url: `${BLOCKED_PAGE}?blocked=${blockedUrl}&return=${returnUrl}&host=${hostname}`
  });
}

// ── Tab monitoring ───────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  await checkAndBlock(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) await checkAndBlock(tabId, tab.url);
  } catch {}
});

chrome.tabs.onRemoved.addListener(tabId => tabLastAllowed.delete(tabId));

// ── Alarm s ───────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'focuslock-break-end') {
    const s = await getSettings();
    await savePatch({ breakState: null, lastBreakEnd: s.breakState?.endTime ?? Date.now() });
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url?.startsWith(BLOCKED_PAGE)) chrome.tabs.reload(tab.id);
    }
  }
  if (alarm.name === 'focuslock-commit-end') {
    await savePatch({ commitLockEnd: null });
  }
});

// ── Message bus ──────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_STATE':     handleGetState(sendResponse);                        return true;
    case 'SET_FOCUS':     handleSetFocus(msg.enabled, msg.pin, sendResponse);  return true;
    case 'SAVE_SITES':    handleSaveSites(msg.sites, sendResponse);            return true;
    case 'SAVE_TIMING':   handleSaveTiming(msg, sendResponse);                 return true;
    case 'START_BREAK':   handleStartBreak(sendResponse);                      return true;
    case 'RESET_SESSION': handleResetSession(sendResponse);                    return true;
    case 'SET_PIN':       handleSetPin(msg.pin, sendResponse);                 return true;
    case 'CLEAR_PIN':     handleClearPin(msg.currentPin, sendResponse);        return true;
    case 'VERIFY_PIN':    handleVerifyPin(msg.pin, sendResponse);              return true;
  }
});

// ── Handlers ─────────────────────────────────

async function handleGetState(sendResponse) {
  const s = await getSettings();
  const now = Date.now();

  let cooldownRemaining = 0;
  if (s.lastBreakEnd)
    cooldownRemaining = Math.max(0, s.lastBreakEnd + s.breakCooldown * 60000 - now);

  let breakRemaining = 0;
  if (s.breakState) {
    breakRemaining = Math.max(0, s.breakState.endTime - now);
    if (breakRemaining === 0) {
      await savePatch({ breakState: null, lastBreakEnd: s.breakState.endTime });
      cooldownRemaining = s.breakCooldown * 60000;
    }
  }

  let commitLockRemaining = 0;
  if (s.commitLockEnd) {
    commitLockRemaining = Math.max(0, s.commitLockEnd - now);
    if (commitLockRemaining === 0) await savePatch({ commitLockEnd: null });
  }

  sendResponse({
    focusEnabled:       s.focusEnabled,
    sites:              s.sites,
    breakDuration:      s.breakDuration,
    breakCooldown:      s.breakCooldown,
    breakRemaining,
    cooldownRemaining,
    sessionStart:       s.sessionStart,
    blockCount:         s.blockCount,
    hasPinSet:          !!s.focusPin,
    commitDuration:     s.commitDuration,
    commitLockRemaining,
  });
}

async function handleSetFocus(enabled, providedPin, sendResponse) {
  const s   = await getSettings();
  const now = Date.now();

  if (!enabled) {
    // Hard block: commitment lock cannot be overridden by anything
    if (s.commitLockEnd && now < s.commitLockEnd) {
      sendResponse({ ok: false, reason: 'commit_locked', remaining: s.commitLockEnd - now });
      return;
    }
    // PIN required
    if (s.focusPin) {
      if (!providedPin || providedPin !== s.focusPin) {
        sendResponse({ ok: false, reason: 'wrong_pin' });
        return;
      }
    }
    await savePatch({ focusEnabled: false, sessionStart: null, blockCount: 0, commitLockEnd: null });
    sendResponse({ ok: true });
    return;
  }

  // Enabling
  const patch = { focusEnabled: true, blockCount: 0 };
  if (!s.sessionStart) patch.sessionStart = now;
  if (s.commitDuration > 0) {
    const lockEnd = now + s.commitDuration * 60000;
    patch.commitLockEnd = lockEnd;
    chrome.alarms.create('focuslock-commit-end', { when: lockEnd });
  }
  await savePatch(patch);
  sendResponse({ ok: true });
}

async function handleSaveSites(sites, sendResponse) {
  await savePatch({ sites });
  sendResponse({ ok: true });
}

async function handleSaveTiming({ breakDuration, breakCooldown, commitDuration }, sendResponse) {
  const patch = {};
  if (breakDuration  != null) patch.breakDuration  = breakDuration;
  if (breakCooldown  != null) patch.breakCooldown  = breakCooldown;
  if (commitDuration != null) patch.commitDuration = commitDuration;
  await savePatch(patch);
  sendResponse({ ok: true });
}

async function handleStartBreak(sendResponse) {
  const s = await getSettings(), now = Date.now();
  if (s.breakState && now < s.breakState.endTime) {
    sendResponse({ ok: false, reason: 'break_active', breakRemaining: s.breakState.endTime - now });
    return;
  }
  if (s.lastBreakEnd) {
    const cooldownEnd = s.lastBreakEnd + s.breakCooldown * 60000;
    if (now < cooldownEnd) {
      sendResponse({ ok: false, reason: 'cooldown', cooldownRemaining: cooldownEnd - now });
      return;
    }
  }
  const endTime = now + s.breakDuration * 60000;
  await savePatch({ breakState: { endTime } });
  chrome.alarms.create('focuslock-break-end', { when: endTime });
  sendResponse({ ok: true, endTime });
}

async function handleResetSession(sendResponse) {
  await savePatch({ sessionStart: null, blockCount: 0 });
  sendResponse({ ok: true });
}

async function handleSetPin(pin, sendResponse) {
  if (!pin || pin.length < 4) { sendResponse({ ok: false, reason: 'too_short' }); return; }
  await savePatch({ focusPin: pin });
  sendResponse({ ok: true });
}

async function handleClearPin(currentPin, sendResponse) {
  const s = await getSettings();
  if (s.focusPin && currentPin !== s.focusPin) {
    sendResponse({ ok: false, reason: 'wrong_pin' });
    return;
  }
  await savePatch({ focusPin: '' });
  sendResponse({ ok: true });
}

async function handleVerifyPin(pin, sendResponse) {
  const s = await getSettings();
  sendResponse({ ok: pin === s.focusPin });
}
