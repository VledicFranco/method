/**
 * SessionPool Port — Cross-domain interface for session pool access.
 *
 * PRD-057 / S2 §3.3 / C5: session-pool types moved to
 * `@method/runtime/ports` + `@method/runtime/sessions`. This shim stays
 * on the bridge side so historical imports of
 * `./ports/session-pool.js` continue to work during the migration
 * window. C7 removes the shim.
 */

export type {
  SessionPool,
  SessionStatusInfo,
  SessionBudget,
  SessionChainInfo,
  WorktreeInfo,
  SessionMode,
  IsolationMode,
  WorktreeAction,
  StreamEvent,
} from '@method/runtime/sessions';
