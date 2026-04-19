// SPDX-License-Identifier: Apache-2.0
/**
 * httpChecker — gate runner that performs an HTTP GET check.
 *
 * Fetches a URL and validates response status and/or body content.
 * Accepts an optional fetch function for testability.
 *
 * @see PRD 021 Component 7 — httpChecker gate runner
 */

import { Effect } from "effect";
import type { Gate, GateResult, GateError } from "../gate.js";
import { gateError } from "../gate.js";
import { TRUE } from "../../predicate/predicate.js";

/** Expected conditions for the HTTP check. */
export type HttpExpectation = {
  /** Expected HTTP status code (default: 200). */
  readonly status?: number;
  /** String that must appear in the response body. */
  readonly bodyContains?: string;
};

/**
 * Minimal fetch signature for dependency injection.
 *
 * Matches the subset of the global `fetch` API that httpChecker needs.
 */
export type FetchFn = (url: string) => Promise<{ status: number; text: () => Promise<string> }>;

/**
 * Create a Gate that performs an HTTP GET and validates the response.
 *
 * The gate passes when:
 * - The response status matches `expected.status` (default 200), AND
 * - If `expected.bodyContains` is set, the response body includes that string.
 *
 * @param id - Unique identifier for this gate
 * @param url - URL to GET
 * @param expected - Expected response conditions
 * @param fetchFn - Optional fetch implementation (defaults to global fetch)
 * @returns A Gate whose evaluate function performs the HTTP check
 */
export function httpChecker<S>(
  id: string,
  url: string,
  expected: HttpExpectation,
  fetchFn?: FetchFn,
): Gate<S> {
  const doFetch: FetchFn = fetchFn ?? ((url) => globalThis.fetch(url).then(r => ({ status: r.status, text: () => r.text() })));
  const expectedStatus = expected.status ?? 200;

  return {
    id,
    description: `HTTP check: ${url}`,
    predicate: TRUE,
    maxRetries: 0,
    evaluate: (_state: S): Effect.Effect<GateResult<S>, GateError, never> =>
      Effect.gen(function* () {
        const start = Date.now();

        const response = yield* Effect.tryPromise({
          try: () => doFetch(url),
          catch: (cause) => gateError(id, `HTTP request failed: ${String(cause)}`, cause),
        });

        const statusOk = response.status === expectedStatus;
        let bodyOk = true;
        let body = "";

        if (expected.bodyContains !== undefined) {
          body = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: (cause) => gateError(id, `Failed to read response body: ${String(cause)}`, cause),
          });
          bodyOk = body.includes(expected.bodyContains);
        }

        const passed = statusOk && bodyOk;
        const reasons: string[] = [];

        if (!statusOk) {
          reasons.push(`Expected status ${expectedStatus}, got ${response.status}`);
        }
        if (!bodyOk) {
          reasons.push(`Body does not contain: "${expected.bodyContains}"`);
        }

        return {
          passed,
          witness: null,
          reason: passed
            ? `HTTP check passed: ${url}`
            : reasons.join("; "),
          feedback: passed ? undefined : (body || `Status: ${response.status}`),
          duration_ms: Date.now() - start,
        } satisfies GateResult<S>;
      }),
  };
}
