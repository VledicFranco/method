// ── Membership Configuration ────────────────────────────────────
//
// Zod-validated config for the membership state machine. Defaults
// are tuned for small clusters (2–5 nodes) on a LAN/Tailscale mesh.

import { z } from 'zod';

export const MembershipConfigSchema = z.object({
  /** Heartbeat interval in milliseconds. */
  heartbeatMs: z.number().int().positive().default(5000),

  /** Time after last heartbeat before a node is marked suspect. */
  suspectTimeoutMs: z.number().int().positive().default(15000),

  /** Full state broadcast interval in milliseconds. */
  stateBroadcastMs: z.number().int().positive().default(10000),

  /** Time after suspect before a node is marked dead. Defaults to 2x suspectTimeout. */
  deadTimeoutMs: z.number().int().positive().optional(),

  /** Time after dead before a node is garbage-collected from peers. Defaults to 3x suspectTimeout. */
  gcTimeoutMs: z.number().int().positive().optional(),
});

export type MembershipConfig = z.infer<typeof MembershipConfigSchema>;

/** Resolve optional timeouts to concrete values. */
export function resolveConfig(raw: MembershipConfig): Required<MembershipConfig> {
  return {
    heartbeatMs: raw.heartbeatMs,
    suspectTimeoutMs: raw.suspectTimeoutMs,
    stateBroadcastMs: raw.stateBroadcastMs,
    deadTimeoutMs: raw.deadTimeoutMs ?? raw.suspectTimeoutMs * 2,
    gcTimeoutMs: raw.gcTimeoutMs ?? raw.suspectTimeoutMs * 3,
  };
}
