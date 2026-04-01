/**
 * GlyphReport — lazy-compiled GlyphJS document renderer.
 *
 * PRD-044 C-3: Extracted from sessions/ChatView.tsx.
 *
 * Compiles GlyphJS markdown → IR client-side using @glyphjs/compiler,
 * then renders via @glyphjs/runtime GlyphDocument. Both packages are
 * dynamically imported (never statically) so they do not bloat the
 * initial bundle.
 *
 * All bridge frontend consumers of @glyphjs/* must go through this
 * component — never import @glyphjs packages directly from other domains.
 */

import React, {
  useState,
  useEffect,
  Component,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { GlyphReportProps } from './index.js';

/* ------------------------------------------------------------------ */
/*  Bridge dark theme (mirrors ChatView.tsx BRIDGE_GLYPH_THEME)       */
/* ------------------------------------------------------------------ */

const BRIDGE_GLYPH_THEME = {
  name: 'bridge-dark',
  variables: {
    '--glyph-bg': 'transparent',
    '--glyph-text': 'var(--text)',
    '--glyph-text-muted': 'var(--text-muted)',
    '--glyph-heading': 'var(--text)',
    '--glyph-link': 'var(--bio)',
    '--glyph-link-hover': 'var(--bio)',
    '--glyph-border': 'rgba(138,155,176,0.15)',
    '--glyph-border-strong': 'rgba(138,155,176,0.3)',
    '--glyph-surface': 'var(--abyss)',
    '--glyph-surface-raised': 'var(--abyss-light, #1a2433)',
    '--glyph-accent': 'var(--bio)',
    '--glyph-accent-hover': 'var(--bio)',
    '--glyph-accent-subtle': 'rgba(100,200,150,0.12)',
    '--glyph-accent-muted': 'rgba(100,200,150,0.08)',
    '--glyph-text-on-accent': 'var(--void)',
    '--glyph-code-bg': 'var(--abyss-light, #1a2433)',
    '--glyph-code-text': 'var(--text)',
    '--glyph-font-body': 'var(--font-mono)',
    '--glyph-font-heading': 'var(--font-mono)',
    '--glyph-font-mono': 'var(--font-mono)',
    '--glyph-color-success': 'var(--bio)',
    '--glyph-color-warning': 'var(--solar)',
    '--glyph-color-error': 'var(--error)',
    '--glyph-color-info': 'var(--bio)',
  } as Record<string, string>,
};

/* ------------------------------------------------------------------ */
/*  Lazy runtime loader — module-level singleton                       */
/* ------------------------------------------------------------------ */

let _glyphPromise: Promise<{
  compile: (md: string) => any;
  GlyphDoc: ComponentType<{ ir: any; layout?: string }>;
}> | null = null;

function getGlyphRuntime() {
  if (!_glyphPromise) {
    _glyphPromise = Promise.all([
      import('@glyphjs/compiler'),
      import('@glyphjs/runtime'),
      import('@glyphjs/components'),
    ]).then(([compiler, runtime, components]) => {
      const rt = runtime.createGlyphRuntime({
        components: [...components.allComponentDefinitions] as any,
        theme: BRIDGE_GLYPH_THEME,
        animation: { enabled: true, duration: 200 },
      });
      return {
        compile: compiler.compile,
        GlyphDoc: rt.GlyphDocument as ComponentType<{ ir: any; layout?: string }>,
      };
    });
  }
  return _glyphPromise;
}

/* ------------------------------------------------------------------ */
/*  Error boundary — catches GlyphJS render failures                  */
/* ------------------------------------------------------------------ */

class GlyphErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/*  Default fallback UI                                               */
/* ------------------------------------------------------------------ */

const defaultLoadingFallback: ReactNode = (
  <div
    style={{
      padding: '16px',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      color: 'var(--text-muted)',
      textAlign: 'center',
    }}
  >
    Compiling document...
  </div>
);

/* ------------------------------------------------------------------ */
/*  GlyphReport component                                             */
/* ------------------------------------------------------------------ */

/**
 * Lazy-compiled GlyphJS document renderer.
 *
 * - Compiles markdown → GlyphIR on mount/update (async, non-blocking)
 * - Shows fallback while compiling and on compile error
 * - Never throws — all failures are swallowed to fallback
 * - Layout modes: 'document' (default) | 'dashboard'
 */
export function GlyphReport({
  markdown,
  className,
  layout = 'document',
  fallback,
}: GlyphReportProps): React.ReactElement {
  const [compiledIr, setCompiledIr] = useState<any | null>(null);
  const [GlyphDoc, setGlyphDoc] = useState<ComponentType<{ ir: any; layout?: string }> | null>(null);
  const [hasError, setHasError] = useState(false);

  const effectiveFallback = fallback ?? defaultLoadingFallback;

  useEffect(() => {
    let cancelled = false;
    setCompiledIr(null);
    setHasError(false);

    getGlyphRuntime()
      .then(({ compile, GlyphDoc: Doc }) => {
        if (cancelled) return;
        try {
          const result = compile(markdown);
          if (result && !result.hasErrors && result.ir) {
            setCompiledIr(result.ir);
            setGlyphDoc(() => Doc);
          } else {
            setHasError(true);
          }
        } catch {
          if (!cancelled) setHasError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setHasError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [markdown]);

  if (hasError || !compiledIr || !GlyphDoc) {
    if (hasError) return <>{effectiveFallback}</>;
    // Still compiling
    return <>{effectiveFallback}</>;
  }

  return (
    <div className={className}>
      <GlyphErrorBoundary fallback={effectiveFallback}>
        <GlyphDoc ir={compiledIr} layout={layout} />
      </GlyphErrorBoundary>
    </div>
  );
}
