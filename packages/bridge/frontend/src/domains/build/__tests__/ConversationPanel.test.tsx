/**
 * ConversationPanel tests — uses vitest + @testing-library/react.
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
 *     npx vitest run src/domains/build/__tests__/ConversationPanel.test.tsx
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationPanel } from '../ConversationPanel';
import { MOCK_BUILDS } from '../mock-data';
import type { BuildSummary } from '../types';

// ── Helper: minimal build with conversation ──

function makeBuild(overrides: Partial<BuildSummary> = {}): BuildSummary {
  return {
    ...MOCK_BUILDS[0],
    ...overrides,
  };
}

describe('ConversationPanel', () => {
  it('renders without crashing with mock build data', () => {
    const builds = MOCK_BUILDS;
    const onSelectBuild = vi.fn();

    render(
      <ConversationPanel
        builds={builds}
        selectedBuildId={builds[0].id}
        onSelectBuild={onSelectBuild}
      />,
    );

    // Should render without throwing — presence of the input area confirms mount
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
  });

  it('shows agent messages with correct avatar (B) and sender name', () => {
    const builds = MOCK_BUILDS;
    const onSelectBuild = vi.fn();

    render(
      <ConversationPanel
        builds={builds}
        selectedBuildId="build-rate-limiting"
        onSelectBuild={onSelectBuild}
      />,
    );

    // Agent messages use "Build" sender name and "B" avatar
    const buildLabels = screen.getAllByText('Build');
    expect(buildLabels.length).toBeGreaterThan(0);

    // Agent avatar letter "B" should appear
    const avatars = screen.getAllByText('B');
    expect(avatars.length).toBeGreaterThan(0);
  });

  it('shows human messages with correct avatar (F) and sender name', () => {
    // Auth extraction build has a human message
    const builds = MOCK_BUILDS;
    const onSelectBuild = vi.fn();

    render(
      <ConversationPanel
        builds={builds}
        selectedBuildId="build-auth-extraction"
        onSelectBuild={onSelectBuild}
      />,
    );

    // Human messages use "Franco" sender name
    expect(screen.getByText('Franco')).toBeInTheDocument();

    // Human avatar letter "F" should appear
    const avatars = screen.getAllByText('F');
    expect(avatars.length).toBeGreaterThan(0);
  });

  it('shows system messages with "System" sender name and "S" avatar', () => {
    const builds = MOCK_BUILDS;
    const onSelectBuild = vi.fn();

    render(
      <ConversationPanel
        builds={builds}
        selectedBuildId="build-rate-limiting"
        onSelectBuild={onSelectBuild}
      />,
    );

    // System messages use "System" sender name
    const systemLabels = screen.getAllByText('System');
    expect(systemLabels.length).toBeGreaterThan(0);

    // System avatar letter "S" should appear
    const avatars = screen.getAllByText('S');
    expect(avatars.length).toBeGreaterThan(0);
  });

  it('gate action buttons render correctly for "specify" gate type (1 action + Send)', () => {
    // Auth extraction build has activeGate: 'specify'
    const builds = MOCK_BUILDS;
    const onSelectBuild = vi.fn();

    render(
      <ConversationPanel
        builds={builds}
        selectedBuildId="build-auth-extraction"
        onSelectBuild={onSelectBuild}
      />,
    );

    // 'specify' gate shows 'Approve Spec' button
    expect(screen.getByText('Approve Spec')).toBeInTheDocument();

    // Send button is always present
    expect(screen.getByText('Send')).toBeInTheDocument();
  });

  it('gate action buttons render correctly for "review" gate type (3 action buttons + Send)', () => {
    // Create a build with review gate active
    const reviewBuild = makeBuild({
      id: 'build-review-test',
      name: 'Review test',
      activeGate: 'review',
      status: 'waiting',
      currentPhase: 'review',
    });

    render(
      <ConversationPanel
        builds={[reviewBuild]}
        selectedBuildId="build-review-test"
        onSelectBuild={vi.fn()}
      />,
    );

    // 'review' gate shows 3 actions: Approve, Approve with Comments, Request Changes
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Approve with Comments')).toBeInTheDocument();
    expect(screen.getByText('Request Changes')).toBeInTheDocument();

    // Send button always present
    expect(screen.getByText('Send')).toBeInTheDocument();
  });

  it('skill buttons [Debate] [Review] [Surface] are present', () => {
    const builds = MOCK_BUILDS;
    const onSelectBuild = vi.fn();

    render(
      <ConversationPanel
        builds={builds}
        selectedBuildId="build-rate-limiting"
        onSelectBuild={onSelectBuild}
      />,
    );

    expect(screen.getByText('Debate')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Surface')).toBeInTheDocument();
  });
});
