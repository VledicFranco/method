/**
 * partitions/constraint/ — Constraint partition (hard limits).
 *
 * Stores what the agent must never do. Entries are permanent — never evicted.
 * The ConstraintClassifier module checks this partition before every action.
 * Monitor module: observes constraint violation events.
 */

export * from './config.js';
export * from './monitor.js';
