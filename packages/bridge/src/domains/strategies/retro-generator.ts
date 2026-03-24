/**
 * PRD 017: Strategy Pipelines — Retrospective Generator (Phase 1d)
 *
 * WS-2: Now a thin re-export from @method/methodts canonical retro generator.
 * All retrospective generation logic (critical path, gate aggregation, etc.)
 * lives in methodts. This file preserves the bridge's import surface.
 *
 * The setRetroGeneratorYaml() port configuration is retained for bridge-level
 * YAML loader injection (PRD 024 MG-2), but serialization delegates to methodts.
 */

import { type YamlLoader } from '../../ports/yaml-loader.js';

// PRD 024 MG-2: Module-level yaml port (retained for bridge composition root)
let _yaml: YamlLoader | null = null;

/** PRD 024: Configure YamlLoader for retro-generator. Called from composition root. */
export function setRetroGeneratorYaml(yaml: YamlLoader): void {
  _yaml = yaml;
}

// Re-export types from methodts
export type { StrategyRetro } from '@method/methodts/strategy/dag-types.js';

// Re-export functions from methodts
export {
  generateRetro,
  computeCriticalPath,
  retroToYaml,
} from '@method/methodts/strategy/dag-retro.js';
