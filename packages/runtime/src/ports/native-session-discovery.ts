// SPDX-License-Identifier: Apache-2.0
/**
 * NativeSessionDiscovery — Port interface for discovering live Claude CLI sessions.
 *
 * PRD-057 / S2 §5.3: Only the interface lives in runtime. The Node impl
 * (`createNodeNativeSessionDiscovery`) stays in bridge because it reads the
 * filesystem — an OS-bound operation.
 *
 * Used by startup recovery to reconcile persisted session state against
 * actual running processes.
 */

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
