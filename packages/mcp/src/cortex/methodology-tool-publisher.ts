/**
 * @method/mcp — `MethodologyToolPublisher` (PRD-066 Track A, S9 §5.3).
 *
 * Composition-root-only. Composes a `MethodologySource` view with a
 * `CortexToolRegistrationClient` to keep the Cortex registry in sync
 * with the loaded methodology set.
 *
 * **G-PORT invariant:** this module is referenced ONLY from the
 * `@method/mcp` composition root (`index.ts`'s `main()`). It MUST NOT be
 * referenced from any `CallToolRequestSchema` handler path. The
 * architecture test in `architecture.test.ts` (G-NO-RUNTIME-DISCOVERY)
 * enforces this by grep.
 *
 * **Track A behavior:**
 *   - `publishAll()` in `'manifest'` mode: no-op verifier. Logs that the
 *     tenant app is operating under Model A (deploy-time `spec.tools[]`
 *     hand-curated from methodology YAML). Does NOT call the client.
 *   - `publishAll()` in `'dynamic'` mode: emits a single warn explaining
 *     dynamic mode is Track B (blocked on O5) and degrades to a no-op.
 *   - `publishMethodology`, `retractMethodology`: reserved for Track B;
 *     throw `NotImplementedError` tied to O5/O7.
 *   - `dispose()`: clears internal state. With `retractAll: true` in
 *     Track A, still a no-op (nothing was published).
 *
 * **Track B behavior (DEFERRED — PRD-066 §12 CORTEX-Q1/Q2/Q3):**
 *   - Subscribe to `MethodologySource.onChange`, diff, upsert + retract.
 */

import type {
  CreateMethodologyToolPublisherOptions,
  PublishReport,
  RetractionResult,
} from "./types.js";
import { NotImplementedError } from "./types.js";

export interface MethodologyToolPublisher {
  /**
   * Initial sync. In Track A manifest mode this is a no-op verifier;
   * dynamic mode is Track B and also degrades to a warn-logged no-op.
   */
  publishAll(): Promise<ReadonlyArray<PublishReport>>;

  /** Publish or re-publish a single methodology. Track B. */
  publishMethodology(methodologyId: string): Promise<PublishReport>;

  /** Retract every tool in the given methodology. Track B. */
  retractMethodology(methodologyId: string): Promise<RetractionResult>;

  /** Dispose: clears handlers; optionally retract all (Track B). */
  dispose(options?: { readonly retractAll?: boolean }): Promise<void>;
}

/**
 * Construct the publisher. Track A: manifest mode is the default shape;
 * dynamic mode is accepted but logs a one-time "blocked on O5" warning
 * because the underlying client throws on publish until Track B.
 */
export function createMethodologyToolPublisher(
  options: CreateMethodologyToolPublisherOptions,
): MethodologyToolPublisher {
  const { client: _client, methodologySource, mode, manifestTools, ctxLog } =
    options;

  if (mode === "manifest" && !manifestTools) {
    throw new Error(
      "createMethodologyToolPublisher: mode='manifest' requires manifestTools (hand-curated spec.tools[] from cortex-app.yaml). " +
        "See PRD-066 §7.7 Model A.",
    );
  }

  let disposed = false;
  let dynamicWarned = false;

  return {
    async publishAll(): Promise<ReadonlyArray<PublishReport>> {
      if (disposed) {
        throw new Error("MethodologyToolPublisher already disposed");
      }

      const methodologies = await methodologySource.list();

      if (mode === "manifest") {
        ctxLog?.info?.(
          "MethodologyToolPublisher: manifest mode — operating under Model A " +
            "(deploy-time cortex-app.yaml spec.tools[]). publishAll is a no-op.",
          {
            methodologyCount: methodologies.length,
            manifestToolCount: manifestTools?.length ?? 0,
          },
        );
        return methodologies.map((m) => ({
          methodologyId: m.id,
          toolsPublished: 0,
          toolsRetracted: 0,
          policySuggestionsEmitted: 0,
          state: "active" as const,
        }));
      }

      // mode === 'dynamic' — Track B, blocked on Cortex O5.
      if (!dynamicWarned) {
        dynamicWarned = true;
        ctxLog?.warn?.(
          "MethodologyToolPublisher: dynamic mode is Track B and blocked on Cortex O5 " +
            "(runtime tool registration). Falling back to no-op. See PRD-066 §12 CORTEX-Q1.",
        );
      }
      return methodologies.map((m) => ({
        methodologyId: m.id,
        toolsPublished: 0,
        toolsRetracted: 0,
        policySuggestionsEmitted: 0,
        state: "pending-approval" as const,
      }));
    },

    async publishMethodology(_methodologyId: string): Promise<PublishReport> {
      throw new NotImplementedError(
        "Track B: blocked on Cortex O5 (runtime tool registration). " +
          "See PRD-066 §12 CORTEX-Q1.",
      );
    },

    async retractMethodology(_methodologyId: string): Promise<RetractionResult> {
      throw new NotImplementedError(
        "Track B: blocked on Cortex O7 (DELETE verb). " +
          "See PRD-066 §12 CORTEX-Q3.",
      );
    },

    async dispose(_opts?: { readonly retractAll?: boolean }): Promise<void> {
      // Track A: nothing to retract because nothing was published.
      disposed = true;
    },
  };
}
