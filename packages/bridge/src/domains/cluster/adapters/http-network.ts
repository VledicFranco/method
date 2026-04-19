// SPDX-License-Identifier: Apache-2.0
// ── HTTP Network Adapter ────────────────────────────────────────
//
// NetworkProvider implementation using Node.js built-in fetch (22+).
// Sends cluster messages as HTTP POST with JSON body to peer
// bridges. Incoming messages are dispatched from the cluster
// HTTP routes — not from this adapter directly.

import type { NetworkProvider } from '@methodts/cluster';
import type { PeerAddress, ClusterMessage } from '@methodts/cluster';

// ── Types ─────────────────────────────────────────────────────

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

type MessageHandler = (from: PeerAddress, msg: ClusterMessage) => void;

// ── Implementation ────────────────────────────────────────────

export class HttpNetwork implements NetworkProvider {
  private handler: MessageHandler | null = null;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;

  constructor(overrides?: { fetch?: FetchFn; timeoutMs?: number }) {
    this.fetchFn = overrides?.fetch ?? globalThis.fetch;
    this.timeoutMs = overrides?.timeoutMs ?? 5000;
  }

  async send(peer: PeerAddress, message: ClusterMessage): Promise<void> {
    // Map message type to the appropriate cluster route
    const route = this.routeForMessage(message);
    const url = `http://${peer.host}:${peer.port}${route}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${peer.host}:${peer.port}${route}`);
      }
    } finally {
      clearTimeout(timer);
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
      default: return '/cluster/ping';
    }
  }
}
