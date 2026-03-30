/**
 * Cognitive Presets — pre-composed cognitive agent configurations.
 *
 * Presets combine module factories, workspace policies, and cycle configs
 * into ready-to-use CreateCognitiveAgentOptions bundles.
 */

// ── Enriched Preset (PRD 035 — all v2 modules) ─────────────────

export { enrichedPreset } from './enriched.js';

export type {
  EnrichedPresetOverrides,
  EnrichedPresetPorts,
  ModuleSlotOverrides,
} from './enriched.js';

// ── Affect & Explore Presets (PRD 037 — affect + curiosity) ────

export { affectivePreset, exploratoryPreset, fullPreset } from './affect-explore.js';

export type { AffectExploreOverrides } from './affect-explore.js';
