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
| `packages/bridge/src/usage-poller.ts` | Subscription usage data source |
| `packages/bridge/src/token-tracker.ts` | Per-session token data source |
| `packages/bridge/src/pool.ts` | Session list and pool stats data source |
| `scripts/start-bridge.js` | Launcher — auto-loads OAuth token |

### Data Flow

```
pool.list()           → session table rows
pool.poolStats()      → health cards (active, total, dead, max)
tokenTracker          → per-session and aggregate token data
usagePoller           → subscription usage meters
config                → port, startedAt, version
```

The route handler in `dashboard-route.ts` calls these, then replaces `{{placeholder}}` tokens in the HTML template using `String.prototype.replace()`.

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

For live output streaming, use Server-Sent Events (SSE). Fastify supports raw response streaming:

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
  terminal.textContent += text;
};
```

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
