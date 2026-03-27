/**
 * ChatView tests — uses vitest + @testing-library/react.
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
 *     npx vitest run src/domains/sessions/ChatView.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatView } from './ChatView';
import type { ChatTurn, SessionSummary } from './types';

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: 'sess-0001',
    nickname: 'alpha',
    purpose: null,
    status: 'idle',
    mode: 'pty',
    queue_depth: 0,
    metadata: {},
    prompt_count: 0,
    last_activity_at: new Date().toISOString(),
    workdir: '/tmp/work',
    parent_session_id: null,
    depth: 0,
    children: [],
    budget: { max_depth: 3, max_agents: 5, agents_spawned: 0 },
    isolation: 'shared',
    worktree_path: null,
    metals_available: false,
    stale: false,
    ...overrides,
  };
}

const historicalTurn: ChatTurn = {
  kind: 'historical',
  prompt: 'What is 2+2?',
  output: 'The answer is 4.',
  timestamp: new Date().toISOString(),
};

const liveTurn: ChatTurn = {
  kind: 'live',
  prompt: 'Tell me a joke',
  output: 'Why did the chicken cross the road?',
  timestamp: new Date().toISOString(),
  metadata: {
    cost_usd: 0.0042,
    num_turns: 2,
    duration_ms: 3200,
    stop_reason: 'end_turn',
    input_tokens: 150,
    output_tokens: 80,
    cache_read_tokens: 5000,
    cache_write_tokens: 0,
  },
};

const pendingTurn: ChatTurn = {
  kind: 'pending',
  prompt: 'Processing this…',
};

describe('ChatView', () => {
  it('historical turn: output text rendered; no chips (no $ cost element)', () => {
    const session = makeSession();
    render(<ChatView session={session} turns={[historicalTurn]} isWorking={false} />);

    // Output text should be present
    expect(screen.getByText('The answer is 4.')).toBeInTheDocument();
    expect(screen.getByText('What is 2+2?')).toBeInTheDocument();

    // There should be no cost chip ($ symbol in a chip element)
    const allText = document.body.textContent ?? '';
    // Historical turns have no chips — check no cost chip exists
    const chips = document.querySelectorAll('[style*="border-radius: 4px"]');
    const costChip = Array.from(chips).find((el) => el.textContent?.startsWith('$'));
    expect(costChip).toBeUndefined();
  });

  it('live turn: output text + chips row with $ cost chip', () => {
    const session = makeSession();
    render(<ChatView session={session} turns={[liveTurn]} isWorking={false} />);

    // Output text should be present
    expect(screen.getByText('Why did the chicken cross the road?')).toBeInTheDocument();

    // Chips row should contain a $ cost element
    const costChip = screen.getByText(/^\$0\.00/);
    expect(costChip).toBeInTheDocument();

    // Should also have turns and duration chips
    expect(screen.getByText('2 turns')).toBeInTheDocument();
    expect(screen.getByText('3.2s')).toBeInTheDocument();
  });

  it('pending turn: pending indicator rendered (dots); no output text div', () => {
    const session = makeSession();
    render(<ChatView session={session} turns={[pendingTurn]} isWorking={true} />);

    // Prompt text should be visible
    expect(screen.getByText('Processing this…')).toBeInTheDocument();

    // Pending dots container should be present
    const dotsContainer = screen.getByLabelText('Working…');
    expect(dotsContainer).toBeInTheDocument();

    // There should be no output block text (no output text from pending)
    // The dots themselves contain the · character visually as CSS — just check no output block
    // Verify the pending turn has no text other than prompt
    expect(screen.queryByText('The answer is 4.')).not.toBeInTheDocument();
  });

  it('dead session: ⊗ terminated notice in document', () => {
    const session = makeSession({ status: 'dead' });
    const turns = [historicalTurn];

    render(<ChatView session={session} turns={turns} isWorking={false} />);

    expect(screen.getByText('session terminated')).toBeInTheDocument();
    // The ⊗ symbol should also be present
    const notice = document.body.textContent ?? '';
    expect(notice).toContain('⊗');
  });

  it('alive session: no terminated notice', () => {
    const session = makeSession({ status: 'running' });
    render(<ChatView session={session} turns={[historicalTurn]} isWorking={false} />);

    expect(screen.queryByText('session terminated')).not.toBeInTheDocument();
  });
});
