# Guide 15 — Remote Access via Tailscale

How to access the bridge from a phone or another machine using Tailscale. Covers the network setup, persistent sessions, and known limitations.

## What This Gives You

The bridge runs on your desktop machine. Normally you interact with it from the same machine — Claude Code in a terminal, dashboard in a browser. Remote access lets you reach the bridge from anywhere on your Tailscale mesh network: your phone, a laptop, another workstation. You get full access to the HTTP API, the dashboard, live agent output, and the ability to spawn and prompt sessions remotely.

The long-term vision (PRD 011) adds a dedicated portal with passkey authentication, voice input, and a mobile chat UI via the `pv-silky` project. This guide covers the current setup: direct bridge access over Tailscale.

## Architecture

```
Phone / Laptop (anywhere)
  └─ Tailscale app (WireGuard tunnel)
     └─ Browser or curl
        ↓ HTTP (within Tailscale mesh)
Home machine: mission-control
  └─ pv-method bridge (:3456)
     ├─ GET /dashboard       (observability)
     ├─ GET /sessions/:id/live  (xterm.js terminal)
     ├─ POST /sessions       (spawn agents)
     ├─ POST /sessions/:id/prompt  (send work)
     └─ ... (full HTTP API)
```

All traffic stays within the Tailscale WireGuard mesh — encrypted end-to-end, no public internet exposure, no port forwarding needed.

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

From the remote device, confirm the bridge is reachable:

```bash
# Health check
curl http://mission-control.emu-cosmological.ts.net:3456/health

# Or by Tailscale IP
curl http://100.114.69.42:3456/health
```

Expected response:
```json
{ "status": "ok", "sessions": 0, "uptime": "2h 15m" }
```

If this works, you can open the dashboard in a browser at the same URL with `/dashboard` appended.

## Using the Bridge Remotely

### Dashboard

Open in any browser on a tailnet device:

```
http://mission-control.emu-cosmological.ts.net:3456/dashboard
```

The dashboard auto-refreshes every 5 seconds. You get the same view as on the local machine: health cards, subscription meters, session table, progress timelines, and event feed.

### Live agent output

Watch a running agent in real time via xterm.js:

```
http://mission-control.emu-cosmological.ts.net:3456/sessions/{session_id}/live
```

The live output page renders the agent's raw PTY output with full ANSI support — colors, cursor movement, box-drawing. It also shows session metadata (nickname, status, tokens, cache rate).

### Spawning sessions remotely

Use `curl` or any HTTP client to spawn and prompt agents:

```bash
# Spawn a persistent admin session
curl -X POST http://mission-control.emu-cosmological.ts.net:3456/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "workdir": "/path/to/project",
    "persistent": true,
    "nickname": "remote-admin",
    "purpose": "Remote administration session"
  }'

# Send a prompt
curl -X POST http://mission-control.emu-cosmological.ts.net:3456/sessions/{session_id}/prompt \
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

### Auth is disabled

The bridge has no authentication layer. Anyone on the tailnet can access it. Tailscale's WireGuard encryption and device authorization provide the security boundary — only devices you've approved can join the tailnet, and all traffic is encrypted.

For sensitive environments, PRD 011 specifies a portal layer (`pv-silky`) with WebAuthn passkey authentication on top of the Tailscale tunnel. This is not yet implemented. For now, the threat model assumes the tailnet itself is trusted.

### Portal process needs manual start

The bridge must be running on `mission-control` before you can access it remotely. There is no auto-start mechanism. If the machine reboots or the bridge crashes, you need to start it again:

```bash
# SSH into mission-control (or use local terminal)
cd /path/to/pv-method
npm run bridge
```

Future work: systemd service or startup script for automatic bridge recovery.

### No HTTPS

The bridge serves plain HTTP. Within the Tailscale mesh, traffic is already encrypted by WireGuard, so HTTPS is redundant for security. However, some browser features (service workers, Web Speech API, clipboard API) require a secure context. If you need HTTPS, PRD 011's portal layer provides it via Tailscale HTTPS certificates.

### No mobile-optimized UI

The dashboard is designed for desktop browsers. It works on mobile but isn't optimized for small screens. PRD 011's PWA chat interface addresses this with a mobile-first design.

## Security Model

The current remote access setup has two security layers:

| Layer | Mechanism | Protects against |
|-------|-----------|-----------------|
| 1. Network | Tailscale WireGuard mesh | Public internet exposure, eavesdropping |
| 2. Device auth | Tailscale device authorization | Unauthorized devices joining the tailnet |

The bridge itself has no authentication — it trusts that anything reaching port 3456 has already passed through Tailscale's security. This is appropriate for a single-user tailnet where you control all devices.

**What this protects against:**
- Public internet scanning — no ports are exposed, no DNS records point to the bridge
- Network eavesdropping — WireGuard encrypts all traffic between tailnet devices
- Unauthorized devices — only devices you've approved in the Tailscale admin console can reach the bridge

**What this does NOT protect against:**
- Compromise of a tailnet device — if an attacker controls a device on your tailnet, they can access the bridge
- Home machine compromise — if someone has SSH or local access to `mission-control`, they have bridge access
- Tailscale account compromise — an attacker who takes over your Tailscale account could add their device

For higher security, add the passkey authentication portal from PRD 011 as a defense-in-depth layer.

## Relationship to PRD 011

PRD 011 ("Remote Bridge: Mission Control from Anywhere") defines the full vision for remote access:

1. **Secure tunnel** — Tailscale mesh (this guide covers this part)
2. **Web portal with passkey auth** — `pv-silky` project, not yet implemented
3. **PWA chat interface** — mobile-first chat with voice input/output, not yet implemented
4. **Admin session** — persistent sessions in the bridge (this guide covers this part)

This guide covers what works today — layers 1 and 4. When the portal and PWA are implemented, this guide will be updated with setup instructions for the full stack.
