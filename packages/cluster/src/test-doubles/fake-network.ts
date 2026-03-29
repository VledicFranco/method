import type { NetworkProvider } from '../ports/network-provider.js';
import type { PeerAddress, ClusterMessage } from '../types.js';

export class FakeNetwork implements NetworkProvider {
  public sent: Array<{ peer: PeerAddress; message: ClusterMessage }> = [];
  private handler: ((from: PeerAddress, msg: ClusterMessage) => void) | null = null;

  async send(peer: PeerAddress, message: ClusterMessage): Promise<void> {
    this.sent.push({ peer, message });
  }

  onMessage(handler: (from: PeerAddress, msg: ClusterMessage) => void): void {
    this.handler = handler;
  }

  deliver(from: PeerAddress, msg: ClusterMessage): void {
    this.handler?.(from, msg);
  }
}
