/**
 * Startup Recovery — Three-phase session recovery on bridge restart.
 *
 * Reconciles persisted session state with native OS process discovery
 * to determine which sessions can be restored and which are tombstoned.
 *
 * Phases:
 *   1. Discover — load persisted sessions + list live native sessions
 *   2. Reconcile — cross-reference by sessionId to classify each session
 *   3. Hydrate — call restoreSession() for each recoverable session
 *
 * Emits system.recovery_started and system.recovery_completed events via the EventBus.
 */

import type { NativeSessionDiscovery, NativeSessionInfo } from './ports/native-session-discovery.js';
import type { BridgeEvent, BridgeEventInput } from './ports/event-bus.js';

// ── Types ───────────────────────────────────────────────────────

export interface PersistedSessionForRecovery {
  session_id: string;
  workdir: string;
  nickname: string;
  purpose: string | null;
  mode: 'pty' | 'print';
  status: string;
  created_at: string;
  last_activity_at: string;
  prompt_count: number;
  depth: number;
  parent_session_id: string | null;
  isolation: string;
  metadata?: Record<string, unknown>;
}

export interface SessionSnapshot {
  sessionId: string;
  workdir: string;
  nickname: string;
  purpose: string | null;
  mode: 'pty' | 'print';
  pid: number;
  promptCount: number;
  depth: number;
  parentSessionId: string | null;
  isolation: string;
  metadata?: Record<string, unknown>;
}

export interface RecoveryReport {
  recovered: number;
  failed: number;
  tombstoned: number;
  skipped: number;
  durationMs: number;
}

export interface RecoveryDeps {
  persistence: {
    loadAll(): Promise<PersistedSessionForRecovery[]>;
  };
  discovery: NativeSessionDiscovery;
  restoreSession: (snapshot: SessionSnapshot) => void;
  eventBus: {
    emit(event: BridgeEventInput): BridgeEvent;
  };
}

// ── Implementation ──────────────────────────────────────────────

export async function runStartupRecovery(deps: RecoveryDeps): Promise<RecoveryReport> {
  const startTime = Date.now();

  // Emit recovery_started before discovery
  deps.eventBus.emit({
    version: 1,
    domain: 'system',
    type: 'system.recovery_started',
    severity: 'info',
    payload: {},
    source: 'bridge/startup-recovery',
  });

  // ── Phase 1: Discover ──

  let persisted: PersistedSessionForRecovery[] = [];
  let nativeSessions: NativeSessionInfo[] = [];

  // Load persisted sessions — always attempted
  try {
    persisted = await deps.persistence.loadAll();
  } catch (err) {
    console.error(`[startup-recovery] Failed to load persisted sessions: ${(err as Error).message}`);
  }

  // Discover native sessions — failure is non-fatal
  try {
    nativeSessions = await deps.discovery.listLiveSessions();
  } catch (err) {
    console.error(`[startup-recovery] Native session discovery failed: ${(err as Error).message}`);
    // Continue with empty native list — all persisted sessions will be tombstoned
  }

  // ── Phase 2: Reconcile ──

  const nativeBySessionId = new Map<string, NativeSessionInfo>();
  for (const ns of nativeSessions) {
    nativeBySessionId.set(ns.sessionId, ns);
  }

  const report: RecoveryReport = {
    recovered: 0,
    failed: 0,
    tombstoned: 0,
    skipped: 0,
    durationMs: 0,
  };

  interface RecoverableSession {
    persisted: PersistedSessionForRecovery;
    native: NativeSessionInfo;
  }

  const recoverable: RecoverableSession[] = [];

  for (const ps of persisted) {
    const native = nativeBySessionId.get(ps.session_id);
    if (native) {
      // Persisted + alive = recovering
      recoverable.push({ persisted: ps, native });
    } else {
      // Persisted + no live PID = restore as dead (available for resume)
      // Print-mode sessions never have persistent PIDs — they exit after each prompt.
      // Restoring as dead makes them visible in the UI session list with their
      // transcript accessible and resumable via --resume.
      if (ps.status !== 'dead') {
        try {
          deps.restoreSession({
            sessionId: ps.session_id,
            workdir: ps.workdir,
            nickname: ps.nickname,
            purpose: ps.purpose ?? null,
            mode: (ps.mode as 'print' | 'pty') ?? 'print',
            pid: 0, // no live process
            promptCount: ps.prompt_count ?? 0,
            depth: ps.depth ?? 0,
            parentSessionId: ps.parent_session_id ?? null,
            isolation: (ps.isolation as 'shared' | 'worktree') ?? 'shared',
            metadata: ps.metadata ?? {},
          });
          report.tombstoned++;
        } catch (err) {
          console.error(`[startup-recovery] Failed to restore dead session ${ps.session_id}: ${(err as Error).message}`);
          report.failed++;
        }
      } else {
        report.tombstoned++;
      }
    }
  }

  // Native sessions without persistence data are skipped (logged)
  for (const ns of nativeSessions) {
    const hasPersistence = persisted.some((ps) => ps.session_id === ns.sessionId);
    if (!hasPersistence) {
      report.skipped++;
      console.warn(
        `[startup-recovery] Native session ${ns.sessionId} (PID ${ns.pid}) has no persistence data — skipping`,
      );
    }
  }

  // ── Phase 3: Hydrate ──

  for (const { persisted: ps, native } of recoverable) {
    try {
      deps.restoreSession({
        sessionId: ps.session_id,
        workdir: ps.workdir,
        nickname: ps.nickname,
        purpose: ps.purpose,
        mode: ps.mode,
        pid: native.pid,
        promptCount: ps.prompt_count,
        depth: ps.depth,
        parentSessionId: ps.parent_session_id,
        isolation: ps.isolation,
        metadata: ps.metadata,
      });
      report.recovered++;
    } catch (err) {
      report.failed++;
      console.error(
        `[startup-recovery] Failed to restore session ${ps.session_id}: ${(err as Error).message}`,
      );
    }
  }

  report.durationMs = Date.now() - startTime;

  // Emit recovery_completed after hydration
  deps.eventBus.emit({
    version: 1,
    domain: 'system',
    type: 'system.recovery_completed',
    severity: 'info',
    payload: {
      recovered: report.recovered,
      failed: report.failed,
      tombstoned: report.tombstoned,
      skipped: report.skipped,
      durationMs: report.durationMs,
    },
    source: 'bridge/startup-recovery',
  });

  return report;
}
