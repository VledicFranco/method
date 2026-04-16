/**
 * CrossAppInvoker — transport-free port for cross-app strategy invocation (PRD-067).
 *
 * Frozen (Track A simulator surfaces): 2026-04-15 — see
 * `.method/sessions/fcd-design-prd-067-multi-app-strategy/prd.md` §6.1.
 *
 * Owner:    @method/runtime (defines port)
 * Producer: @method/agent-runtime/cortex (CortexCrossAppInvoker — BLOCKED on
 *           Cortex PRD-080) and @method/runtime (InProcessCrossAppInvoker
 *           simulator — shipping in this PR)
 * Consumer: @method/runtime/strategy (DagStrategyExecutor cross-app-invoke node dispatch)
 *
 * Gates:
 *   - G-BOUNDARY: zero `@cortex/*` imports in this file — only port-local types.
 *   - G-PORT: strategy executor MUST dispatch through this port, never directly
 *     through `ctx.apps.invoke`.
 *
 * PRD-067 §12.3 ships `InProcessCrossAppInvoker` now so tests + single-process
 * demos can exercise cross-app DAG flows without waiting for Cortex PRD-080
 * (`🔜 deferred`, Wave 5). Swapping the simulator for the live adapter is a
 * single composition-root line change once PRD-080 thaws.
 */

/** Delegation context carried into any RFC 8693 token exchange on dispatch.
 *
 * Constructed by the strategy executor from the pact's token context (see S3
 * `CortexTokenExchangeMiddleware`). Tenant-app code does not build this.
 */
export interface DelegationCarry {
  /** The caller's ctx-issued token (agent-scoped). Opaque to method; the
   *  Cortex adapter threads it into `ctx.auth.exchangeForAgent`. */
  readonly parentToken: string;
  /** Exchange depth the caller has already consumed (RFC 8693). The adapter
   *  rejects when `currentDepth >= maxDelegationDepth` per PRD-061/PRD-080. */
  readonly currentDepth: number;
  /** Originating request id — flows into the caller-side audit entry and
   *  correlates with `tokenContext.originatingRequestId` on the envelope. */
  readonly originatingRequestId: string;
}

/** Request to invoke an operation on a target Cortex tenant app. */
export interface CrossAppInvokeRequest<Input = unknown> {
  /** Target Cortex app id. MUST be present in the caller's `requires.apps[]`
   *  manifest block. Enforced by Cortex at runtime; the Method adapter also
   *  pre-checks via `capabilities().allowedTargetAppIds` to fail fast. */
  readonly targetAppId: string;

  /** Operation name on the target app. PRD-080 constrains cross-app calls to
   *  operations, never tools. */
  readonly operation: string;

  /** Typed payload. Shape contract belongs to the target app's operation
   *  schema — the invoker does NOT validate it; the caller's strategy DAG
   *  node config declares its expected shape via `input_projection`. */
  readonly input: Input;

  /** Optional per-call timeout (milliseconds). Default: executor's
   *  `defaultTimeoutMs`. */
  readonly timeoutMs?: number;

  /** Optional idempotency key. If the same
   *  `(targetAppId, operation, idempotencyKey)` triple is seen twice the
   *  target returns the first result. Recommended: the strategy DAG's
   *  `${sessionId}:${nodeId}` tuple to dedupe across retries. */
  readonly idempotencyKey?: string;

  /** Delegation context for RFC 8693 token exchange. */
  readonly delegation: DelegationCarry;

  /** Strategy correlation identifiers — flow into the caller-side audit
   *  entry and the continuation envelope's `crossApp.callerNodeId`. */
  readonly caller: {
    readonly sessionId: string;
    readonly nodeId: string;
  };
}

/** Result of a cross-app invocation. */
export interface CrossAppInvokeResult<Output = unknown> {
  /** The target operation's output, opaque to the port. */
  readonly output: Output;

  /** Target app's decisionId as returned by `ctx.apps.invoke` (PRD-080 §5.7).
   *  Method appends this to its caller-side audit entry so the dual-audit
   *  correlation works end-to-end. */
  readonly targetDecisionId: string;

  /** Wall-clock latency (ms) measured at the call site — includes token
   *  exchange, scope check, transport, and target execution. */
  readonly latencyMs: number;

  /** Cost attributed to the CALLER's budget (USD) as reported by `ctx.llm`
   *  at dispatch time. Callee's own `ctx.llm` cost is NOT included here —
   *  the callee debits its own budget separately and the caller never sees
   *  the callee's line item. */
  readonly callerCostUsd: number;
}

/** Declarative capabilities of a concrete invoker implementation, asked at
 *  compose time by the strategy executor so dev-mode bridges can fail fast
 *  rather than at execution. */
export interface CrossAppInvokerCapabilities {
  /** True when the invoker can actually dispatch; false for null invokers. */
  readonly enabled: boolean;

  /** Max RFC 8693 delegation depth this invoker will accept before rejecting
   *  at dispatch time. Echoes the PRD-061/PRD-080 default of 2. Adapters
   *  MAY declare a lower cap (e.g. a simulator that runs depth 1 only). */
  readonly maxDelegationDepth: number;

  /** Allowed target app ids — derived from the tenant app's
   *  `requires.apps[]` manifest block. Empty `undefined` means "adapter
   *  doesn't enforce — trust the Cortex runtime check". A non-empty set
   *  lets the strategy compose-time validator reject DAGs targeting
   *  undeclared apps before execution starts. */
  readonly allowedTargetAppIds?: ReadonlySet<string>;
}

/**
 * Transport-free port the strategy DAG executor calls to dispatch a
 * `cross-app-invoke` node. The `@method/runtime` layer knows nothing about
 * Cortex; the adapter in `@method/agent-runtime/cortex` implements this port
 * by calling `ctx.apps.invoke` (Cortex PRD-080).
 *
 * Implementations (per PRD-067 §6.1):
 *   - `InProcessCrossAppInvoker` — in-memory map of registered simulator
 *     apps; dispatches synchronously in-process. Shipping in this PR.
 *   - `CortexCrossAppInvoker` — wraps `ctx.apps.invoke`. BLOCKED on Cortex
 *     PRD-080 freeze.
 *   - `NullCrossAppInvoker` — throws `CrossAppNotConfiguredError` on every
 *     call; the default when no cross-app capability is wired.
 *
 * Fire-and-forget is explicitly not supported (PRD-080 §4 OOS): every call
 * is request/reply.
 */
export interface CrossAppInvoker {
  /** Invoke a named operation on a target app. */
  invoke<Input = unknown, Output = unknown>(
    request: CrossAppInvokeRequest<Input>,
  ): Promise<CrossAppInvokeResult<Output>>;

  /** Declare capabilities the strategy executor can check at compose time. */
  capabilities(): CrossAppInvokerCapabilities;
}

// ── Typed error classes ─────────────────────────────────────────

/** Thrown when a `cross-app-invoke` node runs but no invoker is wired
 *  (composition root received `NullCrossAppInvoker` or none at all). */
export class CrossAppNotConfiguredError extends Error {
  readonly code = 'CROSS_APP_NOT_CONFIGURED' as const;
  constructor(message?: string) {
    super(
      message ??
        'CrossAppInvoker not configured — strategy DAG declares a cross-app-invoke node but the runtime has no invoker wired. Inject CortexCrossAppInvoker (prod) or InProcessCrossAppInvoker (simulator/test).',
    );
    this.name = 'CrossAppNotConfiguredError';
  }
}

/** Thrown at compose time when a DAG targets an app not in the manifest
 *  `requires.apps[]` block (i.e. not in `capabilities().allowedTargetAppIds`). */
export class CrossAppTargetNotDeclaredError extends Error {
  readonly code = 'CROSS_APP_TARGET_NOT_DECLARED' as const;
  readonly targetAppId: string;
  readonly allowedTargetAppIds: ReadonlySet<string>;
  constructor(targetAppId: string, allowedTargetAppIds: ReadonlySet<string>) {
    super(
      `Cross-app target "${targetAppId}" is not declared in the caller's requires.apps[] manifest block. ` +
        `Allowed: [${[...allowedTargetAppIds].sort().join(', ') || '<none>'}]. ` +
        `Add "${targetAppId}" to the tenant app's manifest or remove the cross-app-invoke node from the strategy.`,
    );
    this.name = 'CrossAppTargetNotDeclaredError';
    this.targetAppId = targetAppId;
    this.allowedTargetAppIds = allowedTargetAppIds;
  }
}

/** Surfaces Cortex PRD-080's `cross_app_scope_missing` 403 as a typed error. */
export class CrossAppScopeMissingError extends Error {
  readonly code = 'CROSS_APP_SCOPE_MISSING' as const;
  readonly targetAppId: string;
  readonly operation: string;
  constructor(targetAppId: string, operation: string) {
    super(
      `Cross-app call to "${targetAppId}.${operation}" rejected: token is missing the required app:${targetAppId}:${operation} scope. ` +
        `The caller's ctx-issued token must carry that scope claim. ` +
        `This maps to Cortex PRD-080's cross_app_scope_missing 403.`,
    );
    this.name = 'CrossAppScopeMissingError';
    this.targetAppId = targetAppId;
    this.operation = operation;
  }
}

/** Thrown when the delegation depth would exceed the invoker's declared
 *  max (PRD-067 §9.1 conflict point — default cap is 2). */
export class CrossAppDelegationDepthExceededError extends Error {
  readonly code = 'CROSS_APP_DELEGATION_DEPTH_EXCEEDED' as const;
  readonly currentDepth: number;
  readonly maxDepth: number;
  constructor(currentDepth: number, maxDepth: number) {
    super(
      `Cross-app invocation rejected: delegation depth ${currentDepth} would exceed the cap of ${maxDepth}. ` +
        `Per PRD-061/PRD-080 the hard cap is 2 — user → agent → cross-app is the deepest valid chain. ` +
        `PRD-067 §9.1 default mitigation: re-compose deep sub-agent trees as siblings via additional cross-app-invoke calls (flatten the tree).`,
    );
    this.name = 'CrossAppDelegationDepthExceededError';
    this.currentDepth = currentDepth;
    this.maxDepth = maxDepth;
  }
}

/** Thrown when the target app/operation is registered but its handler threw
 *  — the invoker captures the target error and re-raises so the strategy
 *  gate/retry machinery can resolve it as a node failure (PRD-067 §9 risk:
 *  "Failure isolation"). */
export class CrossAppTargetError extends Error {
  readonly code = 'CROSS_APP_TARGET_ERROR' as const;
  readonly targetAppId: string;
  readonly operation: string;
  readonly targetDecisionId: string;
  readonly cause: unknown;
  constructor(
    targetAppId: string,
    operation: string,
    targetDecisionId: string,
    cause: unknown,
  ) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(
      `Cross-app target "${targetAppId}.${operation}" failed (decisionId=${targetDecisionId}): ${causeMsg}`,
    );
    this.name = 'CrossAppTargetError';
    this.targetAppId = targetAppId;
    this.operation = operation;
    this.targetDecisionId = targetDecisionId;
    this.cause = cause;
  }
}

/** Thrown when a target app is not registered with the invoker (simulator
 *  analogue of Cortex's deploy-time app-dep graph check). */
export class CrossAppTargetUnknownError extends Error {
  readonly code = 'CROSS_APP_TARGET_UNKNOWN' as const;
  readonly targetAppId: string;
  readonly operation: string;
  constructor(targetAppId: string, operation: string, knownAppIds: readonly string[]) {
    super(
      `Cross-app target "${targetAppId}.${operation}" unknown to invoker. ` +
        `Registered apps: [${[...knownAppIds].sort().join(', ') || '<none>'}]. ` +
        `In the simulator, register the app via InProcessCrossAppInvoker.registerApp(); ` +
        `in production, confirm the app is deployed and declared in requires.apps[].`,
    );
    this.name = 'CrossAppTargetUnknownError';
    this.targetAppId = targetAppId;
    this.operation = operation;
  }
}

// ── Default null invoker ────────────────────────────────────────

/** Default invoker used when the composition root did not wire a real one.
 *
 *  `invoke()` throws `CrossAppNotConfiguredError` on every call; `capabilities()`
 *  reports `{ enabled: false }` so the strategy parser can refuse cross-app
 *  nodes at compose time rather than at runtime.
 */
export class NullCrossAppInvoker implements CrossAppInvoker {
  async invoke<Input, Output>(
    _request: CrossAppInvokeRequest<Input>,
  ): Promise<CrossAppInvokeResult<Output>> {
    throw new CrossAppNotConfiguredError();
  }

  capabilities(): CrossAppInvokerCapabilities {
    return {
      enabled: false,
      maxDelegationDepth: 2,
      allowedTargetAppIds: new Set<string>(),
    };
  }
}

/** Default delegation depth cap, matching PRD-061/PRD-080 RFC 8693 defaults. */
export const CROSS_APP_DEFAULT_MAX_DELEGATION_DEPTH = 2;

/**
 * Compose-time validator — given a strategy's declared set of target apps,
 * fails fast if any are not in the invoker's allowlist. Strategy executors
 * call this before walking the DAG so a misconfigured manifest surfaces at
 * compose time rather than at node dispatch.
 *
 * Behavior: when `capabilities().allowedTargetAppIds` is `undefined` the
 * check is skipped (adapter declared "trust Cortex runtime check"). When
 * the set is present (even empty), every declared target must be a member.
 */
export function assertCrossAppTargetsAllowed(
  invoker: CrossAppInvoker,
  declaredTargetAppIds: readonly string[],
): void {
  const caps = invoker.capabilities();
  const allowed = caps.allowedTargetAppIds;
  if (allowed === undefined) return;
  for (const targetAppId of declaredTargetAppIds) {
    if (!allowed.has(targetAppId)) {
      throw new CrossAppTargetNotDeclaredError(targetAppId, allowed);
    }
  }
}
