// PRD-057 / S2 §3.6 / C6: Strategies config schema moved to @method/runtime/config.
// This file stays as a re-export shim during the migration window so existing
// bridge imports (e.g. server-entry.ts, strategy-routes.ts) keep working unchanged.

export { StrategiesConfigSchema, loadStrategiesConfig } from '@method/runtime/config';
export type { StrategiesConfig, StrategyExecutorConfig } from '@method/runtime/config';
