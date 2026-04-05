/**
 * StructuredCard tests — uses vitest + @testing-library/react.
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
 *     npx vitest run src/domains/build/__tests__/StructuredCard.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StructuredCard } from '../StructuredCard';
import type { StructuredCard as StructuredCardType } from '../types';

describe('StructuredCard', () => {
  it('renders feature-spec card with problem and criteria', () => {
    const card: StructuredCardType = {
      type: 'feature-spec',
      data: {
        problem: 'Auth logic duplicated across 3 domains',
        scope: 'domains/auth/ (new)',
        approach: 'Extract AuthPort, 3-wave migration',
        criteria: [
          'All auth imports resolve to domains/auth/',
          'Zero runtime auth logic in consumer domains',
          'tsc --noEmit: 0 errors',
        ],
      },
    };

    render(<StructuredCard card={card} />);

    // Problem text renders
    expect(
      screen.getByText('Auth logic duplicated across 3 domains'),
    ).toBeInTheDocument();

    // Scope renders
    expect(screen.getByText('domains/auth/ (new)')).toBeInTheDocument();

    // Approach renders
    expect(
      screen.getByText('Extract AuthPort, 3-wave migration'),
    ).toBeInTheDocument();

    // Criteria items render
    expect(
      screen.getByText('All auth imports resolve to domains/auth/'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Zero runtime auth logic in consumer domains'),
    ).toBeInTheDocument();
    expect(screen.getByText('tsc --noEmit: 0 errors')).toBeInTheDocument();

    // Field labels present
    expect(screen.getByText('problem:')).toBeInTheDocument();
    expect(screen.getByText('scope:')).toBeInTheDocument();
    expect(screen.getByText('criteria:')).toBeInTheDocument();
  });

  it('renders review-findings card grouped by severity', () => {
    const card: StructuredCardType = {
      type: 'review-findings',
      data: {
        findings: [
          { severity: 'Fix-Now', message: 'Unhandled null reference in auth flow', file: 'auth.ts', line: 42 },
          { severity: 'Fix-Soon', message: 'Missing error boundary', file: 'App.tsx' },
          { severity: 'Suggestion', message: 'Consider extracting helper function' },
        ],
      },
    };

    render(<StructuredCard card={card} />);

    // Card title
    expect(screen.getByText('Review Findings')).toBeInTheDocument();

    // Severity labels render
    expect(screen.getByText('Fix-Now')).toBeInTheDocument();
    expect(screen.getByText('Fix-Soon')).toBeInTheDocument();
    expect(screen.getByText('Suggestion')).toBeInTheDocument();

    // Finding messages render
    expect(
      screen.getByText('Unhandled null reference in auth flow'),
    ).toBeInTheDocument();
    expect(screen.getByText('Missing error boundary')).toBeInTheDocument();
    expect(
      screen.getByText('Consider extracting helper function'),
    ).toBeInTheDocument();

    // File references render
    expect(screen.getByText('auth.ts:42')).toBeInTheDocument();
    expect(screen.getByText('App.tsx')).toBeInTheDocument();
  });

  it('renders evidence-report card with verdict badge', () => {
    const card: StructuredCardType = {
      type: 'evidence-report',
      data: {
        verdict: 'fully_validated',
        totalCost: 1.8,
        overheadPct: 9,
        interventions: 3,
        durationMin: 12,
      },
    };

    render(<StructuredCard card={card} />);

    // Verdict badge text
    expect(screen.getByText('Fully Validated')).toBeInTheDocument();

    // Mini stats
    expect(screen.getByText('$1.80')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('9%')).toBeInTheDocument();
    expect(screen.getByText('Overhead')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Interventions')).toBeInTheDocument();
    expect(screen.getByText('12m')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
  });

  it('renders debate-decision card with collapsible content', () => {
    const card: StructuredCardType = {
      type: 'debate-decision',
      data: {
        motion: 'Extract AuthPort as central auth interface',
        advisors: [
          { name: 'architecture', position: 'for', argument: 'Clean separation. Port pattern matches FCA.' },
          { name: 'security', position: 'for', argument: 'Centralizes auth surface.' },
        ],
        verdict: 'unanimous approval',
      },
    };

    render(<StructuredCard card={card} />);

    // Collapsed state: shows motion in button text
    expect(
      screen.getByText(/Extract AuthPort as central auth interface/),
    ).toBeInTheDocument();

    // Advisor details should NOT be visible in collapsed state
    expect(screen.queryByText('unanimous approval')).not.toBeInTheDocument();

    // Click to expand
    const expandButton = screen.getByText(
      /Extract AuthPort as central auth interface/,
    );
    fireEvent.click(expandButton);

    // Expanded state: shows advisor arguments and verdict
    expect(
      screen.getByText(/Clean separation. Port pattern matches FCA./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Centralizes auth surface./),
    ).toBeInTheDocument();
    expect(screen.getByText('unanimous approval')).toBeInTheDocument();
  });

  it('returns null for unknown card types', () => {
    const card = {
      type: 'unknown-type' as StructuredCardType['type'],
      data: {},
    };

    const { container } = render(<StructuredCard card={card} />);
    expect(container.innerHTML).toBe('');
  });
});
