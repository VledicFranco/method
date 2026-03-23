---
guide: 14
title: "Extending the Bridge Dashboard UI"
domain: bridge
audience: [contributors]
summary: >-
  Dashboard rendering architecture, Vidtecci OS design system, adding panels and pages.
prereqs: [10]
touches:
  - packages/bridge/src/index.ts
  - packages/bridge/frontend/
---

# Guide 14 — Extending the Bridge Dashboard UI

How to add new features and views to the bridge dashboard. Covers the rendering architecture, the design system, and patterns for new panels, endpoints, and pages.

## Architecture

The dashboard is server-rendered HTML. No frontend framework, no build step, no client-side JS bundle. The rendering pipeline is:

```
dashboard.html (template)     ←  static HTML with {{placeholders}}
        ↓
dashboard-route.ts (renderer) ←  replaces placeholders with live data
        ↓
GET /dashboard (response)     ←  text/html, auto-refreshes every 5s
```

### Key Files

| File | Responsibility |
|------|---------------|
| `packages/bridge/src/dashboard.html` | HTML template with `{{placeholder}}` tokens |
| `packages/bridge/src/dashboard-route.ts` | Fastify route handler — assembles data, renders template |
| `packages/bridge/src/live-output-route.ts` | xterm.js live output page + SSE stream endpoint |
| `packages/bridge/src/transcript-route.ts` | Transcript browser page + transcript listing |
| `packages/bridge/src/usage-poller.ts` | Subscription usage data source |
| `packages/bridge/src/token-tracker.ts` | Per-session token data source (from JSONL transcripts) |
| `packages/bridge/src/pool.ts` | Session list, pool stats, channel data |
| `packages/bridge/src/pty-watcher.ts` | PTY activity auto-detection (feeds channels) |
| `packages/bridge/src/diagnostics.ts` | Per-session diagnostic metrics and stall classification (PRD 012) |
| `packages/bridge/src/adaptive-settle.ts` | Adaptive settle delay algorithm (PRD 012) |
| `scripts/start-bridge.js` | Launcher — auto-loads OAuth token |

### Data Flow

```
pool.list()           → session table rows (tree-ordered by depth)
pool.poolStats()      → health cards (active, total, dead, max)
pool.channels         → progress timeline + event feed
tokenTracker          → per-session and aggregate token data
usagePoller           → subscription usage meters
config                → port, startedAt, version
```

The route handler in `dashboard-route.ts` calls these, then replaces `{{placeholder}}` tokens in the HTML template using `String.prototype.replace()`.

### Pages

The bridge serves multiple pages, each as a route + template pair:

| Route | Template | Description |
|-------|----------|-------------|
| `GET /dashboard` | `dashboard.html` | Main dashboard — sessions, usage, events, progress |
| `GET /sessions/:id/live` | Inline HTML in `live-output-route.ts` | xterm.js terminal emulator with live PTY stream |
| `GET /sessions/:id/transcript` | Inline HTML in `transcript-route.ts` | Transcript browser with JSONL parsing and stats |
| `GET /transcripts` | Inline HTML in `transcript-route.ts` | List of all available transcript sessions |
| `GET /app/*` | React SPA (`frontend-route.ts`) | Narrative Flow frontend — unified React SPA with client-side routing. Controlled by `FRONTEND_ENABLED` env var (default: `true`). Serves built assets from `packages/bridge/frontend/`. See Guide 17. |
| `GET /viz/*` | React SPA (`strategy-viz-route.ts`) | Strategy DAG Visualizer — interactive pipeline visualization SPA. Serves built assets from `packages/bridge/viz/`. |

## Design System

The dashboard follows the **Vidtecci OS Design System**. Reference files are in `docs/design/`:

- `visual-compass.md` — 5 principles, palette, typography, anti-patterns
- `os-design-guide.html` — OS components, cognitive load rules, live demos

### Principles (must-follow)

1. **Depth before decoration** — dark background, light emerges from within
2. **Color carries state** — pre-attentive, processed in <200ms. Status = color, not text
3. **Contrast separates** — no decorative divider lines. Background shade = separation
4. **Accent borders carry meaning** — 2px left border only. Bio = system, solar = human/attention, nebular = council
5. **4 Cowan chunks max** — per card, per row. Respect working memory limits

### Color Variables

```css
--void:       #050910;    /* primary background */
--abyssal:    #0e2030;    /* secondary backgrounds */
--abyss:      #0b1c2b;    /* card surfaces */
--ocean:      #0c2a3c;    /* tertiary backgrounds */
--bio:        #00d4b0;    /* primary accent — active, healthy, system */
--bio-bright: #00f0d0;    /* hover emphasis */
--bio-dim:    rgba(0,212,176,.10);  /* bio background tint */
--solar:      #eeaa62;    /* human accent — attention, warmth */
--solar-dim:  rgba(238,170,98,.08); /* solar background tint */
--stellar:    #f4f8fc;    /* primary text */
--dim:        #c0d0de;    /* secondary text */
--dim2:       #7a90a2;    /* tertiary text, labels */
--nebular:    #9b7fd4;    /* depth accent — council, tool calls */
--muted:      #4a5c6a;    /* disabled, placeholder */
--red:        #e05a5a;    /* error, dead */
```

### Typography

```css
--font-d: 'Space Grotesk';   /* display headings — bold, geometric */
--font-b: 'Inter';            /* body text — maximum legibility */
--font-m: 'JetBrains Mono';   /* technical — code, data, labels */
```

### Status Color Mapping

| Status | Color | CSS Class | Badge Background |
|--------|-------|-----------|-----------------|
| ready | `--bio` | `status-ready` | `--bio-dim` |
| working | `--solar` | `status-working` | `--solar-dim` (+ pulse animation) |
| dead | `--red` | `status-dead` | `--red-dim` |
| initializing | `--dim2` | `status-init` | `rgba(122,144,162,.08)` (+ slow pulse) |

### Meter Color Thresholds

| Range | Class | Color | Meaning |
|-------|-------|-------|---------|
| 0–60% | `healthy` | `--bio` | Normal usage |
| 60–85% | `warning` | `--solar` | Approaching limit |
| 85–100% | `critical` | `--red` | Near capacity |

## Dashboard Panels

The main dashboard has eight panels, each with its own data source and rendering logic.

### 1. Bridge status (health cards)

Top-level stats in a row of health cards: port, uptime, active/max sessions, total spawned, dead sessions.

Data source: `pool.poolStats()` + config.

### 2. Token tracking (health cards)

Aggregate token usage: total tokens, input, output, cache hit rate, cache read tokens. Uses `bio` accent for system metrics.

Data source: `tokenTracker.getAggregateUsage()`.

### 3. Subscription usage meters

Four meters sourced from the Anthropic API: 5-hour window, 7-day ceiling, 7-day Sonnet, 7-day Opus. Each shows utilization percentage with color-coded bar and reset timer.

Data source: `usagePoller`. Requires `CLAUDE_OAUTH_TOKEN`. If unavailable, shows status text ("Not Configured", "Scope Error (403)", "Network Error", "Loading...").

### 4. Session table

Tree-ordered by depth (parent-child indentation via `nickname` column). Each row shows nickname, status badge, workdir, method session ID, prompt count, token usage, cache rate, and last activity time.

Clickable rows expand a detail view with: purpose, full session ID, full workdir path, methodology session, detailed token breakdown, and session diagnostics (PRD 012). Detail view includes links to "View Live Output" (for alive sessions) and "View Transcript".

Data sources: `pool.list()`, `tokenTracker.getUsage(id)`, `diagnosticsTracker.snapshot(id)`.

### 4b. Session diagnostics (detail panel)

Per-session diagnostic metrics shown in the expanded detail view (PRD 012). Displays: time to first output, time to first tool call, tool call count, settle overhead, idle transitions, longest idle period, permission prompt detected flag, and stall classification.

Data source: `diagnosticsTracker.snapshot(id)`. See `packages/bridge/src/diagnostics.ts`.

### 5. Progress timeline

Per-session timeline of the last 8 progress entries. Each entry shows time, type badge (step_advance, tool_call, idle, git_commit, etc.), and description or step name.

Data source: per-session progress channel (`pool.channels.progress`). Entries come from both agent-reported progress (`bridge_progress`) and PTY watcher auto-detection (sender: `pty-watcher`).

### 6. Event feed

Global feed of the 20 most recent events across all sessions. Each entry shows time, session nickname, color-coded event badge (completed = bio, error = red, stale = solar, etc.), and summary.

Data source: aggregated events channel (`pool.channels.events`). Includes both agent-reported events and auto-detected events.

### 7. Triggers panel (PRD 018 Phase 2a-4)

Registered event triggers with live status. Each trigger row shows: name, status badge (active/warning/disabled/paused), fire count, last fired timestamp, and error count. A maintenance banner appears when the trigger system is paused.

Data source: `triggerDataProvider` — a lazy proxy that resolves to `triggerRouter.getStatus()` and `triggerRouter.getHistory()` at request time. See `packages/bridge/src/index.ts` (around line 110) for the provider wiring.

## Adding a New Panel

### Step 1: Define the data source

If your panel needs new data, add it to an existing module or create a new one:

```typescript
// In an existing module (e.g., pool.ts)
export interface SessionPool {
  // ... existing methods
  myNewData(): MyDataType;
}
```

### Step 2: Add a placeholder to the template

In `dashboard.html`, add your panel HTML with `{{placeholder}}` tokens:

```html
<!-- New panel -->
<div class="health-row">
  <div class="health-card accent-bio">
    <div class="health-card-label">My Metric</div>
    <div class="health-card-value bio">{{myMetric.value}}</div>
    <div class="health-card-detail">{{myMetric.detail}}</div>
  </div>
</div>
```

### Step 3: Replace the placeholder in the route handler

In `dashboard-route.ts`, add the replacement in the `GET /dashboard` handler:

```typescript
// Inside registerDashboardRoute, in the route handler:
const myData = pool.myNewData();
html = html.replace(/\{\{myMetric\.value\}\}/g, formatTokens(myData.value));
html = html.replace(/\{\{myMetric\.detail\}\}/g, escapeHtml(myData.detail));
```

### Step 4: Build and verify

```bash
npm run build && npm run build --workspace=packages/bridge
npm run bridge
# Open http://localhost:3456/dashboard
```

The bridge build copies `dashboard.html` to `dist/` — always rebuild after template changes.

## Adding a New Page

For features that don't fit in the main dashboard (e.g., session detail view, transcript browser), add a new route + template pair.

### Step 1: Create the HTML template

```
packages/bridge/src/my-page.html
```

Follow the dashboard template pattern — full HTML document with Vidtecci OS CSS inlined, `{{placeholder}}` tokens for dynamic data.

### Step 2: Create the route handler

```typescript
// packages/bridge/src/my-page-route.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));
let cache: string | null = null;

export function registerMyPageRoute(app: FastifyInstance, /* data sources */): void {
  app.get('/my-page', async (_request, reply) => {
    if (!cache) cache = readFileSync(join(__dirname, 'my-page.html'), 'utf-8');
    let html = cache;
    // ... replace placeholders
    return reply.type('text/html').send(html);
  });
}
```

### Step 3: Wire into index.ts

```typescript
import { registerMyPageRoute } from './my-page-route.js';

// After pool/poller/tracker creation, before app.listen():
registerMyPageRoute(app, pool, tokenTracker);
```

### Step 4: Update the build script

In `packages/bridge/package.json`, copy the new template to `dist/`:

```json
"build": "tsc && node -e \"['dashboard.html','my-page.html'].forEach(f=>require('fs').copyFileSync('src/'+f,'dist/'+f))\""
```

### Step 5: Link from the dashboard

Add a link in the dashboard template's header or session table rows:

```html
<a href="/my-page?session=d9dea613" class="hb-dashboard">View Details</a>
```

## Adding a Streaming Endpoint (SSE)

The live output page uses SSE for real-time PTY streaming. Follow this pattern for new streaming features:

```typescript
app.get('/sessions/:id/stream', async (request, reply) => {
  const { id } = request.params as { id: string };

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Subscribe to PTY output
  const unsubscribe = session.onOutput((data: string) => {
    reply.raw.write(`data: ${JSON.stringify({ text: data })}\n\n`);
  });

  // Clean up on disconnect
  request.raw.on('close', () => {
    unsubscribe();
    reply.raw.end();
  });
});
```

Client-side consumption:

```javascript
const source = new EventSource('/sessions/d9dea613/stream');
source.onmessage = (event) => {
  const { text } = JSON.parse(event.data);
  terminal.write(text);  // xterm.js write method handles ANSI
};
```

The SSE endpoint sends a heartbeat every `SSE_HEARTBEAT_MS` (default 15 seconds) to keep the connection alive. On initial connection, it replays the complete transcript buffer so late-joining clients see the full output.

## Component Reference

Existing CSS classes available in the dashboard template. Reuse these for consistency:

### Health Cards
```html
<div class="health-card accent-bio">  <!-- accent-bio | accent-solar | accent-nebular | accent-dim -->
  <div class="health-card-label">Label</div>
  <div class="health-card-value bio">Value</div>  <!-- bio | solar | dim -->
  <div class="health-card-detail">Detail text</div>
</div>
```

### Status Badges
```html
<span class="status status-ready">ready</span>
<span class="status status-working">working</span>
<span class="status status-dead">dead</span>
<span class="status status-init">initializing</span>
```

### Subscription Meters
```html
<div class="meter">
  <div class="meter-header">
    <span class="meter-label">Label</span>
    <span class="meter-value healthy">42%</span>  <!-- healthy | warning | critical -->
  </div>
  <div class="meter-bar">
    <div class="meter-fill healthy" style="width: 42%;"></div>
  </div>
  <div class="meter-detail">resets in 3h 18m</div>
</div>
```

### Session Table
```html
<table class="session-table">
  <thead><tr><th>Column</th></tr></thead>
  <tbody>
    <tr>
      <td class="mono session-id">d9dea613</td>
      <td class="mono workdir">pv-method</td>
      <td class="mono method-sid">council-run-1</td>
      <td class="mono timestamp">32s ago</td>
    </tr>
  </tbody>
</table>
```

### Event Badge
```html
<span class="event-badge event-completed">completed</span>  <!-- bio -->
<span class="event-badge event-error">error</span>          <!-- red -->
<span class="event-badge event-stale">stale</span>          <!-- solar -->
<span class="event-badge event-escalation">escalation</span> <!-- nebular -->
```

## Mockups

UI mockups for planned features are in `tmp/`:

| File | Feature |
|------|---------|
| `tmp/mock-live-output.html` | Live agent output view — terminal streaming, tool call blocks, sidebar stats |
| `tmp/mock-transcript-history.html` | Session transcript browser — sidebar session list, conversation turns |

Open these in a browser to see the target design before implementing.

## Checklist

Before merging a dashboard UI change:

- [ ] Follows Vidtecci OS design system (check against `docs/design/visual-compass.md`)
- [ ] No decorative dividers — contrast separates
- [ ] Left-accent borders carry semantic meaning (bio/solar/nebular)
- [ ] 4 Cowan chunks max per card
- [ ] All dynamic values use `escapeHtml()` to prevent XSS
- [ ] Template renders correctly with zero data (graceful degradation)
- [ ] `npm run build --workspace=packages/bridge` copies HTML to dist
- [ ] Auto-refresh (5s) doesn't cause layout jumps
- [ ] PTY watcher auto-detected entries render correctly alongside agent-reported entries
- [ ] Links to `/sessions/:id/live` and `/sessions/:id/transcript` work from session table
