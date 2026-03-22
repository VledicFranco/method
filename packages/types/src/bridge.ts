/**
 * Bridge/transport protocol types shared across agent providers and the bridge server.
 *
 * These describe the wire protocol — what goes over HTTP between
 * agent providers (methodts) and the bridge session pool.
 */

import type { IsolationMode, SessionMode } from "./identifiers.js";
// CostMetrics re-exported from cost.ts for consumers who need both bridge + cost types

/** Session budget constraints for hierarchical agent chains. */
export type SessionBudget = {
  readonly max_depth: number;
  readonly max_agents: number;
  readonly agents_spawned: number;
};

/** Parent/child session chain metadata. */
export type SessionChainInfo = {
  readonly parent_session_id: string | null;
  readonly depth: number;
  readonly children: readonly string[];
  readonly budget: SessionBudget;
};

/** Parameters for spawning a bridge session (maps to POST /sessions). */
export type BridgeSpawnParams = {
  readonly workdir: string;
  readonly nickname?: string;
  readonly purpose?: string;
  readonly parentSessionId?: string;
  readonly depth?: number;
  readonly budget?: { readonly maxDepth: number; readonly maxAgents: number };
  readonly isolation?: IsolationMode;
  readonly timeoutMs?: number;
  readonly mode?: SessionMode;
  readonly spawnArgs?: readonly string[];
};

/** Worktree metadata returned by the bridge. */
export type WorktreeInfo = {
  readonly isolation: IsolationMode;
  readonly worktree_path: string | null;
  readonly worktree_branch: string | null;
  readonly metals_available: boolean;
};

/** Progress channel payload (POST /sessions/:id/channels/progress). */
export type ProgressPayload = {
  readonly step: string;
  readonly status: string;
  readonly detail?: string;
  readonly timestamp: string;
};

/** Event channel payload (POST /sessions/:id/channels/events). */
export type EventPayload = {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
};
