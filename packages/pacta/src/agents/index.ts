// SPDX-License-Identifier: Apache-2.0
// ── Reference Agents — Barrel Export ─────────────────────────────
//
// Pre-assembled agents with .with() customization.
// Each requires a provider — no default provider is shipped.

export type {
  ReferenceAgent,
  ReferenceAgentConfig,
  ReferenceAgentPactOverrides,
} from './reference-agent.js';

export { createReferenceAgent } from './reference-agent.js';

export { codeAgent } from './code-agent.js';
export { researchAgent } from './research-agent.js';
export { reviewAgent } from './review-agent.js';
