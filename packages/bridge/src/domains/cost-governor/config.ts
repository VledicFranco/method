// PRD-057 / S2 §3.6 / C6: Cost-governor config schema moved to @method/runtime/config.
// This file stays as a re-export shim during the migration window so existing
// bridge imports (e.g. server-entry.ts, cost-governor/index.ts) keep working unchanged.

export { CostGovernorConfigSchema, loadCostGovernorConfig } from '@method/runtime/config';
export type { CostGovernorConfig } from '@method/runtime/config';
