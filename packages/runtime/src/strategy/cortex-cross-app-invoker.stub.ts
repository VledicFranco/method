// SPDX-License-Identifier: Apache-2.0
/**
 * CortexCrossAppInvoker — live Cortex adapter for the CrossAppInvoker port.
 *
 * STATUS: STUB — BLOCKED ON CORTEX PRD-080.
 *
 * PRD-067 Track B ships this class as a live adapter wrapping
 * `ctx.apps.invoke` (PRD-080 §5.7). That capability is `🔜 deferred` in
 * Cortex Wave 5 — Method cannot implement the real adapter until PRD-080
 * freezes.
 *
 * This stub exists so:
 *   1. The composition root can reference `CortexCrossAppInvoker` by name —
 *      the class + construction surface is named now so wiring code can be
 *      drafted against it.
 *   2. Accidental wiring in test/dev bridges before PRD-080 lands fails
 *      fast with a typed, self-describing error rather than a silent
 *      undefined-behavior path.
 *   3. When PRD-080 thaws, implementation lives next to this stub — a
 *      single file replacement (or `.stub.ts` → `.ts` rename + body swap)
 *      and the port surface stays identical.
 *
 * DO NOT call `new CortexCrossAppInvoker()` in production pacts. For tests
 * and single-process demos use `InProcessCrossAppInvoker` instead.
 *
 * The eventual real home for the live adapter is `@methodts/agent-runtime/cortex/`
 * (PRD-067 §7.2) — the stub lives in `@methodts/runtime/strategy/` for now so
 * that the adapter class name is discoverable alongside the port it
 * implements and the simulator it will replace.
 */

import {
  type CrossAppInvokeRequest,
  type CrossAppInvokeResult,
  type CrossAppInvoker,
  type CrossAppInvokerCapabilities,
} from '../ports/cross-app-invoker.js';

/** Thrown whenever any method on `CortexCrossAppInvoker` is called while
 *  PRD-080 remains deferred. Carries the PRD reference in the message for
 *  fast triage. */
export class CortexCrossAppInvokerNotImplementedError extends Error {
  readonly code = 'CORTEX_CROSS_APP_INVOKER_NOT_IMPLEMENTED' as const;
  constructor(methodName: string) {
    super(
      `CortexCrossAppInvoker.${methodName}() — NotImplemented: Blocked on Cortex PRD-080 (App-to-App Dependencies, \`🔜 deferred\` in Wave 5). ` +
        `For tests + single-process demos, use InProcessCrossAppInvoker from @methodts/runtime/strategy. ` +
        `The real adapter ships when PRD-080 thaws and Cortex exposes ctx.apps.invoke (PRD-080 §5.7).`,
    );
    this.name = 'CortexCrossAppInvokerNotImplementedError';
  }
}

/**
 * Options the live adapter will accept once PRD-080 ships. Named now so
 * composition-root wiring can be drafted; the fields will be honored by the
 * real implementation.
 */
export interface CortexCrossAppInvokerOptions {
  /** Cortex SDK `ctx.apps` handle (PRD-080 §5.7). The stub takes `unknown`
   *  because the real `CortexCtxApps` type lives in `@cortex/sdk` — that
   *  import is forbidden from `@methodts/runtime` (G-BOUNDARY). The live
   *  adapter in `@methodts/agent-runtime/cortex/` will type this properly. */
  readonly ctxApps: unknown;

  /** App ids from the tenant's `requires.apps[]` manifest block — seeds
   *  `capabilities().allowedTargetAppIds` so compose-time checks reject
   *  un-declared targets before dispatch. */
  readonly allowedTargetAppIds: ReadonlySet<string>;

  /** Maximum RFC 8693 delegation depth — defaults to
   *  `CROSS_APP_DEFAULT_MAX_DELEGATION_DEPTH` (= 2) per PRD-061/PRD-080. */
  readonly maxDelegationDepth?: number;
}

/** Live Cortex adapter — STUB pending PRD-080. Every method throws. */
export class CortexCrossAppInvoker implements CrossAppInvoker {
  private readonly allowedTargetAppIds: ReadonlySet<string>;
  private readonly maxDelegationDepth: number;

  constructor(options: CortexCrossAppInvokerOptions) {
    // Capture config so `capabilities()` can at least report the intended
    // allowlist — useful for compose-time error messages even before the
    // live adapter exists.
    this.allowedTargetAppIds = options.allowedTargetAppIds;
    this.maxDelegationDepth = options.maxDelegationDepth ?? 2;
    // Intentionally DO NOT throw in the constructor — callers may want to
    // inspect `capabilities()` without dispatching. Throw on `invoke` only.
    void options.ctxApps;
  }

  async invoke<Input = unknown, Output = unknown>(
    _request: CrossAppInvokeRequest<Input>,
  ): Promise<CrossAppInvokeResult<Output>> {
    throw new CortexCrossAppInvokerNotImplementedError('invoke');
  }

  capabilities(): CrossAppInvokerCapabilities {
    return {
      enabled: false,
      maxDelegationDepth: this.maxDelegationDepth,
      allowedTargetAppIds: this.allowedTargetAppIds,
    };
  }
}
