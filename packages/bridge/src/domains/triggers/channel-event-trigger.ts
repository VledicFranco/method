/**
 * PRD 018: Event Triggers — ChannelEventTrigger (Phase 2a-2)
 *
 * Subscribes to bridge channel events via an onMessage hook on
 * channels.ts's appendMessage(). Filters by event_type and optional
 * filter expression evaluated in a sandboxed scope.
 *
 * Integration: The TriggerRouter registers itself as a listener
 * via the onMessage hook. When appendMessage is called, the hook
 * invokes TriggerRouter.onChannelMessage(), which forwards to
 * registered ChannelEventTrigger instances.
 */

import type {
  TriggerWatcher,
  TriggerType,
  ChannelEventTriggerConfig,
} from './types.js';
import { evaluateSandboxedExpression } from './sandbox-eval.js';

/** Channel message shape forwarded from the channels system */
export interface ChannelMessageEvent {
  channel_name: string;
  sender: string;
  type: string;
  content: Record<string, unknown>;
  session_id?: string;
}

export class ChannelEventTrigger implements TriggerWatcher {
  readonly type: TriggerType = 'channel_event';

  private _active = false;
  private readonly config: ChannelEventTriggerConfig;
  private readonly allowedEventTypes: Set<string>;
  private onFire: ((payload: Record<string, unknown>) => void) | null = null;

  constructor(config: ChannelEventTriggerConfig) {
    this.config = config;
    this.allowedEventTypes = new Set(config.event_types);
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
   * Called by TriggerRouter.onChannelMessage() when a channel message
   * is appended. Checks event type filter and optional filter expression
   * before firing.
   */
  handleChannelMessage(message: ChannelMessageEvent): void {
    if (!this._active || !this.onFire) return;

    // Filter by event type
    if (!this.allowedEventTypes.has(message.type)) return;

    // Optional filter expression evaluated against the event
    if (this.config.filter) {
      const { result, error } = evaluateSandboxedExpression(
        this.config.filter,
        { event: message },
      );

      if (error) {
        // Filter evaluation error — skip silently
        return;
      }

      if (!result) return;
    }

    this.onFire({
      event_type: message.type,
      channel_name: message.channel_name,
      sender: message.sender,
      content: message.content,
      session_id: message.session_id,
    });
  }
}
