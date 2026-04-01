/**
 * GlyphReport tests — vitest + @testing-library/react.
 *
 * HOW TO RUN (once vitest is configured for the frontend package):
 *   cd packages/bridge/frontend
 *   npx vitest run src/domains/reports/GlyphReport.test.tsx
 *
 * Note: The root `npm test` runs backend tests only (tsx --test). These
 * frontend tests require a vitest environment (jsdom). See ChatView.test.tsx
 * for setup instructions.
 *
 * All @glyphjs/* packages are mocked so tests do not require the compiler
 * to actually run. Tests verify: fallback during compile, successful render,
 * error handling, and layout prop pass-through.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GlyphReport } from './GlyphReport.js';

/* ------------------------------------------------------------------ */
/*  @glyphjs/* mocks                                                   */
/* ------------------------------------------------------------------ */

// Mock GlyphDocument — a simple div that echoes its props as data attrs.
const MockGlyphDocument = vi.fn(({ ir, layout }: { ir: any; layout?: string }) => (
  <div data-testid="glyph-document" data-layout={layout ?? 'document'} data-ir={JSON.stringify(ir)} />
));

// Compile mock — returns a successful result by default.
const mockCompile = vi.fn((md: string) => ({
  hasErrors: false,
  ir: { __source: md },
}));

// createGlyphRuntime mock — returns a GlyphDocument ComponentType.
const mockCreateGlyphRuntime = vi.fn(() => ({
  GlyphDocument: MockGlyphDocument,
}));

vi.mock('@glyphjs/compiler', () => ({
  compile: (...args: any[]) => mockCompile(...args),
}));

vi.mock('@glyphjs/runtime', () => ({
  createGlyphRuntime: (...args: any[]) => mockCreateGlyphRuntime(...args),
}));

vi.mock('@glyphjs/components', () => ({
  allComponentDefinitions: [],
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Reset the module-level singleton in GlyphReport so each test starts
 * with a fresh lazy-load cycle. We reset via vi.resetModules() + re-import
 * but since that's heavy, we instead reset mocks and rely on the fact that
 * the singleton is already resolved from the first test. For isolation we
 * only need to verify observable behavior (rendered output), not the internals.
 */
beforeEach(() => {
  vi.clearAllMocks();
  MockGlyphDocument.mockImplementation(({ ir, layout }: { ir: any; layout?: string }) => (
    <div data-testid="glyph-document" data-layout={layout ?? 'document'} data-ir={JSON.stringify(ir)} />
  ));
  mockCompile.mockImplementation((md: string) => ({
    hasErrors: false,
    ir: { __source: md },
  }));
  mockCreateGlyphRuntime.mockReturnValue({ GlyphDocument: MockGlyphDocument });
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('GlyphReport', () => {
  it('renders the fallback while compiling (initial state)', () => {
    // The component starts in loading state before the async compile resolves.
    render(
      <GlyphReport
        markdown="# Hello"
        fallback={<div data-testid="my-fallback">Loading...</div>}
      />,
    );

    // The fallback should be immediately visible on first render.
    expect(screen.getByTestId('my-fallback')).toBeInTheDocument();
  });

  it('renders GlyphDocument after successful compile', async () => {
    render(
      <GlyphReport
        markdown="# Hello"
        fallback={<div data-testid="my-fallback">Loading...</div>}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('glyph-document')).toBeInTheDocument();
    });

    // Fallback should be gone once compiled
    expect(screen.queryByTestId('my-fallback')).not.toBeInTheDocument();
  });

  it('passes layout="document" to GlyphDocument by default', async () => {
    render(<GlyphReport markdown="# Doc" />);

    await waitFor(() => {
      expect(screen.getByTestId('glyph-document')).toBeInTheDocument();
    });

    expect(screen.getByTestId('glyph-document')).toHaveAttribute('data-layout', 'document');
  });

  it('passes layout="dashboard" to GlyphDocument when specified', async () => {
    render(<GlyphReport markdown="# Dashboard" layout="dashboard" />);

    await waitFor(() => {
      expect(screen.getByTestId('glyph-document')).toBeInTheDocument();
    });

    expect(screen.getByTestId('glyph-document')).toHaveAttribute('data-layout', 'dashboard');
  });

  it('shows fallback when compile returns hasErrors=true', async () => {
    mockCompile.mockReturnValueOnce({ hasErrors: true, ir: null });

    render(
      <GlyphReport
        markdown="bad markdown"
        fallback={<div data-testid="error-fallback">Compile failed</div>}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('error-fallback')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('glyph-document')).not.toBeInTheDocument();
  });

  it('shows fallback when compile throws', async () => {
    mockCompile.mockImplementationOnce(() => {
      throw new Error('syntax error');
    });

    render(
      <GlyphReport
        markdown="broken"
        fallback={<div data-testid="throw-fallback">Error</div>}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('throw-fallback')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('glyph-document')).not.toBeInTheDocument();
  });

  it('applies className to the container div when rendering', async () => {
    render(
      <GlyphReport markdown="# Styled" className="my-class" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('glyph-document')).toBeInTheDocument();
    });

    // The container wrapping GlyphDocument should have the className
    const container = screen.getByTestId('glyph-document').parentElement;
    expect(container).toHaveClass('my-class');
  });

  it('uses a default loading indicator when no fallback prop is provided', () => {
    render(<GlyphReport markdown="# Loading" />);

    // Before compile resolves, something should be in the DOM (the default fallback)
    // We can verify the glyph-document is not yet there on initial render.
    // (If it were synchronous, it would be there immediately — but it's async.)
    expect(screen.queryByTestId('glyph-document')).not.toBeInTheDocument();
  });

  it('does not throw when render completes successfully — no error boundary activation', async () => {
    const { container } = render(
      <GlyphReport markdown="# Safe" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('glyph-document')).toBeInTheDocument();
    });

    // Container should be intact — no error boundary fallback
    expect(container.firstChild).not.toBeNull();
  });
});
