/**
 * PRD 018: Event Triggers — PtyWatcherTrigger (Phase 2a-2)
 *
 * Hooks into PTY watcher observations via TriggerRouter.onObservation().
 * Filters by `pattern` (ObservationCategory like "test_result", "error")
 * and optional `condition` expression evaluated in a sandboxed scope.
 *
 * Integration: The pool wraps diagnosticsCallback to also invoke
 * TriggerRouter.onObservation(), which forwards to registered
 * PtyWatcherTrigger instances.
 */

import type {
  TriggerWatcher,
  TriggerType,
  PtyWatcherTriggerConfig,
} from './types.js';
import { evaluateSandboxedExpression } from './sandbox-eval.js';

/** Observation shape forwarded from the PTY watcher system */
export interface PtyObservation {
  category: string;
  detail: Record<string, unknown>;
  session_id: string;
}

export class PtyWatcherTrigger implements TriggerWatcher {
  readonly type: TriggerType = 'pty_watcher';

  private _active = false;
  private readonly config: PtyWatcherTriggerConfig;
  private onFire: ((payload: Record<string, unknown>) => void) | null = null;

  constructor(config: PtyWatcherTriggerConfig) {
    this.config = config;
  }

  get active(): boolean {
    return this._active;
  }

  start(onFire: (payload: Record<string, unknown>) => void): void {
    if (this._active) return;
    this.onFire = onFire;
    this._active = true;
  }

  stop(): void {
    this._active = false;
    this.onFire = null;
  }

  /**
   * Called by TriggerRouter.onObservation() when a PTY watcher observation
   * is forwarded from the pool. This method checks the pattern filter and
   * optional condition expression before firing.
   */
  handleObservation(observation: PtyObservation): void {
    if (!this._active || !this.onFire) return;

    // Filter by pattern (category name)
    if (observation.category !== this.config.pattern) return;

    // Optional condition expression evaluated against the observation detail
    if (this.config.condition) {
      const { result, error } = evaluateSandboxedExpression(
        this.config.condition,
        { detail: observation.detail },
      );

      if (error) {
        // Condition evaluation error — skip silently (logged at router level)
        return;
      }

      if (!result) return;
    }

    this.onFire({
      category: observation.category,
      detail: observation.detail,
      session_id: observation.session_id,
    });
  }
}
