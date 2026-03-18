// Re-exported from @method/core for backward compatibility
// Pure logic (generateRetro, computeCriticalPath, retroToYaml) lives in core.
// saveRetro (filesystem I/O) stays in bridge — see retro-writer.ts.
export type { StrategyRetro } from '@method/core';
export { generateRetro, computeCriticalPath, retroToYaml } from '@method/core';
export { saveRetro } from './retro-writer.js';
