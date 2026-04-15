/**
 * InProcessCrossAppInvoker — in-memory simulator for the CrossAppInvoker port.
 *
 * PRD-067 Track A (Wave 0 §8): ships with this PR so multi-app strategy DAGs
 * can be exercised in tests + single-process demos without waiting for Cortex
 * PRD-080 (`🔜 deferred`, Wave 5). Swapping the simulator for the live
 * CortexCrossAppInvoker is a single composition-root line change once
 * PRD-080 thaws.
 *
 * The simulator:
 *   - Maps `targetAppId → { operation → handler }` via an in-memory registry
 *   - Dispatches synchronously in-process (no SQS, no HTTP, no real auth)
 *   - Enforces the same delegation-depth cap as the live adapter
 *   - Enforces a caller-side allowlist mirrored from `requires.apps[]`
 *   - Honors `idempotencyKey` by caching the first result per key
 *   - Generates synthetic `decisionId`s + wall-clock `latencyMs`
 *   - Captures target handler throws as `CrossAppTargetError` (so the caller's
 *     strategy gate machinery resolves them as node failures — see G-FAILURE-ISOLATION)
 *
 * Owner:    @method/runtime (simulator lives next to the port for discoverability)
 * Producer: tests + single-process demos wire this at the composition root
 * Consumer: DagStrategyExecutor (via the CrossAppInvoker port)
 *
 * NOTE: this is a SIMULATOR — it does not exercise token exchange, audit
 * correlation against a real Cortex audit stream, cost metering against a
 * real `ctx.llm` reservation, or health-propagation from PRD-077. Those all
 * require the live CortexCrossAppInvoker (Track B, blocked on PRD-080).
 */

import {
  CROSS_APP_DEFAULT_MAX_DELEGATION_DEPTH,
  CrossAppDelegationDepthExceededError,
  type CrossAppInvokeRequest,
  type CrossAppInvokeResult,
  type CrossAppInvoker,
  type CrossAppInvokerCapabilities,
  CrossAppTargetError,
  CrossAppTargetUnknownError,
} from '../ports/cross-app-invoker.js';

/** A registered target-app operation handler.
 *
 *  Handlers are synchronous-or-async functions receiving the input payload +
 *  metadata about the caller; they return the operation's output. Throws are
 *  captured by the invoker and surfaced as `CrossAppTargetError` (failure
 *  isolation — see PRD-067 §9 G-FAILURE-ISOLATION).
 */
export type InProcessCrossAppHandler<Input = unknown, Output = unknown> = (
  input: Input,
  meta: {
    readonly targetAppId: string;
    readonly operation: string;
    readonly targetDecisionId: string;
    readonly callerSessionId: string;
    readonly callerNodeId: string;
    readonly delegation: CrossAppInvokeRequest<Input>['delegation'];
  },
) => Output | Promise<Output>;

/** Options controlling the simulator's behavior. */
export interface InProcessCrossAppInvokerOptions {
  /** Max RFC 8693 delegation depth the simulator will accept before rejecting.
   *  Defaults to `CROSS_APP_DEFAULT_MAX_DELEGATION_DEPTH` (= 2, matching
   *  PRD-061/PRD-080). Tests may lower this to exercise the cap. */
  readonly maxDelegationDepth?: number;

  /** Simulated caller-side cost (USD) attributed to each dispatch. Default 0
   *  — tests may override to inspect budget accounting. */
  readonly simulatedCallerCostUsd?: number;

  /** When set, `capabilities().allowedTargetAppIds` returns this set exactly —
   *  overriding the default behavior of deriving it from the registered app
   *  ids. Use this to model a manifest that declares more apps than have
   *  been registered yet (or fewer, for negative tests). */
  readonly allowedTargetAppIdsOverride?: ReadonlySet<string>;

  /** Clock shim — injected for deterministic latency in tests. Defaults to
   *  `Date.now`. */
  readonly now?: () => number;

  /** Decision id generator — defaults to a monotonic counter so tests see
   *  stable synthetic ids. Supply `crypto.randomUUID` for realism. */
  readonly nextDecisionId?: () => string;
}

interface RegisteredApp {
  readonly operations: Map<string, InProcessCrossAppHandler<unknown, unknown>>;
}

interface IdempotencyRecord {
  readonly result: CrossAppInvokeResult<unknown>;
}

/** In-memory `CrossAppInvoker` implementation for tests + single-process demos.
 *
 *  Usage:
 *  ```ts
 *  const invoker = new InProcessCrossAppInvoker();
 *  invoker.registerApp('feature-dev-agent', {
 *    commission_fix: async (input, meta) => ({ pr_url: '...', effort: 'S' }),
 *  });
 *  // Pass invoker to the strategy executor at the composition root.
 *  ```
 */
export class InProcessCrossAppInvoker implements CrossAppInvoker {
  private readonly apps = new Map<string, RegisteredApp>();
  private readonly idempotencyCache = new Map<string, IdempotencyRecord>();
  private readonly maxDelegationDepth: number;
  private readonly simulatedCallerCostUsd: number;
  private readonly allowedTargetAppIdsOverride: ReadonlySet<string> | null;
  private readonly now: () => number;
  private readonly nextDecisionId: () => string;
  private decisionCounter = 0;

  constructor(options: InProcessCrossAppInvokerOptions = {}) {
    this.maxDelegationDepth =
      options.maxDelegationDepth ?? CROSS_APP_DEFAULT_MAX_DELEGATION_DEPTH;
    this.simulatedCallerCostUsd = options.simulatedCallerCostUsd ?? 0;
    this.allowedTargetAppIdsOverride =
      options.allowedTargetAppIdsOverride ?? null;
    this.now = options.now ?? (() => Date.now());
    this.nextDecisionId =
      options.nextDecisionId ??
      (() => {
        this.decisionCounter += 1;
        return `in-proc-decision-${this.decisionCounter.toString(36)}`;
      });
  }

  /**
   * Register a simulated target app with one-or-more operation handlers.
   *
   * Calling `registerApp` twice with the same `appId` merges the handler
   * tables — the second call's handlers override any colliding operation
   * names. This makes test setup incremental without forcing callers to
   * rebuild the whole app each time.
   */
  registerApp(
    appId: string,
    operations: Readonly<
      Record<string, InProcessCrossAppHandler<never, unknown>>
    >,
  ): void {
    const existing = this.apps.get(appId);
    const next: RegisteredApp = existing ?? {
      operations: new Map<string, InProcessCrossAppHandler<unknown, unknown>>(),
    };
    for (const [op, handler] of Object.entries(operations)) {
      // Cast: the handler's declared Input is `never` to accept any input at
      // the registry boundary; runtime shape is the target operation's
      // responsibility.
      next.operations.set(op, handler as InProcessCrossAppHandler<unknown, unknown>);
    }
    this.apps.set(appId, next);
  }

  /** Remove a registered app. Returns true if something was removed. */
  unregisterApp(appId: string): boolean {
    return this.apps.delete(appId);
  }

  /** Clear the idempotency cache — useful between tests. */
  clearIdempotencyCache(): void {
    this.idempotencyCache.clear();
  }

  /** List all registered app ids. Sorted for stable output in diagnostics. */
  listRegisteredAppIds(): readonly string[] {
    return [...this.apps.keys()].sort();
  }

  capabilities(): CrossAppInvokerCapabilities {
    const allowedTargetAppIds =
      this.allowedTargetAppIdsOverride ??
      new Set<string>(this.apps.keys());
    return {
      enabled: true,
      maxDelegationDepth: this.maxDelegationDepth,
      allowedTargetAppIds,
    };
  }

  async invoke<Input = unknown, Output = unknown>(
    request: CrossAppInvokeRequest<Input>,
  ): Promise<CrossAppInvokeResult<Output>> {
    // Depth cap first — cheapest to reject.
    if (request.delegation.currentDepth >= this.maxDelegationDepth) {
      throw new CrossAppDelegationDepthExceededError(
        request.delegation.currentDepth,
        this.maxDelegationDepth,
      );
    }

    // Allowlist check. Skipped when the capabilities set is explicitly empty
    // AND no override was provided (i.e. no apps registered yet) — in that
    // case the target lookup below throws `CrossAppTargetUnknownError`
    // which carries better diagnostics for the simulator case.
    const allowed =
      this.allowedTargetAppIdsOverride ??
      new Set<string>(this.apps.keys());
    if (
      this.allowedTargetAppIdsOverride !== null &&
      !allowed.has(request.targetAppId)
    ) {
      // Override present and target not in it → fail as unknown (the
      // simulator's idiomatic error for this case; compose-time enforcement
      // lives in `assertCrossAppTargetsAllowed`).
      throw new CrossAppTargetUnknownError(
        request.targetAppId,
        request.operation,
        [...allowed].sort(),
      );
    }

    // Idempotency short-circuit: same (target, op, key) → return first result.
    const idempotencyCacheKey = request.idempotencyKey
      ? `${request.targetAppId}::${request.operation}::${request.idempotencyKey}`
      : null;
    if (idempotencyCacheKey !== null) {
      const cached = this.idempotencyCache.get(idempotencyCacheKey);
      if (cached) {
        return cached.result as CrossAppInvokeResult<Output>;
      }
    }

    // Lookup target app + operation.
    const app = this.apps.get(request.targetAppId);
    if (!app) {
      throw new CrossAppTargetUnknownError(
        request.targetAppId,
        request.operation,
        this.listRegisteredAppIds(),
      );
    }
    const handler = app.operations.get(request.operation);
    if (!handler) {
      throw new CrossAppTargetUnknownError(
        request.targetAppId,
        request.operation,
        this.listRegisteredAppIds(),
      );
    }

    const targetDecisionId = this.nextDecisionId();
    const startedAt = this.now();

    // Optional timeout — if the handler runs longer than timeoutMs, surface
    // as a target error (mirrors how the live adapter would surface an HTTP
    // timeout).
    const invocation = Promise.resolve().then(() =>
      handler(request.input as unknown, {
        targetAppId: request.targetAppId,
        operation: request.operation,
        targetDecisionId,
        callerSessionId: request.caller.sessionId,
        callerNodeId: request.caller.nodeId,
        delegation: request.delegation,
      }),
    );

    let rawOutput: unknown;
    try {
      if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
        rawOutput = await withTimeout(
          invocation,
          request.timeoutMs,
          request.targetAppId,
          request.operation,
        );
      } else {
        rawOutput = await invocation;
      }
    } catch (cause) {
      // Failure isolation (G-FAILURE-ISOLATION): wrap the throw so the
      // strategy executor sees a typed, caller-local error. The executor's
      // gate/retry machinery resolves this as a node failure; it never
      // propagates as an unhandled exception.
      throw new CrossAppTargetError(
        request.targetAppId,
        request.operation,
        targetDecisionId,
        cause,
      );
    }

    const latencyMs = Math.max(0, this.now() - startedAt);
    const result: CrossAppInvokeResult<Output> = {
      output: rawOutput as Output,
      targetDecisionId,
      latencyMs,
      callerCostUsd: this.simulatedCallerCostUsd,
    };

    if (idempotencyCacheKey !== null) {
      this.idempotencyCache.set(idempotencyCacheKey, {
        result: result as CrossAppInvokeResult<unknown>,
      });
    }

    return result;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  targetAppId: string,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Cross-app invocation to "${targetAppId}.${operation}" timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
