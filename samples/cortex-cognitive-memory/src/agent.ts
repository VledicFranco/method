/**
 * Memory cognitive-module — Cortex tenant app composition root (PRD-068 W1).
 *
 * Persistent pact, storage-backed. Reacts to `memory_query` and `state`
 * events and emits `memory_recalled` + `memory_consolidated`. The pact is
 * `persistent` because Memory is a long-lived service (PRD-068 §5.1) —
 * not a one-shot invocation.
 *
 * Wave 1 scaffold:
 *
 *   - A **bounded in-memory dual store** holds episodic + semantic entries
 *     (`MAX_ENTRIES_PER_KIND` cap per kind, FIFO eviction). This is a
 *     skeleton — it does NOT port `MemoryModuleV3`'s ACT-R activation-based
 *     retrieval (research-gated on PRD-068 §10 D4 / D5).
 *   - On first query for a `(traceId, queryKind)` pair, Memory **lazily
 *     rebuilds its shadow** from `ctx.storage` seed entries (R5 mitigation —
 *     restart semantics for a persistent pact rebuild state on demand,
 *     not at startup).
 *   - `reactToWorkspaceState` is the consolidation trigger: when the root
 *     app emits `workspace.state`, Memory promotes high-activation episodic
 *     entries into semantic entries (v3-style episodic→semantic roll-up)
 *     and emits `memory_consolidated`.
 *   - Periodic heartbeat (30s) + consolidation tick (5min) are scheduled
 *     via `ctx.schedule` when available.
 */

import {
  ScheduledPact,
  assertCtxCompatibility,
  createMethodAgent,
  createWorkspaceEventEmitter,
  withCorticalWorkspaceMembership,
  type AgentEvent,
  type CortexCtx,
  type MethodAgent,
  type CorticalWorkspaceMembershipHandle,
  type WorkspaceEventEmitter,
} from '@method/agent-runtime';

import { memoryPact, type MemoryEntry, type MemoryRecallOutput } from './pact.js';

export const MEMORY_MODULE_VERSION = '0.1.0-wave1-scaffold';
export const MEMORY_PACT_KEY = 'cortex-cognitive-memory';

/** Seed entries loaded from ctx.storage on first query for a traceId. */
const STORAGE_SEED_KEY_PREFIX = 'cortex-cognitive-memory/seed/';
const STORAGE_CONSOLIDATION_SCHEDULE_CRON = '*/5 * * * *'; // every 5 minutes

/** Bounded store cap per kind — keeps the Wave 1 skeleton small. */
const MAX_ENTRIES_PER_KIND = 64;
/**
 * Activation threshold for episodic → semantic promotion. The Wave 1
 * scaffold uses a flat constant; MemoryModuleV3 will drive this via its
 * ACT-R base-level + associative bump terms once wired in (R-26c).
 */
const CONSOLIDATION_ACTIVATION_FLOOR = 0.6;

export interface MemoryTenantHandle {
  readonly agent: MethodAgent<MemoryRecallOutput>;
  readonly membership: CorticalWorkspaceMembershipHandle;
  readonly workspace: WorkspaceEventEmitter;
  /**
   * Serve a memory_query from a peer module. Emits `memory_recalled` on
   * the workspace topic. Returns the retrieved entries for local use.
   */
  handleMemoryQuery(
    traceId: string,
    query: { queryKind: 'episodic' | 'semantic'; key: string; k: number },
  ): Promise<ReadonlyArray<MemoryEntry>>;
  /**
   * React to a `workspace.state` emission. Memory uses the state snapshot
   * as a consolidation trigger — high-activation episodic entries are
   * promoted to semantic. Emits `memory_consolidated` with the written
   * count. Wave 1 scaffold: full v3 consolidation gated on R-26c.
   */
  reactToWorkspaceState(
    traceId: string,
    state: Record<string, unknown>,
  ): Promise<{ writtenCount: number }>;
  /** Run a consolidation pass (episodic → semantic). Emits memory_consolidated. */
  consolidate(traceId: string): Promise<{ writtenCount: number }>;
  /**
   * Seed an episodic entry for a trace. Test-only convenience — in
   * production episodes arrive via event subscriptions from the root app.
   */
  recordEpisodic(entry: MemoryEntry): void;
  /** Snapshot the in-memory store (read-only — returned arrays are copies). */
  snapshot(): {
    episodic: ReadonlyArray<MemoryEntry>;
    semantic: ReadonlyArray<MemoryEntry>;
  };
  dispose(): Promise<void>;
}

export async function composeMemoryTenantApp(
  ctx: CortexCtx,
): Promise<MemoryTenantHandle> {
  assertCtxCompatibility(ctx);

  const agent = createMethodAgent<MemoryRecallOutput>({
    ctx,
    pact: memoryPact,
    onEvent: (event: AgentEvent): void => {
      void event;
    },
  });

  const membership = withCorticalWorkspaceMembership({
    ctx,
    moduleRole: 'memory',
    version: MEMORY_MODULE_VERSION,
    capabilities: [
      'memory/recall',
      'memory/consolidate',
      'memory/episodic',
      'memory/semantic',
    ],
  });
  await membership.join();

  const workspace = createWorkspaceEventEmitter(ctx);

  // Register heartbeat (30s) + consolidation (5min) schedules.
  if (ctx.schedule) {
    try {
      const heartbeatPayload = ScheduledPact.payload(MEMORY_PACT_KEY, {
        initialContext: { kind: 'heartbeat', moduleRole: 'memory' },
        budgetStrategy: 'fresh-per-continuation',
        perTickBudgetUsd: 0.001,
      });
      await ctx.schedule.register('*/30 * * * * *', {
        kind: 'method.pact.continue',
        payload: heartbeatPayload as unknown as Record<string, unknown>,
      });
      const consolidationPayload = ScheduledPact.payload(MEMORY_PACT_KEY, {
        initialContext: { kind: 'consolidate', moduleRole: 'memory' },
        budgetStrategy: 'fresh-per-continuation',
        perTickBudgetUsd: 0.01,
      });
      await ctx.schedule.register(STORAGE_CONSOLIDATION_SCHEDULE_CRON, {
        kind: 'method.pact.continue',
        payload: consolidationPayload as unknown as Record<string, unknown>,
      });
    } catch (err) {
      ctx.log?.warn('cortex-cognitive-memory: schedule registration failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Bounded in-memory dual store (Wave 1 skeleton) ────────────────
  // Episodic + semantic entries are kept in FIFO buffers capped at
  // `MAX_ENTRIES_PER_KIND`. On overflow, the oldest entry is evicted.
  // This is NOT a cognitive memory module — it is a scaffold that lets
  // the test suite exercise the Cortex-hosting wiring (handshake,
  // workspace emits, consolidation trigger) independent of the
  // research-gated MemoryModuleV3 integration.
  const episodicStore: MemoryEntry[] = [];
  const semanticStore: MemoryEntry[] = [];
  /** Traces whose shadow has already been rebuilt lazily from storage. */
  const shadowHydrated = new Set<string>();

  function appendBounded(store: MemoryEntry[], entry: MemoryEntry): void {
    store.push(entry);
    while (store.length > MAX_ENTRIES_PER_KIND) {
      store.shift();
    }
  }

  function recordEpisodic(entry: MemoryEntry): void {
    // Coerce `kind` to episodic — callers passing semantic via this helper
    // is an API misuse, but the safer route is to drop it into the
    // right store rather than reject.
    if (entry.kind === 'semantic') {
      appendBounded(semanticStore, entry);
    } else {
      appendBounded(episodicStore, entry);
    }
  }

  async function hydrateShadowFromStorage(
    traceId: string,
    queryKind: 'episodic' | 'semantic',
  ): Promise<void> {
    const shadowKey = `${queryKind}:${traceId}`;
    if (shadowHydrated.has(shadowKey)) return;
    shadowHydrated.add(shadowKey);
    if (!ctx.storage) return;
    const key = `${STORAGE_SEED_KEY_PREFIX}${queryKind}/${traceId}`;
    const record = (await ctx.storage.get(key)) as
      | { entries?: ReadonlyArray<MemoryEntry> }
      | null
      | undefined;
    const seeded = record?.entries;
    if (!seeded || seeded.length === 0) return;
    const target = queryKind === 'episodic' ? episodicStore : semanticStore;
    for (const e of seeded) {
      appendBounded(target, e);
    }
  }

  async function handleMemoryQuery(
    traceId: string,
    query: { queryKind: 'episodic' | 'semantic'; key: string; k: number },
  ): Promise<ReadonlyArray<MemoryEntry>> {
    await hydrateShadowFromStorage(traceId, query.queryKind);
    const store =
      query.queryKind === 'episodic' ? episodicStore : semanticStore;

    // Match on either key-substring or content-substring. Wave 1 only —
    // real retrieval uses ACT-R activation scoring (R-26c gated).
    const matches = store
      .filter((e) => e.key.includes(query.key) || e.content.includes(query.key))
      .slice(0, query.k);

    const output: MemoryRecallOutput = {
      queryKind: query.queryKind,
      entries: matches,
    };

    await workspace.emit('method.cortex.workspace.memory_recalled', traceId, {
      queryKind: output.queryKind,
      entries: output.entries,
      citationRefs: [],
    });

    return output.entries;
  }

  /**
   * Promote high-activation episodic entries to the semantic store. Wave 1
   * scaffold — the full ACT-R base-level + associative bump path is
   * research-gated on R-26c (PRD-068 §10 D4/D5). Here we use a flat
   * activation floor.
   */
  function runConsolidationPass(): number {
    const toPromote = episodicStore.filter(
      (e) => e.activation >= CONSOLIDATION_ACTIVATION_FLOOR,
    );
    for (const e of toPromote) {
      // De-duplicate on key — if a semantic entry already exists, skip.
      if (semanticStore.some((s) => s.key === e.key)) continue;
      appendBounded(semanticStore, { ...e, kind: 'semantic' });
    }
    return toPromote.length;
  }

  async function reactToWorkspaceState(
    traceId: string,
    state: Record<string, unknown>,
  ): Promise<{ writtenCount: number }> {
    // Consolidation trigger — the root app emits `workspace.state` after
    // meaningful state transitions. We treat that as a cue to promote
    // high-activation episodic entries to semantic.
    void state; // Wave 1: state is not inspected — runs a flat pass.
    const writtenCount = runConsolidationPass();

    await workspace.emit(
      'method.cortex.workspace.memory_consolidated',
      traceId,
      {
        consolidationKind: 'episodic-to-semantic',
        writtenCount,
      },
    );

    return { writtenCount };
  }

  async function consolidate(
    traceId: string,
  ): Promise<{ writtenCount: number }> {
    const writtenCount = runConsolidationPass();

    await workspace.emit(
      'method.cortex.workspace.memory_consolidated',
      traceId,
      {
        consolidationKind: 'episodic-to-semantic',
        writtenCount,
      },
    );

    return { writtenCount };
  }

  function snapshot(): {
    episodic: ReadonlyArray<MemoryEntry>;
    semantic: ReadonlyArray<MemoryEntry>;
  } {
    return {
      episodic: episodicStore.slice(),
      semantic: semanticStore.slice(),
    };
  }

  async function dispose(): Promise<void> {
    await membership.leave('graceful');
    await agent.dispose();
  }

  return {
    agent,
    membership,
    workspace,
    handleMemoryQuery,
    reactToWorkspaceState,
    consolidate,
    recordEpisodic,
    snapshot,
    dispose,
  };
}
