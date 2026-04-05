import { test } from 'node:test';
import assert from 'node:assert/strict';
import { throttler, brandSlotId } from './throttler.js';
import type { RateGovernor, DispatchSlot, AcquireOptions, ObserveOutcome } from '../ports/rate-governor.js';
import type { AccountId } from '@method/types';
import {
  RateLimitError,
  AuthError,
  NetworkError,
  TimeoutError,
  InvalidRequestError,
} from '../errors.js';
import type { Pact, AgentRequest, AgentResult } from '../pact.js';

const CLI_CTX = { providerClass: 'claude-cli' as const };

// Mock RateGovernor that tracks acquire/release calls
function makeMockGovernor() {
  const acquires: AcquireOptions[] = [];
  const releases: ObserveOutcome[] = [];
  let slotCounter = 0;

  const governor: RateGovernor = {
    async acquireSlot(opts) {
      acquires.push(opts);
      const slot: DispatchSlot = {
        slotId: brandSlotId(`slot-${slotCounter++}`),
        providerClass: opts.providerClass,
        accountId: 'default' as AccountId,
        acquiredAt: Date.now(),
        estimatedCostUsd: opts.estimatedCostUsd,
        maxLifetimeMs: 60_000,
      };
      return slot;
    },
    async releaseSlot(outcome) {
      releases.push(outcome);
    },
  };

  return { governor, acquires, releases };
}

const pact: Pact = { mode: { type: 'oneshot' } };
const request: AgentRequest = { prompt: 'test', workdir: process.cwd() };

const makeResult = (): AgentResult => ({
  output: 'ok',
  sessionId: 'sess-1',
  completed: true,
  stopReason: 'complete',
  usage: {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 150,
  },
  cost: { totalUsd: 0.03, perModel: {} },
  durationMs: 1500,
  turns: 1,
});

test('acquires slot before invoking inner', async () => {
  const { governor, acquires } = makeMockGovernor();
  let innerCalled = false;
  const inner = async () => {
    assert.equal(acquires.length, 1, 'slot must be acquired before invoke');
    innerCalled = true;
    return makeResult();
  };
  const wrapped = throttler(inner, { rateGovernor: governor, providerClass: 'claude-cli' });
  await wrapped(pact, request);
  assert.ok(innerCalled);
  assert.equal(acquires.length, 1);
  assert.equal(acquires[0].providerClass, 'claude-cli');
});

test('releases slot on success with outcome=success', async () => {
  const { governor, releases } = makeMockGovernor();
  const inner = async () => makeResult();
  const wrapped = throttler(inner, { rateGovernor: governor, providerClass: 'claude-cli' });
  await wrapped(pact, request);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].outcome, 'success');
  assert.equal(releases[0].actualCostUsd, 0.03);
});

test('releases slot on RateLimitError with outcome=rate_limited', async () => {
  const { governor, releases } = makeMockGovernor();
  const inner = async () => {
    throw new RateLimitError(CLI_CTX);
  };
  const wrapped = throttler(inner, { rateGovernor: governor, providerClass: 'claude-cli' });
  await assert.rejects(wrapped(pact, request), RateLimitError);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].outcome, 'rate_limited');
});

test('releases slot on TransientError (Network) with outcome=transient_error', async () => {
  const { governor, releases } = makeMockGovernor();
  const inner = async () => {
    throw new NetworkError(CLI_CTX);
  };
  const wrapped = throttler(inner, { rateGovernor: governor, providerClass: 'claude-cli' });
  await assert.rejects(wrapped(pact, request), NetworkError);
  assert.equal(releases[0].outcome, 'transient_error');
});

test('releases slot on TimeoutError with outcome=timeout', async () => {
  const { governor, releases } = makeMockGovernor();
  const inner = async () => {
    throw new TimeoutError({ ...CLI_CTX, timeoutMs: 5000 });
  };
  const wrapped = throttler(inner, { rateGovernor: governor, providerClass: 'claude-cli' });
  await assert.rejects(wrapped(pact, request), TimeoutError);
  assert.equal(releases[0].outcome, 'timeout');
});

test('releases slot on PermanentError (Auth) with outcome=permanent_error', async () => {
  const { governor, releases } = makeMockGovernor();
  const inner = async () => {
    throw new AuthError(CLI_CTX);
  };
  const wrapped = throttler(inner, { rateGovernor: governor, providerClass: 'claude-cli' });
  await assert.rejects(wrapped(pact, request), AuthError);
  assert.equal(releases[0].outcome, 'permanent_error');
});

test('releases slot on PermanentError (InvalidRequest) with outcome=permanent_error', async () => {
  const { governor, releases } = makeMockGovernor();
  const inner = async () => {
    throw new InvalidRequestError(CLI_CTX);
  };
  const wrapped = throttler(inner, { rateGovernor: governor, providerClass: 'claude-cli' });
  await assert.rejects(wrapped(pact, request), InvalidRequestError);
  assert.equal(releases[0].outcome, 'permanent_error');
});

test('releases slot on unknown error with outcome=transient_error (conservative)', async () => {
  const { governor, releases } = makeMockGovernor();
  const inner = async () => {
    throw new Error('mystery');
  };
  const wrapped = throttler(inner, { rateGovernor: governor, providerClass: 'claude-cli' });
  await assert.rejects(wrapped(pact, request), Error);
  assert.equal(releases[0].outcome, 'transient_error');
});

test('passes slotTimeoutMs to acquireSlot', async () => {
  const { governor, acquires } = makeMockGovernor();
  const inner = async () => makeResult();
  const wrapped = throttler(inner, {
    rateGovernor: governor,
    providerClass: 'claude-cli',
    slotTimeoutMs: 10_000,
  });
  await wrapped(pact, request);
  assert.equal(acquires[0].timeoutMs, 10_000);
});

test('propagates abort signal to acquireSlot', async () => {
  const { governor, acquires } = makeMockGovernor();
  const inner = async () => makeResult();
  const ac = new AbortController();
  const wrapped = throttler(inner, { rateGovernor: governor, providerClass: 'claude-cli' });
  await wrapped(pact, { ...request, abortSignal: ac.signal });
  assert.strictEqual(acquires[0].abortSignal, ac.signal);
});

test('attemptCount reflects inner turns count', async () => {
  const { governor, releases } = makeMockGovernor();
  const inner = async () => ({ ...makeResult(), turns: 3 });
  const wrapped = throttler(inner, { rateGovernor: governor, providerClass: 'claude-cli' });
  await wrapped(pact, request);
  assert.equal(releases[0].attemptCount, 3);
});
