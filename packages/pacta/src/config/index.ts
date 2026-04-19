// SPDX-License-Identifier: Apache-2.0
/**
 * config/ — Agent personas and thought pattern presets.
 *
 * PERSONAS: named persona profiles with system prompt fragments and tool preferences.
 * selectPersona(): selects persona by task description keyword matching.
 * formatPersonaPrompt(): renders PersonaProfile → system prompt fragment.
 * thought-patterns.ts: pre-built reasoning style strings for common tasks.
 */

export { PERSONAS, selectPersona, formatPersonaPrompt } from './personas.js';
export type { PersonaProfile } from './personas.js';
export * from './thought-patterns.js';
