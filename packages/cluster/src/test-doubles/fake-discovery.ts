import type { DiscoveryProvider } from '../ports/discovery-provider.js';
import type { PeerAddress, NodeIdentity } from '../types.js';

export class FakeDiscovery implements DiscoveryProvider {
  public peers: PeerAddress[] = [];
  public announced: NodeIdentity[] = [];

  async discover(): Promise<PeerAddress[]> {
    return this.peers;
  }

  async announce(self: NodeIdentity): Promise<void> {
    this.announced.push(self);
  }
}
