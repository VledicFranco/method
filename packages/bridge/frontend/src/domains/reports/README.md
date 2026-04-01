# reports/ domain

Owns all GlyphJS compile/render for the bridge frontend.

## Purpose

This domain is the **single entry point for `@glyphjs/*`** in the bridge frontend. All GlyphJS packages (`@glyphjs/compiler`, `@glyphjs/runtime`, `@glyphjs/components`) are consumed here and here only. No other domain may import `@glyphjs/*` directly.

## `GlyphReport` component

Lazy-compiled GlyphJS document renderer. Compiles GlyphJS markdown to IR client-side (dynamic import, non-blocking), then renders via `@glyphjs/runtime`.

### Props

```typescript
interface GlyphReportProps {
  markdown: string;           // Raw GlyphJS markdown to compile and render
  className?: string;         // CSS class applied to the container div
  layout?: 'document'         // GlyphJS layout mode (default: 'document')
         | 'dashboard';
  fallback?: ReactNode;       // Shown while compiling or on error (optional)
}
```

### Behavior

- Compiles on mount and whenever `markdown` changes
- Shows `fallback` (or a built-in "Compiling document…" message) while async compile is in progress
- Shows `fallback` on compile error — never throws
- Layout modes: `'document'` (linear report) | `'dashboard'` (grid panels)
- `@glyphjs/*` packages are dynamically imported — not included in the initial bundle

## Usage

```tsx
import { GlyphReport } from '@/domains/reports';

<GlyphReport
  markdown={strategyArtifactMarkdown}
  layout="document"
  fallback={<Spinner />}
/>
```

## Import boundary rule

**All `@glyphjs/*` imports must go through this domain.**

```
✓  import { GlyphReport } from '@/domains/reports';
✗  import { compile }     from '@glyphjs/compiler';   // never outside reports/
✗  import { GlyphDocument } from '@glyphjs/runtime';  // never outside reports/
```

This boundary is enforced by the `G-PRD044-GLYPHREPORT` architecture gate in `packages/bridge/src/shared/architecture.test.ts`.

## Extension

To add a new GlyphJS-backed component (e.g. a `GlyphDashboard` or `GlyphArtifact`):

1. Add the component file inside `reports/`
2. Export it from `reports/index.ts`
3. Reuse `getGlyphRuntime()` from `GlyphReport.tsx` for the lazy singleton loader
4. Keep all `@glyphjs/*` imports inside `reports/` — never export them to consumers
