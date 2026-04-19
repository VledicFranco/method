// SPDX-License-Identifier: Apache-2.0
/**
 * enrichedPreset — v2 cognitive agent composition preset.
 *
 * Composes all PRD 035 v2 modules into a ready-to-use CreateCognitiveAgentOptions
 * configuration. Replaces v1 defaults with:
 *
 * - MonitorV2 (prediction-error tracking, precision weighting, adaptive thresholds)
 * - PriorityAttend (three-factor biased competition salience)
 * - ReasonerActorV2 (SOAR impasse detection, auto-subgoaling)
 * - PrecisionAdapter (continuous effort allocation wrapping the ProviderAdapter)
 * - EVC threshold policy (cost-benefit intervention gating)
 *
 * The preset is a factory function: provide a ProviderAdapter and ToolProvider,
 * get back a CreateCognitiveAgentOptions-compatible configuration that works
 * out-of-the-box with sensible defaults.
 *
 * Grounded in: PRD 035 — Cognitive Monitoring & Control v2.
 */

import type { ProviderAdapter, WorkspaceWritePort, ControlPolicy, WorkspaceConfig } from '../algebra/index.js';
import type { MonitorV2Config, ReasonerActorV2Config, PriorityAttendConfig, EVCConfig, PrecisionAdapterConfig } from '../algebra/index.js';
import { createPrecisionAdapter } from '../algebra/index.js';
import type { ToolProvider } from '../../ports/tool-provider.js';
import type { MemoryPort } from '../../ports/memory-port.js';
import type { CreateCognitiveAgentOptions } from '../engine/create-cognitive-agent.js';
import type { CycleModules, CycleConfig } from '../engine/cycle.js';

// Module factories
import { createMonitorV2 } from '../modules/monitor-v2.js';
import { createPrioritySalienceFunction } from '../modules/priority-attend.js';
import { createReasonerActorV2 } from '../modules/reasoner-actor-v2.js';
import { evcThresholdPolicy } from '../engine/evc-policy.js';

// ── Config Overrides ────────────────────────────────────────────

/**
 * Per-module configuration overrides for the enriched preset.
 * All fields are optional — omitted fields use sensible defaults.
 */
export interface EnrichedPresetOverrides {
  /** MonitorV2 configuration overrides. */
  monitor?: MonitorV2Config;
  /** ReasonerActorV2 configuration overrides. */
  reasonerActor?: ReasonerActorV2Config;
  /** PriorityAttend configuration overrides (used for workspace salience). */
  priorityAttend?: PriorityAttendConfig;
  /** EVC threshold policy overrides. */
  evc?: EVCConfig;
  /** PrecisionAdapter configuration overrides. */
  precision?: PrecisionAdapterConfig;
  /** Workspace configuration overrides. */
  workspace?: Partial<WorkspaceConfig>;
  /** Cycle configuration overrides (errorPolicy, cycleBudget, etc.). */
  cycle?: Partial<Omit<CycleConfig, 'thresholds' | 'controlPolicy'>>;
  /** Control policy override. Defaults to a permissive policy. */
  controlPolicy?: ControlPolicy;
}

// ── Module Slot Overrides ───────────────────────────────────────

/**
 * Override individual module slots in the CycleModules.
 * Use this to mix v1 and v2 modules (e.g., v1 monitor with v2 reasoner-actor).
 */
export interface ModuleSlotOverrides {
  /** Replace the observer module. */
  observer?: CycleModules['observer'];
  /** Replace the memory module. */
  memory?: CycleModules['memory'];
  /** Replace the reasoner module (occupies the 'reasoner' slot). */
  reasoner?: CycleModules['reasoner'];
  /** Replace the actor module (occupies the 'actor' slot). */
  actor?: CycleModules['actor'];
  /** Replace the monitor module. */
  monitor?: CycleModules['monitor'];
  /** Replace the evaluator module. */
  evaluator?: CycleModules['evaluator'];
  /** Replace the planner module. */
  planner?: CycleModules['planner'];
  /** Replace the reflector module. */
  reflector?: CycleModules['reflector'];
}

// ── Required Ports ──────────────────────────────────────────────

/**
 * External ports required by the enriched preset.
 *
 * The ProviderAdapter and ToolProvider are required for the ReasonerActorV2.
 * The WorkspaceWritePort is required for modules that write to the workspace.
 * Optional ports (MemoryPort) enable additional modules when provided.
 */
export interface EnrichedPresetPorts {
  /** The LLM provider adapter (required). */
  adapter: ProviderAdapter;
  /** The tool provider for available tools (required). */
  tools: ToolProvider;
  /** Workspace write port for the reasoner-actor (required). */
  writePort: WorkspaceWritePort;
  /** Memory port for memory and reflector modules (optional). */
  memoryPort?: MemoryPort;
}

// ── Default Control Policy ──────────────────────────────────────

/** Permissive control policy — allows all directives. Suitable for testing. */
function permissiveControlPolicy(): ControlPolicy {
  return {
    allowedDirectiveTypes: ['*'],
    validate: () => true,
  };
}

// ── Factory ─────────────────────────────────────────────────────

/**
 * Create a CreateCognitiveAgentOptions configuration using all v2 modules.
 *
 * This is the primary entry point for composing a v2 cognitive agent. It:
 * 1. Wraps the provided adapter with PrecisionAdapter
 * 2. Creates MonitorV2 with prediction-error tracking
 * 3. Creates ReasonerActorV2 with impasse detection (occupies both reasoner + actor slots)
 * 4. Configures workspace with PriorityAttend salience function
 * 5. Uses EVC threshold policy for intervention gating
 *
 * Modules that don't have v2 variants (observer, memory, evaluator, planner, reflector)
 * must be provided via moduleOverrides or will use minimal pass-through stubs.
 *
 * @param ports - Required external ports (adapter, tools, writePort).
 * @param overrides - Optional per-module configuration overrides.
 * @param moduleOverrides - Optional per-slot module replacements.
 * @returns A CreateCognitiveAgentOptions ready for createCognitiveAgent().
 */
export function enrichedPreset(
  ports: EnrichedPresetPorts,
  overrides?: EnrichedPresetOverrides,
  moduleOverrides?: ModuleSlotOverrides,
): CreateCognitiveAgentOptions {
  // 1. Wrap adapter with PrecisionAdapter
  const precisionAdapter = createPrecisionAdapter(ports.adapter, overrides?.precision);

  // 2. Create v2 modules
  const monitorV2 = createMonitorV2(overrides?.monitor);
  const reasonerActorV2 = createReasonerActorV2(
    precisionAdapter,
    ports.tools,
    ports.writePort,
    overrides?.reasonerActor,
  );

  // 3. Build the salience function using PriorityAttend
  const salienceFunction = createPrioritySalienceFunction(
    overrides?.priorityAttend ?? {},
  );

  // 4. Build EVC threshold policy
  const thresholds = evcThresholdPolicy(overrides?.evc);

  // 5. Assemble stub modules for slots without v2 variants
  // These are minimal pass-through modules that satisfy the CycleModules contract.
  // Real deployments should provide real implementations via moduleOverrides.
  const stubModules = createStubModules();

  // 6. Compose CycleModules — v2 modules take precedence, then overrides, then stubs
  const modules: CycleModules = {
    observer: moduleOverrides?.observer ?? stubModules.observer,
    memory: moduleOverrides?.memory ?? stubModules.memory,
    reasoner: moduleOverrides?.reasoner ?? reasonerActorV2, // v2 reasoner-actor fills reasoner slot
    actor: moduleOverrides?.actor ?? reasonerActorV2,       // v2 reasoner-actor fills actor slot
    monitor: moduleOverrides?.monitor ?? monitorV2,
    evaluator: moduleOverrides?.evaluator ?? stubModules.evaluator,
    planner: moduleOverrides?.planner ?? stubModules.planner,
    reflector: moduleOverrides?.reflector ?? stubModules.reflector,
  };

  // 7. Build workspace config with PriorityAttend salience
  const workspaceConfig: WorkspaceConfig = {
    capacity: overrides?.workspace?.capacity ?? 50,
    salience: salienceFunction,
    writeQuotaPerModule: overrides?.workspace?.writeQuotaPerModule,
    defaultTtl: overrides?.workspace?.defaultTtl,
  };

  // 8. Build cycle config with EVC thresholds
  const cycleConfig: CycleConfig = {
    thresholds,
    errorPolicy: overrides?.cycle?.errorPolicy ?? { default: 'skip' },
    controlPolicy: overrides?.controlPolicy ?? permissiveControlPolicy(),
    cycleBudget: overrides?.cycle?.cycleBudget,
    maxConsecutiveInterventions: overrides?.cycle?.maxConsecutiveInterventions ?? 3,
  };

  return {
    modules,
    workspace: workspaceConfig,
    cycle: cycleConfig,
  };
}

// ── Stub Modules ────────────────────────────────────────────────

import { moduleId } from '../algebra/index.js';
import type { CognitiveModule, StepResult, MonitoringSignal, ControlDirective } from '../algebra/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = CognitiveModule<any, any, any, any, any>;

/**
 * Create minimal pass-through stub modules for slots that lack v2 variants.
 *
 * These stubs satisfy the CognitiveModule interface contract — they have
 * valid step() and initialState() functions — but do minimal work.
 * Real deployments should replace them via moduleOverrides.
 */
function createStubModules(): Record<string, AnyModule> {
  function stub(id: string, output?: unknown, monitoring?: Record<string, unknown>): AnyModule {
    const mid = moduleId(id);
    return {
      id: mid,
      initialState() { return { callCount: 0 }; },
      async step(input: unknown, state: { callCount: number }, _control: ControlDirective): Promise<StepResult<unknown, unknown, MonitoringSignal>> {
        return {
          output: output ?? { result: `${id}-output` },
          state: { callCount: state.callCount + 1 },
          monitoring: {
            source: mid,
            timestamp: Date.now(),
            ...(monitoring ?? {}),
          },
        };
      },
    };
  }

  return {
    observer: stub('observer', { observation: 'pass-through', noveltyScore: 0.5, filtered: false }),
    memory: stub('memory', { entries: [], count: 0 }, { type: 'memory' }),
    evaluator: stub('evaluator', { estimatedProgress: 0.5, diminishingReturns: false }, { type: 'evaluator', estimatedProgress: 0.5, diminishingReturns: false }),
    planner: stub('planner', { directives: [], plan: 'continue', subgoals: [] }, { type: 'planner', planRevised: false, subgoalCount: 0 }),
    reflector: stub('reflector', { lessons: [] }, { type: 'reflector', lessonsExtracted: 0 }),
  };
}
