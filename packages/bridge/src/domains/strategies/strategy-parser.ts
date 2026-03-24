/**
 * PRD 017: Strategy Pipelines — Strategy YAML Parser (Phase 1c)
 *
 * WS-2: Now a thin re-export from @method/methodts canonical parser.
 * All parsing, validation, and topological sort logic lives in methodts.
 * This file preserves the bridge's import surface for backward compatibility.
 *
 * The setStrategyParserYaml() port configuration is retained for bridge-level
 * YAML loader injection (PRD 024 MG-2), but parsing itself delegates to methodts.
 */

import { JsYamlLoader, type YamlLoader } from '../../ports/yaml-loader.js';
import {
  parseStrategyYaml as methodtsParseYaml,
  parseStrategyObject as methodtsParseObject,
  validateStrategyDAG as methodtsValidateDAG,
  topologicalSort as methodtsTopoSort,
  getDefaultRetries as methodtsGetDefaultRetries,
  getDefaultTimeout as methodtsGetDefaultTimeout,
} from '@method/methodts/strategy/dag-parser.js';

// Re-export types from methodts dag-types (preserving bridge's type surface)
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

// PRD 024 MG-2: Module-level yaml port (retained for bridge composition root)
let _yaml: YamlLoader | null = null;

/** PRD 024: Configure YamlLoader for strategy-parser. Called from composition root. */
export function setStrategyParserYaml(yaml: YamlLoader): void {
  _yaml = yaml;
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
