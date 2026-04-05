/**
 * EvidenceReport tests — uses vitest + @testing-library/react.
 *
 * HOW TO RUN:
 *   These tests require vitest and @testing-library/react to be installed and
 *   a vitest.config.ts to be set up in packages/bridge/frontend/.
 *
 *   Install deps (if not already):
 *     cd packages/bridge/frontend
 *     npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
 *
 *   Then run:
 *     npx vitest run src/domains/build/__tests__/EvidenceReport.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvidenceReport } from '../EvidenceReport';
import { MOCK_BUILDS } from '../mock-data';
import type { BuildSummary, Refinement } from '../types';

// The health endpoint build is completed with full evidence
const completedBuild = MOCK_BUILDS[2];

// Helper: build with refinements for testing
function buildWithRefinements(refinements: Refinement[]): BuildSummary {
  return {
    ...completedBuild,
    refinements,
  };
}

describe('EvidenceReport', () => {
  it('renders verdict badge with correct text (FULLY VALIDATED)', () => {
    render(<EvidenceReport build={completedBuild} />);

    expect(screen.getByText('FULLY VALIDATED')).toBeInTheDocument();
  });

  it('returns null for builds without verdict or evidence', () => {
    const incompleteRender = render(
      <EvidenceReport build={MOCK_BUILDS[0]} />,
    );

    // Running build has no verdict — component returns null
    expect(incompleteRender.container.innerHTML).toBe('');
  });

  it('shows 5-stat grid (cost, overhead, interventions, duration, recoveries)', () => {
    render(<EvidenceReport build={completedBuild} />);

    // Cost: $1.80
    expect(screen.getByText('$1.80')).toBeInTheDocument();
    expect(screen.getByText('Total Cost')).toBeInTheDocument();

    // Overhead: 9%
    expect(screen.getByText('9%')).toBeInTheDocument();
    expect(screen.getByText('Overhead')).toBeInTheDocument();

    // Interventions: 3
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Interventions')).toBeInTheDocument();

    // Duration: 12m
    expect(screen.getByText('12m')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();

    // Failures: 0
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Failures')).toBeInTheDocument();
  });

  it('criteria checklist shows pass/fail status', () => {
    render(<EvidenceReport build={completedBuild} />);

    // Health endpoint build has 3 criteria, all passed
    expect(
      screen.getByText('GET /health returns 200 with uptime, version'),
    ).toBeInTheDocument();
    expect(screen.getByText('tsc --noEmit: 0 errors')).toBeInTheDocument();
    expect(
      screen.getByText('All tests pass (4 new, 127 total)'),
    ).toBeInTheDocument();

    // Should show "3/3 passed" subtitle
    expect(screen.getByText('3/3 passed')).toBeInTheDocument();
  });

  it('refinements list renders "No refinements" for clean builds', () => {
    render(<EvidenceReport build={completedBuild} />);

    // Health endpoint has empty refinements array
    expect(screen.getByText('Refinements')).toBeInTheDocument();
    expect(screen.getByText(/No refinements/)).toBeInTheDocument();
  });

  it('refinements list renders with category tags when present', () => {
    const refinements: Refinement[] = [
      {
        target: 'gate',
        description: 'G-NO-ANY gate too strict for Express handlers',
        frequency: '2 of 5 builds',
      },
      {
        target: 'strategy',
        description: 'Commission timeout too short for large diffs',
        frequency: '1 of 5 builds',
      },
    ];

    render(<EvidenceReport build={buildWithRefinements(refinements)} />);

    // Refinement descriptions render
    expect(
      screen.getByText('G-NO-ANY gate too strict for Express handlers'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Commission timeout too short for large diffs'),
    ).toBeInTheDocument();

    // Category tags render
    expect(screen.getByText('gate')).toBeInTheDocument();
    expect(screen.getByText('strategy')).toBeInTheDocument();

    // Frequency labels render
    expect(screen.getByText('2 of 5 builds')).toBeInTheDocument();
    expect(screen.getByText('1 of 5 builds')).toBeInTheDocument();
  });
});
