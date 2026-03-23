---
guide: 17
title: "Narrative Flow UI"
domain: bridge
audience: [contributors]
summary: >-
  React SPA frontend for visualizing methodology execution as interactive narratives.
prereqs: [10, 14]
touches:
  - packages/bridge/frontend/
  - packages/bridge/src/frontend-route.ts
---

# Guide 17 — Narrative Flow: Bridge Frontend Design Guide

How to build and extend the bridge frontend using the Narrative Flow design language. This guide covers the design principles, component patterns, and implementation guidance for anyone contributing to the bridge UI.

## What is Narrative Flow?

Narrative Flow is the bridge frontend's design concept. It treats the bridge as a **story** — events flow through time, and the human reads what happened, what's happening, and what needs their attention.

Three principles govern every design decision:

1. **Attention First** — Human-in-the-loop moments surface before anything else
2. **Time as the Organizing Principle** — Everything is chronological on a shared timeline
3. **Progressive Disclosure** — Start with the headline, reveal details on demand (3 tiers max)

## When to Use This Guide

- Building new pages or panels for the bridge frontend
- Adding new event types to the timeline
- Creating new card types or detail panels
- Designing notification and escalation UX
- Extending the slide-over panel with new tabs

## The Page Template

Every page in the Narrative Flow frontend follows the same structure:

```
Navigation Bar (sticky, 56px)
  └─ Logo | Nav Items | Search | Notifications | Settings

Content Area (max-width: 820px, centered)
  ├─ Attention Banner (if items need human action)
  ├─ Context Cards (1-2 column grid)
  └─ Timeline or Content (chronological feed or page-specific content)

Slide-Over Panel (420px, from right, on demand)
  └─ Tabbed detail for selected item
```

## Adding a New Timeline Event Type

When a new event type needs to appear on the timeline (e.g., a new trigger type, a new governance action):

### 1. Define the semantic color

Choose from the existing palette based on what the event represents:

| Category | Color | Examples |
|----------|-------|---------|
| System activity (agents working) | `--bio` | Session step advance, methodology transition |
| Human attention needed | `--solar` | Escalation, approval request, budget warning |
| Success / completion | `--cyan` | Session complete, gate passed, strategy done |
| Governance / council | `--nebular` | Council session, RFC status change, agenda update |
| Failure / error | `--error` | Session error, gate failed, trigger error |

### 2. Choose an icon

The icon should be instantly recognizable at 12px:
- Diamond ◆ for session events
- Lightning ⚡ for triggers
- Checkmark ✓ for completions
- Gavel 🏛 for governance
- X ✗ for errors
- Shield for gate results
- Arrow ↑ for escalations

### 3. Define the card content

Each timeline event card has:
- **Title** (bold, one line): What happened. Use the entity's nickname, not its UUID.
- **Context** (dim, 1-2 lines): Why it matters. Include cost, duration, or gate result if relevant.
- **Actions** (links, bio-colored): What the human can do. "View Retro", "View Session", "Approve".

### 4. Define the entrance animation

All timeline events use the same animation pattern:
```css
animation: slide-in-left 400ms ease-out forwards;
animation-delay: calc(var(--stagger-index) * 100ms);
```

## Adding a New Card Type

Cards appear in the "Right Now" section or on dedicated pages. Every card follows the same structure:

```
┌──────────────────────────────────┐
│ SECTION LABEL (dim, uppercase)   │
│                                  │
│ Primary Content                  │
│ (varies by card type)            │
│                                  │
│ [Action Link →]                  │
└──────────────────────────────────┘
```

### Card styling rules

- Background: `--abyss`
- Border: `--border` (subtle), `--border-hover` on hover
- Border-radius: 12px
- Padding: 20-24px
- Hover: `translateY(-2px)` lift + border brighten (200ms ease-out)
- Running/active states: pulse glow animation

### Session cards specifically

Session cards are the most common card type. They show:
- Left: nickname (bold), methodology step (mono, dim), duration
- Right: status badge, cost (mono)
- Bottom: progress bar (4px, bio fill)

Running sessions get the `pulse-glow` animation (2.5s, ease-in-out, infinite).

## Adding a New Slide-Over Tab

The slide-over panel supports multiple tabs for different views of the same entity. To add a new tab:

### 1. Register the tab

Tabs are defined as an array. Add your tab with a label and content renderer:
```
{ id: 'my-tab', label: 'My Tab', render: () => <MyTabContent /> }
```

### 2. Follow the content pattern

Each tab's content follows the same structure:
- **Section headers** (dim, uppercase, 11px, letter-spacing 0.05em)
- **Key-value pairs** in a grid (label left in dim, value right in stellar/mono)
- **Lists** with bullet points or badges
- **Code blocks** for technical content (abyss background, mono font)

### 3. Tab transition

Tabs switch with a 200ms fade transition. Content area preserves scroll position per tab.

## Designing Human-in-the-Loop Moments

The most important UX decisions in Narrative Flow are about **when and how to interrupt the human.**

### Priority Levels

| Priority | Visual Treatment | Notification | Sound | Timeout |
|----------|-----------------|-------------|-------|---------|
| **HIGH** | Attention banner + modal | Browser notification | Optional chime | Stays until acted on |
| **MEDIUM** | Attention banner item | Badge count | None | Stays until dismissed |
| **LOW** | Timeline event only | Badge count | None | Auto-clears after 24h |

### HIGH Priority (must act)

Examples: RFC approval (Ax-GOV-1), essence escalation, strategy oversight warning.

- Appears in the Attention Banner at the top of every page
- Cannot be dismissed without taking action (approve/reject/acknowledge)
- If the user navigates away, the banner persists with the same items
- The nav item for the relevant section gets a red badge

### MEDIUM Priority (should review)

Examples: Budget warning, session escalation, stale session.

- Appears in the Attention Banner as a dismissible item
- Badge count on the nav item
- Also appears in the timeline as a regular event
- Can be snoozed for 1 hour

### LOW Priority (informational)

Examples: Session completed, trigger fired, gate passed.

- Timeline event only — no banner, no interruption
- Badge count on the nav item (cleared on visit)
- No notification, no sound

### The Solar Warmth Rule

Solar Warmth (`--solar`, `#e8a45a`) is reserved **exclusively** for human attention moments. Never use it for decoration, branding, or non-urgent information. When the human sees Solar Warmth, they know: "this needs me."

## Information Tiers

Every piece of information in the UI belongs to exactly one tier:

### Tier 1: Glance (< 1 second)

What the human sees without focusing:
- Navigation badge counts
- Attention banner presence (not content)
- Running session count
- Global status indicators

**Design rule:** Tier 1 information uses color and position only — no reading required.

### Tier 2: Scan (5 seconds)

What the human sees with a quick scan:
- Session card grid (who's running, what status)
- Today's metrics (cost, tokens, completion rate)
- Recent timeline events (last 5-10)
- Attention banner items (titles)

**Design rule:** Tier 2 information uses bold titles, status badges, and spatial layout — minimal reading.

### Tier 3: Deep dive (as long as needed)

What the human sees when they click into detail:
- Slide-over panel content (full session config, channels, diagnostics)
- Transcript viewer (turn-by-turn)
- Embedded terminal (live output)
- Gate results with expressions and feedback
- Artifact contents

**Design rule:** Tier 3 information is dense and technical — mono fonts, code blocks, tables. Only shown on explicit user action.

## Aggregate vs Atomic Data

The Narrative Flow design makes a clear distinction:

| Data Type | Where it appears | Format |
|-----------|-----------------|--------|
| **Aggregate** (trends, totals, rates) | Cards, metrics, sparklines | Numbers + trend arrows + sparklines |
| **Atomic** (individual events, specific values) | Timeline, slide-over panel | Full event cards, key-value pairs |

**Rule:** Never mix aggregate and atomic data in the same component. The session card shows aggregate (total cost, duration), the slide-over shows atomic (per-step output, individual gate results).

## Animation Guidelines

### When to Animate

- State transitions (pending → running → completed)
- Entrance of new content (timeline events, cards loading)
- User interactions (hover, click, panel open/close)
- Counter updates (cost, tokens incrementing)

### When NOT to Animate

- Static content that doesn't change
- Labels, headers, navigation items (except hover)
- Content within the slide-over panel (too much motion is disorienting when reading detail)
- Anything when `prefers-reduced-motion` is set

### The Organic Motion Rule

Animations should feel like living things:
- **Entrances:** `ease-out` — organisms decelerate into rest
- **Exits:** `ease-in` — organisms accelerate away
- **Pulses:** `ease-in-out` — breathing rhythm
- **Never:** `linear` for UI transitions (feels mechanical)

## File Structure

> **Note:** This frontend is fully built and served at `/app/*` (controlled by `FRONTEND_ENABLED` env var, default `true`). The structure below reflects the current implementation.

```
packages/bridge/frontend/
├── src/
│   ├── App.tsx                    # Root app component
│   ├── main.tsx                   # Entry point
│   ├── vite-env.d.ts
│   ├── components/
│   │   ├── data/                  # Data display components
│   │   │   ├── MetricCard.tsx
│   │   │   ├── ProgressBar.tsx
│   │   │   ├── StatusBadge.tsx
│   │   │   └── TimelineEvent.tsx
│   │   ├── domain/                # Domain-specific components
│   │   │   ├── CopyMethodologyModal.tsx
│   │   │   ├── EventStreamPanel.tsx
│   │   │   ├── ExecuteDialog.tsx
│   │   │   ├── GenesisChatPanel.tsx
│   │   │   ├── GenesisFAB.tsx
│   │   │   ├── MethodDetail.tsx
│   │   │   ├── MiniDag.tsx
│   │   │   ├── ProjectListView.tsx
│   │   │   ├── RegistryTree.tsx
│   │   │   ├── StrategyCard.tsx
│   │   │   ├── StrategyDefinitionPanel.tsx
│   │   │   ├── TriggerCard.tsx
│   │   │   └── TriggerDetail.tsx
│   │   ├── layout/                # Layout shells
│   │   │   ├── AttentionBanner.tsx
│   │   │   ├── NavBar.tsx
│   │   │   ├── PageShell.tsx
│   │   │   └── SlideOverPanel.tsx
│   │   └── ui/                    # Generic UI primitives
│   │       ├── Badge.tsx
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Tabs.tsx
│   │       └── Tooltip.tsx
│   ├── domain/
│   │   └── strategies/            # Strategy visualization
│   │       ├── CostOverlay.tsx
│   │       ├── StrategyDag.tsx
│   │       ├── edges/
│   │       ├── hooks/
│   │       ├── lib/
│   │       └── nodes/
│   ├── hooks/                     # Data fetching + state
│   │   ├── useEventStream.ts
│   │   ├── useProjects.ts
│   │   ├── useRegistry.ts
│   │   ├── useResourceCopy.ts
│   │   ├── useSSE.ts
│   │   ├── useStrategies.ts
│   │   └── useTriggers.ts
│   ├── stores/                    # Client-side state
│   │   ├── preference-store.ts
│   │   └── ui-store.ts
│   ├── lib/                       # Utilities
│   │   ├── api.ts
│   │   ├── cn.ts
│   │   ├── constants.ts
│   │   ├── formatters.ts
│   │   ├── registry-types.ts
│   │   └── types.ts
│   └── styles/
│       └── vidtecci.css           # Design tokens
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Design Reference

The complete design language specification — colors, typography, spacing, animations, component specs, and anti-patterns — is at:

**`docs/design/narrative-flow-design-language.md`**

The Vidtecci visual identity foundation is at:

**`docs/design/visual-compass.md`**
