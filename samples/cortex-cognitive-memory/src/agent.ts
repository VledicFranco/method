/**
 * Memory cognitive-module — Cortex tenant app composition root (PRD-068 W1).
 *
 * Persistent pact, storage-backed. Reacts to `memory_query` events and
 * emits `memory_recalled`. Consolidation runs periodically (scheduled)
 * and emits `memory_consolidated` when it completes a pass.
 *
 * Wave 1 scaffold: the ctx.storage-backed dual store is represented by a
 * simple per-app key-value seed loaded from storage. Full
 * `MemoryModuleV3` ACT-R activation-based retrieval is NOT wired — it is
 * the research-gated integration point (PRD-068 §10 D4 / D5).
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
  /** Run a consolidation pass (episodic → semantic). Emits memory_consolidated. */
  consolidate(traceId: string): Promise<{ writtenCount: number }>;
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

  async function loadSeedEntries(
    traceId: string,
    queryKind: 'episodic' | 'semantic',
  ): Promise<ReadonlyArray<MemoryEntry>> {
    // Lazy shadow rebuild per R5: read from ctx.storage on first query.
    if (!ctx.storage) return [];
    const key = `${STORAGE_SEED_KEY_PREFIX}${queryKind}/${traceId}`;
    const record = await ctx.storage.get(key);
    if (!record) return [];
    const entries = (record as { entries?: ReadonlyArray<MemoryEntry> }).entries;
    return entries ?? [];
  }

  async function handleMemoryQuery(
    traceId: string,
    query: { queryKind: 'episodic' | 'semantic'; key: string; k: number },
  ): Promise<ReadonlyArray<MemoryEntry>> {
    const seedEntries = await loadSeedEntries(traceId, query.queryKind);
    const matches = seedEntries
      .filter((e) => e.key.includes(query.key) || e.content.includes(query.key))
      .slice(0, query.k);

    // In the full integration, we'd invoke `agent` to rank entries via
    // ACT-R activation. For Wave 1 we emit the raw matches.
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

  async function consolidate(
    traceId: string,
  ): Promise<{ writtenCount: number }> {
    // Wave 1 scaffold: pretend to consolidate by invoking the persistent
    // agent once; report a zero-written count unless storage is present.
    let writtenCount = 0;
    if (ctx.storage) {
      const key = `${STORAGE_SEED_KEY_PREFIX}semantic/${traceId}`;
      const existing = (await ctx.storage.get(key)) as
        | { entries?: MemoryEntry[] }
        | null
        | undefined;
      const entries = existing?.entries ?? [];
      writtenCount = entries.length;
    }

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

  async function dispose(): Promise<void> {
    await membership.leave('graceful');
    await agent.dispose();
  }

  return {
    agent,
    membership,
    workspace,
    handleMemoryQuery,
    consolidate,
    dispose,
  };
}
