// SPDX-License-Identifier: Apache-2.0
/**
 * Affect & Explore Presets — compositions with affect and curiosity modules (PRD 037).
 *
 * Three presets that extend the enriched baseline:
 *
 * - affectivePreset:   enriched + Affect module
 * - exploratoryPreset: enriched + Curiosity module
 * - fullPreset:        enriched + Affect + Curiosity (everything)
 *
 * Each preset is a thin wrapper over enrichedPreset() that injects the extra
 * modules via the moduleOverrides mechanism as auxiliary modules while
 * preserving the enriched baseline's core pipeline (MonitorV2, PriorityAttend,
 * ReasonerActorV2, PrecisionAdapter, EVC policy).
 *
 * Grounded in: PRD 037 — Cognitive Affect & Exploration.
 */

import { enrichedPreset } from './enriched.js';
import type {
  EnrichedPresetOverrides,
  EnrichedPresetPorts,
  ModuleSlotOverrides,
} from './enriched.js';
import type { CreateCognitiveAgentOptions } from '../engine/create-cognitive-agent.js';
import { createAffectModule } from '../modules/affect-module.js';
import type { AffectConfig } from '../modules/affect-module.js';
import { createCuriosityModule } from '../modules/curiosity-module.js';
import type { CuriosityConfig } from '../modules/curiosity-module.js';

// ── Extended Overrides ─────────────────────────────────────────

/** Overrides for affect/explore presets — extends enriched overrides with affect/curiosity config. */
export interface AffectExploreOverrides extends EnrichedPresetOverrides {
  /** Affect module configuration overrides. */
  affect?: AffectConfig;
  /** Curiosity module configuration overrides. */
  curiosity?: Partial<CuriosityConfig>;
}

// ── Affective Preset ───────────────────────────────────────────

/**
 * Create a cognitive agent configuration with the enriched baseline + Affect module.
 *
 * The Affect module computes emotional metacognition signals (valence, arousal)
 * from behavioral patterns. It occupies the evaluator slot as an emotional
 * evaluator, enriching the agent's self-awareness.
 *
 * @param ports - Required external ports (adapter, tools, writePort).
 * @param overrides - Optional per-module configuration overrides (including affect config).
 * @param moduleOverrides - Optional per-slot module replacements (applied on top of affect).
 */
export function affectivePreset(
  ports: EnrichedPresetPorts,
  overrides?: AffectExploreOverrides,
  moduleOverrides?: ModuleSlotOverrides,
): CreateCognitiveAgentOptions {
  const affectModule = createAffectModule(overrides?.affect);

  // Affect occupies the evaluator slot (emotional evaluation)
  const mergedModuleOverrides: ModuleSlotOverrides = {
    evaluator: affectModule,
    ...moduleOverrides,
  };

  return enrichedPreset(ports, overrides, mergedModuleOverrides);
}

// ── Exploratory Preset ─────────────────────────────────────────

/**
 * Create a cognitive agent configuration with the enriched baseline + Curiosity module.
 *
 * The Curiosity module tracks learning progress per domain and decides
 * explore vs exploit. It occupies the planner slot, since exploration
 * decisions are inherently planning-level concerns.
 *
 * @param ports - Required external ports (adapter, tools, writePort).
 * @param overrides - Optional per-module configuration overrides (including curiosity config).
 * @param moduleOverrides - Optional per-slot module replacements (applied on top of curiosity).
 */
export function exploratoryPreset(
  ports: EnrichedPresetPorts,
  overrides?: AffectExploreOverrides,
  moduleOverrides?: ModuleSlotOverrides,
): CreateCognitiveAgentOptions {
  const curiosityModule = createCuriosityModule(overrides?.curiosity);

  // Curiosity occupies the planner slot (exploration planning)
  const mergedModuleOverrides: ModuleSlotOverrides = {
    planner: curiosityModule,
    ...moduleOverrides,
  };

  return enrichedPreset(ports, overrides, mergedModuleOverrides);
}

// ── Full Preset ────────────────────────────────────────────────

/**
 * Create a cognitive agent configuration with all v2 modules + Affect + Curiosity.
 *
 * This is the most complete preset: enriched baseline (MonitorV2, PriorityAttend,
 * ReasonerActorV2, PrecisionAdapter, EVC) plus Affect (evaluator slot) and
 * Curiosity (planner slot).
 *
 * @param ports - Required external ports (adapter, tools, writePort).
 * @param overrides - Optional per-module configuration overrides (including affect + curiosity).
 * @param moduleOverrides - Optional per-slot module replacements (highest priority).
 */
export function fullPreset(
  ports: EnrichedPresetPorts,
  overrides?: AffectExploreOverrides,
  moduleOverrides?: ModuleSlotOverrides,
): CreateCognitiveAgentOptions {
  const affectModule = createAffectModule(overrides?.affect);
  const curiosityModule = createCuriosityModule(overrides?.curiosity);

  // Affect → evaluator, Curiosity → planner. User overrides take highest priority.
  const mergedModuleOverrides: ModuleSlotOverrides = {
    evaluator: affectModule,
    planner: curiosityModule,
    ...moduleOverrides,
  };

  return enrichedPreset(ports, overrides, mergedModuleOverrides);
}
