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

import type { Pact, SchemaDefinition, SchemaResult } from '@method/agent-runtime';

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

/**
 * Hand-written SchemaDefinition for MemoryRecallOutput.
 *
 * Validates:
 *   - queryKind ∈ {'episodic', 'semantic'}
 *   - entries is an array of MemoryEntry { key, kind, content, activation }
 */
const memoryRecallOutputSchema: SchemaDefinition<MemoryRecallOutput> = {
  description: 'MemoryRecallOutput { queryKind, entries[] }',
  parse(raw: unknown): SchemaResult<MemoryRecallOutput> {
    const value = typeof raw === 'string' ? tryJsonParse(raw) : raw;
    if (value === undefined) {
      return { success: false, errors: ['output is not a valid JSON object'] };
    }
    if (value === null || typeof value !== 'object') {
      return {
        success: false,
        errors: [`expected object, got ${value === null ? 'null' : typeof value}`],
      };
    }
    const obj = value as Record<string, unknown>;
    const errors: string[] = [];

    const queryKind = obj.queryKind;
    if (queryKind !== 'episodic' && queryKind !== 'semantic') {
      errors.push(
        `queryKind must be 'episodic' | 'semantic', got ${JSON.stringify(queryKind)}`,
      );
    }

    const entriesRaw = obj.entries;
    const entries: MemoryEntry[] = [];
    if (!Array.isArray(entriesRaw)) {
      errors.push(`entries must be an array, got ${typeof entriesRaw}`);
    } else {
      entriesRaw.forEach((item, i) => {
        if (item === null || typeof item !== 'object') {
          errors.push(`entries[${i}] must be an object`);
          return;
        }
        const e = item as Record<string, unknown>;
        if (typeof e.key !== 'string') {
          errors.push(`entries[${i}].key must be a string`);
        }
        if (e.kind !== 'episodic' && e.kind !== 'semantic') {
          errors.push(`entries[${i}].kind must be 'episodic' | 'semantic'`);
        }
        if (typeof e.content !== 'string') {
          errors.push(`entries[${i}].content must be a string`);
        }
        if (typeof e.activation !== 'number' || !Number.isFinite(e.activation)) {
          errors.push(`entries[${i}].activation must be a finite number`);
        }
        if (
          typeof e.key === 'string' &&
          (e.kind === 'episodic' || e.kind === 'semantic') &&
          typeof e.content === 'string' &&
          typeof e.activation === 'number'
        ) {
          entries.push({
            key: e.key,
            kind: e.kind,
            content: e.content,
            activation: e.activation,
          });
        }
      });
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }
    return {
      success: true,
      data: {
        queryKind: queryKind as 'episodic' | 'semantic',
        entries,
      },
    };
  },
};

function tryJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
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
    schema: memoryRecallOutputSchema,
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
