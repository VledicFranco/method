/**
 * NativeSessionDiscovery — Port interface for discovering live Claude CLI sessions.
 *
 * Reads session PID files written by Claude CLI to discover sessions that are
 * still alive at the OS level. Used by startup recovery to reconcile persisted
 * session state against actual running processes.
 *
 * Port pattern (DR-15): interface defined here, factory creates the Node implementation.
 * The composition root wires the concrete instance.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Port types ──────────────────────────────────────────────────

export interface NativeSessionInfo {
  sessionId: string;
  pid: number;
  projectPath: string;
  startedAt: number;
}

export interface NativeSessionDiscovery {
  listLiveSessions(): Promise<NativeSessionInfo[]>;
}

// ── Node implementation ─────────────────────────────────────────

/**
 * Checks whether a process with the given PID is alive.
 * Uses `process.kill(pid, 0)` which sends no signal but throws if PID is invalid.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a NativeSessionDiscovery backed by the filesystem.
 *
 * Reads `*.json` files from sessionsDir, parses each as a session PID file,
 * checks PID liveness, and returns only sessions with live PIDs.
 *
 * Handles corrupt JSON, missing files, and missing directory gracefully.
 */
export function createNodeNativeSessionDiscovery(
  sessionsDir?: string,
): NativeSessionDiscovery {
  const dir = sessionsDir ?? join(homedir(), '.claude', 'sessions');

  return {
    async listLiveSessions(): Promise<NativeSessionInfo[]> {
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        // Directory doesn't exist or is inaccessible — no sessions
        return [];
      }

      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      const results: NativeSessionInfo[] = [];

      for (const file of jsonFiles) {
        try {
          const raw = await readFile(join(dir, file), 'utf-8');
          const data = JSON.parse(raw) as {
            pid?: number;
            sessionId?: string;
            cwd?: string;
            startedAt?: number;
            kind?: string;
          };

          // Validate required fields
          if (
            typeof data.pid !== 'number' ||
            typeof data.sessionId !== 'string' ||
            typeof data.cwd !== 'string' ||
            typeof data.startedAt !== 'number'
          ) {
            continue;
          }

          if (isPidAlive(data.pid)) {
            results.push({
              sessionId: data.sessionId,
              pid: data.pid,
              projectPath: data.cwd,
              startedAt: data.startedAt,
            });
          }
        } catch {
          // Corrupt JSON or unreadable file — skip
          continue;
        }
      }

      return results;
    },
  };
}
