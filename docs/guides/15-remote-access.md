---
guide: 15
title: "Remote Access via Tailscale"
domain: bridge
audience: [agent-operators]
summary: >-
  Accessing the bridge from a phone or remote machine over Tailscale.
prereqs: [10]
touches:
  - packages/bridge/src/index.ts
---

# Guide 15 — Remote Access via Tailscale

How to access the bridge from a phone or another machine using Tailscale + passkey auth. Covers the full stack: network tunnel, authentication portal, mobile dashboard, voice input, and persistent sessions.

## What This Gives You

The bridge runs on your desktop machine. Remote access lets you reach it from anywhere on your Tailscale mesh network: your phone, a laptop, another workstation. You get the full bridge dashboard (mobile-responsive), live agent output via xterm.js, voice input, and the ability to spawn and prompt sessions — all protected by passkey (biometric) authentication.

The architecture was established by PRD 011 (Tailscale + persistent sessions) and refined by PRD 016 (portal stripped to auth proxy, bridge dashboard made mobile-responsive). The portal (pv-silky) handles authentication and reverse-proxies everything else to the bridge.

## Architecture

```
Phone / Laptop (anywhere)
  └─ Tailscale app (WireGuard tunnel)
     └─ Browser
        ↓ HTTPS (Tailscale cert)
pv-silky portal (:4430) on mission-control
  ├─ /auth/*    → passkey registration/login (WebAuthn)
  └─ /*         → reverse proxy to bridge (:3456)
        ↓ localhost
pv-method bridge (:3456)
  ├─ GET /dashboard            (mobile-responsive observability)
  ├─ GET /sessions/:id/live    (xterm.js terminal + voice input)
  ├─ POST /sessions            (spawn agents)
  ├─ POST /sessions/:id/prompt (send work)
  └─ ... (full HTTP API)
```

All traffic stays within the Tailscale WireGuard mesh — encrypted end-to-end (WireGuard + HTTPS), no public internet exposure, no port forwarding needed. The portal adds passkey authentication so that Tailscale device compromise alone doesn't grant bridge access.

## Tailscale Setup

### Network details

| Property | Value |
|----------|-------|
| Tailnet | `emu-cosmological.ts.net` |
| Home machine | `mission-control` (the machine running the bridge) |
| Bridge URL (from tailnet) | `http://mission-control.emu-cosmological.ts.net:3456` |
| Bridge URL (by IP) | `http://100.114.69.42:3456` |

### Prerequisites

1. **Tailscale installed** on both the bridge machine and the remote device
2. **Both devices joined** to the `emu-cosmological.ts.net` tailnet
3. **Bridge running** on `mission-control`: `npm run bridge`
4. **Tailscale connected** on the remote device (app running, logged in)

### Verifying connectivity

From the remote device, confirm the portal is reachable:

```bash
# Health check (through portal proxy)
curl https://mission-control.emu-cosmological.ts.net:4430/health
```

Expected response:
```json
{ "status": "ok", "active_sessions": 0, "max_sessions": 10, "uptime_ms": 8100000, "version": "0.3.0" }
```

If this works, open the portal in a browser at `https://mission-control.emu-cosmological.ts.net:4430` — you'll be prompted to authenticate with your passkey, then redirected to the bridge dashboard.

## Using the Bridge Remotely

### Authentication

On first visit, register a passkey from a trusted device (desktop browser). The portal uses WebAuthn — your credential is bound to the origin and requires biometric verification (fingerprint, Face ID, or security key).

On subsequent visits (including from phone), the portal prompts for your passkey. After authentication, you're redirected to the bridge dashboard. A signed JWT cookie maintains your session.

### Dashboard

After auth, the bridge dashboard is served directly through the portal:

```
https://mission-control.emu-cosmological.ts.net:4430/dashboard
```

The dashboard is mobile-responsive (PRD 016) — health cards reflow to 2-column on narrow screens, session table scrolls horizontally, channel panels stack vertically. Auto-refreshes every 5 seconds.

### Live agent output

Watch a running agent in real time via xterm.js:

```
https://mission-control.emu-cosmological.ts.net:4430/sessions/{session_id}/live
```

The live output page renders the agent's raw PTY output with full ANSI support — colors, cursor movement, box-drawing. It also shows session metadata (nickname, status, tokens, cache rate). On mobile, the prompt input bar is full-width with a larger font. Voice input is available via the mic button (Web Speech API, on-device).

### Spawning sessions remotely

Use the "Spawn Session" button in the dashboard header, or use `curl` through the portal:

```bash
# Spawn a persistent admin session (through portal proxy)
curl -X POST https://mission-control.emu-cosmological.ts.net:4430/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "workdir": "/path/to/project",
    "persistent": true,
    "nickname": "remote-admin",
    "purpose": "Remote administration session"
  }'

# Send a prompt
curl -X POST https://mission-control.emu-cosmological.ts.net:4430/sessions/{session_id}/prompt \
  -H "Content-Type: application/json" \
  -d '{ "prompt": "Run the tests and report results" }'
```

## Persistent Sessions

When accessing the bridge remotely, use persistent sessions (`persistent: true`) so that network interruptions don't kill your session. A persistent session:

- **Skips stale detection** — won't be auto-killed after 30 minutes of inactivity
- **Survives disconnects** — if your phone loses signal or you close the browser, the session stays alive
- **Lives until explicitly killed** — or until the bridge process restarts

Without `persistent: true`, the bridge's stale detection would mark the session as stale after 30 minutes of no prompts and auto-kill it after 60 minutes. For remote use, where you might check in intermittently, persistent sessions are essential.

```bash
# Spawn with persistent flag
curl -X POST http://mission-control.emu-cosmological.ts.net:3456/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "workdir": "/home/user/project",
    "persistent": true,
    "nickname": "mission",
    "purpose": "Remote mission control session"
  }'
```

To reconnect to an existing session after a disconnect, check if it's still alive:

```bash
# Check session status
curl http://mission-control.emu-cosmological.ts.net:3456/sessions/{session_id}/status

# If alive (status != "dead"), resume prompting
curl -X POST http://mission-control.emu-cosmological.ts.net:3456/sessions/{session_id}/prompt \
  -H "Content-Type: application/json" \
  -d '{ "prompt": "What is your current status?" }'

# If dead, spawn a new session
```

## Known Limitations

### Both processes need manual start

Both the bridge and the portal must be running on `mission-control`. There is no auto-start mechanism. If the machine reboots or either process crashes, you need to restart them:

```bash
# SSH into mission-control (or use local terminal)
cd /path/to/pv-method && npm run bridge
cd /path/to/pv-silky && npm run portal
```

Future work: systemd services or startup scripts for automatic recovery.

### No PWA install / push notifications

The portal does not yet support install-to-home-screen (PWA manifest) or push notifications via service worker. You access it through the browser. Agent completion/error alerts require checking the dashboard manually.

### Direct bridge access is unauthenticated

The bridge itself (port 3456) has no auth. On the local machine this is fine. Over Tailscale, always access through the portal (port 4430) which enforces passkey authentication. Direct bridge access over Tailscale bypasses auth — this is a known gap if a Tailscale device is compromised.

## Security Model

The remote access stack has four security layers:

| Layer | Mechanism | Protects against |
|-------|-----------|-----------------|
| 1. Network | Tailscale WireGuard mesh | Public internet exposure, eavesdropping |
| 2. Device auth | Tailscale device authorization | Unauthorized devices joining the tailnet |
| 3. Transport | HTTPS (Tailscale Let's Encrypt cert) | MITM on tailnet, enables secure browser APIs |
| 4. Authentication | WebAuthn passkey (biometric) | Unauthorized access from compromised tailnet device |

The portal enforces layers 3-4. The bridge itself (port 3456) has no auth — it trusts localhost. Remote access always goes through the portal (port 4430).

**What this protects against:**
- Public internet scanning — no ports are exposed, no DNS records point to the bridge
- Network eavesdropping — WireGuard + HTTPS encrypt all traffic
- Unauthorized devices — only Tailscale-approved devices can reach the portal
- Tailscale device compromise — passkey requires biometric verification, so a stolen device key alone doesn't grant access
- Phone theft (locked) — standard phone security applies, no access to Tailscale or browser

**What this does NOT protect against:**
- Home machine compromise — if someone has SSH or local access to `mission-control`, they have the bridge directly
- Tailscale account compromise — an attacker could add their device to the tailnet (passkey is the backstop)
- Phone theft (unlocked) — if biometric is bypassed, passkey verification may pass

## Relationship to PRDs

**PRD 011** ("Remote Bridge: Mission Control from Anywhere") defined the original vision:

1. **Secure tunnel** — Tailscale mesh — implemented
2. **Web portal with passkey auth** — pv-silky project — implemented
3. **PWA chat interface** — superseded by PRD 016
4. **Admin session** — persistent sessions in the bridge — implemented

**PRD 016** ("Portal as Auth Proxy") replaced PRD 011's custom chat UI with the bridge dashboard itself. The portal was stripped to a pure auth proxy, and the bridge dashboard was made mobile-responsive. Voice input moved from the portal to the bridge's live output page. This eliminated UI duplication between portal and bridge.

This guide covers the full implemented stack: Tailscale (PRD 011 C1) + passkey portal (PRD 011 C2 / PRD 016) + mobile-responsive bridge dashboard (PRD 016) + persistent sessions (PRD 011 C4).
