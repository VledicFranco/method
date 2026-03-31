// ── HTTP Network Adapter ────────────────────────────────────────
//
// NetworkProvider implementation using Node.js built-in fetch (22+).
// Sends cluster messages as HTTP POST with JSON body to peer
// bridges. Incoming messages are dispatched from the cluster
// HTTP routes — not from this adapter directly.

import type { NetworkProvider } from '@method/cluster';
import type { PeerAddress, ClusterMessage, ClusterState } from '@method/cluster';

// ── Types ─────────────────────────────────────────────────────

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

type MessageHandler = (from: PeerAddress, msg: ClusterMessage) => void;

// ── Helpers ──────────────────────────────────────────────────

/**
 * Serialize a ClusterMessage to JSON, handling Map→Object conversion
 * for ack messages whose state.peers is a Map<string, ClusterNode>.
 */
function serializeMessage(msg: ClusterMessage): string {
  if (msg.type === 'ack' && msg.state?.peers instanceof Map) {
    return JSON.stringify({
      ...msg,
      state: {
        ...msg.state,
        peers: Object.fromEntries(msg.state.peers),
      },
    });
  }
  return JSON.stringify(msg);
}

// ── Implementation ────────────────────────────────────────────

export class HttpNetwork implements NetworkProvider {
  private handler: MessageHandler | null = null;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private clusterSecret: string | undefined;

  constructor(overrides?: { fetch?: FetchFn; timeoutMs?: number; clusterSecret?: string }) {
    this.fetchFn = overrides?.fetch ?? globalThis.fetch;
    this.timeoutMs = overrides?.timeoutMs ?? 5000;
    this.clusterSecret = overrides?.clusterSecret;
  }

  /** Update the cluster secret (called from composition root). */
  setClusterSecret(secret: string | undefined): void {
    this.clusterSecret = secret;
  }

  async send(peer: PeerAddress, message: ClusterMessage): Promise<void> {
    // Map message type to the appropriate cluster route
    const route = this.routeForMessage(message);
    const url = `http://${peer.host}:${peer.port}${route}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.clusterSecret) {
      headers['x-cluster-secret'] = this.clusterSecret;
    }

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: serializeMessage(message),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${peer.host}:${peer.port}${route}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Send a message with retry for critical messages (join/leave).
   * Retries on failure with linear backoff. Swallows the error after
   * all retries are exhausted (join/leave are best-effort).
   */
  async sendWithRetry(
    peer: PeerAddress,
    message: ClusterMessage,
    retries = 2,
    backoffMs = 1000,
  ): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.send(peer, message);
        return;
      } catch (err) {
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, backoffMs * (attempt + 1)));
        }
        // After all retries exhausted, swallow — join/leave are best-effort
      }
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * Dispatch an incoming message (called by cluster routes when
   * HTTP requests arrive from peers).
   */
  dispatch(from: PeerAddress, msg: ClusterMessage): void {
    this.handler?.(from, msg);
  }

  // ── Internal ──────────────────────────────────────────────────

  private routeForMessage(msg: ClusterMessage): string {
    switch (msg.type) {
      case 'ping': return '/cluster/ping';
      case 'join': return '/cluster/join';
      case 'leave': return '/cluster/leave';
      case 'state-sync': return '/cluster/state-sync';
      case 'event-relay': return '/cluster/events';
      case 'ack': return '/cluster/ack';
      default: {
        const _exhaustive: never = msg;
        throw new Error(`Unknown cluster message type: ${(msg as ClusterMessage).type}`);
      }
    }
  }
}
