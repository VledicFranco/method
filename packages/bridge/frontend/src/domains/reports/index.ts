/**
 * reports/ domain — GlyphJS document rendering for strategy artifacts.
 *
 * PRD-044: This domain owns the GlyphReport component, which compiles GlyphJS
 * markdown to IR and renders it in the bridge dashboard. All bridge frontend
 * consumers of @glyphjs/* must import through this domain — never directly.
 *
 * C-3 implementation: GlyphReport is the real implementation extracted from
 * sessions/ChatView.tsx. The Wave 0 stub has been replaced.
 */

import type { ReactNode } from 'react';

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

export { GlyphReport } from './GlyphReport.js';
