// ── Network Provider Port ───────────────────────────────────────
//
// How a bridge sends and receives messages to/from peers. Implementations
// might use HTTP POST, WebSocket, raw TCP, etc. The cluster package
// never imports a specific transport — all I/O enters through this port.

import type { PeerAddress, ClusterMessage } from '../types.js';

/**
 * Port interface for peer-to-peer messaging.
 *
 * Implementations are injected at the composition root (L4).
 * The cluster package only depends on this interface, never on
 * a concrete transport mechanism.
 */
export interface NetworkProvider {
  /** Send a message to a specific peer. */
  send(peer: PeerAddress, message: ClusterMessage): Promise<void>;

  /** Register a handler for incoming messages from peers. */
  onMessage(handler: (from: PeerAddress, msg: ClusterMessage) => void): void;
}
