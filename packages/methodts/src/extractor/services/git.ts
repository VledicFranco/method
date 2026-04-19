// SPDX-License-Identifier: Apache-2.0
/**
 * GitService — Effect Layer for git operations.
 *
 * Built on CommandService, providing typed git operations (log, diff, branch, status).
 * Error mapping converts CommandError to GitError with operation context.
 *
 * PRD Component 8: Extractor framework — git integration.
 * DR-T02: Effect is the primary side-effect mechanism.
 */

import { Context, Effect, Layer } from "effect";
import { CommandService } from "./command.js";

/**
 * Error produced when a git operation fails.
 *
 * The `operation` field identifies which git command failed (e.g., "log", "diff"),
 * enabling structured error handling at the methodology level.
 */
export type GitError = {
  readonly _tag: "GitError";
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
};

/**
 * Service interface for git operations.
 *
 * All git interaction in the extractor framework goes through this service,
 * which delegates to CommandService for actual command execution.
 */
export interface GitService {
  /** Get the git log as oneline format. Defaults to 10 entries. */
  readonly log: (n?: number) => Effect.Effect<string, GitError, never>;
  /** Get the diff output, optionally against a ref. */
  readonly diff: (ref?: string) => Effect.Effect<string, GitError, never>;
  /** Get the current branch name (trimmed). */
  readonly branch: () => Effect.Effect<string, GitError, never>;
  /** Get porcelain status output. */
  readonly status: () => Effect.Effect<string, GitError, never>;
}

/**
 * Effect Context tag for GitService.
 *
 * Used in Layer composition to provide/require GitService.
 */
export const GitService = Context.GenericTag<GitService>("GitService");

/**
 * Live implementation of GitService.
 *
 * Delegates to CommandService for all git command execution.
 * Maps CommandError to GitError with operation context.
 */
export const GitServiceLive = Layer.effect(
  GitService,
  Effect.gen(function* () {
    const cmd = yield* CommandService;
    return {
      log: (n = 10) =>
        cmd.exec("git", ["log", "--oneline", `-${n}`]).pipe(
          Effect.map((r) => r.stdout),
          Effect.mapError((e) => ({
            _tag: "GitError" as const,
            operation: "log",
            message: e.message,
          })),
        ),
      diff: (ref) =>
        cmd.exec("git", ref ? ["diff", ref] : ["diff"]).pipe(
          Effect.map((r) => r.stdout),
          Effect.mapError((e) => ({
            _tag: "GitError" as const,
            operation: "diff",
            message: e.message,
          })),
        ),
      branch: () =>
        cmd.exec("git", ["branch", "--show-current"]).pipe(
          Effect.map((r) => r.stdout.trim()),
          Effect.mapError((e) => ({
            _tag: "GitError" as const,
            operation: "branch",
            message: e.message,
          })),
        ),
      status: () =>
        cmd.exec("git", ["status", "--porcelain"]).pipe(
          Effect.map((r) => r.stdout),
          Effect.mapError((e) => ({
            _tag: "GitError" as const,
            operation: "status",
            message: e.message,
          })),
        ),
    };
  }),
);
