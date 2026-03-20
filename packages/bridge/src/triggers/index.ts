/**
 * PRD 018: Event Triggers — Module Exports (Phase 2a-1 + Phase 2a-2 + Phase 2a-3)
 */

export { TriggerRouter } from './trigger-router.js';
export type { TriggerRouterOptions } from './trigger-router.js';

export { FileWatchTrigger } from './file-watch-trigger.js';
export { GitCommitTrigger } from './git-commit-trigger.js';
export { ScheduleTrigger, parseCron, cronMatches, nextCronFire } from './schedule-trigger.js';
export { PtyWatcherTrigger } from './pty-watcher-trigger.js';
export type { PtyObservation } from './pty-watcher-trigger.js';
export { ChannelEventTrigger } from './channel-event-trigger.js';
export type { ChannelMessageEvent } from './channel-event-trigger.js';
export { WebhookTrigger } from './webhook-trigger.js';
export { evaluateSandboxedExpression } from './sandbox-eval.js';

export { DebounceEngine } from './debounce.js';
export { minimatch } from './glob-match.js';

export { parseStrategyTriggers, hasEventTriggers } from './trigger-parser.js';
export type { ParsedStrategyTriggers } from './trigger-parser.js';

export { scanAndRegisterTriggers } from './startup-scan.js';
export type { ScanResult } from './startup-scan.js';

export { registerTriggerRoutes } from './trigger-routes.js';

export type {
  TriggerType,
  TriggerConfig,
  TriggerWatcher,
  TriggerEvent,
  TriggerRegistration,
  TriggerStats,
  DebounceConfig,
  DebouncedEvent,
  DebouncedTriggerFire,
  TimerInterface,
  FileWatchTriggerConfig,
  GitCommitTriggerConfig,
  ScheduleTriggerConfig,
  PtyWatcherTriggerConfig,
  ChannelEventTriggerConfig,
  WebhookTriggerConfig,
} from './types.js';

export { realTimers } from './types.js';
