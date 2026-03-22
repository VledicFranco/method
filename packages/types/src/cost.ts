/**
 * Cost and budget types shared across agent providers, bridge, and runtime.
 *
 * The CostMetrics shape appears in: AgentResult.cost, StepResult.cost,
 * CompletedMethodRecord.cost, bridge NodeResult, and strategy execution.
 */

/** Token/USD/time cost of an execution unit. */
export type CostMetrics = {
  readonly tokens: number;
  readonly usd: number;
  readonly duration_ms: number;
};
