/**
 * StatusBar tests — uses vitest + @testing-library/react.
 *
 * HOW TO RUN:
 *   These tests require vitest and @testing-library/react to be installed and
 *   a vitest.config.ts to be set up in packages/bridge/frontend/.
 *
 *   Install deps (if not already):
 *     cd packages/bridge/frontend
 *     npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
 *
 *   Create packages/bridge/frontend/vitest.config.ts:
 *     import { defineConfig } from 'vitest/config';
 *     export default defineConfig({
 *       test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'] },
 *     });
 *
 *   Create packages/bridge/frontend/vitest.setup.ts:
 *     import '@testing-library/jest-dom';
 *
 *   Then run:
 *     npx vitest run src/domains/sessions/StatusBar.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusBar } from './StatusBar';
import type { SessionSummary } from './types';

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: 'abcdef123456789xyz',
    nickname: 'my-session',
    purpose: 'doing things',
    status: 'idle',
    mode: 'pty',
    queue_depth: 0,
    metadata: { cost_usd: 0.01 },
    prompt_count: 7,
    last_activity_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2m ago
    workdir: '/home/user/projects/app',
    parent_session_id: null,
    depth: 0,
    children: [],
    budget: { max_depth: 3, max_agents: 5, agents_spawned: 0 },
    isolation: 'worktree',
    worktree_path: '/home/user/.worktrees/sess-01',
    metals_available: false,
    stale: false,
    ...overrides,
  };
}

describe('StatusBar', () => {
  it('collapsed: nickname is rendered', () => {
    const session = makeSession();
    render(<StatusBar session={session} />);

    expect(screen.getByText(/my-session/)).toBeInTheDocument();
  });

  it('collapsed: truncated session_id (first 8 chars + …)', () => {
    const session = makeSession({ session_id: 'abcdef123456789xyz' });
    render(<StatusBar session={session} />);

    // First 8 chars: 'abcdef12' + '…'
    expect(screen.getByText(/abcdef12…/)).toBeInTheDocument();
  });

  it('click ⊕: expands and shows full session_id', () => {
    const session = makeSession({ session_id: 'abcdef123456789xyz' });
    render(<StatusBar session={session} />);

    const expandBtn = screen.getByLabelText('Expand status bar');
    fireEvent.click(expandBtn);

    // Full session ID should now be visible in the expanded panel
    expect(screen.getByText('abcdef123456789xyz')).toBeInTheDocument();
  });

  it('click ⊖ from expanded: collapses (expanded panel disappears)', () => {
    const session = makeSession({ session_id: 'abcdef123456789xyz' });
    render(<StatusBar session={session} />);

    // Expand
    fireEvent.click(screen.getByLabelText('Expand status bar'));
    expect(screen.getByText('abcdef123456789xyz')).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByLabelText('Collapse status bar'));
    // Full session ID should no longer be visible in the expanded panel
    // (only the truncated short form remains)
    expect(screen.queryByText('abcdef123456789xyz')).not.toBeInTheDocument();
  });

  it('expanded: workdir text is visible', () => {
    const session = makeSession({ workdir: '/home/user/projects/app' });
    render(<StatusBar session={session} />);

    fireEvent.click(screen.getByLabelText('Expand status bar'));

    expect(screen.getByText('/home/user/projects/app')).toBeInTheDocument();
  });
});
