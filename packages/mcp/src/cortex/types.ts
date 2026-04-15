/**
 * @method/mcp — Cortex transport types (PRD-066 Track A, S9 §5.2).
 *
 * Payload, result, and option types for `CortexToolRegistrationClient`
 * and `MethodologyToolPublisher`. Structural-only — no runtime value
 * imports from `@cortex/*` (enforced by G-LAYER). `@modelcontextprotocol/sdk`
 * is never imported from this subtree (G-BOUNDARY).
 *
 * Frozen shape per S9 §5.2.
 */

// ── Cortex operation + tool shapes ───────────────────────────────────────────

export interface CortexOperationDef {
  readonly name: string;
  readonly description: string;
  readonly transport: "mcp-tool" | "http" | "agent-operation";
  readonly write?: boolean;
  /** Scope discriminator used for batched retract. NOT part of RFC-005. */
  readonly scope?: { readonly methodologyId: string };
}

export interface CortexToolDescriptor {
  readonly name: string;
  readonly operation: string;
  readonly displayName?: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
}

// ── Registration payload + results ───────────────────────────────────────────

export interface ToolRegistrationPayload {
  readonly operations: ReadonlyArray<CortexOperationDef>;
  readonly tools: ReadonlyArray<CortexToolDescriptor>;
  /** Suggested Layer-2 default_policy. Publisher emits; admin approves. */
  readonly suggestedPolicy?: ReadonlyArray<{
    readonly role: string;
    readonly operations: ReadonlyArray<string>;
  }>;
}

export interface RegistrationResult {
  readonly registered: number;
  readonly updated: number;
  readonly deprecated: number;
  /** Cortex decision: 'active' | 'pending-approval' (RFC-005 §3.4.4). */
  readonly state: "active" | "pending-approval";
  readonly requestId: string;
}

export interface RetractionResult {
  readonly retracted: number;
  readonly notFound: number;
}

export interface RegistrationSnapshot {
  readonly toolNames: ReadonlyArray<string>;
  readonly operationNames: ReadonlyArray<string>;
  readonly byMethodology: Readonly<Record<string, ReadonlyArray<string>>>;
}

// ── Context shape (structural, NOT imported from @cortex/*) ──────────────────

/**
 * Structural subset of `CortexCtx` the client depends on. Full shape is
 * defined by S1 (`CortexAuthFacade`); this type narrows to only what S9
 * reads, so S9 never transitively pulls `@cortex/*` into mcp.
 */
export interface CortexRegistrationCtx {
  readonly app: { readonly id: string };
  readonly auth: {
    /**
     * S1 additive amendment (optional on S1). S9 REQUIRES it — absence
     * throws `MissingCtxError` at client construction.
     */
    readonly issueServiceToken?: (
      scope: ReadonlyArray<string>,
    ) => Promise<{ readonly token: string; readonly expiresAt: number }>;
  };
  readonly log?: {
    readonly info: (msg: string, fields?: object) => void;
    readonly warn: (msg: string, fields?: object) => void;
    readonly error: (msg: string, fields?: object) => void;
  };
}

export interface CreateCortexToolRegistrationClientOptions {
  readonly ctx: CortexRegistrationCtx;
  /** e.g. 'https://cortex.t1.local' */
  readonly baseUrl: string;
  /** Injectable fetch for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  readonly retryBudget?: {
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
  };
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * Thrown at construction time when `ctx.auth.issueServiceToken` is absent.
 * Fail-closed — no env-var fallback, no unauthenticated mode.
 */
export class MissingCtxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingCtxError";
  }
}

/**
 * Placeholder thrown by Track B client methods until Cortex answers the
 * open questions O5 (runtime update verb), O6 (service token + auto
 * approval), and O7 (DELETE verb). Keeping these as typed errors rather
 * than silent stubs ensures that any caller reaching them in Track A
 * fails loudly. See PRD-066 §12 CORTEX-Q1/Q2/Q3 for resolution.
 */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

// ── Publisher surface options ────────────────────────────────────────────────

/**
 * Minimal structural view of `MethodologySource` (S7) the publisher
 * consumes in Track A — only `list` is required. `onChange` is part of
 * S7 but is Track B (dynamic registration). Publisher never reaches into
 * S7 beyond this interface.
 */
export interface MethodologySourceView {
  /** List methodology ids currently exposed by the source. */
  list(): Promise<ReadonlyArray<{ readonly id: string }>>;
  /**
   * Fetch a methodology's registration payload. In Track A this is only
   * called by `publishAll` when a manifest tool set is not preconfigured.
   * Throws if the methodology id is unknown.
   */
  getRegistrationPayload?(
    methodologyId: string,
  ): Promise<ToolRegistrationPayload>;
}

export interface PublishReport {
  readonly methodologyId: string;
  readonly toolsPublished: number;
  readonly toolsRetracted: number;
  readonly policySuggestionsEmitted: number;
  readonly state: "active" | "pending-approval";
}

export interface CreateMethodologyToolPublisherOptions {
  readonly client: import("./cortex-tool-registration-client.js").CortexToolRegistrationClient;
  readonly methodologySource: MethodologySourceView;
  /**
   * Manifest mode (Track A / Model A default): `publishAll` is a verifier
   * or no-op; all tools are hand-curated in `cortex-app.yaml spec.tools[]`.
   * Dynamic mode is Track B — reserved.
   */
  readonly mode: "manifest" | "dynamic";
  /** Required when `mode === 'manifest'`: the tools statically declared in cortex-app.yaml. */
  readonly manifestTools?: ReadonlyArray<CortexToolDescriptor>;
  readonly ctxLog?: CortexRegistrationCtx["log"];
}
