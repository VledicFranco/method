/**
 * PRD-044 C-4: ArtifactViewer — renders a strategy execution artifact.
 *
 * Detects GlyphJS content (ui: blocks or YAML frontmatter with a type: field)
 * and renders via GlyphReport. Falls back to a syntax-highlighted <pre><code>
 * block for plain text/markdown without GlyphJS markers.
 *
 * Import boundary: GlyphReport MUST come from @/domains/reports/index — never
 * directly from @glyphjs/*.
 */

import { useMemo } from 'react';
import { GlyphReport } from '@/domains/reports/index';
import { cn } from '@/shared/lib/cn';

export interface ArtifactViewerProps {
  content: string;
  artifactId: string;
  className?: string;
}

// ── GlyphJS detection ────────────────────────────────────────────

/**
 * Returns true if content looks like GlyphJS:
 * - Contains a `ui:` block (GlyphJS component syntax), or
 * - Starts with YAML frontmatter (`---`) that contains a `type:` field.
 */
function isGlyphJsContent(content: string): boolean {
  const trimmed = content.trimStart();

  // Check for ui: component blocks (GlyphJS embedded components)
  if (/^ui:\s+\w/m.test(content)) {
    return true;
  }

  // Check for YAML frontmatter with a type: field
  if (trimmed.startsWith('---')) {
    const fmEnd = content.indexOf('---', 3);
    if (fmEnd !== -1) {
      const frontmatter = content.slice(3, fmEnd);
      if (/^\s*type\s*:/m.test(frontmatter)) {
        return true;
      }
    }
  }

  return false;
}

// ── Component ────────────────────────────────────────────────────

export function ArtifactViewer({ content, artifactId, className }: ArtifactViewerProps) {
  const isGlyph = useMemo(() => isGlyphJsContent(content), [content]);

  if (isGlyph) {
    return (
      <GlyphReport
        markdown={content}
        layout="document"
        fallback={
          <pre
            className={cn(
              'rounded-card border border-bdr bg-abyss p-sp-4 overflow-auto',
              'text-[0.75rem] text-txt-dim font-mono whitespace-pre-wrap leading-relaxed',
              className,
            )}
            data-artifact-id={artifactId}
          >
            <code>{content}</code>
          </pre>
        }
        className={className}
      />
    );
  }

  return (
    <pre
      className={cn(
        'rounded-card border border-bdr bg-abyss p-sp-4 overflow-auto max-h-[60vh]',
        'text-[0.75rem] text-txt-dim font-mono whitespace-pre-wrap leading-relaxed',
        className,
      )}
      data-artifact-id={artifactId}
    >
      <code>{content}</code>
    </pre>
  );
}
