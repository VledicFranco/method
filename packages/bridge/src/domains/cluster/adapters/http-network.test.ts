/**
 * HTTP Network Adapter — tests.
 *
 * Uses injected fetch override to avoid real HTTP calls.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpNetwork, type FetchFn } from './http-network.js';
import type { PeerAddress, ClusterMessage } from '@method/cluster';

// ── Tests ──────────────────────────────────────────────────────

describe('HttpNetwork', () => {

  // 1. send() makes HTTP POST with correct headers
  it('sends messages as HTTP POST with JSON body', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];

    const fakeFetch: FetchFn = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ acknowledged: true }), { status: 200 });
    };

    const network = new HttpNetwork({ fetch: fakeFetch });

    const peer: PeerAddress = { host: 'peer-1.ts.net', port: 3456 };
    const msg: ClusterMessage = { type: 'ping', from: 'self-node', generation: 1 };

    await network.send(peer, msg);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://peer-1.ts.net:3456/cluster/ping');
    assert.equal((calls[0].init.headers as Record<string, string>)['Content-Type'], 'application/json');
    assert.equal(calls[0].init.method, 'POST');

    const sentBody = JSON.parse(calls[0].init.body as string);
    assert.equal(sentBody.type, 'ping');
    assert.equal(sentBody.from, 'self-node');
    assert.equal(sentBody.generation, 1);
  });

  // 2. onMessage handler receives dispatched messages
  it('dispatches incoming messages to registered handler', () => {
    const network = new HttpNetwork();

    const received: Array<{ from: PeerAddress; msg: ClusterMessage }> = [];
    network.onMessage((from, msg) => {
      received.push({ from, msg });
    });

    const from: PeerAddress = { host: 'peer-2.ts.net', port: 3456 };
    const msg: ClusterMessage = { type: 'ping', from: 'peer-2', generation: 5 };

    network.dispatch(from, msg);

    assert.equal(received.length, 1);
    assert.equal(received[0].from.host, 'peer-2.ts.net');
    assert.equal(received[0].msg.type, 'ping');
    assert.equal((received[0].msg as { from: string }).from, 'peer-2');
  });
});
