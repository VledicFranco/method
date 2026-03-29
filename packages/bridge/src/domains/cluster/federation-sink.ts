// ── Cluster Federation Sink ─────────────────────────────────────
//
// EventSink implementation that federates local bridge events to
// cluster peers via the EventRelay from @method/cluster.
//
// Lives in domains/cluster/ because it IS cluster-specific logic —
// the bridge composition root registers it as a sink on the EventBus
// when cluster mode is enabled.
//
// Loop prevention: events with `federated: true` are skipped to avoid
// re-relaying events received from other bridges.

import type { BridgeEvent, EventSink } from '../../ports/event-bus.js';
import type { EventRelay } from '@method/cluster';
import type { ClusterDomain } from './core.js';
import type { ClusterNode } from '@method/cluster';

// ── ClusterFederationSink ─────────────────────────────────────

export class ClusterFederationSink implements EventSink {
  readonly name = 'cluster-federation';

  private readonly relay: EventRelay;
  private readonly cluster: ClusterDomain;
  private readonly selfNodeId: string;

  constructor(relay: EventRelay, cluster: ClusterDomain, selfNodeId: string) {
    this.relay = relay;
    this.cluster = cluster;
    this.selfNodeId = selfNodeId;
  }

  /**
   * Handle a bridge event by federating it to alive cluster peers.
   *
   * - Skip if event.federated === true (loop prevention).
   * - Get alive peers from the ClusterDomain state.
   * - Delegate to EventRelay.relay() which applies severity/domain filters.
   */
  async onEvent(event: BridgeEvent): Promise<void> {
    // Loop prevention — never re-relay events received from other bridges
    if (event.federated === true) return;

    const state = this.cluster.getState();
    if (!state) return;

    // Collect peers from cluster state
    const peers: ClusterNode[] = [];
    for (const [, node] of state.peers) {
      peers.push(node);
    }

    // Adapt BridgeEvent to the shape EventRelay.relay() expects.
    // EventRelay's RelayableEvent is not re-exported from @method/cluster,
    // but relay() accepts compatible structural types.
    const relayable = {
      domain: event.domain,
      type: event.type,
      severity: event.severity,
      payload: event.payload,
      timestamp: Date.parse(event.timestamp),
      sourceNodeId: event.sourceNodeId,
      federated: event.federated,
    };

    await this.relay.relay(relayable, this.selfNodeId, peers);
  }
}
