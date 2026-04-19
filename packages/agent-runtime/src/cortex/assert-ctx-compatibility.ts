// SPDX-License-Identifier: Apache-2.0
/**
 * Runtime structural compatibility check for the injected Cortex ctx.
 *
 * R1 mitigation (PRD-058 §3.3): TypeScript type-only imports are erased at
 * compile time, so field drift between Cortex's real `ctx` and our
 * structural `CortexCtx` type may compile cleanly yet break at runtime.
 * `assertCtxCompatibility` is the opt-in runtime guard tenant apps call at
 * boot (sample app invokes it inside `agent.ts` before `createMethodAgent`).
 *
 * Contract: throws {@link MissingCtxError} when a required facade is absent
 * or lacks the method we dispatch against. Optional facades (`events`,
 * `storage`, `jobs`, `schedule`, `auth`, `log`) are *not* asserted; their
 * presence is validated on-demand at the point of consumption.
 *
 * This helper is **not** called inside `createMethodAgent` (would slow every
 * factory invocation). Tenant apps opt in; the sample app always does.
 */

import { MissingCtxError } from '../errors.js';
import type { CortexCtx } from './ctx-types.js';

/**
 * Runtime structural check on the Cortex ctx injected by the tenant app.
 *
 * Throws {@link MissingCtxError} with the specific list of missing facades.
 * Successful return means the ctx satisfies the S1 hard-required slice:
 *   - `ctx.app` with `id` (string) and `tier` (service/tool/web)
 *   - `ctx.llm.complete` callable
 *   - `ctx.audit.event` callable
 */
export function assertCtxCompatibility(ctx: CortexCtx): void {
  const missing: Array<keyof CortexCtx> = [];

  if (!ctx || typeof ctx !== 'object') {
    throw new MissingCtxError(['app', 'llm', 'audit']);
  }

  if (!ctx.app || typeof ctx.app.id !== 'string' || typeof ctx.app.tier !== 'string') {
    missing.push('app');
  }

  if (!ctx.llm || typeof ctx.llm.complete !== 'function') {
    missing.push('llm');
  }

  if (!ctx.audit || typeof ctx.audit.event !== 'function') {
    missing.push('audit');
  }

  if (missing.length > 0) {
    throw new MissingCtxError(missing);
  }
}
