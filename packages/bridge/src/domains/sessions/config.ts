// PRD-057 / S2 §3.6 / C6: Sessions config schema moved to @method/runtime/config.
// This file stays as a re-export shim during the migration window so existing
// bridge imports (e.g. server-entry.ts) keep working unchanged.

export { SessionsConfigSchema, loadSessionsConfig } from '@method/runtime/config';
export type { SessionsConfig } from '@method/runtime/config';
