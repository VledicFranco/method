/**
 * testRunner — gate runner that executes a shell command.
 *
 * Exit code 0 = pass, non-zero = fail.
 * Accepts a CommandService instance directly (dependency injection)
 * to keep Gate's R parameter as `never`.
 *
 * @see PRD 021 Component 7 — testRunner gate runner
 */

import { Effect } from "effect";
import type { CommandService } from "../../extractor/services/command.js";
import type { Gate, GateResult, GateError } from "../gate.js";
import { TRUE } from "../../predicate/predicate.js";

/**
 * Create a Gate that runs a shell command via CommandService.
 *
 * The gate passes when the command exits with code 0.
 * On non-zero exit, the gate fails and includes stdout as feedback.
 *
 * @param id - Unique identifier for this gate
 * @param command - The shell command to execute
 * @param cmdService - A CommandService instance (injected, not from Effect context)
 * @param args - Optional command arguments
 * @returns A Gate whose evaluate function runs the command
 */
export function testRunner<S>(
  id: string,
  command: string,
  cmdService: CommandService,
  args?: string[],
): Gate<S> {
  return {
    id,
    description: `Test runner: ${command}`,
    predicate: TRUE,
    maxRetries: 0,
    evaluate: (_state: S): Effect.Effect<GateResult<S>, GateError, never> =>
      Effect.gen(function* () {
        const start = Date.now();
        const result = yield* cmdService.exec(command, args).pipe(
          Effect.catchAll((err) =>
            Effect.succeed({ stdout: err.message, exitCode: err.exitCode ?? 1 }),
          ),
        );
        const passed = result.exitCode === 0;
        return {
          passed,
          witness: null,
          reason: passed
            ? `Command passed: ${command}`
            : `Command failed with exit code ${result.exitCode}`,
          feedback: passed ? undefined : result.stdout,
          duration_ms: Date.now() - start,
        } satisfies GateResult<S>;
      }),
  };
}
