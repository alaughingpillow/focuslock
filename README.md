# FocusLock

> A Chrome extension that enforces deep focus sessions by blocking distracting websites — with an escape-proof Commitment Lock you can't click your way out of.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat&logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen?style=flat)
![Vanilla JS](https://img.shields.io/badge/Vanilla-JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-lightgrey?style=flat)

---

## What It Does

FocusLock blocks any website not on your whitelist during an active focus session. Once you start a Commitment Lock timer, the session cannot be ended early — not through the popup, not by disabling the extension, not by fiddling with the service worker. The timer runs at the service worker level and persists across browser restarts.

It's built for people who know they'll negotiate with themselves. FocusLock removes the option.

---

## Features

- **Site blocking** — all non-whitelisted URLs redirect to a focus page during active sessions
- **Whitelist management** — add/remove domains; supports wildcard patterns
- **YouTube playlist whitelisting** — allow specific playlist URLs while blocking the rest of YouTube
- **PIN protection** — lock the extension settings behind a PIN so you can't impulsively turn it off
- **Commitment Lock** — set a session duration; the timer is enforced at the service worker level and cannot be bypassed from the UI
- **Persistent timer** — session state survives tab closures and browser restarts via `chrome.storage`
- **Twilight terminal UI** — dark interface with Bebas Neue display headers and Space Mono monospace, built for low-distraction use

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension platform | Chrome Extensions Manifest V3 |
| Background logic | Service Worker (`background.js`) |
| Blocking mechanism | `chrome.declarativeNetRequest` dynamic rules |
| State persistence | `chrome.storage.local` + `chrome.alarms` |
| UI | Vanilla HTML/CSS/JS popup |
| Typography | Bebas Neue, Space Mono (Google Fonts) |

---

## How It Works

1. **Session start** — the extension registers dynamic blocking rules via `chrome.declarativeNetRequest`, redirecting non-whitelisted requests to a local focus page
2. **Commitment Lock** — a `chrome.alarms` entry is created for the session end time; the service worker owns the countdown and ignores early-stop requests while locked
3. **PIN gate** — settings mutations (whitelist edits, session end) are gated behind a hashed PIN check stored in `chrome.storage.local`
4. **YouTube granularity** — the blocking rule for `youtube.com` includes an exception regex matching whitelisted playlist IDs, so `youtube.com/watch?list=PLAYLIST_ID` passes through while `youtube.com/feed/` does not

---

## Installation

> No store listing yet. Load unpacked from source.

1. Clone the repo:
   ```bash
   git clone https://github.com/YOUR_USERNAME/focuslock.git
   ```
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the cloned folder
5. Pin the extension for quick access

---

## Usage

1. Open the FocusLock popup
2. Add sites to your whitelist (everything else gets blocked)
3. Toggle the session on — or set a Commitment Lock duration for hard mode
4. To unlock settings, enter your PIN

---

## Project Structure

```
focuslock/
├── manifest.json          # MV3 manifest
├── background.js          # Service worker — blocking logic, alarm-based timer
├── popup/
│   ├── popup.html
│   ├── popup.js           # UI logic, PIN gate, whitelist management
│   └── popup.css          # Twilight terminal aesthetic
├── blocked/
│   ├── blocked.html       # Redirect target during focus sessions
│   └── blocked.css
└── icons/
```

---

## Known Limitations

- Blocking applies to top-level navigations only; embedded iframes on whitelisted sites are not separately filtered
- PIN is hashed client-side in `chrome.storage` — not a cryptographic guarantee, just friction
- Extension must be manually loaded (no Web Store listing yet)

---

## Roadmap

- [ ] Session history and focus analytics
- [ ] Scheduled recurring sessions (e.g. every weekday 9–11am)
- [ ] Chrome Web Store release
- [ ] Custom blocked-page messages

---

## License

MIT
