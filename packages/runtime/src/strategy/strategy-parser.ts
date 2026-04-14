/**
 * PRD 017: Strategy Pipelines — Strategy YAML Parser
 *
 * Re-export from @method/methodts canonical parser. All parsing, validation,
 * and topological sort logic lives in methodts. This file preserves the
 * runtime's import surface.
 *
 * The setStrategyParserYaml() port configuration is retained for composition-root
 * YAML loader injection (PRD 024 MG-2), but parsing itself delegates to methodts.
 *
 * PRD-057 / S2 §3.2 / C2: moved from @method/bridge/domains/strategies/.
 */

import type { YamlLoader } from '../ports/yaml-loader.js';
import {
  parseStrategyYaml as methodtsParseYaml,
  parseStrategyObject as methodtsParseObject,
  validateStrategyDAG as methodtsValidateDAG,
  topologicalSort as methodtsTopoSort,
} from '@method/methodts/strategy/dag-parser.js';

// Re-export types from methodts dag-types (preserving the runtime's type surface)
export type {
  StrategyYaml,
  MethodologyNodeConfig,
  ScriptNodeConfig,
  StrategyNode,
  OversightRule,
  StrategyDAG,
  StrategyValidationResult,
  DagGateType as GateType,
} from '@method/methodts/strategy/dag-types.js';

// Re-export StrategyGateDecl as StrategyGate for backward compat
export type { StrategyGateDecl as StrategyGate } from '@method/methodts/strategy/dag-types.js';

// PRD-044: new node type + port interfaces
export type {
  StrategyNodeConfig,
  SubStrategyResult,
  SubStrategySource,
  HumanApprovalResolver,
  HumanApprovalContext,
  HumanApprovalDecision,
} from '@method/methodts/strategy/dag-types.js';

/** PRD 024: Configure YamlLoader for strategy-parser. Called from composition root.
 * Retained for API compatibility — parsing is fully delegated to @method/methodts.
 */
export function setStrategyParserYaml(_yaml: YamlLoader): void {
  // no-op: methodts manages its own YAML loader internally
}

// ── Delegated Functions ─────────────────────────────────────────

/** Parse a raw YAML string into a StrategyDAG. Delegates to @method/methodts. */
export const parseStrategyYaml = methodtsParseYaml;

/** Parse a pre-parsed YAML object into a StrategyDAG. Delegates to @method/methodts. */
export const parseStrategyObject = methodtsParseObject;

/** Validate a StrategyDAG for correctness. Delegates to @method/methodts. */
export const validateStrategyDAG = methodtsValidateDAG;

/** Compute topological ordering grouped by levels. Delegates to @method/methodts. */
export const topologicalSort = methodtsTopoSort;
