// SPDX-License-Identifier: Apache-2.0
// ── Discovery Provider Port ─────────────────────────────────────
//
// How a bridge finds other bridges in the cluster. Implementations
// might use Tailscale API, static seed lists, mDNS, gossip, etc.
// The cluster package never imports a specific discovery mechanism.

import type { PeerAddress, NodeIdentity } from '../types.js';

/**
 * Port interface for peer discovery.
 *
 * Implementations are injected at the composition root (L4).
 * The cluster package only depends on this interface, never on
 * a concrete discovery mechanism.
 */
export interface DiscoveryProvider {
  /** Discover currently reachable peer addresses. */
  discover(): Promise<PeerAddress[]>;

  /** Announce this node's identity to the discovery mechanism. */
  announce(self: NodeIdentity): Promise<void>;
}
