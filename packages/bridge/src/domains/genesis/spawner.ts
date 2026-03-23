/**
 * PRD 020 Phase 2A: Genesis Spawner
 *
 * Creates and manages the persistent Genesis session:
 * - Spawn with project_id="root" for root-level access
 * - Apply budget tracking (50K tokens/day default)
 * - Use OBSERVE+REPORT initialization prompt
 * - Maintain across bridge restarts
 */

import type { SessionPool } from '../../pool.js';
import type { SessionStatusInfo } from '../../pool.js';
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
  try {
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
      mode: 'pty',
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
