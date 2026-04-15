/**
 * ChannelSink — PRD 026 Phase 3.
 *
 * Replaces the legacy appendMessage channel system. Subscribes to ALL events
 * from the bus and maintains per-session ring buffers. Provides cursor-based
 * reads for REST endpoints and triggers push notifications to parent agents
 * for events with severity warning/error/critical.
 *
 * Channel classification: events are classified as 'progress' or 'events'
 * based on type and payload, matching the legacy dual-channel design.
 */

import type { RuntimeEvent, EventSink } from '../ports/event-bus.js';
import { toChannelMessage } from './adapters.js';

// ── Configuration ───────────────────────────────────────────────

export interface ChannelSinkOptions {
  /** Per-session buffer capacity (default: 200). */
  capacity?: number;
  /** Callback for push notifications to parent agents. */
  pushToParent?: (sessionId: string, event: RuntimeEvent) => void;
}

const DEFAULT_CAPACITY = 200;

// ── Channel classification ──────────────────────────────────────

/**
 * Classify a RuntimeEvent as belonging to the 'progress' or 'events' channel.
 * Matches legacy dual-channel behavior from channels.ts.
 */
export function getChannelTarget(event: RuntimeEvent): 'progress' | 'events' {
  // Explicit channel target in payload (from pty-watcher)
  if (event.payload.channelTarget === 'progress') return 'progress';
  if (event.payload.channelTarget === 'events') return 'events';

  // Methodology step events are progress
  if (event.type === 'methodology.step_completed' || event.type === 'methodology.step_started') {
    return 'progress';
  }

  // Default: events
  return 'events';
}

// ── Per-session buffer ──────────────────────────────────────────

interface SessionBuffer {
  events: RuntimeEvent[];
  capacity: number;
}

function createSessionBuffer(capacity: number): SessionBuffer {
  return { events: [], capacity };
}

function pushToBuffer(buf: SessionBuffer, event: RuntimeEvent): void {
  buf.events.push(event);
  if (buf.events.length > buf.capacity) {
    buf.events.shift(); // evict oldest
  }
}

// ── ChannelSink ─────────────────────────────────────────────────

/** Severity levels that trigger push notifications to parent agents. */
const PUSH_SEVERITIES = new Set(['warning', 'error', 'critical']);

export class ChannelSink implements EventSink {
  readonly name = 'channels';

  private readonly capacity: number;
  private readonly sessions = new Map<string, SessionBuffer>();
  private readonly pushToParent: ((sessionId: string, event: RuntimeEvent) => void) | null;
  private lastSequence = 0;

  constructor(options: ChannelSinkOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.pushToParent = options.pushToParent ?? null;
  }

  /**
   * Initialize from persisted cursor state.
   */
  initFromCursor(cursor: number): void {
    this.lastSequence = cursor;
  }

  /** Current cursor position (last processed sequence). */
  get cursor(): number {
    return this.lastSequence;
  }

  // ── EventSink interface ──────────────────────────────────────

  onEvent(event: RuntimeEvent): void {
    // Cursor recovery: skip already-processed events
    if (event.sequence <= this.lastSequence) return;
    this.lastSequence = event.sequence;

    // Only buffer events that have a sessionId
    if (event.sessionId) {
      const buf = this.getOrCreateBuffer(event.sessionId);
      pushToBuffer(buf, event);
    }

    // Push notification for elevated severity events
    if (event.sessionId && PUSH_SEVERITIES.has(event.severity) && this.pushToParent) {
      try {
        this.pushToParent(event.sessionId, event);
      } catch { /* push failure is non-fatal */ }
    }
  }

  onError(error: Error, event: RuntimeEvent): void {
    console.error(`[channel-sink] Error processing event ${event.id}:`, error.message);
  }

  // ── Read methods ─────────────────────────────────────────────

  /**
   * Get events for a session, optionally filtered by channel target.
   * Returns backward-compatible ChannelMessage shape.
   */
  getEvents(
    sessionId: string,
    sinceSequence = 0,
    channel?: 'progress' | 'events',
  ): { messages: Array<ReturnType<typeof toChannelMessage>>; last_sequence: number; has_more: boolean } {
    const buf = this.sessions.get(sessionId);
    if (!buf) {
      return { messages: [], last_sequence: sinceSequence, has_more: false };
    }

    let filtered = buf.events.filter(e => e.sequence > sinceSequence);

    if (channel) {
      filtered = filtered.filter(e => getChannelTarget(e) === channel);
    }

    const messages = filtered.map(toChannelMessage);
    const lastSeq = messages.length > 0
      ? messages[messages.length - 1].sequence
      : sinceSequence;

    return { messages, last_sequence: lastSeq, has_more: false };
  }

  /**
   * Get aggregated events across all sessions, sorted by timestamp.
   * Returns backward-compatible shape for GET /channels/events.
   */
  getAggregated(
    sinceSequence = 0,
    filterType?: string,
  ): {
    events: Array<{
      bridge_session_id: string;
      session_metadata: Record<string, unknown>;
      message: ReturnType<typeof toChannelMessage>;
    }>;
    last_sequence: number;
  } {
    const results: Array<{
      bridge_session_id: string;
      session_metadata: Record<string, unknown>;
      message: ReturnType<typeof toChannelMessage>;
    }> = [];

    let globalLastSequence = sinceSequence;

    for (const [sessionId, buf] of this.sessions) {
      for (const event of buf.events) {
        if (event.sequence <= sinceSequence) continue;

        // Channel target filter: aggregated endpoint shows 'events' channel by default
        if (getChannelTarget(event) !== 'events') continue;

        const msg = toChannelMessage(event);
        if (filterType && msg.type !== filterType) continue;

        results.push({
          bridge_session_id: sessionId,
          session_metadata: event.payload.metadata as Record<string, unknown> ?? {},
          message: msg,
        });

        if (event.sequence > globalLastSequence) {
          globalLastSequence = event.sequence;
        }
      }
    }

    results.sort((a, b) => a.message.timestamp.localeCompare(b.message.timestamp));

    return { events: results, last_sequence: globalLastSequence };
  }

  /**
   * Get all session IDs that have buffered events.
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Remove a session's buffer (e.g., on session kill).
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // ── Internal ─────────────────────────────────────────────────

  private getOrCreateBuffer(sessionId: string): SessionBuffer {
    let buf = this.sessions.get(sessionId);
    if (!buf) {
      buf = createSessionBuffer(this.capacity);
      this.sessions.set(sessionId, buf);
    }
    return buf;
  }
}
