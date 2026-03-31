/**
 * PRD 020 Phase 2A: Genesis Spawner
 *
 * Creates and manages the persistent Genesis session:
 * - Spawn with project_id="root" for root-level access
 * - Apply budget tracking (50K tokens/day default)
 * - Use OBSERVE+REPORT initialization prompt
 * - Maintain across bridge restarts
 */

import type { SessionPool, SessionStatusInfo } from '../../ports/session-pool.js';
import { getGenesisInitializationPrompt } from './initialization.js';

export interface GenesisConfig {
  enabled: boolean;
  sessionId?: string;
  budgetTokensPerDay: number;
  workdir: string;
}

export interface GenesisSpawnResult {
  sessionId: string;
  nickname: string;
  status: string;
  projectId: string;
  budgetTokensPerDay: number;
  initialized: boolean;
}

export interface GenesisPersistentState {
  sessionId: string;
  startedAt: Date;
  budgetTokensPerDay: number;
  lastActivityAt: Date;
}

/**
 * Spawn Genesis session on bridge startup
 *
 * PRD 029 C-3: Before spawning a new session, checks if a genesis-tagged session
 * was already recovered during startup recovery. If so, adopts the recovered session
 * instead of creating a duplicate — ensuring at most one genesis session per bridge instance.
 *
 * Parameters:
 * - pool: SessionPool for spawning
 * - workdir: Working directory for Genesis
 * - budgetTokensPerDay: Daily budget (default 50000)
 *
 * Returns: SpawnResult with sessionId and status
 */
export async function spawnGenesis(
  pool: SessionPool,
  workdir: string,
  budgetTokensPerDay: number = 50000,
): Promise<GenesisSpawnResult> {
  // PRD 029 C-3: Check if a genesis session already exists (recovered from crash)
  const existing = getGenesisStatus(pool);
  if (existing && (existing.status === 'running' || existing.status === 'idle' || existing.status === 'recovering')) {
    console.log(
      `Genesis: adopting recovered session ${existing.sessionId} (status=${existing.status})`,
    );
    return {
      sessionId: existing.sessionId,
      nickname: existing.nickname ?? 'genesis-root',
      status: existing.status,
      projectId: 'root',
      budgetTokensPerDay,
      initialized: false, // Already initialized from previous run
    };
  }

  try {
    console.log('Genesis: spawning new session');
    const result = await pool.create({
      workdir,
      initialPrompt: getGenesisInitializationPrompt(),
      nickname: 'genesis-root',
      metadata: {
        project_id: 'root',
        genesis: true,
        budget_tokens_per_day: budgetTokensPerDay,
      },
      persistent: true, // Skip stale detection
      // PRD 028: mode 'pty' removed — print is the only mode
    });

    return {
      sessionId: result.sessionId,
      nickname: result.nickname,
      status: result.status,
      projectId: 'root',
      budgetTokensPerDay,
      initialized: true,
    };
  } catch (err) {
    throw new Error(`Failed to spawn Genesis: ${(err as Error).message}`);
  }
}

/**
 * Get Genesis session status
 *
 * Returns: SessionStatusInfo if Genesis exists, undefined otherwise
 */
export function getGenesisStatus(pool: SessionPool): SessionStatusInfo | undefined {
  const sessions = pool.list();
  return sessions.find((s) => s.metadata?.genesis === true);
}

/**
 * Check if Genesis is running
 */
export function isGenesisRunning(pool: SessionPool): boolean {
  const status = getGenesisStatus(pool);
  return status != null && (status.status === 'running' || status.status === 'idle');
}

/**
 * Get Genesis session ID if running
 */
export function getGenesisSessionId(pool: SessionPool): string | undefined {
  const status = getGenesisStatus(pool);
  return status?.sessionId;
}
