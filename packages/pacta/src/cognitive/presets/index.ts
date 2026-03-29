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
