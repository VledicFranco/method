/**
 * CortexTokenExchangeMiddleware — RFC 8693 token exchange for every
 * agent invocation, plus depth-capped sub-agent delegation per RFC-005
 * §4.1.5.
 *
 * Wraps pacta invoke at the OUTERMOST cortex-layer position (S3 §6.7,
 * PRD-059 §6.7). At wrap time:
 *   1. Reads `request.metadata.parentUserToken` (the user-scoped JWT
 *      the caller forwarded in).
 *   2. Calls `ctx.auth.exchange(...)` to produce an agent-scoped
 *      `ScopedToken`.
 *   3. Attaches the result to `request.metadata.__cortexDelegatedToken`
 *      so all inner middleware + the LLM provider can see it.
 *
 * `exchangeForSubAgent(parent, childAppId, childScope)` is the depth
 * gate (Gate `G-TOKEN-DEPTH-CAP`): at `actAs.length >= 2`, throws
 * {@link CortexDelegationDepthExceededError} WITHOUT calling
 * `ctx.auth.exchange`. Server-side also enforces — client-side
 * fail-fast saves a wasted round-trip (RFC-005 §4.1.5 Wave 0).
 *
 * Related:
 *   - S3 §5 (`fcd-surface-cortex-service-adapters/decision.md`)
 *   - PRD-059 §Gates, §Success Criteria SC-05
 *   - t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md §4.1.5
 */

import type { Pact, AgentRequest, AgentResult } from '@method/pacta';
import {
  CortexAdapterComposeError,
  type ComposedAdapter,
  type CortexServiceAdapter,
  type CtxSlice,
} from './adapter.js';
import type {
  ActAsEntry,
  CortexAuthCtx,
  ScopedToken,
  TokenExchangeRequest,
} from './ctx-types.js';

// ── Constants ─────────────────────────────────────────────────────

/** RFC-005 §4.1.5 Wave 0 cap. */
export const MAX_DELEGATION_DEPTH = 2;

// ── Config ────────────────────────────────────────────────────────

export interface CortexTokenExchangeConfig {
  /** The appId requesting the exchange — becomes the `audience` claim. */
  readonly appId: string;
  /**
   * Narrow the user's scope list for the agent. Must return a subset —
   * escalation is rejected server-side too, but this client-side
   * pre-check lets us fail fast.
   */
  readonly narrowScope: (userScope: ReadonlyArray<string>, pact: Pact<unknown>) => ReadonlyArray<string>;
  /** Optional exchanged-token TTL override, bounded by server policy. */
  readonly ttlSeconds?: number;
}

// ── Error types ───────────────────────────────────────────────────

export class CortexDelegationDepthExceededError extends Error {
  readonly depth: number;
  readonly max = MAX_DELEGATION_DEPTH;

  constructor(depth: number) {
    super(
      `Token delegation depth ${depth} exceeds max ${MAX_DELEGATION_DEPTH}`,
    );
    this.name = 'CortexDelegationDepthExceededError';
    this.depth = depth;
  }
}

export class CortexSubjectUnauthorizedError extends Error {
  readonly subjectSub: string | undefined;

  constructor(subjectSub: string | undefined, reason: string) {
    super(`Subject unauthorized for token exchange: ${reason}`);
    this.name = 'CortexSubjectUnauthorizedError';
    this.subjectSub = subjectSub;
  }
}

export class CortexScopeEscalationError extends Error {
  readonly requestedScope: ReadonlyArray<string>;
  readonly allowedScope: ReadonlyArray<string>;

  constructor(requested: ReadonlyArray<string>, allowed: ReadonlyArray<string>) {
    super(
      `Scope escalation rejected: requested ${requested.length} beyond allowed`,
    );
    this.name = 'CortexScopeEscalationError';
    this.requestedScope = requested;
    this.allowedScope = allowed;
  }
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Parse the `act_as` chain from a ScopedToken. The caller may present
 * tokens whose `.actAs` is precomputed (structural Cortex SDK case) or
 * whose raw JWT needs decoding (legacy callers). We support both.
 */
export function parseActChain(token: ScopedToken): ReadonlyArray<ActAsEntry> {
  if (Array.isArray(token.actAs)) return token.actAs;
  return [];
}

function ensureScopeSubset(
  requested: ReadonlyArray<string>,
  allowed: ReadonlyArray<string>,
): void {
  const allowedSet = new Set(allowed);
  const escalated = requested.filter(s => !allowedSet.has(s));
  if (escalated.length > 0) {
    throw new CortexScopeEscalationError(requested, allowed);
  }
}

// ── Composed form ────────────────────────────────────────────────

type InvokeFn<T> = (pact: Pact<T>, request: AgentRequest) => Promise<AgentResult<T>>;

export interface ComposedCortexTokenExchangeMiddleware
  extends ComposedAdapter<Pact<unknown>> {
  readonly name: 'cortex-token-exchange';
  wrap<T>(inner: InvokeFn<T>): InvokeFn<T>;
  /**
   * Produce an exchanged token for a child agent. Depth-capped; throws
   * {@link CortexDelegationDepthExceededError} without calling
   * `ctx.auth.exchange` when `actAs.length >= MAX_DELEGATION_DEPTH`.
   */
  exchangeForSubAgent(
    parentToken: ScopedToken,
    childAppId: string,
    childScope: ReadonlyArray<string>,
  ): Promise<ScopedToken>;
}

// ── Factory ───────────────────────────────────────────────────────

const ADAPTER_NAME = 'cortex-token-exchange' as const;
const SUBJECT_TOKEN_TYPE_JWT = 'urn:ietf:params:oauth:token-type:jwt';

export function cortexTokenExchangeMiddleware(
  config: CortexTokenExchangeConfig,
): CortexServiceAdapter<
  { auth: CortexAuthCtx },
  Pact<unknown>,
  CortexTokenExchangeConfig
> {
  return {
    name: ADAPTER_NAME,

    compose(args: {
      ctx: { auth: CortexAuthCtx };
      pact: Pact<unknown>;
      config?: CortexTokenExchangeConfig;
    }): ComposedCortexTokenExchangeMiddleware {
      const effectiveConfig = args.config ?? config;
      const ctxAuth = args.ctx?.auth;

      if (!ctxAuth) {
        throw new CortexAdapterComposeError(ADAPTER_NAME, 'missing_ctx_service', {
          service: 'auth',
        });
      }
      if (!effectiveConfig?.appId || typeof effectiveConfig.appId !== 'string') {
        throw new CortexAdapterComposeError(ADAPTER_NAME, 'invalid_config', {
          field: 'appId',
        });
      }
      if (typeof effectiveConfig.narrowScope !== 'function') {
        throw new CortexAdapterComposeError(ADAPTER_NAME, 'invalid_config', {
          field: 'narrowScope',
        });
      }

      // ── exchangeForSubAgent (depth gate) ─────────────────────────
      async function exchangeForSubAgent(
        parentToken: ScopedToken,
        childAppId: string,
        childScope: ReadonlyArray<string>,
      ): Promise<ScopedToken> {
        const chain = parseActChain(parentToken);
        const depth = chain.length;

        // G-TOKEN-DEPTH-CAP: hard reject without calling ctx.auth.exchange.
        if (depth >= MAX_DELEGATION_DEPTH) {
          throw new CortexDelegationDepthExceededError(depth);
        }

        // Scope narrowing: server-side also enforces, but fail fast.
        ensureScopeSubset(childScope, parentToken.scope);

        const req: TokenExchangeRequest = {
          subjectTokenType: SUBJECT_TOKEN_TYPE_JWT,
          subjectToken: parentToken.token,
          actorTokenType: SUBJECT_TOKEN_TYPE_JWT,
          actorToken: parentToken.token, // chain: parent becomes actor for child
          audience: childAppId,
          scope: childScope.join(' '),
          requestedTokenType: SUBJECT_TOKEN_TYPE_JWT,
          ttlSeconds: effectiveConfig.ttlSeconds,
        };
        return ctxAuth.exchange(req);
      }

      // ── wrap (per-invocation user → agent exchange) ──────────────
      function wrap<T>(inner: InvokeFn<T>): InvokeFn<T> {
        return async (pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> => {
          const parentUserToken = request.metadata?.parentUserToken as
            | string
            | undefined;

          // If no parent token is present, the agent is running in a
          // non-user-initiated path (batch, cron, self-host) and this
          // middleware is a no-op — exchange is skipped.
          if (!parentUserToken) {
            return inner(pact, request);
          }

          // Derive narrowed scope from the user's scope hint (if present).
          const userScope: ReadonlyArray<string> =
            (request.metadata?.parentUserScope as ReadonlyArray<string> | undefined) ?? [];
          const narrowed = effectiveConfig.narrowScope(userScope, pact as Pact<unknown>);
          ensureScopeSubset(narrowed, userScope);

          const exchangeReq: TokenExchangeRequest = {
            subjectTokenType: SUBJECT_TOKEN_TYPE_JWT,
            subjectToken: parentUserToken,
            actorTokenType: SUBJECT_TOKEN_TYPE_JWT,
            actorToken: ctxAuth.serviceAccountToken,
            audience: effectiveConfig.appId,
            scope: narrowed.join(' '),
            requestedTokenType: SUBJECT_TOKEN_TYPE_JWT,
            ttlSeconds: effectiveConfig.ttlSeconds,
          };

          const delegated = await ctxAuth.exchange(exchangeReq);

          // Propagate into metadata so inner middleware + the LLM provider
          // can pick it up. Opaque key — documented in S3 §5.1.
          const wrappedMeta: Record<string, unknown> = {
            ...(request.metadata ?? {}),
            __cortexDelegatedToken: delegated,
          };
          const wrappedRequest: AgentRequest = { ...request, metadata: wrappedMeta };

          return inner(pact, wrappedRequest);
        };
      }

      return {
        name: ADAPTER_NAME,
        requires: ['auth'] as ReadonlyArray<keyof CtxSlice>,
        pact: args.pact,
        wrap,
        exchangeForSubAgent,
      };
    },
  };
}
