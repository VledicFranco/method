// ── Singleton WebSocket connection manager ───────────────────
//
// Maintains a single multiplexed WebSocket connection to the bridge.
// Topics are subscribed/unsubscribed dynamically. On disconnect,
// reconnects with exponential backoff and resumes from last cursor.

export type MessageHandler = (payload: unknown, cursor: string) => void;

interface Subscription {
  filter?: Record<string, string>;
  handlers: Set<MessageHandler>;
  lastCursor?: string;
}

type ConnectionListener = (connected: boolean) => void;

class WsManager {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<string, Subscription>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30_000;
  private _connected = false;
  private connectionListeners = new Set<ConnectionListener>();
  private destroyed = false;

  get connected(): boolean {
    return this._connected;
  }

  /** Subscribe to connection state changes. Returns unsubscribe function. */
  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => { this.connectionListeners.delete(listener); };
  }

  /** Open the WebSocket connection. Safe to call multiple times. */
  connect(): void {
    if (this.ws || this.destroyed) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.setConnected(true);
      this.reconnectDelay = 1000;

      // Re-subscribe all active topics with cursors for resumption
      for (const [topic, sub] of this.subscriptions) {
        if (sub.handlers.size > 0) {
          this.sendSubscribe(topic, sub.filter, sub.lastCursor);
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data' && msg.topic) {
          const sub = this.subscriptions.get(msg.topic);
          if (sub) {
            sub.lastCursor = msg.cursor;
            for (const handler of sub.handlers) {
              try { handler(msg.payload, msg.cursor); } catch { /* handler error */ }
            }
          }
        }
        // pong, subscribed, unsubscribed, error — silently handled
      } catch { /* parse error */ }
    };

    ws.onclose = () => {
      this.ws = null;
      this.setConnected(false);
      if (!this.destroyed) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }

  /**
   * Send a raw message to the server over the WebSocket connection.
   * Returns false if the connection is not open.
   */
  send(message: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  /** Disconnect and stop reconnecting. */
  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnected(false);
  }

  /**
   * Subscribe to a topic. Returns an unsubscribe function.
   * Multiple handlers can subscribe to the same topic — messages are
   * broadcast to all. The subscription is created on first handler
   * and torn down when the last handler unsubscribes.
   */
  subscribe(
    topic: string,
    handler: MessageHandler,
    filter?: Record<string, string>,
  ): () => void {
    let sub = this.subscriptions.get(topic);

    if (!sub) {
      sub = { filter, handlers: new Set() };
      this.subscriptions.set(topic, sub);
    }

    const isFirst = sub.handlers.size === 0;
    sub.handlers.add(handler);

    // Send subscribe message if connected and this is the first handler
    if (isFirst && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(topic, filter, sub.lastCursor);
    }

    return () => {
      sub!.handlers.delete(handler);
      if (sub!.handlers.size === 0) {
        // Last handler removed — unsubscribe from server
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'unsubscribe', topic }));
        }
        this.subscriptions.delete(topic);
      }
    };
  }

  // ── Internal ─────────────────────────────────────────────

  private sendSubscribe(
    topic: string,
    filter?: Record<string, string>,
    cursor?: string,
  ): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const msg: Record<string, unknown> = { type: 'subscribe', topic };
    if (filter && Object.keys(filter).length > 0) msg.filter = filter;
    if (cursor) msg.cursor = cursor;
    this.ws.send(JSON.stringify(msg));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private setConnected(value: boolean): void {
    if (this._connected === value) return;
    this._connected = value;
    for (const listener of this.connectionListeners) {
      try { listener(value); } catch { /* listener error */ }
    }
  }
}

/** Singleton instance */
export const wsManager = new WsManager();
