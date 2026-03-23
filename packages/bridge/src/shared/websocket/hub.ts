// ── WebSocket pub/sub hub for real-time frontend push ────────
//
// Single multiplexed WebSocket connection at /ws with topic-based
// subscriptions. Replaces HTTP polling for live operational data.

import type { WebSocket } from 'ws';

// ── Wire protocol types ──────────────────────────────────────

export type ClientMessage =
  | { type: 'subscribe'; topic: string; filter?: Record<string, string>; cursor?: string }
  | { type: 'unsubscribe'; topic: string }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'subscribed'; topic: string; cursor: string }
  | { type: 'unsubscribed'; topic: string }
  | { type: 'data'; topic: string; payload: unknown; cursor: string }
  | { type: 'error'; topic: string; message: string; code: string }
  | { type: 'pong' };

// ── Valid topics ─────────────────────────────────────────────

export const VALID_TOPICS = ['events', 'sessions', 'executions', 'triggers'] as const;
export type Topic = typeof VALID_TOPICS[number];

function isValidTopic(topic: string): topic is Topic {
  return (VALID_TOPICS as readonly string[]).includes(topic);
}

// ── Client and subscription tracking ─────────────────────────

interface ClientSubscription {
  filter?: Record<string, string>;
}

interface WsClient {
  id: string;
  socket: WebSocket;
  subscriptions: Map<string, ClientSubscription>;
  alive: boolean;
}

/**
 * Predicate to test whether a published message matches a client's
 * subscription filter. The publisher provides this so filtering logic
 * stays colocated with the data source.
 */
export type FilterMatcher = (filter: Record<string, string>) => boolean;

/**
 * Callback for replaying missed messages on cursor-based resumption.
 * Returns an array of { payload, sequence } to replay.
 */
export type ReplayProvider = (topic: Topic, sinceSequence: number) => Array<{ payload: unknown; sequence: number }>;

// ── Backpressure ─────────────────────────────────────────────

const MAX_BUFFERED_AMOUNT = 65_536; // 64 KB

// ── WsHub ────────────────────────────────────────────────────

export class WsHub {
  private clients = new Map<string, WsClient>();
  private topicSequences = new Map<string, number>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private replayProviders = new Map<string, ReplayProvider>();
  private nextClientId = 1;

  constructor(private heartbeatMs: number = 30_000) {
    this.startHeartbeat();
  }

  // ── Connection lifecycle ─────────────────────────────────

  addClient(socket: WebSocket): string {
    const id = `ws-${this.nextClientId++}`;
    const client: WsClient = {
      id,
      socket,
      subscriptions: new Map(),
      alive: true,
    };
    this.clients.set(id, client);

    socket.on('pong', () => { client.alive = true; });

    return id;
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  // ── Replay providers ────────────────────────────────────

  /**
   * Register a replay provider for a topic. Called when a client
   * subscribes with a cursor to catch up on missed messages.
   */
  setReplayProvider(topic: Topic, provider: ReplayProvider): void {
    this.replayProviders.set(topic, provider);
  }

  // ── Subscription management ──────────────────────────────

  subscribe(clientId: string, topic: string, filter?: Record<string, string>, cursor?: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (!isValidTopic(topic)) {
      this.send(client, { type: 'error', topic, message: `Unknown topic: ${topic}`, code: 'UNKNOWN_TOPIC' });
      return;
    }

    client.subscriptions.set(topic, { filter });

    // Current sequence for this topic
    const seq = this.topicSequences.get(topic) ?? 0;

    // Replay missed messages if cursor provided
    if (cursor) {
      const sinceSeq = this.parseCursor(topic, cursor);
      if (sinceSeq !== null && sinceSeq < seq) {
        const provider = this.replayProviders.get(topic);
        if (provider) {
          const missed = provider(topic as Topic, sinceSeq);
          for (const { payload, sequence } of missed) {
            this.send(client, {
              type: 'data',
              topic,
              payload,
              cursor: `${topic}:${sequence}`,
            });
          }
        }
      }
    }

    this.send(client, { type: 'subscribed', topic, cursor: `${topic}:${seq}` });
  }

  unsubscribe(clientId: string, topic: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscriptions.delete(topic);
    this.send(client, { type: 'unsubscribed', topic });
  }

  // ── Publishing ───────────────────────────────────────────

  /**
   * Publish a message to all subscribers of a topic.
   *
   * @param topic      - The topic to publish to
   * @param payload    - The message payload
   * @param matchFilter - Optional predicate: given a client's filter, return
   *                      true if this message should be sent to that client.
   *                      If omitted, all subscribers receive the message.
   */
  publish(topic: Topic, payload: unknown, matchFilter?: FilterMatcher): void {
    const seq = (this.topicSequences.get(topic) ?? 0) + 1;
    this.topicSequences.set(topic, seq);

    const cursor = `${topic}:${seq}`;
    const message: ServerMessage = { type: 'data', topic, payload, cursor };

    for (const client of this.clients.values()) {
      const sub = client.subscriptions.get(topic);
      if (!sub) continue;

      // Check filter match
      if (matchFilter && sub.filter && Object.keys(sub.filter).length > 0) {
        if (!matchFilter(sub.filter)) continue;
      }

      // Backpressure check
      if (client.socket.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        continue; // Drop message — client can resume via cursor
      }

      this.send(client, message);
    }
  }

  // ── Client message handling ──────────────────────────────

  handleMessage(clientId: string, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      const client = this.clients.get(clientId);
      if (client) {
        this.send(client, { type: 'error', topic: '', message: 'Invalid JSON', code: 'PARSE_ERROR' });
      }
      return;
    }

    switch (msg.type) {
      case 'subscribe':
        this.subscribe(clientId, msg.topic, msg.filter, msg.cursor);
        break;
      case 'unsubscribe':
        this.unsubscribe(clientId, msg.topic);
        break;
      case 'ping':
        {
          const client = this.clients.get(clientId);
          if (client) this.send(client, { type: 'pong' });
        }
        break;
      default:
        {
          const client = this.clients.get(clientId);
          if (client) {
            this.send(client, { type: 'error', topic: '', message: 'Unknown message type', code: 'UNKNOWN_TYPE' });
          }
        }
    }
  }

  // ── Heartbeat ────────────────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [id, client] of this.clients) {
        if (!client.alive) {
          client.socket.terminate();
          this.clients.delete(id);
          continue;
        }
        client.alive = false;
        client.socket.ping();
      }
    }, this.heartbeatMs);
  }

  // ── Cleanup ──────────────────────────────────────────────

  destroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.clients.values()) {
      client.socket.close(1001, 'Server shutting down');
    }
    this.clients.clear();
  }

  // ── Helpers ──────────────────────────────────────────────

  private send(client: WsClient, message: ServerMessage): void {
    if (client.socket.readyState === 1 /* OPEN */) {
      client.socket.send(JSON.stringify(message));
    }
  }

  private parseCursor(topic: string, cursor: string): number | null {
    const prefix = `${topic}:`;
    if (!cursor.startsWith(prefix)) return null;
    const seq = parseInt(cursor.slice(prefix.length), 10);
    return Number.isFinite(seq) ? seq : null;
  }
}
