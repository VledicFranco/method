/**
 * partitions/task/ — Task partition (goal tracking).
 *
 * Stores current and pending tasks ordered by priority.
 * Eviction policy: priority-based (highest priority entries retained longest).
 * Monitor module: observes task completion events and updates partition state.
 */

export * from './config.js';
export * from './monitor.js';
