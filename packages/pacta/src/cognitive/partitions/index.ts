/**
 * Partitions Domain — barrel export.
 *
 * PRD 044 Phase 1: workspace partition system with typed entries,
 * pluggable eviction, per-partition monitors, and entry routing.
 */

export { PartitionWorkspace } from './partition-workspace.js';
export type { PartitionWorkspaceConfig } from './partition-workspace.js';
export { NoEvictionPolicy, RecencyEvictionPolicy, GoalSalienceEvictionPolicy } from './eviction-policies.js';
export { DefaultEntryRouter } from './entry-router.js';
export type { EntryRouterConfig } from './entry-router.js';
export { createPartitionSystem } from './partition-system.js';
export type { PartitionSystemConfig } from './partition-system.js';
export { createTypeResolver } from './type-resolver.js';
