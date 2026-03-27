/**
 * SessionSidebar tests — uses vitest + @testing-library/react.
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
 *     npx vitest run src/domains/sessions/SessionSidebar.test.tsx
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionSidebar } from './SessionSidebar';
import type { SessionSummary } from './types';

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: 'sess-0001',
    nickname: 'alpha',
    purpose: 'test purpose',
    status: 'idle',
    mode: 'pty',
    queue_depth: 0,
    metadata: { cost_usd: 0.042 },
    prompt_count: 3,
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

function renderSidebar(props: {
  sessions?: SessionSummary[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  onSpawn?: () => void;
  onRefresh?: () => void;
}) {
  const {
    sessions = [],
    activeId = null,
    onSelect = vi.fn(),
    onSpawn = vi.fn(),
    onRefresh = vi.fn(),
  } = props;

  return render(
    <MemoryRouter>
      <SessionSidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={onSelect}
        onSpawn={onSpawn}
        onRefresh={onRefresh}
      />
    </MemoryRouter>,
  );
}

describe('SessionSidebar', () => {
  it('renders all sessions in the list', () => {
    const sessions = [
      makeSession({ session_id: 'sess-0001', nickname: 'alpha' }),
      makeSession({ session_id: 'sess-0002', nickname: 'beta' }),
      makeSession({ session_id: 'sess-0003', nickname: 'gamma' }),
    ];

    renderSidebar({ sessions });

    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('gamma')).toBeInTheDocument();
  });

  it('active session item has data-active="true"', () => {
    const sessions = [
      makeSession({ session_id: 'sess-0001', nickname: 'alpha' }),
      makeSession({ session_id: 'sess-0002', nickname: 'beta' }),
    ];

    renderSidebar({ sessions, activeId: 'sess-0001' });

    const items = document.querySelectorAll('[data-active]');
    const activeItem = Array.from(items).find(
      (el) => el.getAttribute('data-active') === 'true',
    );
    expect(activeItem).toBeTruthy();
    // The active item should be the first one (alpha)
    expect(activeItem?.textContent).toContain('alpha');
  });

  it('running session: progress bar is visible (opacity 1)', () => {
    const sessions = [makeSession({ status: 'running' })];
    renderSidebar({ sessions });

    // The progress bar is aria-hidden; query by its style
    const bar = document.querySelector('[aria-hidden="true"]') as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar?.style.opacity).toBe('1');
  });

  it('no running session: progress bar has opacity 0', () => {
    const sessions = [makeSession({ status: 'dead' })];
    renderSidebar({ sessions });

    const bar = document.querySelector('[aria-hidden="true"]') as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar?.style.opacity).toBe('0');
  });

  it('dead session: status dot has muted color (var(--text-muted))', () => {
    const sessions = [makeSession({ session_id: 'sess-dead', status: 'dead' })];
    renderSidebar({ sessions });

    // Find the session item and look for a dot element inside it
    const activeItem = document.querySelector('[data-active="false"]') as HTMLElement;
    expect(activeItem).toBeTruthy();
    // The first child of the row is the dot span
    const row = activeItem.querySelector('div');
    const dot = row?.querySelector('span') as HTMLElement | null;
    expect(dot?.style.background).toBe('var(--text-muted)');
  });

  it('refresh button calls onRefresh', () => {
    const onRefresh = vi.fn();
    renderSidebar({ onRefresh });

    fireEvent.click(screen.getByLabelText('Refresh sessions'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('spawn button calls onSpawn', () => {
    const onSpawn = vi.fn();
    renderSidebar({ onSpawn });

    fireEvent.click(screen.getByText(/new session/i));
    expect(onSpawn).toHaveBeenCalledTimes(1);
  });

  it('footer contains /sessions link', () => {
    renderSidebar({});

    const links = document.querySelectorAll('a[href]');
    const sessionLink = Array.from(links).find((el) =>
      el.getAttribute('href')?.includes('/sessions'),
    );
    expect(sessionLink).toBeTruthy();
  });
});
