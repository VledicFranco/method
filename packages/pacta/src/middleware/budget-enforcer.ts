/**
 * Budget Enforcer Middleware — wraps provider invocations with budget tracking.
 *
 * Tracks turns, tokens, cost, and duration. Emits budget_warning at 80%
 * and budget_exhausted when limits are exceeded. Stops execution based
 * on the onExhaustion policy.
 *
 * Middleware ordering: Budget Enforcer → Output Validator → Provider
 * (budget enforcer is the outermost wrapper).
 *
 * Modes (see {@link BudgetEnforcerOptions}):
 * - `'authoritative'` (default) — tokens + cost + turns + duration all
 *   reject/stop on exhaustion, preserving the pre-PRD-059 behavior.
 * - `'predictive'` — tokens + cost exhaustion EMIT warning/exhausted
 *   events but never reject / stop / throw; turns + duration remain
 *   authoritative. Use when the downstream provider enforces cost/tokens
 *   atomically (e.g., a `CortexLLMProvider` whose
 *   `capabilities().budgetEnforcement === 'native'`). See PRD-059 §4 and
 *   S3 (`fcd-surface-cortex-service-adapters`) §4 "Budget double-count
 *   resolution" for the full contract.
 */

import type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from '../pact.js';
import type { AgentEvent, AgentBudgetWarning, AgentBudgetExhausted } from '../events.js';
import type { BudgetContract } from '../budget/budget-contract.js';

type InvokeFn<T> = (pact: Pact<T>, request: AgentRequest) => Promise<AgentResult<T>>;

const WARNING_THRESHOLD = 0.8;

/** Which resources predictive mode downgrades to events-only. Turns + duration stay authoritative. */
const PREDICTIVE_DOWNGRADED_RESOURCES: ReadonlySet<AgentBudgetWarning['resource']> = new Set([
  'tokens',
  'cost',
]);

/**
 * Optional options for {@link budgetEnforcer}.
 *
 * Added in PRD-059 as an additive, backward-compatible extension. Omitting
 * the argument yields the previous behavior byte-for-byte (mode defaults to
 * `'authoritative'`).
 */
export interface BudgetEnforcerOptions {
  /**
   * `'authoritative'` (default) — the enforcer rejects calls on
   * cost / token / turn / duration exhaustion, as it has always done.
   *
   * `'predictive'` — the enforcer only EMITS `budget_warning` /
   * `budget_exhausted` events for **cost and tokens**; it does NOT throw,
   * NOT short-circuit, and NOT set `stopReason: 'budget_exhausted'` for
   * those resources. **Turns and duration** continue to reject
   * authoritatively because Cortex's `ctx.llm` does not own them.
   *
   * Use `'predictive'` when the composed provider reports
   * `capabilities().budgetEnforcement === 'native'` — typically a
   * `CortexLLMProvider`, where `ctx.llm` is the atomic cost/token
   * authority. The downstream authority emits the real budget decisions;
   * this layer only mirrors them for observability.
   */
  readonly mode?: 'authoritative' | 'predictive';
}

function emitWarning(
  onEvent: ((e: AgentEvent) => void) | undefined,
  resource: AgentBudgetWarning['resource'],
  consumed: number,
  limit: number,
): void {
  if (!onEvent) return;
  const percentUsed = Math.round((consumed / limit) * 100);
  onEvent({
    type: 'budget_warning',
    resource,
    consumed,
    limit,
    percentUsed,
  });
}

function emitExhausted(
  onEvent: ((e: AgentEvent) => void) | undefined,
  resource: AgentBudgetExhausted['resource'],
  consumed: number,
  limit: number,
): void {
  if (!onEvent) return;
  onEvent({
    type: 'budget_exhausted',
    resource,
    consumed,
    limit,
  });
}

export interface BudgetState {
  turns: number;
  totalTokens: number;
  totalCostUsd: number;
  startTime: number;
}

/**
 * Check a resource against its budget limit. Returns 'ok', 'warning', or 'exhausted'.
 */
function checkLimit(
  consumed: number,
  limit: number | undefined,
): 'ok' | 'warning' | 'exhausted' {
  if (limit === undefined) return 'ok';
  if (consumed >= limit) return 'exhausted';
  if (consumed >= limit * WARNING_THRESHOLD) return 'warning';
  return 'ok';
}

/**
 * Creates a budget-enforced result that signals budget exhaustion.
 */
function exhaustedResult<T>(
  result: AgentResult<T>,
  resource: string,
): AgentResult<T> {
  return {
    ...result,
    completed: false,
    stopReason: 'budget_exhausted',
  };
}

/**
 * Wraps an invoke function with budget enforcement.
 * Pre-checks turn budget before calling inner. Post-checks all budgets after.
 *
 * @param options Optional mode selector — see {@link BudgetEnforcerOptions}.
 *                Default mode is `'authoritative'` (pre-PRD-059 behavior).
 */
export function budgetEnforcer<T>(
  inner: InvokeFn<T>,
  pact: Pact<T>,
  onEvent?: (event: AgentEvent) => void,
  options?: BudgetEnforcerOptions,
): InvokeFn<T> {
  const budget: BudgetContract = pact.budget ?? {};
  const mode = options?.mode ?? 'authoritative';
  const state: BudgetState = {
    turns: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    startTime: Date.now(),
  };

  return async (p: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> => {
    // Pre-check: turn limit
    if (budget.maxTurns !== undefined && state.turns >= budget.maxTurns) {
      emitExhausted(onEvent, 'turns', state.turns, budget.maxTurns);
      const policy = budget.onExhaustion ?? 'stop';
      if (policy === 'error') {
        throw new BudgetExhaustedError('turns', state.turns, budget.maxTurns);
      }
      // Return a synthetic exhausted result
      return {
        output: undefined as T,
        sessionId: '',
        completed: false,
        stopReason: 'budget_exhausted',
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
        cost: { totalUsd: state.totalCostUsd, perModel: {} },
        durationMs: Date.now() - state.startTime,
        turns: state.turns,
      };
    }

    // Pre-check: duration limit
    if (budget.maxDurationMs !== undefined) {
      const elapsed = Date.now() - state.startTime;
      if (elapsed >= budget.maxDurationMs) {
        emitExhausted(onEvent, 'duration', elapsed, budget.maxDurationMs);
        const policy = budget.onExhaustion ?? 'stop';
        if (policy === 'error') {
          throw new BudgetExhaustedError('duration', elapsed, budget.maxDurationMs);
        }
        return {
          output: undefined as T,
          sessionId: '',
          completed: false,
          stopReason: 'budget_exhausted',
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
          cost: { totalUsd: state.totalCostUsd, perModel: {} },
          durationMs: elapsed,
          turns: state.turns,
        };
      }
    }

    // Invoke the inner pipeline
    const result = await inner(p, request);

    // Post-invocation tracking
    state.turns += 1;
    state.totalTokens += result.usage.totalTokens;
    state.totalCostUsd += result.cost.totalUsd;

    // Post-check: warnings and exhaustion
    const checks: Array<{ resource: AgentBudgetWarning['resource']; consumed: number; limit: number | undefined }> = [
      { resource: 'turns', consumed: state.turns, limit: budget.maxTurns },
      { resource: 'tokens', consumed: state.totalTokens, limit: budget.maxTokens },
      { resource: 'cost', consumed: state.totalCostUsd, limit: budget.maxCostUsd },
      { resource: 'duration', consumed: Date.now() - state.startTime, limit: budget.maxDurationMs },
    ];

    for (const { resource, consumed, limit } of checks) {
      const status = checkLimit(consumed, limit);
      // PRD-059 / S3 §4: in predictive mode, cost + tokens become events-only;
      // turns + duration remain authoritative (Cortex doesn't track them).
      const downgraded =
        mode === 'predictive' && PREDICTIVE_DOWNGRADED_RESOURCES.has(resource);

      if (status === 'exhausted') {
        emitExhausted(onEvent, resource, consumed, limit!);
        if (downgraded) {
          // Observability only — never throw, never stop. The downstream
          // provider (e.g., ctx.llm) owns the real enforcement decision.
          continue;
        }
        const policy = budget.onExhaustion ?? 'stop';
        if (policy === 'error') {
          throw new BudgetExhaustedError(resource, consumed, limit!);
        }
        if (policy === 'stop') {
          return exhaustedResult(result, resource);
        }
        // 'warn' — continue but event already emitted
      } else if (status === 'warning') {
        emitWarning(onEvent, resource, consumed, limit!);
      }
    }

    return result;
  };
}

// ── Error Types ──────────────────────────────────────────────────

export class BudgetExhaustedError extends Error {
  readonly resource: string;
  readonly consumed: number;
  readonly limit: number;

  constructor(resource: string, consumed: number, limit: number) {
    super(`Budget exhausted: ${resource} — consumed ${consumed}, limit ${limit}`);
    this.name = 'BudgetExhaustedError';
    this.resource = resource;
    this.consumed = consumed;
    this.limit = limit;
  }
}
