/**
 * reports/ domain — GlyphJS document rendering for strategy artifacts.
 *
 * PRD-044: This domain owns the GlyphReport component, which compiles GlyphJS
 * markdown to IR and renders it in the bridge dashboard. All bridge frontend
 * consumers of @glyphjs/* must import through this domain — never directly.
 *
 * Wave 0 stub: GlyphReport is defined here as an interface so downstream
 * consumers (strategies/, etc.) can type-check against it before C-3 ships
 * the real implementation.
 */

import type { ReactNode, ReactElement } from 'react';

export interface GlyphReportProps {
  /** Raw GlyphJS markdown content to compile and render. */
  markdown: string;
  /** CSS class applied to the container div. */
  className?: string;
  /** GlyphJS layout mode. Defaults to 'document'. */
  layout?: 'document' | 'dashboard';
  /** Content shown while compiling or on compile error. */
  fallback?: ReactNode;
}

/**
 * Lazy-compiled GlyphJS document renderer.
 *
 * Compiles markdown → GlyphIR client-side using @glyphjs/compiler,
 * then renders via @glyphjs/runtime GlyphDocument.
 *
 * Wave 0 stub — C-3 (feat/prd-044-c3-frontend-reports) replaces this
 * with the real implementation extracted from sessions/ChatView.tsx.
 */
export function GlyphReport(_props: GlyphReportProps): ReactElement {
  throw new Error(
    'GlyphReport: Wave 0 stub — merge feat/prd-044-c3-frontend-reports before using this component.'
  );
}
