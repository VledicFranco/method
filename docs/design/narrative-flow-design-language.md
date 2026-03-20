# Narrative Flow — Design Language Reference

**Version:** 1.0
**Date:** 2026-03-20
**Status:** Adopted (bridge frontend redesign)
**Foundation:** Vidtecci Visual Compass v1.0, Narrative Flow Concept B

---

## 1. Design Philosophy

Narrative Flow treats the bridge as a **story** — events flow through time, the human reads what happened and what needs attention. The design is organized around three principles:

### Attention First
The most urgent items appear at the top, always. Human-in-the-loop moments (approvals, escalations, budget warnings) are surfaced before anything else. The system respects human attention as a scarce resource.

### Time as the Organizing Principle
Everything is chronological. Sessions, triggers, council decisions, strategy executions — they all appear on a shared timeline. The human reads the project's story, they don't monitor disconnected dashboards.

### Progressive Disclosure
Start with the headline, reveal details on demand. Three tiers maximum:
- **Tier 1 (Glance):** Status bar + attention banner — 1 second
- **Tier 2 (Scan):** Cards + timeline — 5 seconds
- **Tier 3 (Deep dive):** Slide-over detail panel — as long as needed

---

## 2. Color System

Built on the Vidtecci Visual Compass with Narrative Flow semantic mapping.

### Core Palette

| Token | Hex | Role | Semantic Meaning |
|-------|-----|------|-----------------|
| `--void` | `#080e14` | Page background | The dark the life glows against |
| `--abyss` | `#0d1f2d` | Card/panel backgrounds | Depth before light |
| `--abyss-light` | `#122a3a` | Hover states, elevated surfaces | Subtle lift |
| `--bio` | `#00c9a7` | Primary accent, active states | Life, health, the system is alive |
| `--bio-dim` | `rgba(0, 201, 167, 0.15)` | Accent backgrounds, badges | Subtle life signal |
| `--bio-glow` | `rgba(0, 201, 167, 0.3)` | Glow effects, running states | Bioluminescent pulse |
| `--solar` | `#e8a45a` | Human attention, warnings | Warm signal on cold cosmos |
| `--solar-dim` | `rgba(232, 164, 90, 0.15)` | Warning backgrounds | Subtle warmth |
| `--cyan` | `#00e5cc` | Completion, success | Bright life — the work is done |
| `--error` | `#e05a5a` | Errors, failures | Broken life |
| `--error-dim` | `rgba(224, 90, 90, 0.15)` | Error backgrounds | Subtle alarm |
| `--nebular` | `#7b5fb5` | Depth transitions, governance | The space between stars |
| `--nebular-dim` | `rgba(123, 95, 181, 0.15)` | Governance backgrounds | Subtle depth |
| `--text` | `#f0f4f8` | Primary text | Stellar White — clean signal |
| `--text-dim` | `#8a9bb0` | Secondary text, metadata | Dim White — supporting info |
| `--text-muted` | `#5a6b7e` | Disabled, placeholder | Barely visible — not relevant now |
| `--border` | `rgba(138, 155, 176, 0.12)` | Default borders | Structural, not decorative |
| `--border-hover` | `rgba(138, 155, 176, 0.25)` | Hover borders | Lifted attention |

### Status Color Mapping

| Status | Color Token | Icon | Badge Background |
|--------|------------|------|-----------------|
| Running | `--bio` | Spinner | `--bio-dim` |
| Completed | `--cyan` | Checkmark | `rgba(0, 229, 204, 0.15)` |
| Failed | `--error` | X circle | `--error-dim` |
| Pending/Queued | `--text-dim` | Circle outline | `rgba(138, 155, 176, 0.08)` |
| Suspended | `--nebular` | Pause | `--nebular-dim` |
| Warning | `--solar` | Alert triangle | `--solar-dim` |
| Needs Attention | `--solar` | Exclamation | `--solar-dim` |

### Event Type Colors (Timeline)

| Event Type | Dot Color | Icon Shape |
|-----------|-----------|-----------|
| Session activity | `--bio` | Diamond ◆ |
| Trigger fired | `--solar` | Lightning ⚡ |
| Completion | `--cyan` | Checkmark ✓ |
| Council/governance | `--nebular` | Gavel 🏛 |
| Error | `--error` | X ✗ |
| Gate passed | `--bio` | Shield ✓ |
| Escalation | `--solar` | Arrow ↑ |

---

## 3. Typography

### Typeface Roles

| Role | Typeface | Why |
|------|----------|-----|
| Display / Headings | Space Grotesk | Geometric precision with organic personality |
| Body / Reading | Inter | Maximum legibility, neutral carrier |
| Technical / Mono | JetBrains Mono | Code, data, IDs, costs, tokens |

### Type Scale

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `--text-xs` | 0.7rem (10px) | 500 | Badges, tiny labels |
| `--text-sm` | 0.8rem (11px) | 400 | Metadata, timestamps, secondary |
| `--text-base` | 0.875rem (14px) | 400 | Body text, descriptions |
| `--text-md` | 1rem (16px) | 500 | Card titles, list items |
| `--text-lg` | 1.25rem (20px) | 600 | Section headers |
| `--text-xl` | 1.5rem (24px) | 700 | Page titles |

### Typography Rules

- **Headings live on dark.** Stellar White on Void/Abyss. Never dark-on-light.
- **Mono is equal.** Technical data (IDs, costs, tokens) uses JetBrains Mono at the same weight as body text — not subordinated.
- **Line height 1.5+** for body. Generous spacing — void is breathing room, not emptiness.
- **Letter spacing:** `-0.02em` on headings (Space Grotesk), `0` on body (Inter), `0.02em` on mono labels.

---

## 4. Layout System

### Page Structure

```
┌──────────────────────────────────────────────┐
│ Navigation Bar (56px, sticky)                │
├──────────────────────────────────────────────┤
│ Content Area (max-width: 820px, centered)    │
│                                              │
│  Attention Banner (if items pending)         │
│  Cards Row (2-column grid)                   │
│  Timeline (vertical, chronological)          │
│                                              │
├──────────────────────────────────────────────┤
│ Slide-Over Panel (420px, from right)         │
└──────────────────────────────────────────────┘
```

### Key Dimensions

| Element | Value | Rationale |
|---------|-------|-----------|
| Nav height | 56px | Compact but touch-friendly |
| Content max-width | 820px | Optimal reading width for timeline |
| Slide-over panel | 420px | Room for detail without overwhelming |
| Card padding | 20px-24px | Generous interior space |
| Card gap | 16px | Clear separation |
| Card border-radius | 12px | Soft, organic (not sharp, not bubbly) |
| Timeline dot size | 12px | Visible but not dominant |
| Timeline line width | 2px | Structural, not heavy |

### Spacing Scale (4px base)

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Tight inline spacing |
| `--space-2` | 8px | Badge padding, tight gaps |
| `--space-3` | 12px | Icon-to-text, small card padding |
| `--space-4` | 16px | Default gap, card padding |
| `--space-5` | 20px | Section padding |
| `--space-6` | 24px | Large card padding |
| `--space-8` | 32px | Section separation |
| `--space-10` | 40px | Page-level separation |

---

## 5. Component Library

### Navigation Bar
- Horizontal, sticky at top
- Logo left, nav items center, actions right
- Active item: bioluminescent underline that grows from center
- Hover: underline preview at 50% opacity
- Badge counts on nav items for pending actions

### Attention Banner
- Full-width card below nav when items need human action
- Left border accent in `--solar` (2px)
- Collapsible header with count badge
- Each item: icon + description + action button
- Slide-down entrance animation on page load

### Session Cards
- Abyss background with subtle border
- Left: nickname (bold), methodology step (mono), duration
- Right: status badge, cost (mono)
- Progress bar at bottom (fills with `--bio`)
- Running cards: pulse glow animation (2.5s ease-in-out)
- Hover: lift + border brighten
- Click: opens slide-over with full detail

### Timeline Events
- Vertical line on the left (2px, `--border`)
- Colored dot per event type (12px circle)
- Time label (mono, dim)
- Event card: title (bold), context (dim), action links (bio)
- Staggered entrance animation (100ms per item)
- Grouped by time period (section headers)
- Hover: subtle card lift + border glow

### Slide-Over Panel
- 420px from right edge
- Backdrop blur (8px) on overlay
- Close: X button, Escape key, backdrop click
- Tabbed content (Overview, Terminal, Channels, etc.)
- Slide-in animation: 300ms ease-out
- Header: entity name + type label + close button

### Status Badges
- Rounded pill shape
- Color-coded background (dim variant) + text
- Icon left of label
- Small: `--text-xs`, padding 2px 8px
- Standard: `--text-sm`, padding 4px 12px

### Metric Cards
- Label (dim) above, value (stellar, mono) below
- Optional trend indicator (arrow + percentage)
- Optional sparkline inline
- Counter animation on load (ease-out, 1.5s)

### Progress Bars
- 4px height, rounded
- Track: `rgba(0, 201, 167, 0.1)`
- Fill: `--bio` (animate from 0 on load)
- Running: subtle pulse on the fill edge

---

## 6. Animation Specification

### Principles

1. **Organic, not mechanical.** Animations should feel like living things — ease-out for entrances (organisms decelerate into rest), ease-in for exits (organisms accelerate away).
2. **Purposeful motion.** Every animation communicates state change. No decorative animation.
3. **Stagger for narrative.** Lists and grids use staggered entrance to guide the eye through a reading order.
4. **Respect prefers-reduced-motion.** All animations disabled when the system preference is set.

### Timing

| Animation | Duration | Easing | Trigger |
|-----------|----------|--------|---------|
| Timeline item entrance | 400ms | ease-out | Scroll into view |
| Timeline stagger delay | 100ms per item | — | Page load |
| Card hover lift | 200ms | ease-out | Mouse enter |
| Badge pulse (running) | 2500ms | ease-in-out | Continuous |
| Progress bar fill | 800ms | ease-out | Load / update |
| Counter increment | 1500ms | ease-out | Load |
| Slide-over open | 300ms | ease-out | Click trigger |
| Slide-over close | 250ms | ease-in | Close action |
| Backdrop fade | 200ms | linear | Panel open/close |
| Nav underline grow | 200ms | ease-out | Hover |
| Attention banner slide | 500ms | ease-out | Page load |
| Sparkline draw | 1000ms | ease-out | Load |

### Keyframes

```css
/* Running status pulse */
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 var(--bio-glow); }
  50% { box-shadow: 0 0 16px 4px var(--bio-glow); }
}

/* Timeline item entrance */
@keyframes slide-in-left {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}

/* Counter tick */
@keyframes count-up {
  from { opacity: 0.5; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

/* Attention banner */
@keyframes slide-down {
  from { opacity: 0; transform: translateY(-20px); max-height: 0; }
  to { opacity: 1; transform: translateY(0); max-height: 300px; }
}
```

---

## 7. Interaction Patterns

### Navigation
- Horizontal nav items with hover underline preview
- Active item: solid underline, bioluminescent
- Badge counts on items with pending actions
- Cmd+K global search (opens command palette)

### Card Selection
- Click card → opens slide-over detail panel
- Selected card gets brighter border
- Only one card selected at a time
- Click outside / Escape → deselect

### Timeline Reading
- Scroll to browse history
- Time period headers are sticky during scroll
- "Load more" at the bottom of each period
- New events animate in at top when data refreshes

### Slide-Over Panel
- Opens from right with backdrop blur
- Tabbed content for different views
- Close: X button, Escape, backdrop click
- Preserves scroll position per tab

### Attention Actions
- Banner items have explicit action buttons
- Clicking action opens the relevant slide-over with context
- Dismissing an item removes it from banner, badge updates
- Cannot dismiss without acting (for HIGH priority items)

---

## 8. Responsive Behavior

| Breakpoint | Layout Change |
|-----------|--------------|
| > 1200px | Full layout (cards 2-col, timeline centered) |
| 768-1200px | Cards stack to 1-col, timeline full-width |
| < 768px | Nav collapses to hamburger, slide-over becomes full-screen modal |

### Mobile-First Considerations
- Single-column timeline works naturally on mobile
- Attention banner remains at top (most important content first)
- Cards become full-width with horizontal scrolling for metrics
- Slide-over becomes a full-screen page push

---

## 9. Vidtecci 5-Principle Alignment

| Principle | Application |
|-----------|------------|
| **Depth Before Decoration** | Dark Void background, cards glow from within. No surface patterns or textures. |
| **Precision in Service of Wonder** | Timeline events precisely placed, spacing intentional, typography measured. The precision reveals the living system. |
| **Organic Geometry** | Rounded cards (12px), circular timeline dots, smooth animations. Geometric structure with organic rhythm. |
| **Warm Signal on Cold Cosmos** | Solar Warmth reserved exclusively for human attention moments (approvals, warnings). Never used for decoration. |
| **Scale Without Hierarchy** | Individual session detail (atomic) and project-wide timeline (aggregate) coexist on the same page. Micro and macro equally important. |

---

## 10. Anti-Patterns

| Don't | Why |
|-------|-----|
| Use color alone for status | Accessibility — always pair with icon + text label |
| Auto-play sound on notifications | Alert fatigue — sound only for HIGH priority (and user-configurable) |
| Show all data at once | Cognitive overload — progressive disclosure, three tiers max |
| Use the Attention Banner for informational items | Erodes trust — banner is for actions, not announcements |
| Animate everything | Motion sickness — animate state changes only, respect prefers-reduced-motion |
| Use Solar Warmth for non-human-attention elements | Semantic dilution — warmth = human signal, nothing else |
| Put technical IDs in primary position | Narrative Flow is human-first — nicknames and descriptions come before UUIDs |
| Break the chronological order of the timeline | The timeline is the organizing principle — mixing chronological and categorical breaks the narrative |
