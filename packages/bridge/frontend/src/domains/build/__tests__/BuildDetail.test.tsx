/**
 * BuildDetail tests — uses vitest + @testing-library/react.
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
 *     npx vitest run src/domains/build/__tests__/BuildDetail.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BuildDetail } from '../BuildDetail';
import { MOCK_BUILDS } from '../mock-data';
import type { BuildSummary } from '../types';

// ── Helper: get a running build (rate limiting) and a completed build ──

const runningBuild = MOCK_BUILDS[0]; // Rate limiting — running, in implement phase
const completedBuild = MOCK_BUILDS[2]; // Health endpoint — completed, fully validated

describe('BuildDetail', () => {
  it('renders with 4 tabs (Overview, Artifacts, Events, Analytics)', () => {
    render(<BuildDetail build={runningBuild} />);

    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Artifacts')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
  });

  it('tab switching works — click Events tab, Events content appears', () => {
    render(<BuildDetail build={runningBuild} />);

    // Initially on Overview tab — should see phase timeline content
    // The Commissions section is part of Overview for running builds
    expect(screen.getByText('Commissions')).toBeInTheDocument();

    // Click Events tab
    fireEvent.click(screen.getByText('Events'));

    // Events tab content: "Event Stream" heading should appear
    expect(screen.getByText('Event Stream')).toBeInTheDocument();

    // Overview-specific content should no longer be visible
    expect(screen.queryByText('Commissions')).not.toBeInTheDocument();
  });

  it('tab switching works — click Artifacts tab, artifact list appears', () => {
    render(<BuildDetail build={runningBuild} />);

    // Click Artifacts tab
    fireEvent.click(screen.getByText('Artifacts'));

    // Artifacts tab shows per-phase artifact names
    expect(screen.getByText('ExplorationReport')).toBeInTheDocument();
    expect(screen.getByText('FeatureSpec')).toBeInTheDocument();
    expect(screen.getByText('DesignDoc')).toBeInTheDocument();
  });

  it('phase timeline renders 8 phase pills', () => {
    render(<BuildDetail build={runningBuild} />);

    // The 8 phases from PHASE_LABELS: Explore, Specify, Design, Plan, Implement, Review, Validate, Measure
    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText('Specify')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Implement')).toBeInTheDocument();
    // Review, Validate, Measure also present
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Validate')).toBeInTheDocument();
    expect(screen.getByText('Measure')).toBeInTheDocument();
  });

  it('commission progress cards render for running builds', () => {
    render(<BuildDetail build={runningBuild} />);

    // Running build (rate limiting) has 3 commissions
    expect(screen.getByText('C-1 rate-limit-port')).toBeInTheDocument();
    expect(screen.getByText('C-2 gateway-middleware')).toBeInTheDocument();
    expect(screen.getByText('C-3 tenant-quota-store')).toBeInTheDocument();

    // Strategy tag should appear
    expect(screen.getByText('s-fcd-commission-orch')).toBeInTheDocument();

    // 2/3 done counter
    expect(screen.getByText('2/3 done')).toBeInTheDocument();
  });
});
