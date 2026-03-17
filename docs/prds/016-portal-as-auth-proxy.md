# PRD 016 — Portal as Auth Proxy: Mobile Bridge Access

**Status:** Implemented
**Date:** 2026-03-15
**Previous:** Draft (2026-03-15)
**Scope:** Strip portal to pure auth + reverse proxy, make bridge dashboard mobile-responsive, eliminate UI duplication
**Depends on:** PRD 005 (bridge dashboard), PRD 007 (nicknames, live output, transcripts), PRD 011 (Tailscale + portal)
**Supersedes:** PRD 011 Components 2–3 (chat UI, voice). PRD 011 defined the full remote access vision; this PRD replaced its custom portal UI with the bridge dashboard itself.
**Evidence:** Phone testing showed bridge live output (xterm.js) works perfectly in mobile browser. Portal's separate chat UI duplicates bridge features and needs separate maintenance.

---

## 1. Problem

The portal (pv-silky) has its own chat UI, session picker, and voice interface — all duplicating features the bridge dashboard already has. When we improve the bridge (diagnostics panel, xterm.js, progress feeds), those improvements aren't available on phone because the portal renders its own UI. Two UIs to maintain, two surfaces to improve, two places for bugs.

**The bridge dashboard already works on mobile** — the xterm.js live output page renders PTY output perfectly in a phone browser. The session table, health cards, and channel panels just need responsive CSS.

## 2. Solution

The portal becomes a transparent auth proxy. No UI of its own. Phone users see the bridge dashboard directly, with passkey auth protecting access.

```
Phone → Tailscale → Portal (:4430)
                      ├── /auth/* → passkey registration/login
                      └── /* → reverse proxy to bridge (:3456)

After auth, the phone sees:
  /dashboard          → bridge dashboard (mobile-responsive)
  /sessions/:id/live  → xterm.js live output + prompt bar
  /sessions/:id/transcript → conversation history
  /health             → bridge health check
```

## 3. Components

### Component 1: Strip Portal UI

Remove from `portal/public/index.html`:
- Chat interface (messages area, input bar)
- Session picker dropdown
- Voice input/output (Web Speech API)
- All chat-related JavaScript

Replace with a simple redirect:
```html
<!-- After auth, redirect to bridge dashboard -->
<script>
  if (authenticated) window.location.href = '/dashboard';
</script>
```

Keep:
- Auth screen (passkey login/register buttons)
- Auth-related CSS and JavaScript
- Status indicator

The auth screen is the only portal-owned UI. Everything else proxies to the bridge.

### Component 2: Bridge Dashboard Mobile CSS

Add responsive media queries to `dashboard.html`:

```css
@media (max-width: 768px) {
  /* Health cards: 2-column instead of 4 */
  .health-row { grid-template-columns: 1fr 1fr; }

  /* Session table: horizontal scroll */
  .session-table { display: block; overflow-x: auto; }

  /* Channel panels: stack vertically */
  .channels-grid { grid-template-columns: 1fr; }

  /* Container: less padding */
  .container { padding: 1rem; }

  /* Header: stack vertically */
  .header { flex-direction: column; gap: 1rem; }
}
```

Also add touch-friendly targets:
- Session rows: larger tap targets (min-height 48px)
- Detail expand/collapse: full-width tap area
- Links: minimum 44x44px touch area

### Component 3: Bridge Live Output Mobile

The live output page (`live-output.html`) already works on mobile via xterm.js. Improvements:

- Prompt input bar: larger on mobile (full width, bigger font)
- xterm.js: fit addon already handles resize
- Agent identity banner: wrap on narrow screens
- Add viewport meta tag if missing

### Component 4: Spawn Button in Dashboard

Add a "Spawn Session" button to the bridge dashboard header. When tapped:
- Shows a form: workdir (preset to current), initial prompt (text area), isolation toggle
- Submits `POST /sessions`
- Refreshes session table

This replaces the portal's "+ New" button functionality, but lives in the bridge dashboard where all session management belongs.

### Component 5: Voice Input in Bridge Live Output (Phase 2)

Move the Web Speech API code from the portal to the bridge's `live-output.html`:
- Mic button next to the prompt input
- Push-to-talk with interim transcription
- Sends transcribed text as prompt

This means voice control works from any browser accessing the bridge, not just the portal.

## 4. What Gets Removed vs Moved

| Feature | Currently in | After PRD 016 |
|---------|-------------|--------------|
| Passkey auth | Portal | Portal (stays) |
| Session picker | Portal | Bridge dashboard (already has session table) |
| Chat messages | Portal | Bridge live output (xterm.js — already better) |
| Voice input | Portal | Bridge live output (Component 5) |
| Loading spinner | Portal | Bridge live output (xterm.js shows activity natively) |
| Status polling | Portal | Bridge dashboard (5s auto-refresh) |
| Spawn new session | Portal | Bridge dashboard (Component 4) |
| Diagnostics | Bridge only | Bridge (now accessible from phone via proxy) |
| Progress/events | Bridge only | Bridge (now accessible from phone via proxy) |

## 5. Implementation Order

### Phase 1: Strip Portal + Mobile CSS (Components 1-3) — IMPLEMENTED
- [x] Strip portal UI to auth-only
- [x] Add redirect to `/dashboard` after auth
- [x] Add mobile media queries to bridge dashboard
- [x] Add mobile improvements to live output page
- [x] Test on phone via Tailscale

### Phase 2: Dashboard Spawn + Voice (Components 4-5) — IMPLEMENTED
- [x] Spawn button in dashboard
- [x] Voice input in live output page

## 6. Success Criteria

1. Phone opens `https://mission-control.emu-cosmological.ts.net:4430` → passkey auth → sees bridge dashboard
2. Dashboard is readable and usable on phone (no horizontal scroll on main content)
3. Can tap a session → expand details → tap "View Live Output" → see xterm.js with PTY output
4. Can send a prompt from the live output page on phone
5. All existing desktop dashboard functionality preserved
6. Voice input works from live output page on phone (Phase 2)

## 7. Relationship to Existing PRDs

| PRD | Relationship |
|-----|-------------|
| 005 (Bridge v2) | All bridge endpoints now accessible from phone via proxy |
| 007 (Bridge UI) | Live output, nicknames, transcripts — all served directly to mobile |
| **011 (Remote Bridge)** | **Supersedes Components 2–3.** PRD 011 defined the architecture (Tailscale, passkey, persistent sessions). This PRD replaced its custom portal UI with the bridge dashboard. PRD 011's Component 1 (Tailscale) and Component 4 (persistent sessions) remain the foundation. |
| 010 (PTY auto-detection) | Auto-detected activity visible on mobile via bridge dashboard — no portal UI needed |

## 8. Out of Scope

- PWA manifest / install-to-home-screen (future)
- Push notifications on phone (future — needs service worker)
- Offline mode (requires bridge connectivity)
- Portal-side session persistence (bridge handles this)
