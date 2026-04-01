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
 * PRD 046: Implements the DagGateEvaluator port interface. The port is
 * defined in gate/dag-gate-evaluator.ts, and the implementation lives here
 * in the strategy module (port owner: gate, implementation owner: strategy).
 *
 * @see PRD 017 — Strategy Pipelines (gate framework)
 * @see PRD 046 — Runtime Consolidation (DagGateEvaluator port)
 */

import type {
  DagGateConfig,
  DagGateContext,
  DagGateResult,
  HumanApprovalResolver,
  HumanApprovalContext,
  HumanApprovalDecision,
} from "./dag-types.js";
import type {
  DagGateEvaluator,
  DagGateConfig as PortDagGateConfig,
  DagGateContext as PortDagGateContext,
  DagGateResult as PortDagGateResult,
  HumanApprovalResolver as PortHumanApprovalResolver,
  HumanApprovalContext as PortHumanApprovalContext,
} from "../gate/dag-gate-evaluator.js";

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
 * - human_approval: calls the injected HumanApprovalResolver if provided;
 *   falls back to backward-compat stub (passed:false) when resolver is null.
 */
export async function evaluateGate(
  gate: DagGateConfig,
  gateId: string,
  context: DagGateContext,
  humanApprovalResolver?: HumanApprovalResolver | null,
  humanApprovalContext?: HumanApprovalContext,
): Promise<DagGateResult> {
  if (gate.type === "human_approval") {
    if (humanApprovalResolver != null && humanApprovalContext != null) {
      // F-D-3: Enforce timeout on human approval to prevent indefinite hangs
      const timeoutMs = humanApprovalContext.timeout_ms || 300_000; // 5 min default
      const timeoutPromise = new Promise<HumanApprovalDecision>((resolve) => {
        const timer = setTimeout(() => {
          resolve({ approved: false, feedback: `Human approval timed out after ${Math.round(timeoutMs / 1000)}s` });
        }, timeoutMs);
        if (timer && typeof timer === 'object' && 'unref' in timer) {
          (timer as NodeJS.Timeout).unref();
        }
      });

      const decision = await Promise.race([
        humanApprovalResolver.requestApproval(humanApprovalContext),
        timeoutPromise,
      ]);
      if (decision.approved) {
        return {
          gate_id: gateId,
          type: "human_approval",
          passed: true,
          reason: "Human approved",
        };
      } else {
        return {
          gate_id: gateId,
          type: "human_approval",
          passed: false,
          reason: "Human rejected",
          feedback: decision.feedback,
        };
      }
    }
    // Backward-compat: no resolver — immediately return not-passed
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

// ── DagGateEvaluator Implementation (PRD 046) ────────────────

/**
 * Strategy-side implementation of the DagGateEvaluator port.
 *
 * Adapts the existing evaluateGate() function to satisfy the port interface
 * defined in gate/dag-gate-evaluator.ts. The port uses simplified types
 * (DagGateResult without gate_id/type fields); this adapter maps between
 * the strategy's richer types and the port's minimal contract.
 *
 * @see gate/dag-gate-evaluator.ts — port interface (frozen, owned by gate/)
 */
export function createStrategyGateEvaluator(): DagGateEvaluator {
  return {
    async evaluate(
      gate: PortDagGateConfig,
      gateId: string,
      context: PortDagGateContext,
      resolver?: PortHumanApprovalResolver,
      approvalCtx?: PortHumanApprovalContext,
    ): Promise<PortDagGateResult> {
      // Map port types to strategy types (structurally compatible)
      const strategyGate: DagGateConfig = {
        type: gate.type,
        check: gate.check,
        max_retries: gate.max_retries,
        timeout_ms: gate.timeout_ms,
      };

      const strategyContext: DagGateContext = {
        output: context.output,
        artifacts: context.artifacts,
        execution_metadata: context.execution_metadata,
      };

      // Map resolver if present — the port's resolver is a subset of strategy's
      const strategyResolver: HumanApprovalResolver | undefined = resolver
        ? {
            requestApproval: async (ctx: HumanApprovalContext) => {
              const portCtx: PortHumanApprovalContext = {
                execution_id: ctx.execution_id,
                gate_id: ctx.gate_id,
                artifact_markdown: ctx.artifact_markdown,
                timeout_ms: ctx.timeout_ms,
              };
              return resolver.requestApproval(portCtx);
            },
          }
        : undefined;

      // Map approval context if present
      const strategyApprovalCtx: HumanApprovalContext | undefined = approvalCtx
        ? {
            strategy_id: "",
            execution_id: approvalCtx.execution_id,
            gate_id: approvalCtx.gate_id,
            node_id: "",
            artifact_markdown: approvalCtx.artifact_markdown,
            timeout_ms: approvalCtx.timeout_ms,
          }
        : undefined;

      const strategyResult = await evaluateGate(
        strategyGate,
        gateId,
        strategyContext,
        strategyResolver,
        strategyApprovalCtx,
      );

      // Map strategy result to port result (simplified shape)
      return {
        passed: strategyResult.passed,
        detail: strategyResult.reason,
        expression_result: strategyResult.feedback,
      };
    },
  };
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
