// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for HttpBridgeSLMRuntime — PRD 057.
 *
 * Uses a global fetch override (vi-style) since pacta has no http-mock
 * dependency. Each test installs and restores its own stub.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HttpBridgeSLMRuntime } from './http-bridge.js';
import { SLMInferenceError, SLMLoadError, SLMNotAvailable } from './errors.js';

const realFetch = globalThis.fetch;

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function installFetchStub(handler: (req: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler({ url, init });
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

describe('HttpBridgeSLMRuntime', () => {
  let stub: { calls: FetchCall[]; restore: () => void };

  beforeEach(() => {
    stub = { calls: [], restore: () => {} };
  });
  afterEach(() => {
    stub.restore();
  });

  it('load() succeeds when /health reports model_loaded=true', async () => {
    stub = installFetchStub(() =>
      new Response(JSON.stringify({ model_loaded: true, status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const r = new HttpBridgeSLMRuntime({ baseUrl: 'http://chobits:8100' });
    await r.load();
    assert.equal(r.isLoaded(), true);
    assert.match(stub.calls[0]!.url, /\/health$/);
  });

  it('load() rejects with SLMNotAvailable when /health is unreachable', async () => {
    stub = installFetchStub(() => {
      throw new TypeError('connect ECONNREFUSED');
    });
    const r = new HttpBridgeSLMRuntime({ baseUrl: 'http://chobits:8100' });
    await assert.rejects(() => r.load(), SLMNotAvailable);
  });

  it('load() rejects with SLMNotAvailable on non-200 status', async () => {
    stub = installFetchStub(() => new Response('', { status: 500 }));
    const r = new HttpBridgeSLMRuntime({ baseUrl: 'http://chobits:8100' });
    await assert.rejects(() => r.load(), SLMNotAvailable);
  });

  it('load() rejects with SLMLoadError when model_loaded=false', async () => {
    stub = installFetchStub(() =>
      new Response(JSON.stringify({ model_loaded: false, status: 'no_model' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const r = new HttpBridgeSLMRuntime({ baseUrl: 'http://chobits:8100' });
    await assert.rejects(() => r.load(), SLMLoadError);
  });

  it('infer() throws SLMInferenceError before load()', async () => {
    const r = new HttpBridgeSLMRuntime({ baseUrl: 'http://chobits:8100' });
    await assert.rejects(() => r.infer('hi'), SLMInferenceError);
  });

  it('infer() POSTs to /generate with input + max_length', async () => {
    let phase: 'health' | 'gen' = 'health';
    stub = installFetchStub((req) => {
      if (phase === 'health') {
        phase = 'gen';
        return new Response(JSON.stringify({ model_loaded: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      assert.match(req.url, /\/generate$/);
      assert.equal(req.init?.method, 'POST');
      const body = JSON.parse((req.init?.body as string) ?? '{}');
      assert.equal(body.input, 'hello');
      assert.equal(body.max_length, 256);
      return new Response(
        JSON.stringify({ output: 'world', confidence: 0.9, latency_ms: 8 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const r = new HttpBridgeSLMRuntime({ baseUrl: 'http://chobits:8100' });
    await r.load();
    const result = await r.infer('hello');
    assert.equal(result.output, 'world');
    assert.equal(result.confidence, 0.9);
    assert.equal(result.inferenceMs, 8); // server-reported preferred
    assert.equal(result.escalated, false);
  });

  it('infer() falls back to wall-clock when latency_ms missing', async () => {
    let phase: 'health' | 'gen' = 'health';
    stub = installFetchStub(() => {
      if (phase === 'health') {
        phase = 'gen';
        return new Response(JSON.stringify({ model_loaded: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ output: 'x', confidence: 0.5 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const r = new HttpBridgeSLMRuntime({ baseUrl: 'http://chobits:8100' });
    await r.load();
    const result = await r.infer('q');
    assert.ok(result.inferenceMs >= 0);
  });

  it('infer() throws SLMInferenceError on non-200', async () => {
    let phase: 'health' | 'gen' = 'health';
    stub = installFetchStub(() => {
      if (phase === 'health') {
        phase = 'gen';
        return new Response(JSON.stringify({ model_loaded: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('', { status: 500 });
    });
    const r = new HttpBridgeSLMRuntime({ baseUrl: 'http://chobits:8100' });
    await r.load();
    await assert.rejects(() => r.infer('q'), SLMInferenceError);
  });
});
