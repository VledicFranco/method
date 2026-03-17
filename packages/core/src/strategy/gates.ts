/**
 * PRD 017: Strategy Pipelines — Gate Framework (Phase 1b)
 *
 * Gates are the reliability layer between pipeline steps.
 * Each gate evaluates an expression against the step's output,
 * artifacts, and execution metadata to decide pass/fail.
 *
 * Expression evaluation is sandboxed: no access to require, process,
 * fs, globalThis, eval, Function, or any Node.js globals.
 */

// ── Types ──────────────────────────────────────────────────────

export type GateType = 'algorithmic' | 'observation' | 'human_approval';

export interface GateConfig {
  type: GateType;
  check: string;           // Expression evaluated against output/artifacts
  max_retries: number;     // Default: 3 for algorithmic, 2 for observation, 0 for human_approval
  timeout_ms: number;      // Default: 5000
}

export interface GateContext {
  output: Record<string, unknown>;       // Step output
  artifacts: Record<string, unknown>;    // ArtifactBundle snapshot (flat key-value of latest artifact contents)
  execution_metadata: {
    num_turns: number;
    cost_usd: number;
    tool_call_count: number;
    duration_ms: number;
  };
}

export interface GateResult {
  gate_id: string;
  type: GateType;
  passed: boolean;
  reason: string;
  feedback?: string;       // Injected into retry prompt when gate fails
}

// ── Default Values ─────────────────────────────────────────────

const DEFAULT_RETRIES: Record<GateType, number> = {
  algorithmic: 3,
  observation: 2,
  human_approval: 0,
};

const DEFAULT_TIMEOUT = 5000;

/** Get the default max_retries for a given gate type */
export function getDefaultRetries(type: GateType): number {
  return DEFAULT_RETRIES[type];
}

/** Get the default timeout_ms for a given gate type */
export function getDefaultTimeout(_type: GateType): number {
  return DEFAULT_TIMEOUT;
}

// ── Expression Evaluator (sandboxed) ───────────────────────────

/**
 * SECURITY NOTE: This is defense-in-depth against accidental misuse, NOT a
 * security sandbox. Gate expressions are trusted input from Strategy authors.
 * Known escape vectors: dynamic import(), constructor chain traversal,
 * uncontrolled `this` binding. OS-level sandboxing is deferred (PRD 017 §7).
 */

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
  context: GateContext,
  timeoutMs: number = DEFAULT_TIMEOUT,
): Promise<{ passed: boolean; reason: string }> {
  // Deep-freeze context objects to prevent mutation
  const frozenOutput = deepFreeze({ ...context.output });
  const frozenArtifacts = deepFreeze({ ...context.artifacts });
  const frozenMeta = deepFreeze({ ...context.execution_metadata });

  // Race the evaluation against a timeout
  return Promise.race([
    evaluateInSandbox(expression, frozenOutput, frozenArtifacts, frozenMeta),
    timeoutPromise(timeoutMs),
  ]);
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
      // function body. We cannot use 'eval', 'arguments', or 'import' as
      // parameter names in strict mode, so we shadow them via var declarations
      // in a non-strict wrapper that then evaluates the expression.
      //
      // The outer function is NOT strict (so we can shadow 'eval' etc.),
      // but the expression itself runs in a controlled scope where all
      // dangerous identifiers resolve to undefined.
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        'output',
        'artifacts',
        'execution_metadata',
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
        resolve({ passed: true, reason: 'Expression evaluated to truthy' });
      } else {
        resolve({ passed: false, reason: 'Expression evaluated to falsy' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({ passed: false, reason: `Expression error: ${message}` });
    }
  });
}

/** Internal: returns a failing result after timeoutMs */
function timeoutPromise(ms: number): Promise<{ passed: boolean; reason: string }> {
  return new Promise((resolve) => {
    // Note: this setTimeout is the real one from the outer closure, not the
    // shadowed one inside the sandbox. The sandbox cannot access it.
    const timer = setTimeout(() => {
      resolve({ passed: false, reason: 'Gate expression timed out' });
    }, ms);
    // Ensure the timer doesn't keep the process alive
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
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
  gate: GateConfig,
  gateId: string,
  context: GateContext,
): Promise<GateResult> {
  if (gate.type === 'human_approval') {
    return {
      gate_id: gateId,
      type: 'human_approval',
      passed: false,
      reason: 'Awaiting human approval',
      feedback: 'Strategy execution suspended — human approval required',
    };
  }

  // Both algorithmic and observation gates use the same expression evaluator.
  // The semantic distinction is in what the check expression references:
  // - algorithmic: typically checks output.* and artifacts.*
  // - observation: typically checks execution_metadata.*
  const { passed, reason } = await evaluateGateExpression(
    gate.check,
    context,
    gate.timeout_ms,
  );

  const result: GateResult = {
    gate_id: gateId,
    type: gate.type,
    passed,
    reason,
  };

  if (!passed) {
    result.feedback = `Gate check failed: ${gate.check} — ${reason}`;
  }

  return result;
}

// ── Retry Feedback Generator ───────────────────────────────────

/**
 * Build the retry prompt text injected when a gate fails and retries remain.
 */
export function buildRetryFeedback(
  gate: GateConfig,
  result: GateResult,
  attempt: number,
  maxRetries: number,
): string {
  return [
    `GATE FAILURE — Retry ${attempt}/${maxRetries}`,
    `Gate: ${gate.check}`,
    `Result: FAILED — ${result.reason}`,
    `Previous attempt feedback: ${result.feedback ?? 'none'}`,
    'Please address the gate failure and try again.',
  ].join('\n');
}

// ── Helpers ────────────────────────────────────────────────────

/** Deep-freeze an object and all nested objects/arrays */
function deepFreeze<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  Object.freeze(obj);

  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }

  return obj;
}
