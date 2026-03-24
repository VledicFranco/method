/**
 * Strategy DAG Gate Evaluation — expression-based gate framework.
 *
 * Migrated from bridge gates.ts (PRD 017 Phase 1b).
 * This is now the canonical gate evaluation for strategy DAGs — the bridge
 * delegates to this module.
 *
 * Gates evaluate JavaScript expressions against step output, artifacts,
 * and execution metadata. Expression evaluation is sandboxed: no access
 * to require, process, fs, globalThis, eval, Function, or any Node.js globals.
 *
 * SECURITY NOTE: This is defense-in-depth against accidental misuse, NOT a
 * security sandbox. Gate expressions are trusted input from Strategy authors.
 * Known escape vectors: dynamic import(), constructor chain traversal,
 * uncontrolled `this` binding. OS-level sandboxing is deferred (PRD 017 S7).
 *
 * @see PRD 017 — Strategy Pipelines (gate framework)
 */

import type {
  DagGateConfig,
  DagGateContext,
  DagGateResult,
} from "./dag-types.js";

// ── Expression Evaluator (sandboxed) ───────────────────────────

/**
 * Evaluate a gate check expression in a sandboxed scope.
 *
 * The expression receives `output`, `artifacts`, and `execution_metadata`
 * as its only variables. All context objects are deep-frozen to prevent
 * mutation. Node.js globals (require, process, fs, globalThis, eval,
 * Function) are explicitly shadowed with undefined.
 *
 * Returns { passed, reason } — never throws.
 */
export async function evaluateGateExpression(
  expression: string,
  context: DagGateContext,
  timeoutMs: number = 5000,
): Promise<{ passed: boolean; reason: string }> {
  // Deep-freeze context objects to prevent mutation
  const frozenOutput = deepFreeze({ ...context.output });
  const frozenArtifacts = deepFreeze({ ...context.artifacts });
  const frozenMeta = deepFreeze({ ...context.execution_metadata });

  // Race the evaluation against a timeout, clearing the timer on completion
  let timer: ReturnType<typeof setTimeout>;
  const timeoutP = new Promise<{ passed: boolean; reason: string }>(
    (resolve) => {
      timer = setTimeout(() => {
        resolve({ passed: false, reason: "Gate expression timed out" });
      }, timeoutMs);
      if (timer && typeof timer === "object" && "unref" in timer) {
        (timer as NodeJS.Timeout).unref();
      }
    },
  );
  try {
    return await Promise.race([
      evaluateInSandbox(expression, frozenOutput, frozenArtifacts, frozenMeta),
      timeoutP,
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Internal: run the expression via new Function() with blocked globals */
function evaluateInSandbox(
  expression: string,
  output: Record<string, unknown>,
  artifacts: Record<string, unknown>,
  execution_metadata: Record<string, unknown>,
): Promise<{ passed: boolean; reason: string }> {
  return new Promise((resolve) => {
    try {
      // Shadow dangerous globals by declaring them as undefined inside the
      // function body.
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        "output",
        "artifacts",
        "execution_metadata",
        `var require = undefined;
var process = undefined;
var fs = undefined;
var globalThis = undefined;
var eval = undefined;
var Function = undefined;
var global = undefined;
var module = undefined;
var exports = undefined;
var __dirname = undefined;
var __filename = undefined;
var setTimeout = undefined;
var setInterval = undefined;
var setImmediate = undefined;
return (${expression});`,
      );

      const result = fn(output, artifacts, execution_metadata);

      if (result) {
        resolve({ passed: true, reason: "Expression evaluated to truthy" });
      } else {
        resolve({ passed: false, reason: "Expression evaluated to falsy" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({ passed: false, reason: `Expression error: ${message}` });
    }
  });
}

// ── Gate Evaluation ────────────────────────────────────────────

/**
 * Evaluate a single gate against a context.
 *
 * - algorithmic: evaluates the check expression against output/artifacts
 * - observation: evaluates the check expression against execution_metadata
 *   (same mechanism, semantically different — checks patterns like cost, turns)
 * - human_approval: always returns not passed (Phase 1 stub — no suspension mechanism)
 */
export async function evaluateGate(
  gate: DagGateConfig,
  gateId: string,
  context: DagGateContext,
): Promise<DagGateResult> {
  if (gate.type === "human_approval") {
    return {
      gate_id: gateId,
      type: "human_approval",
      passed: false,
      reason: "Awaiting human approval",
      feedback:
        "Strategy execution suspended — human approval required",
    };
  }

  // Both algorithmic and observation gates use the same expression evaluator.
  const { passed, reason } = await evaluateGateExpression(
    gate.check,
    context,
    gate.timeout_ms,
  );

  const result: DagGateResult = {
    gate_id: gateId,
    type: gate.type,
    passed,
    reason,
  };

  if (!passed) {
    return {
      ...result,
      feedback: `Gate check failed: ${gate.check} — ${reason}`,
    };
  }

  return result;
}

// ── Retry Feedback Generator ───────────────────────────────────

/**
 * Build the retry prompt text injected when a gate fails and retries remain.
 */
export function buildRetryFeedback(
  gate: DagGateConfig,
  result: DagGateResult,
  attempt: number,
  maxRetries: number,
): string {
  return [
    `GATE FAILURE — Retry ${attempt}/${maxRetries}`,
    `Gate: ${gate.check}`,
    `Result: FAILED — ${result.reason}`,
    `Previous attempt feedback: ${result.feedback ?? "none"}`,
    "Please address the gate failure and try again.",
  ].join("\n");
}

// ── Helpers ────────────────────────────────────────────────────

/** Deep-freeze an object and all nested objects/arrays */
function deepFreeze<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return obj;
  }

  Object.freeze(obj);

  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value);
    }
  }

  return obj;
}
