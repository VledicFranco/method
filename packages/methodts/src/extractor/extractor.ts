// SPDX-License-Identifier: Apache-2.0
/**
 * Extractor<A, R> — Produces a value of type A from the real world.
 *
 * An Extractor is an Effect that reads external state (files, git, environment)
 * and yields a typed value. Extractors are the bridge between the real world
 * and the formal methodology state.
 *
 * PRD Component 8: Extractor framework.
 * DR-T02: Effect is the primary side-effect mechanism.
 */

import type { Effect } from "effect";

/**
 * An extractor produces a value of type A from the real world.
 *
 * The R parameter captures required services (e.g., CommandService, GitService).
 * When R is `never`, the extractor has no service requirements.
 */
export type Extractor<A, R = never> = Effect.Effect<A, ExtractionError, R>;

/**
 * Error produced when an extraction fails.
 *
 * The `key` field identifies which extraction target failed (e.g., "git-branch",
 * "file-content"), enabling structured error reporting in step context assembly.
 */
export type ExtractionError = {
  readonly _tag: "ExtractionError";
  readonly key: string;
  readonly message: string;
  readonly cause?: unknown;
};
