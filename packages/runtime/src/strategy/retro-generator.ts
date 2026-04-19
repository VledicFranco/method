// SPDX-License-Identifier: Apache-2.0
/**
 * PRD 017: Strategy Pipelines — Retrospective Generator
 *
 * Re-export from @methodts/methodts canonical retro generator. All retrospective
 * generation logic (critical path, gate aggregation, etc.) lives in methodts.
 * This file preserves the runtime's import surface.
 *
 * The setRetroGeneratorYaml() port configuration is retained for composition-root
 * YAML loader injection (PRD 024 MG-2), but serialization delegates to methodts.
 *
 * PRD-057 / S2 §3.2 / C2: moved from @methodts/bridge/domains/strategies/.
 */

import { type YamlLoader } from '../ports/yaml-loader.js';

// PRD 024 MG-2: Module-level yaml port (retained for composition root)
let _yaml: YamlLoader | null = null;

/** PRD 024: Configure YamlLoader for retro-generator. Called from composition root. */
export function setRetroGeneratorYaml(yaml: YamlLoader): void {
  _yaml = yaml;
}

// Re-export types from methodts
export type { StrategyRetro } from '@methodts/methodts/strategy/dag-types.js';

// Re-export functions from methodts
export {
  generateRetro,
  computeCriticalPath,
  retroToYaml,
} from '@methodts/methodts/strategy/dag-retro.js';
