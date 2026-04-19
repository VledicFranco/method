// SPDX-License-Identifier: Apache-2.0
// ── Event Relay ─────────────────────────────────────────────────
//
// Federates bridge events across cluster peers. Decides which local
// events should be relayed to remote bridges based on severity and
// domain filters. Prevents relay loops by checking the `federated`
// flag on incoming events.
//
// Zero transport dependencies — sends via the injected NetworkProvider.

import type { NetworkProvider } from '../ports/network-provider.js';
import type { ClusterNode, FederatedEvent } from '../types.js';
import { EventRelayConfigSchema, type EventRelayConfig, type EventSeverity } from './event-relay.config.js';

// ── Relay Event Shape ──────────────────────────────────────────
//
// The relay works with events that may or may not have federation
// metadata attached. Local events lack sourceNodeId and federated;
// the relay stamps them before sending.

/** An event as seen by the relay — may be local (no federation fields) or already federated. */
export interface RelayableEvent {
  domain: string;
  type?: string;
  severity: EventSeverity;
  payload?: Record<string, unknown>;
  timestamp: number;
  /** Present on events already relayed from another node. */
  sourceNodeId?: string;
  /** True if this event was received via federation — do not re-relay. */
  federated?: boolean;
}

// ── EventRelay ─────────────────────────────────────────────────

export class EventRelay {
  private readonly network: NetworkProvider;
  private readonly config: Required<EventRelayConfig>;
  private readonly severitySet: Set<string>;
  private readonly domainSet: Set<string>;

  constructor(
    network: NetworkProvider,
    config: Partial<EventRelayConfig> = {},
  ) {
    this.network = network;
    this.config = EventRelayConfigSchema.parse(config) as Required<EventRelayConfig>;
    this.severitySet = new Set(this.config.severityFilter);
    this.domainSet = new Set(this.config.domainFilter);
  }

  /**
   * Decide whether an event should be relayed to peers.
   *
   * Rules:
   * 1. Federation must be enabled.
   * 2. Events already federated (federated: true) are never re-relayed (loop prevention).
   * 3. Event severity must match the severity filter.
   * 4. Event domain must match the domain filter (empty filter = all domains pass).
   */
  shouldRelay(event: RelayableEvent): boolean {
    if (!this.config.federationEnabled) return false;
    if (event.federated === true) return false;
    if (!this.severitySet.has(event.severity)) return false;
    if (this.domainSet.size > 0 && !this.domainSet.has(event.domain)) return false;
    return true;
  }

  /**
   * Relay an event to all alive peers.
   *
   * - Checks `shouldRelay` first; no-ops if the event doesn't pass filters.
   * - Tags outgoing events with `sourceNodeId` and `federated: true`.
   * - Sends to each alive peer via the NetworkProvider.
   * - If no alive peers exist, the event is silently dropped (no error).
   */
  async relay(
    event: RelayableEvent,
    sourceNodeId: string,
    peers: ClusterNode[],
  ): Promise<void> {
    if (!this.shouldRelay(event)) return;

    const alivePeers = peers.filter(p => p.status === 'alive');
    if (alivePeers.length === 0) return;

    const federatedEvent: FederatedEvent = {
      domain: event.domain,
      type: event.type ?? `${event.domain}.unknown`,
      severity: event.severity,
      payload: event.payload ?? {},
      timestamp: event.timestamp,
      sourceNodeId,
    };

    const message = {
      type: 'event-relay' as const,
      from: sourceNodeId,
      events: [federatedEvent],
    };

    const sends = alivePeers.map(peer =>
      this.network.send(peer.address, message),
    );

    await Promise.allSettled(sends);
  }
}
