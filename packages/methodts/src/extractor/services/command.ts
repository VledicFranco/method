// SPDX-License-Identifier: Apache-2.0
/**
 * CommandService — Effect Layer for executing shell commands.
 *
 * Provides a testable abstraction over child_process execution.
 * Live implementation is stubbed for Phase 1b; the test layer
 * supports configurable mock responses for deterministic testing.
 *
 * PRD Component 8: Extractor framework — service layer.
 * DR-T02: Effect is the primary side-effect mechanism.
 */

import { Context, Effect, Layer } from "effect";

/**
 * Error produced when a command execution fails.
 *
 * Captures the command string, a human-readable message,
 * and optionally the exit code and underlying cause.
 */
export type CommandError = {
  readonly _tag: "CommandError";
  readonly command: string;
  readonly message: string;
  readonly exitCode?: number;
  readonly cause?: unknown;
};

/**
 * Service interface for executing shell commands.
 *
 * All command execution in the extractor framework goes through this service,
 * enabling both live execution and deterministic test mocks.
 */
export interface CommandService {
  /** Execute a shell command with optional arguments. */
  readonly exec: (
    command: string,
    args?: string[],
  ) => Effect.Effect<{ stdout: string; exitCode: number }, CommandError, never>;
}

/**
 * Effect Context tag for CommandService.
 *
 * Used in Layer composition to provide/require CommandService.
 */
export const CommandService = Context.GenericTag<CommandService>("CommandService");

/**
 * Live implementation of CommandService.
 *
 * Stub for Phase 1b — actual child_process execution will be implemented
 * when the runtime integration layer is built.
 */
export const CommandServiceLive = Layer.succeed(CommandService, {
  exec: (command, _args) =>
    Effect.fail({
      _tag: "CommandError" as const,
      command,
      message: "Live exec not yet implemented",
    }),
});

/**
 * Test implementation of CommandService with configurable responses.
 *
 * Looks up responses by the full command string (command + args joined by spaces).
 * Falls back to matching by command name alone if no full-key match exists.
 *
 * @param responses - Map from command key to expected response
 * @returns A Layer providing CommandService with mock behavior
 */
export const CommandServiceTest = (
  responses: Record<string, { stdout: string; exitCode: number }>,
) =>
  Layer.succeed(CommandService, {
    exec: (command, args) => {
      const key = args ? `${command} ${args.join(" ")}` : command;
      const resp = responses[key] ?? responses[command];
      if (resp) return Effect.succeed(resp);
      return Effect.fail({
        _tag: "CommandError" as const,
        command,
        message: `No mock response for: ${key}`,
      });
    },
  });
