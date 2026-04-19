// SPDX-License-Identifier: Apache-2.0
/**
 * StrategySource — port interface for strategy DAG loading.
 *
 * Same pattern as the planned MethodologySource (WS-1): a port that
 * abstracts how strategies are discovered, loaded, and parsed.
 *
 * Implementations:
 * - StdlibStrategySource — wraps prebuilt strategies behind the port
 * - FileStrategySource — loads from .method/strategies/ YAML files (bridge adapter)
 * - Test doubles — in-memory strategies for unit testing
 *
 * @see PRD 017 — Strategy Pipelines
 * @see WS-2 — Strategy system unification
 */

import type { StrategyDAG, StrategyValidationResult } from "./dag-types.js";

/** Metadata about a strategy (without full DAG structure). */
export interface StrategyInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

/**
 * Port interface for strategy loading and discovery.
 *
 * Implementations are injected at the composition root (bridge server-entry.ts)
 * and passed to the DAG executor. This enables:
 * - Bridge: loads from filesystem YAML
 * - Tests: uses in-memory strategies
 * - Stdlib: wraps prebuilt StrategyController-based strategies
 */
export interface StrategySource {
  /** List all available strategy IDs with basic metadata. */
  list(): Promise<StrategyInfo[]>;

  /** Load a strategy DAG by ID. Returns null if not found. */
  load(id: string): Promise<StrategyDAG | null>;

  /** Parse a YAML string into a StrategyDAG. */
  parse(yaml: string): StrategyDAG;

  /** Validate a StrategyDAG for correctness. */
  validate(dag: StrategyDAG): StrategyValidationResult;
}
