---
title: "PRD 011 — Remote Bridge: Mission Control from Anywhere"
status: implemented
---

# PRD 011 — Remote Bridge: Mission Control from Anywhere

**Status:** Implemented (scope refined by PRD 016 — custom portal UI replaced with mobile-responsive bridge dashboard + auth proxy model)
**Date:** 2026-03-15
**Previous:** Draft (vision) (2026-03-15)
**Scope:** Secure remote access to the bridge from mobile via voice + text
**Cross-project:** pv-method (bridge), pv-silky (infra + portal + PWA)
**Origin:** Council-team debate, SESSION-022 era
**Depends on:** PRD 005 (bridge), PRD 006 (sessions), PRD 007 (identity/transcripts), PRD 008 (channels)
**Superseded by:** PRD 016 (Components 2–3). The original vision included a custom chat UI and voice interface in the portal. PRD 016 replaced this with the bridge dashboard as the single UI — the portal was stripped to a pure auth proxy. Components 1 (Tailscale) and 4 (persistent sessions) remain the active foundation.

---

## Purpose

The bridge is the command center for all agent orchestration — spawning sessions, monitoring progress, commissioning work, reviewing results. But it's only accessible from the machine it runs on. This PRD makes the bridge accessible from anywhere via phone, with voice and text input, turning it into a true mission control.

**The vision:** Open an app on your phone, authenticate with a fingerprint, and say "run the tests on pv-method" or "commission PRD 010." An admin agent receives your command, executes it through the bridge, and reports back. Full development capability from anywhere.

---

## Problem

Today, interacting with the bridge requires:
- Physical access to the machine (or an SSH session)
- A full terminal environment
- Manual prompt composition

This means:
- Development stops when you leave the desk
- Ideas that strike on the go get lost or deferred
- Monitoring commissioned agents requires the desktop dashboard
- No way to respond to agent escalations (bridge_event push) from mobile

---

## Architecture

```
Phone (anywhere)
  |-- Tailscale app (WireGuard tunnel)
  '-- Browser / PWA
       |-- Passkey auth (WebAuthn, biometric)
       |-- Voice input (Web Speech API, on-device)
       |-- Chat UI (text + voice + collapsible code)
       '-- TTS readout (SpeechSynthesis, on-device)
            |
            v  HTTPS (tailscale cert)
       pv-silky portal (home machine)
       |-- Fastify server (:443)
       |-- Passkey verification
       '-- Reverse proxy /api/* -->
            |
            v  localhost
       pv-method bridge (:3456)
       |-- Admin session (persistent: true)
       |-- Claude Code PTY
       '-- Full agent capabilities
```

### Key Design Decisions (from council-team debate)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Tailscale mesh** for tunnel | Zero config, WireGuard crypto, no port forwarding, survives IP changes |
| 2 | **Defense-in-depth auth**: Tailscale ACLs + passkey | Bridge = root-equivalent access. Single Tailscale key compromise shouldn't grant full control |
| 3 | **Browser-native voice** (Web Speech API) | Free, private (audio stays on device), no cloud dependency, good enough for commands |
| 4 | **Voice in MVP** (not deferred) | Voice is the value proposition. Without it, this is just SSH from a phone |
| 5 | **Clean project split**: pv-silky owns infra/auth/PWA, pv-method owns bridge | Bridge shouldn't know it's accessed remotely |
| 6 | **Minimal bridge change**: `persistent: true` flag | Admin sessions survive disconnects. One flag, skips stale auto-kill |

---

## Component 1: Secure Tunnel (pv-silky)

### Tailscale Mesh

The home machine joins a Tailscale tailnet. The phone installs Tailscale and joins the same tailnet. WireGuard handles encryption, NAT traversal, and key rotation.

**Setup (completed 2026-03-15):**
```bash
# Home machine
tailscale up --hostname=mission-control
tailscale cert mission-control.emu-cosmological.ts.net
```

**Live configuration:**
- Tailnet: `emu-cosmological.ts.net`
- Machine: `mission-control` (100.114.69.42)
- Phone: `franciscos-s24` (100.70.119.83)
- Portal URL: `https://mission-control.emu-cosmological.ts.net:4430`
- Plan: Personal Plus ($5/mo) — HTTPS certs enabled

**Result:** Phone can reach `https://mission-control.emu-cosmological.ts.net:4430` — no firewall holes, no port forwarding, no dynamic DNS.

### HTTPS

Tailscale provides free Let's Encrypt certificates for tailnet hostnames. The portal serves HTTPS using these certs. No self-signed cert warnings on the phone.

---

## Component 2: Web Portal with Passkey Auth (pv-silky)

### Fastify Server

Lightweight HTTP server that:
1. Serves the PWA static files
2. Handles passkey registration and verification
3. Reverse-proxies `/api/*` to `localhost:3456` (the bridge)

### Passkey Authentication (WebAuthn)

Single-user auth using `@simplewebauthn/server` + `@simplewebauthn/browser`.

**Registration (one-time, from desktop):**
- Navigate to portal setup page
- Register a passkey (biometric or security key)
- Credential stored server-side in a JSON file (one user, no database)

**Login (every session, from phone):**
- Portal prompts for passkey
- Phone shows Face ID / fingerprint prompt
- On success: server issues a signed JWT cookie (httpOnly, secure, sameSite)
- Cookie used for all subsequent API requests

**Why passkeys, not passwords:**
- No typing on phone — biometric unlock only
- Phishing-resistant (bound to origin)
- No password to steal or leak
- Feels like opening an app, not logging in

### Reverse Proxy

All requests to `/api/*` are forwarded to `http://localhost:3456/*` with the JWT validated. The bridge sees normal HTTP requests — it has no knowledge of remote access, Tailscale, or auth.

```
GET /api/health       --> GET localhost:3456/health
POST /api/sessions    --> POST localhost:3456/sessions
GET /api/dashboard    --> GET localhost:3456/dashboard
```

---

## Component 3: PWA Chat Interface (pv-silky)

### Chat UI

Mobile-first interface. Single screen: a chat thread between the user and the admin agent.

**Message types:**
- **User (voice):** Transcribed text with a mic icon indicator
- **User (text):** Typed text
- **Agent (text):** Rendered markdown, collapsible code blocks
- **Agent (status):** Progress updates from channels (step transitions, commits, test results)
- **System:** Auth status, connection state, session info

**Layout:**
```
+------------------------------------------+
|  Mission Control        [agent: ember]   |
|  ● connected            session: 3m      |
+------------------------------------------+
|                                          |
|  [You] run npm test on pv-method         |
|                                          |
|  [ember] Running tests...                |
|  > 154 tests, 154 pass, 0 fail          |
|  > Duration: 1.09s                       |
|                                          |
|  [You] commission PRD 010               |
|                                          |
|  [ember] Loading commission skill...     |
|  (expanding...)                          |
|                                          |
+------------------------------------------+
|  [mic] Type or speak...          [send]  |
+------------------------------------------+
```

### Voice Input (Web Speech API)

On-device speech recognition. No audio leaves the phone.

```javascript
const recognition = new webkitSpeechRecognition();
recognition.continuous = false;
recognition.interimResults = true;
recognition.lang = 'en-US';

recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  sendToAgent(transcript);
};

// Activated by mic button tap or hold
```

**UX flow:**
1. Tap mic button (or hold for push-to-talk)
2. Speak command
3. Interim text shows in input bar (real-time feedback)
4. On silence detection: final transcript sent to agent
5. Agent response appears in chat, optionally read aloud

### Voice Output (SpeechSynthesis)

Browser-native TTS. Reads agent responses aloud on demand.

- Short responses (< 200 chars): auto-read if voice mode is active
- Long responses (code, diffs, logs): display only, "read summary" button
- User can toggle voice mode on/off

### Offline / Disconnect Handling

- PWA caches shell and auth state via service worker
- On disconnect: queue outgoing messages, show "reconnecting..." status
- On reconnect: replay queued messages, fetch missed channel events
- Admin session persists on bridge — phone reconnects to same session by ID (stored in localStorage)

---

## Component 4: Admin Session (pv-method)

### Persistent Sessions

New `persistent: true` flag on `bridge_spawn`:

```typescript
// POST /sessions
{
  workdir: "/path/to/repo",
  persistent: true,       // NEW: skip stale detection auto-kill
  nickname: "mission",    // PRD 007 nickname
  purpose: "Remote admin session for mobile mission control"
}
```

Persistent sessions:
- Skip stale detection (PRD 006 C4) — no auto-kill on inactivity
- Survive phone disconnect/reconnect
- Stay alive until explicitly killed or bridge restarts
- Still subject to `DEAD_SESSION_TTL_MS` cleanup if the PTY process itself dies

### Session Reconnection

The portal stores the admin session's `bridge_session_id` in a server-side session store (or JWT claim). On reconnect:

1. Portal checks if stored session ID is still alive (`GET /sessions/:id/status`)
2. If alive: resume — send new prompts to existing session
3. If dead: spawn a new admin session, update stored ID

### Admin Agent Capabilities

The admin agent is a regular Claude Code session with full tool access. It can:
- Navigate any repo on the machine
- Run builds, tests, linters
- Read and edit files
- Use methodology MCP tools (load, route, step through methods)
- Spawn sub-agents via bridge (commission work)
- Access the steering council, commission skill, etc.
- Create PRs via GitHub MCP

The admin agent IS the user's remote hands. Whatever you'd do at a terminal, the admin agent can do via voice/text command.

---

## MVP Scope

### Phase 1: Text chat over Tailscale (minimum viable) — IMPLEMENTED

**pv-silky:**
- [x] Fastify server with passkey auth (register + verify)
- [x] ~~Static PWA: chat UI~~ → Replaced by bridge dashboard (PRD 016)
- [x] Reverse proxy to bridge
- [x] Tailscale setup documentation

**pv-method:**
- [x] `persistent: true` flag on bridge_spawn
- [x] Skip stale detection for persistent sessions

**Validation:** From phone browser, authenticate, send a text command, get a response.

### Phase 2: Voice + polish — SUPERSEDED by PRD 016

Original plan built voice into the portal's custom chat UI. PRD 016 moved voice input/output into the bridge's live output page instead, eliminating the portal UI entirely.

- [x] Web Speech API integration (voice input) — in bridge live output
- [x] SpeechSynthesis integration (voice output) — in bridge live output
- [x] Push-to-talk UX — in bridge live output
- [ ] Interim transcription display
- [ ] "Read aloud" for agent responses
- [ ] Service worker for offline shell caching

### Phase 3: Full mission control

- [ ] Channel event streaming (live progress from commissioned agents)
- [x] Dashboard access from phone (responsive bridge dashboard — PRD 016)
- [ ] Push notifications (agent completed/errored via service worker)
- [ ] Session history (past conversations)
- [ ] Multi-repo navigation (switch between repos via voice)

---

## Security Model

### Layers

| Layer | Mechanism | Protects against |
|-------|-----------|-----------------|
| 1. Network | Tailscale WireGuard mesh | Exposure to public internet |
| 2. Transport | HTTPS (tailscale cert) | MITM on tailnet |
| 3. Authentication | WebAuthn passkey (biometric) | Unauthorized access from tailnet devices |
| 4. Authorization | Single-user (owner only) | N/A for solo use |
| 5. Session | Signed JWT cookie (httpOnly, secure) | Session hijacking |

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Tailscale device key compromise | Passkey auth prevents bridge access without biometric |
| Phone stolen (unlocked) | Passkey requires biometric — can't use stored session without face/fingerprint |
| Phone stolen (locked) | No access to Tailscale or browser — standard phone security applies |
| Bridge command injection | Bridge already sanitizes prompt input — no change needed |
| MITM on tailnet | HTTPS with valid cert from Tailscale CA |
| Replay attack | JWT expiry + passkey challenge-response |

### What this does NOT protect against

- Compromise of the home machine itself (if someone has SSH, they have the bridge anyway)
- Tailscale account compromise (attacker could join tailnet — passkey is the backstop)
- Physical access to the home machine while logged in

---

## Out of Scope

- **Multi-user support** — solo use only. No user management, roles, or permissions.
- **Public internet exposure** — Tailscale only. No Cloudflare Tunnel, no ngrok, no public DNS.
- **Native mobile app** — PWA in browser. No App Store, no React Native, no Expo.
- **Video/screen sharing** — text and voice only. No VNC, no screen mirroring.
- **Custom wake word** — no "hey bridge" always-listening. Mic activated by tap only.
- **E2E encryption beyond Tailscale** — WireGuard is sufficient for solo tailnet.

---

## Relationship to Existing PRDs

| PRD | Relationship |
|-----|-------------|
| 005 (Bridge v2) | Portal proxies to bridge — all existing endpoints accessible |
| 006 (Recursive orchestration) | Admin agent can spawn sub-agents, use worktree isolation |
| 007 (Bridge UI) | Nicknames and purpose appear in chat UI; transcripts accessible |
| 008 (Visibility) | Channel events stream to phone as status messages in chat |
| 010 (PTY auto-detection) | Auto-detected activity shows in phone chat without agent cooperation |
| **016 (Portal as Auth Proxy)** | **Supersedes Components 2–3.** Phone testing proved the bridge dashboard + xterm.js live output work better on mobile than a custom portal UI. PRD 016 stripped the portal to auth-only and made the bridge dashboard mobile-responsive instead. Voice input moved to bridge live output page. |

---

## Success Criteria

1. From phone on cellular network, authenticate with biometric in < 3 seconds
2. Send a text command and receive agent response within normal bridge latency
3. Speak a voice command and see correct transcription + agent response
4. Disconnect phone (airplane mode), reconnect — resume same admin session
5. Commission an agent via voice, see progress in chat via channel events
6. All traffic encrypted (WireGuard + HTTPS), zero public internet exposure
