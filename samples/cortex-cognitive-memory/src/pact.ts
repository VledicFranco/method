/**
 * Memory cognitive-module pact — PRD-068 Wave 1.
 *
 * Wraps pacta's `MemoryModuleV3` + `in-memory-dual-store` (CLS-grounded
 * episodic + semantic stores). Uses PERSISTENT mode because Memory is a
 * long-lived service (PRD-068 §5.1) — it reacts to workspace memory_query
 * events and periodic consolidation triggers, not one-shot invocations.
 *
 * Storage is `ctx.storage`-backed. Episodic entries keyed per-app with
 * `traceId` prefix so Memory's shadow rebuilds lazily on the first query
 * event for a given trace (§PRD-068 R5 mitigation).
 */

import type { Pact } from '@method/agent-runtime';

export interface MemoryEntry {
  readonly key: string;
  readonly kind: 'episodic' | 'semantic';
  readonly content: string;
  readonly activation: number;
}

export interface MemoryRecallOutput {
  readonly queryKind: 'episodic' | 'semantic';
  readonly entries: ReadonlyArray<MemoryEntry>;
}

export const memoryPact: Pact<MemoryRecallOutput> = {
  mode: {
    type: 'persistent',
    keepAlive: true,
    idleTimeoutMs: 600_000, // 10 min idle — long enough for multiple trace sessions
  },
  budget: {
    maxTurns: 40,
    maxCostUsd: 0.25, // medium — consolidation uses LLM; retrieval uses scoring
    onExhaustion: 'stop',
  },
  output: {
    schema: {
      type: 'object',
      required: ['queryKind', 'entries'],
      properties: {
        queryKind: { enum: ['episodic', 'semantic'] },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key', 'kind', 'content', 'activation'],
            properties: {
              key: { type: 'string' },
              kind: { enum: ['episodic', 'semantic'] },
              content: { type: 'string' },
              activation: { type: 'number' },
            },
          },
        },
      },
    },
    retryOnValidationFailure: true,
    maxRetries: 2,
  },
  reasoning: { effort: 'low' },
  scope: {
    allowedTools: ['read-only/*'],
    deniedTools: ['fs/Write', 'shell/Bash'],
    permissionMode: 'deny',
  },
};
