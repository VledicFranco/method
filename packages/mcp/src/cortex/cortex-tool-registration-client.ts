/**
 * @method/mcp — `CortexToolRegistrationClient` (PRD-066 Track A, S9 §5.2).
 *
 * Typed HTTP client for Cortex's platform tool registry. The client owns
 * the HTTP envelope (URL composition, auth header, retry budget) and
 * knows NOTHING about methodology semantics — that is the publisher's
 * job.
 *
 * **Track A scope** (ships now):
 *   - Constructor validates `ctx.auth.issueServiceToken` presence
 *     (throws `MissingCtxError` otherwise — fail-closed, no env-var
 *     fallback, no unauthenticated mode).
 *   - The client surface (`replaceAll`, `publish`, `retract`, `list`)
 *     is defined and frozen.
 *
 * **Track B** (BLOCKED on Cortex O5/O6/O7 — see PRD-066 §12):
 *   - Each method throws `NotImplementedError` with a reference to the
 *     corresponding open question. Plugging in HTTP bodies is a pure
 *     implementation swap once Cortex answers; the surface does not
 *     change.
 *   - Blocked items:
 *       * `replaceAll`, `publish`    — blocked on O5 (runtime registration)
 *       * `retract`                  — blocked on O7 (DELETE verb)
 *       * `list`                     — blocked on O5 (read verb confirmation)
 *
 * Allowed by mission §7 "placeholder" rule because each stub is tied to
 * a specific roadmap O-code follow-up.
 */

import type {
  CreateCortexToolRegistrationClientOptions,
  RegistrationResult,
  RegistrationSnapshot,
  RetractionResult,
  ToolRegistrationPayload,
} from "./types.js";
import { MissingCtxError, NotImplementedError } from "./types.js";

export interface CortexToolRegistrationClient {
  /**
   * Bootstrap: replace the full tool+operation set for this app.
   * Idempotent on the Cortex side.
   */
  replaceAll(payload: ToolRegistrationPayload): Promise<RegistrationResult>;

  /**
   * Publish (upsert) a named batch — typically all tools for ONE
   * methodology. Scope discriminator is emitted automatically by the
   * publisher.
   */
  publish(
    methodologyId: string,
    payload: ToolRegistrationPayload,
  ): Promise<RegistrationResult>;

  /**
   * Remove a batch. `methodologyId` is the same discriminator used on
   * `publish`. No-op if the batch is absent.
   */
  retract(methodologyId: string): Promise<RetractionResult>;

  /** Probe current registry state — used at startup for reconciliation. */
  list(): Promise<RegistrationSnapshot>;
}

/**
 * Construct a `CortexToolRegistrationClient`. Track A shape — the client
 * surface is frozen; HTTP bodies land when Track B unblocks (O5/O6/O7).
 *
 * @throws {MissingCtxError} when `ctx.auth.issueServiceToken` is absent.
 */
export function createCortexToolRegistrationClient(
  options: CreateCortexToolRegistrationClientOptions,
): CortexToolRegistrationClient {
  const { ctx, baseUrl } = options;

  if (typeof ctx?.auth?.issueServiceToken !== "function") {
    throw new MissingCtxError(
      "CortexToolRegistrationClient requires ctx.auth.issueServiceToken (S1 amendment). " +
        "No env-var fallback. See PRD-066 §7.6 and S1 §4.1.",
    );
  }

  if (!baseUrl) {
    throw new Error(
      "CortexToolRegistrationClient requires baseUrl (e.g. 'http://cortex.t1.local')",
    );
  }

  // Track A — surface frozen. The HTTP implementation is deferred to
  // Track B once Cortex resolves O5/O6/O7. Each method below is an
  // explicit placeholder pinned to an O-code so a caller that reaches
  // it in Track A fails loudly rather than silently registering.

  return {
    async replaceAll(_payload: ToolRegistrationPayload): Promise<RegistrationResult> {
      throw new NotImplementedError(
        "Track B: blocked on Cortex O5 (runtime tool registration verb). " +
          "See PRD-066 §12 CORTEX-Q1. Track A uses Model A (deploy-time manifest).",
      );
    },

    async publish(
      _methodologyId: string,
      _payload: ToolRegistrationPayload,
    ): Promise<RegistrationResult> {
      throw new NotImplementedError(
        "Track B: blocked on Cortex O5 (runtime tool registration verb). " +
          "See PRD-066 §12 CORTEX-Q1.",
      );
    },

    async retract(_methodologyId: string): Promise<RetractionResult> {
      throw new NotImplementedError(
        "Track B: blocked on Cortex O7 (DELETE verb for tool deregistration). " +
          "See PRD-066 §12 CORTEX-Q3.",
      );
    },

    async list(): Promise<RegistrationSnapshot> {
      throw new NotImplementedError(
        "Track B: blocked on Cortex O5 (endpoint read verb). " +
          "See PRD-066 §12 CORTEX-Q1.",
      );
    },
  };
}
