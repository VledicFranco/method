/**
 * ExperimentList tests — vitest + @testing-library/react.
 *
 * HOW TO RUN (once vitest is configured for the frontend package):
 *   cd packages/bridge/frontend
 *   npx vitest run src/domains/experiments/ExperimentList.test.tsx
 *
 * Note: The root `npm test` runs backend tests only (tsx --test). These
 * frontend tests require a vitest environment (jsdom). See ChatView.test.tsx
 * for setup instructions.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Experiment } from '@/domains/experiments/types';

// ── Mocks ────────────────────────────────────────────────────────

// Mock the hook so tests don't need a real API server
vi.mock('@/domains/experiments/useExperiments', () => ({
  useExperimentList: vi.fn(),
  useRefreshExperiments: vi.fn(() => vi.fn()),
}));

import { useExperimentList } from '@/domains/experiments/useExperiments';
import ExperimentList from './ExperimentList';

// ── Test helpers ─────────────────────────────────────────────────

function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 'exp-0001',
    name: 'Baseline Comparison',
    hypothesis: 'Cognitive agents outperform flat agents on multi-step tasks.',
    conditions: [{ name: 'v1-flat' }, { name: 'v2-cognitive' }],
    tasks: ['Implement a binary search function.'],
    status: 'running',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    updatedAt: new Date(Date.now() - 600_000).toISOString(),
    ...overrides,
  };
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ────────────────────────────────────────────────────────

describe('ExperimentList', () => {
  it('renders page title', () => {
    (useExperimentList as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ExperimentList />);
    expect(screen.getByText('Experiment Lab')).toBeInTheDocument();
  });

  it('shows empty state when there are no experiments', () => {
    (useExperimentList as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ExperimentList />);
    expect(screen.getByText(/No experiments yet/)).toBeInTheDocument();
    expect(screen.getByText(/Create one using MCP tools or the API/)).toBeInTheDocument();
  });

  it('renders an experiment row with name and status badge', () => {
    const exp = makeExperiment();
    (useExperimentList as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [exp],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ExperimentList />);
    expect(screen.getByText('Baseline Comparison')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('truncates long hypothesis text to 80 characters', () => {
    const long = 'A'.repeat(100);
    const exp = makeExperiment({ hypothesis: long });
    (useExperimentList as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [exp],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ExperimentList />);
    // Rendered text should be truncated (80 chars + ellipsis)
    const cell = screen.getByTitle(long);
    expect(cell.textContent).toHaveLength(81); // 80 + '…'
  });

  it('renders all 4 status badge variants', () => {
    const statuses = ['drafting', 'running', 'analyzing', 'concluded'] as const;
    const experiments = statuses.map((status, i) =>
      makeExperiment({ id: `exp-${i}`, name: `Exp ${i}`, status }),
    );
    (useExperimentList as ReturnType<typeof vi.fn>).mockReturnValue({
      data: experiments,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ExperimentList />);
    for (const status of statuses) {
      expect(screen.getByText(status)).toBeInTheDocument();
    }
  });

  it('shows loading skeletons when isLoading is true', () => {
    (useExperimentList as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ExperimentList />);
    // Empty-state text should NOT be visible
    expect(screen.queryByText(/No experiments yet/)).not.toBeInTheDocument();
  });

  it('shows an error message when the query fails', () => {
    (useExperimentList as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
      refetch: vi.fn(),
    });

    renderWithProviders(<ExperimentList />);
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });
});
