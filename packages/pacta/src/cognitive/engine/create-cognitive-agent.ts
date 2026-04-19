// SPDX-License-Identifier: Apache-2.0
/**
 * createCognitiveAgent — composition function for cognitive agents.
 *
 * Validates that all 8 modules are provided, creates workspace from config,
 * creates InMemoryTraceSink for trace accumulation, and returns a CognitiveAgent
 * that delegates to the cognitive cycle orchestrator.
 */

import type {
  WorkspaceConfig,
  TraceSink,
  TraceRecord,
  ControlPolicy,
  CognitiveEvent,
  WorkspaceManager,
} from '../algebra/index.js';
import {
  createWorkspace,
  InMemoryTraceSink,
  CompositionError,
} from '../algebra/index.js';
import type { AgentProvider } from '../../ports/agent-provider.js';
import type { AgentEvent } from '../../events.js';
import type {
  CycleModules,
  CycleConfig,
  CycleResult,
} from './cycle.js';
import { createCognitiveCycle } from './cycle.js';
import type { ModuleId } from '../algebra/index.js';

// ── Options ──────────────────────────────────────────────────────

export interface CreateCognitiveAgentOptions {
  modules: CycleModules;
  workspace: WorkspaceConfig;
  cycle: CycleConfig;
  provider?: AgentProvider;
  traceSinks?: TraceSink[];
  onEvent?: (event: AgentEvent) => void;
}

// ── CognitiveAgent Interface ─────────────────────────────────────

export interface CognitiveAgent {
  invoke(input: unknown): Promise<CycleResult>;
  readonly config: CreateCognitiveAgentOptions;
  traces(): TraceRecord[];
}

// ── Required Module Keys ─────────────────────────────────────────

const REQUIRED_MODULES: (keyof CycleModules)[] = [
  'observer',
  'memory',
  'reasoner',
  'actor',
  'monitor',
  'evaluator',
  'planner',
  'reflector',
];

// ── Factory ──────────────────────────────────────────────────────

export function createCognitiveAgent(
  options: CreateCognitiveAgentOptions,
): CognitiveAgent {
  // Validate all 8 modules are provided
  for (const key of REQUIRED_MODULES) {
    if (!options.modules[key]) {
      throw new CompositionError(
        `Missing required cognitive module: ${key}. All 8 modules must be provided.`,
      );
    }
    if (typeof options.modules[key].step !== 'function') {
      throw new CompositionError(
        `Invalid cognitive module "${key}": must implement step().`,
      );
    }
    if (typeof options.modules[key].initialState !== 'function') {
      throw new CompositionError(
        `Invalid cognitive module "${key}": must implement initialState().`,
      );
    }
  }

  // Create workspace from config
  const salienceContext = {
    now: Date.now(),
    goals: [],
    sourcePriorities: new Map<ModuleId, number>(),
  };
  const workspace: WorkspaceManager = createWorkspace(options.workspace, salienceContext);

  // Create internal trace sink for accumulation
  const internalSink = new InMemoryTraceSink();
  const allSinks: TraceSink[] = [internalSink, ...(options.traceSinks ?? [])];

  // Create the cognitive cycle runner
  const cycleRunner = createCognitiveCycle(options.modules, options.cycle);

  return {
    config: options,

    async invoke(input: unknown): Promise<CycleResult> {
      const result = await cycleRunner.run(
        input,
        workspace,
        allSinks,
        options.onEvent as ((event: CognitiveEvent) => void) | undefined,
      );
      return result;
    },

    traces(): TraceRecord[] {
      return [...internalSink.traces()];
    },
  };
}
