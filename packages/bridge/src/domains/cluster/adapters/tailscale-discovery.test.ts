// SPDX-License-Identifier: Apache-2.0
/**
 * Tailscale Discovery Adapter — tests.
 *
 * Uses injected exec/probe overrides to avoid real shell commands
 * and network calls.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TailscaleDiscovery, type ExecFn, type ProbeFn } from './tailscale-discovery.js';

// ── Helpers ────────────────────────────────────────────────────

function makeLogger() {
  const messages: string[] = [];
  return {
    messages,
    info(msg: string) { messages.push(msg); },
    warn(msg: string) { messages.push(msg); },
  };
}

const TAILSCALE_STATUS_JSON = JSON.stringify({
  Self: { DNSName: 'self-node.ts.net.', TailscaleIPs: ['100.64.0.1'] },
  Peer: {
    'peer-key-1': {
      DNSName: 'mission-control.ts.net.',
      HostName: 'mission-control',
      TailscaleIPs: ['100.64.0.2'],
      Online: true,
    },
    'peer-key-2': {
      DNSName: 'dev-laptop.ts.net.',
      HostName: 'dev-laptop',
      TailscaleIPs: ['100.64.0.3'],
      Online: true,
    },
    'peer-key-3': {
      DNSName: 'offline-node.ts.net.',
      HostName: 'offline-node',
      TailscaleIPs: ['100.64.0.4'],
      Online: false,
    },
  },
});

// ── Tests ──────────────────────────────────────────────────────

describe('TailscaleDiscovery', () => {

  // 1. Tailscale API available — discovers peers
  it('discovers peers via Tailscale CLI when available', async () => {
    const logger = makeLogger();

    const exec: ExecFn = async (cmd, args) => {
      assert.equal(cmd, 'tailscale');
      assert.deepEqual(args, ['status', '--json']);
      return TAILSCALE_STATUS_JSON;
    };

    // Probe: mission-control responds, dev-laptop does not
    const probe: ProbeFn = async (url) => {
      return url.includes('mission-control');
    };

    const discovery = new TailscaleDiscovery(
      { bridgePort: 3456, seeds: '' },
      logger,
      { exec, probe },
    );

    const peers = await discovery.discover();

    assert.equal(peers.length, 1);
    assert.equal(peers[0].host, 'mission-control.ts.net');
    assert.equal(peers[0].port, 3456);
  });

  // 2. Tailscale API unavailable + seeds configured — uses seeds
  it('falls back to seeds when Tailscale is unavailable', async () => {
    const logger = makeLogger();

    const exec: ExecFn = async () => {
      throw new Error('tailscale: not found');
    };

    const discovery = new TailscaleDiscovery(
      { bridgePort: 3456, seeds: 'peer-1.local:3456,peer-2.local' },
      logger,
      { exec },
    );

    const peers = await discovery.discover();

    assert.equal(peers.length, 2);
    assert.equal(peers[0].host, 'peer-1.local');
    assert.equal(peers[0].port, 3456);
    assert.equal(peers[1].host, 'peer-2.local');
    assert.equal(peers[1].port, 3456); // default port when not specified

    assert.ok(logger.messages.some(m => m.includes('Tailscale API unavailable')));
  });

  // 3. No Tailscale, no seeds — returns empty array
  it('returns empty array when no Tailscale and no seeds', async () => {
    const logger = makeLogger();

    const exec: ExecFn = async () => {
      throw new Error('tailscale: not found');
    };

    const discovery = new TailscaleDiscovery(
      { bridgePort: 3456, seeds: '' },
      logger,
      { exec },
    );

    const peers = await discovery.discover();
    assert.equal(peers.length, 0);
  });
});
