// ── Cognitive Composition — domain barrel ────────────────────────
//
// Re-exports from the three cognitive sub-domains:
//   algebra/  — types, composition operators, workspace, trace
//   modules/  — 8 cognitive module implementations
//   engine/   — cycle orchestrator, createCognitiveAgent, asFlatAgent

// Algebra (types + operators + workspace)
export * from './algebra/index.js';

// Engine (cycle + composition + adapter)
export * from './engine/index.js';

// Modules are not re-exported from the domain barrel.
// They are imported directly by consumers who need specific module factories:
//   import { createReasoner } from '@method/pacta/cognitive/modules/reasoner.js';
// This prevents the barrel from coupling to all 8 module implementations.

// Presets (PRD 035 — pre-composed configurations)
export { enrichedPreset } from './presets/index.js';
export type { EnrichedPresetOverrides, EnrichedPresetPorts, ModuleSlotOverrides } from './presets/index.js';

// Presets (PRD 037 — affect + curiosity compositions)
export { affectivePreset, exploratoryPreset, fullPreset } from './presets/index.js';
export type { AffectExploreOverrides } from './presets/index.js';
