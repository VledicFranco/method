// SPDX-License-Identifier: Apache-2.0
/**
 * PRD 018: Event Triggers — Sandboxed Expression Evaluator (Phase 2a-2)
 *
 * Evaluates JS filter/condition expressions in a sandboxed scope.
 * Used by PtyWatcherTrigger (condition) and ChannelEventTrigger (filter).
 *
 * Security: new Function() sandbox with frozen context, no access to
 * require/process/fs/globalThis/eval/Function or any Node.js globals.
 * Matches the gate framework pattern from PRD 017 (evaluateGateExpression).
 *
 * SECURITY NOTE: This sandbox uses `new Function()` with shadowed globals as
 * defense-in-depth against accidental misuse. It is NOT a security sandbox.
 * Known escape vectors: constructor chain (`obj.constructor.constructor('return process')()`),
 * dynamic `import()`. These expressions come from on-disk strategy YAML authored by the
 * project owner — not from external untrusted input. If external input is ever evaluated,
 * switch to `vm.runInNewContext()` or `isolated-vm`.
 */

/**
 * Deep-freeze an object and all nested objects/arrays to prevent mutation.
 */
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

/**
 * Evaluate a JavaScript expression in a sandboxed scope.
 *
 * The expression receives a frozen context object as its only variable.
 * Node.js globals are explicitly shadowed with undefined.
 *
 * @param expression - The JS expression string to evaluate
 * @param context - The context variables available to the expression
 * @returns { result: boolean; error?: string } — never throws
 */
export function evaluateSandboxedExpression(
  expression: string,
  context: Record<string, unknown>,
): { result: boolean; error?: string } {
  const frozenContext = deepFreeze({ ...context });

  try {
    // Build parameter names and values from context keys
    const paramNames = Object.keys(frozenContext);
    const paramValues = paramNames.map((k) => frozenContext[k]);

    // Shadow dangerous globals by declaring them as undefined
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      ...paramNames,
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

    const result = fn(...paramValues);
    return { result: Boolean(result) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: false, error: `Expression error: ${message}` };
  }
}
