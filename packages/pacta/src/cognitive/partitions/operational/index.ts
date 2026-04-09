/**
 * partitions/operational/ — Operational partition (execution state).
 *
 * Stores what the agent is doing right now: active tool calls, current step,
 * recent observations. Eviction policy: LRU (transient, recency-weighted).
 * Monitor module: observes execution events and keeps partition current.
 */

export * from './config.js';
export * from './monitor.js';
