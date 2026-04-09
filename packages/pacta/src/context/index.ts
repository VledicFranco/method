/**
 * context/ — Context window budget management.
 *
 * compactionManager(): middleware that triggers compaction at configurable threshold.
 * ContextPolicy: compaction threshold, max tokens, compaction strategy config.
 * NoteTakingManager: extracts key facts from steps → compact notes.
 * SubagentDelegator: delegates remaining work when context exhausted.
 * SystemPromptBudgetTracker: tracks system prompt tokens separately.
 */

export { compactionManager } from './compaction-manager.js';
export * from './context-policy.js';
export * from './context-middleware.js';

export * from './note-taking-manager.js';
export * from './subagent-delegator.js';
export * from './system-prompt-budget-tracker.js';
