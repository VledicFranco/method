/**
 * Memory Preset — convenience factory composing MemoryV3 + Consolidator
 * with a shared InMemoryDualStore for common use cases.
 *
 * Eliminates the boilerplate of wiring the three CLS components together.
 * Consumers get a ready-to-use memory module, consolidator module, and
 * the shared store reference for offline consolidation via the Sleep API.
 *
 * Grounded in: Complementary Learning Systems (CLS) theory (PRD 036).
 */

import type {
  CognitiveModule,
  MemoryMonitoring,
  ReflectorMonitoring,
  WorkspaceWritePort,
} from '../algebra/index.js';
import type {
  MemoryPortV3,
  DualStoreConfig,
  ConsolidationConfig,
  ActivationConfig,
} from '../../ports/memory-port.js';
import { createInMemoryDualStore } from './in-memory-dual-store.js';
import { createMemoryV3 } from './memory-module-v3.js';
import type { MemoryV3Input, MemoryV3Output, MemoryV3State, MemoryV3Control } from './memory-module-v3.js';
import { createConsolidator } from './consolidator.js';
import type { ConsolidatorInput, ConsolidatorOutput, ConsolidatorState, ConsolidatorControl } from './consolidator.js';

// ── Types ────────────────────────────────────────────────────────

/** Configuration for the memory preset factory. */
export interface MemoryPresetConfig {
  /** Dual-store configuration (episodic/semantic capacity, consolidation batch settings). */
  dualStore: DualStoreConfig;
  /** Consolidation configuration (online depth, offline replay, pruning). */
  consolidation: ConsolidationConfig;
  /** ACT-R activation parameters (retrieval threshold, spreading weight, noise). */
  activation: ActivationConfig;
  /** Workspace write port for MemoryV3 to emit retrieved knowledge. */
  writePort: WorkspaceWritePort;
}

/** Result of the memory preset factory. */
export interface MemoryPresetResult {
  /** MemoryV3 module — operates in the REMEMBER phase. */
  memory: CognitiveModule<MemoryV3Input, MemoryV3Output, MemoryV3State, MemoryMonitoring, MemoryV3Control>;
  /** Consolidator module — operates in the LEARN phase. */
  consolidator: CognitiveModule<ConsolidatorInput, ConsolidatorOutput, ConsolidatorState, ReflectorMonitoring, ConsolidatorControl>;
  /** Shared MemoryPortV3 store instance — pass to Sleep API for offline consolidation. */
  store: MemoryPortV3;
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a memory preset: MemoryV3 + Consolidator + shared InMemoryDualStore.
 *
 * Both modules share the same store instance, ensuring episodes stored by the
 * Consolidator during LEARN are retrievable by MemoryV3 during REMEMBER.
 *
 * @param config - Preset configuration (dual-store, consolidation, activation, writePort).
 * @returns Object containing the memory module, consolidator module, and shared store.
 */
export function createMemoryPreset(config: MemoryPresetConfig): MemoryPresetResult {
  // 1. Create shared InMemoryDualStore
  const store = createInMemoryDualStore(config.dualStore, config.activation);

  // 2. Create MemoryV3 module with the shared store
  const memory = createMemoryV3(store, config.writePort, config.activation);

  // 3. Create Consolidator module with the shared store
  const consolidator = createConsolidator(store, config.consolidation);

  // 4. Return all three
  return { memory, consolidator, store };
}
