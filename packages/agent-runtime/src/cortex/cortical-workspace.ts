// SPDX-License-Identifier: Apache-2.0
/**
 * Cortical Workspace — PRD-068 §5 (S10 topic spec + S11 handshake protocol).
 *
 * This module scaffolds the shared coordination substrate for cognitive
 * tenant apps (Monitor, Planner, Memory, ...). It is *not* a new runtime
 * port — the substrate IS the set of `method.cortex.workspace.*` topics
 * already in METHOD_TOPIC_REGISTRY (S6). This module provides:
 *
 *   1. `ModuleRole` — typed role identifiers for the three Wave 1 modules
 *      plus forward-declared roles reserved for later waves.
 *   2. `CORTICAL_WORKSPACE_TOPICS` + role emit/subscribe tables (§5.2.2).
 *   3. `generateCortexCognitiveEmitSection(roles)` — manifest helper that
 *      produces the `requires.events.{emit,on}` YAML/JSON for one or more
 *      cognitive roles in a tenant app manifest (PRD-068 §5.2.3).
 *   4. `withCorticalWorkspaceMembership()` — helper that performs the
 *      JOIN / HEARTBEAT / LEAVE handshake on behalf of a module agent.
 *      Handshake is flat (no leader election); heartbeat cadence is
 *      30s via `ScheduledPact` (S5), implicit LEAVE after 90s without
 *      re-emitting `module_online`.
 *
 * Wave-1 scope: the helpers compile + emit correctly against a `CortexCtx`
 * bearing `events`, `audit`, and optionally `schedule`. The full cognitive
 * integration (actually running MonitorV2 / Planner / Memory v3 against
 * workspace events) is tenant-app territory — the per-module pact in each
 * `samples/cortex-cognitive-*` app wires its own reasoning loop.
 *
 * Research gate: cognitive *behavior* validation (Monitor+Planner+Memory
 * beating a flat agent) is pending the R-26c rerun in
 * `experiments/exp-cognitive-baseline/` per PRD-068 §10 D4. The scaffolds
 * here are correct-by-construction for Cortex hosting, independent of
 * that research outcome.
 */

import type { MethodTopicDescriptor } from './ctx-types.js';
import type { CortexCtx } from './ctx-types.js';
import { getLogger } from './ctx-types.js';
import {
  METHOD_TOPIC_REGISTRY,
  RUNTIME_EVENT_TYPE_TO_TOPIC,
} from './event-topic-registry.js';
import {
  generateManifestEmitSection,
  type ManifestEmitEntry,
  type ManifestEmitOptions,
} from './manifest-emit-section.js';

// ── ModuleRole ────────────────────────────────────────────────────

/**
 * Cognitive module role identifiers. Wave 1 ships the first three; the
 * remainder are declared here so manifest helpers and observers have a
 * stable set, even though the tenant apps do not yet exist.
 */
export type ModuleRole =
  | 'monitor'
  | 'planner'
  | 'memory'
  | 'reflector' // Wave 2
  | 'critic' // Wave 3+
  | 'observer' // Wave 3+
  | 'reasoner' // Wave 3+
  | 'actor' // Wave 3+
  | 'evaluator'; // Wave 3+

/** Wave 1 subset — the three roles with shipped sample apps in this PRD. */
export const WAVE_1_MODULE_ROLES: ReadonlyArray<ModuleRole> = [
  'monitor',
  'planner',
  'memory',
] as const;

// ── Topic family selection ───────────────────────────────────────

/** All workspace topics in one readonly array for filtering. */
export const CORTICAL_WORKSPACE_TOPICS: ReadonlyArray<MethodTopicDescriptor> =
  METHOD_TOPIC_REGISTRY.filter((d) =>
    d.topic.startsWith('method.cortex.workspace.'),
  );

/**
 * Which topics does each role EMIT? (PRD-068 §5.2.2 table.)
 *
 * `module_online`, `module_offline`, and `degraded` are emitted by any
 * role (handshake / fault signal). `session_opened` / `session_closed`
 * are emitted by the ROOT tenant app — not by cognitive modules. That
 * role is named `root` internally but never carries module-role
 * semantics; it is NOT a `ModuleRole` to prevent accidental deployment
 * of a "root module" cognitive app.
 */
const ROLE_EMITS: Readonly<Record<ModuleRole, ReadonlySet<string>>> = {
  monitor: new Set([
    'method.cortex.workspace.anomaly',
    'method.cortex.workspace.confidence',
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
    'method.cortex.workspace.degraded',
  ]),
  planner: new Set([
    'method.cortex.workspace.plan_updated',
    'method.cortex.workspace.goal',
    'method.cortex.workspace.memory_query',
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
    'method.cortex.workspace.degraded',
  ]),
  memory: new Set([
    'method.cortex.workspace.memory_recalled',
    'method.cortex.workspace.memory_consolidated',
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
    'method.cortex.workspace.degraded',
  ]),
  // Forward-declared roles — shipped for manifest tooling only.
  reflector: new Set([
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
    'method.cortex.workspace.degraded',
  ]),
  critic: new Set([
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
    'method.cortex.workspace.degraded',
  ]),
  observer: new Set([
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
  ]),
  reasoner: new Set([
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
    'method.cortex.workspace.degraded',
  ]),
  actor: new Set([
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
    'method.cortex.workspace.degraded',
  ]),
  evaluator: new Set([
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
    'method.cortex.workspace.degraded',
  ]),
};

/** Which topics does each role SUBSCRIBE to? (PRD-068 §5.2.2.) */
const ROLE_ON: Readonly<Record<ModuleRole, ReadonlySet<string>>> = {
  monitor: new Set([
    'method.cortex.workspace.session_opened',
    'method.cortex.workspace.session_closed',
    'method.cortex.workspace.state',
    'method.cortex.workspace.plan_updated',
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
  ]),
  planner: new Set([
    'method.cortex.workspace.session_opened',
    'method.cortex.workspace.session_closed',
    'method.cortex.workspace.state',
    'method.cortex.workspace.anomaly',
    'method.cortex.workspace.confidence',
    'method.cortex.workspace.memory_recalled',
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
  ]),
  memory: new Set([
    'method.cortex.workspace.session_opened',
    'method.cortex.workspace.session_closed',
    'method.cortex.workspace.state',
    'method.cortex.workspace.memory_query',
    'method.cortex.workspace.plan_updated',
    'method.cortex.workspace.module_online',
    'method.cortex.workspace.module_offline',
  ]),
  reflector: new Set([
    'method.cortex.workspace.session_opened',
    'method.cortex.workspace.session_closed',
    'method.cortex.workspace.state',
    'method.cortex.workspace.anomaly',
    'method.cortex.workspace.plan_updated',
  ]),
  critic: new Set([
    'method.cortex.workspace.session_opened',
    'method.cortex.workspace.plan_updated',
  ]),
  observer: new Set(
    CORTICAL_WORKSPACE_TOPICS.map((d) => d.topic), // observer reads everything
  ),
  reasoner: new Set([
    'method.cortex.workspace.session_opened',
    'method.cortex.workspace.state',
  ]),
  actor: new Set([
    'method.cortex.workspace.session_opened',
    'method.cortex.workspace.plan_updated',
  ]),
  evaluator: new Set([
    'method.cortex.workspace.session_opened',
    'method.cortex.workspace.session_closed',
    'method.cortex.workspace.plan_updated',
  ]),
};

// ── Manifest generation helper ───────────────────────────────────

/**
 * Return the union of topics the given roles EMIT.
 *
 * `observer` role omitted intentionally if the caller mixes it with other
 * roles — observer is read-only. We return the raw union (observer
 * contributes only `module_online`/`offline` which it DOES emit for
 * presence) so the caller gets consistent behavior.
 */
export function cognitiveEmitTopics(
  roles: ReadonlyArray<ModuleRole>,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const role of roles) {
    for (const t of ROLE_EMITS[role]) out.add(t);
  }
  return out;
}

/**
 * Return the union of topics the given roles SUBSCRIBE to.
 */
export function cognitiveSubscribeTopics(
  roles: ReadonlyArray<ModuleRole>,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const role of roles) {
    for (const t of ROLE_ON[role]) out.add(t);
  }
  return out;
}

/**
 * Entry shape for the `requires.events.on[]` section of a tenant manifest.
 * Mirrors `ManifestEmitEntry` but trimmed — `on` entries do not carry
 * schemaVersion/classifications (they subscribe, not emit).
 */
export interface ManifestOnEntry {
  readonly type: string;
  readonly description?: string;
}

/**
 * PRD-068 §5.2.3 — manifest-generation helper for the cognitive cohort.
 *
 * Produces the two halves of `requires.events` for a tenant app manifest
 * that plays one or more cognitive roles. Wave 1 sample apps call this
 * with a single-element role array. Future multi-role apps (e.g. a
 * "planner+critic" tenant) simply pass multiple roles — the helper unions
 * the emit + on sets.
 *
 * Behavior:
 *   - `emit` entries flow through `generateManifestEmitSection()` so the
 *     same classification + schema-ref conventions apply (no drift).
 *   - `on` entries carry only `{ type, description }` — Cortex does not
 *     require schemas on the consumer side (schema matching happens at
 *     emit time per S6 §3.4).
 *   - Duplicate entries across multi-role invocations are de-duplicated.
 */
export function generateCortexCognitiveEmitSection(
  roles: ReadonlyArray<ModuleRole>,
  options: ManifestEmitOptions = {},
): {
  readonly emit: ReadonlyArray<ManifestEmitEntry>;
  readonly on: ReadonlyArray<ManifestOnEntry>;
} {
  if (roles.length === 0) {
    return { emit: [], on: [] };
  }

  const emitTopicSet = cognitiveEmitTopics(roles);
  const onTopicSet = cognitiveSubscribeTopics(roles);

  const emit = generateManifestEmitSection(METHOD_TOPIC_REGISTRY, {
    ...options,
    topics: emitTopicSet,
  });

  const onEntries: ManifestOnEntry[] = [];
  const seen = new Set<string>();
  for (const d of CORTICAL_WORKSPACE_TOPICS) {
    if (!onTopicSet.has(d.topic)) continue;
    if (seen.has(d.topic)) continue;
    seen.add(d.topic);
    onEntries.push({ type: d.topic, description: d.description });
  }

  return { emit, on: onEntries };
}

// ── Handshake protocol (S11) ─────────────────────────────────────

/**
 * Heartbeat cadence constant — PRD-068 §5.3.
 * Peers infer implicit LEAVE after 3x this interval (90s).
 */
export const CORTICAL_WORKSPACE_HEARTBEAT_INTERVAL_MS = 30_000;
export const CORTICAL_WORKSPACE_HEARTBEAT_CRON = '*/30 * * * * *'; // every 30s
export const CORTICAL_WORKSPACE_IMPLICIT_OFFLINE_MS = 90_000;

/** Payload of a `module_online` (JOIN / HEARTBEAT) emission. */
export interface ModuleOnlinePayload {
  readonly moduleRole: ModuleRole;
  readonly appId: string;
  readonly version: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly at: number;
}

/** Payload of a `module_offline` (LEAVE) emission. */
export interface ModuleOfflinePayload {
  readonly moduleRole: ModuleRole;
  readonly appId: string;
  readonly reason: 'graceful' | 'crashed' | 'role_duplicate';
  readonly at: number;
}

/**
 * Options for {@link withCorticalWorkspaceMembership}.
 */
export interface CorticalWorkspaceMembershipOptions {
  readonly ctx: CortexCtx;
  readonly moduleRole: ModuleRole;
  readonly version: string;
  readonly capabilities?: ReadonlyArray<string>;
  /** Clock override for tests. */
  readonly now?: () => number;
}

/**
 * Handle returned by {@link withCorticalWorkspaceMembership}. The tenant
 * app keeps this for its lifetime and invokes `leave()` on dispose.
 * `tickHeartbeat()` is the handler that a `ScheduledPact` tick (S5)
 * invokes every 30s to re-emit `module_online`.
 */
export interface CorticalWorkspaceMembershipHandle {
  /** Emit an initial `module_online` (JOIN). Idempotent. */
  join(): Promise<void>;
  /** Re-emit `module_online` (HEARTBEAT). Designed to be called by a 30s scheduled tick. */
  tickHeartbeat(): Promise<void>;
  /** Emit `module_offline` with `reason='graceful'` (LEAVE). Idempotent. */
  leave(reason?: ModuleOfflinePayload['reason']): Promise<void>;
  /** True once `leave()` has been invoked successfully. */
  readonly isLeft: boolean;
}

/**
 * Compose a cortical-workspace membership helper for a cognitive module's
 * tenant app. Wires handshake emissions through `ctx.events.publish`
 * (bypassing the CortexEventConnector projection path — handshake events
 * are first-class, not projected from RuntimeEvents).
 *
 * Caller contract:
 *   1. Call `handle.join()` at composition time (right after
 *      `createMethodAgent`).
 *   2. Register a Cortex schedule that invokes `handle.tickHeartbeat()`
 *      every 30s — use `ScheduledPact` (S5) with
 *      `CORTICAL_WORKSPACE_HEARTBEAT_CRON`.
 *   3. Call `handle.leave()` on `agent.dispose()`.
 *
 * No leader election. If two modules advertise the same role on different
 * AppIds, peers MAY flag `degraded { reason: 'role_duplicate' }` but
 * neither side is forced offline — operator intervention required.
 */
export function withCorticalWorkspaceMembership(
  options: CorticalWorkspaceMembershipOptions,
): CorticalWorkspaceMembershipHandle {
  const { ctx, moduleRole, version } = options;
  const capabilities = options.capabilities ?? [];
  const now = options.now ?? Date.now;
  const logger = getLogger(ctx);

  let joined = false;
  let left = false;

  async function publish(
    topic: string,
    payload: ModuleOnlinePayload | ModuleOfflinePayload,
  ): Promise<void> {
    if (!ctx.events) {
      logger.warn('cortical-workspace: ctx.events unavailable; handshake skipped', {
        topic,
        moduleRole,
      });
      return;
    }
    try {
      await ctx.events.publish(topic, payload as unknown as Record<string, unknown>);
    } catch (err) {
      // Handshake is best-effort. Per PRD-068 §6.2 ctx.events 429, handshake
      // loss is tolerated — the 30s heartbeat gives us a second chance.
      logger.warn('cortical-workspace: handshake publish failed', {
        topic,
        moduleRole,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const buildOnlinePayload = (): ModuleOnlinePayload => ({
    moduleRole,
    appId: ctx.app.id,
    version,
    capabilities,
    at: now(),
  });

  return {
    get isLeft(): boolean {
      return left;
    },
    async join(): Promise<void> {
      if (joined || left) return;
      joined = true;
      await publish('method.cortex.workspace.module_online', buildOnlinePayload());
    },
    async tickHeartbeat(): Promise<void> {
      if (left) return;
      await publish('method.cortex.workspace.module_online', buildOnlinePayload());
    },
    async leave(reason: ModuleOfflinePayload['reason'] = 'graceful'): Promise<void> {
      if (left) return;
      left = true;
      const payload: ModuleOfflinePayload = {
        moduleRole,
        appId: ctx.app.id,
        reason,
        at: now(),
      };
      await publish('method.cortex.workspace.module_offline', payload);
    },
  };
}

// ── Session-scoped workspace event helper ────────────────────────

/**
 * Lightweight typed emitter for workspace events keyed on `traceId` — the
 * S5 ContinuationEnvelope.traceId is the coordination key (PRD-068 §5.2.1).
 * Every workspace payload MUST carry the traceId so peers can filter by
 * reasoning episode.
 */
export interface WorkspaceEventEmitter {
  emit(
    topic: string,
    traceId: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
}

/**
 * Build a trace-scoped emitter over a `CortexCtx`. The emitter prepends
 * `traceId` to every payload. Topic names are validated against the
 * `method.cortex.workspace.*` family at emit time (defensive — tenant
 * apps passing arbitrary topics would bypass classification).
 */
export function createWorkspaceEventEmitter(
  ctx: CortexCtx,
): WorkspaceEventEmitter {
  const logger = getLogger(ctx);
  return {
    async emit(
      topic: string,
      traceId: string,
      payload: Record<string, unknown>,
    ): Promise<void> {
      if (!topic.startsWith('method.cortex.workspace.')) {
        throw new Error(
          `createWorkspaceEventEmitter: refusing to publish non-workspace topic '${topic}'`,
        );
      }
      if (!ctx.events) {
        logger.warn('cortical-workspace: ctx.events unavailable; emit dropped', {
          topic,
          traceId,
        });
        return;
      }
      const full = { ...payload, traceId };
      await ctx.events.publish(topic, full);
    },
  };
}

/**
 * Internal guard — ensure the registry carries every topic the spec
 * tables reference. If `ROLE_EMITS`/`ROLE_ON` drift from the registry,
 * this throws at module load (same pattern as the audit-superset guard
 * in `event-topic-registry.ts`).
 */
(() => {
  const registrySet = new Set(
    METHOD_TOPIC_REGISTRY.map((d) => d.topic).filter((t) =>
      t.startsWith('method.cortex.workspace.'),
    ),
  );
  const missing: string[] = [];
  for (const role of Object.keys(ROLE_EMITS) as ModuleRole[]) {
    for (const topic of ROLE_EMITS[role]) {
      if (!registrySet.has(topic)) missing.push(`emit:${role}:${topic}`);
    }
    for (const topic of ROLE_ON[role]) {
      if (!registrySet.has(topic)) missing.push(`on:${role}:${topic}`);
    }
  }
  // Defensive sanity — RUNTIME_EVENT_TYPE_TO_TOPIC should have entries for
  // every workspace topic's sourceEventType. Reference to keep the map
  // imported and detect accidental culling.
  for (const d of METHOD_TOPIC_REGISTRY) {
    if (!d.topic.startsWith('method.cortex.workspace.')) continue;
    for (const src of d.sourceEventTypes) {
      if (!RUNTIME_EVENT_TYPE_TO_TOPIC.has(src)) {
        missing.push(`map:${d.topic}:${src}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `cortical-workspace: role/registry drift at module load: [${missing.join(', ')}]`,
    );
  }
})();
