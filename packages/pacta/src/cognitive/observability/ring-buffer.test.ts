// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for TraceRingBuffer — PRD 058 C-1.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TraceRingBuffer } from './ring-buffer.js';
import type { TraceEvent } from '../algebra/trace-events.js';

const T0 = 1_700_000_000_000;

function mkEvent(name: string, t = T0): TraceEvent {
  return {
    eventId: `ev-${name}-${t}`,
    cycleId: 'c1',
    kind: 'operation',
    name,
    timestamp: t,
  };
}

describe('TraceRingBuffer', () => {
  it('buffers up to maxSize and evicts oldest on overflow', () => {
    const rb = new TraceRingBuffer({ maxSize: 3 });
    rb.onEvent(mkEvent('a'));
    rb.onEvent(mkEvent('b'));
    rb.onEvent(mkEvent('c'));
    assert.equal(rb.bufferSize, 3);
    rb.onEvent(mkEvent('d'));
    assert.equal(rb.bufferSize, 3);
    assert.deepEqual(
      rb.recent().map((e) => e.name),
      ['b', 'c', 'd'],
    );
  });

  it('recent(N) returns the last N events', () => {
    const rb = new TraceRingBuffer({ maxSize: 100 });
    for (let i = 0; i < 10; i++) rb.onEvent(mkEvent(`e${i}`));
    assert.deepEqual(
      rb.recent(3).map((e) => e.name),
      ['e7', 'e8', 'e9'],
    );
    assert.equal(rb.recent(0).length, 0);
    assert.equal(rb.recent().length, 10);
  });

  it('fans out events to multiple concurrent subscribers (AC-4)', async () => {
    const rb = new TraceRingBuffer();
    const a = rb.subscribe()[Symbol.asyncIterator]();
    const b = rb.subscribe()[Symbol.asyncIterator]();
    assert.equal(rb.subscriberCount, 2);

    // Emit two events.
    rb.onEvent(mkEvent('x'));
    rb.onEvent(mkEvent('y'));

    const aResults: string[] = [];
    const bResults: string[] = [];
    aResults.push((await a.next()).value!.name);
    aResults.push((await a.next()).value!.name);
    bResults.push((await b.next()).value!.name);
    bResults.push((await b.next()).value!.name);
    assert.deepEqual(aResults, ['x', 'y']);
    assert.deepEqual(bResults, ['x', 'y']);

    // Cleanup.
    await a.return!();
    await b.return!();
    assert.equal(rb.subscriberCount, 0);
  });

  it('subscriber that awaits before emit gets resolved on next event', async () => {
    const rb = new TraceRingBuffer();
    const it = rb.subscribe()[Symbol.asyncIterator]();
    const pending = it.next();
    rb.onEvent(mkEvent('z'));
    const result = await pending;
    assert.equal(result.value?.name, 'z');
    assert.equal(result.done, false);
    await it.return!();
  });

  it('drops slow subscribers that exceed subscriberQueueLimit (AC-4 eviction)', async () => {
    const rb = new TraceRingBuffer({ subscriberQueueLimit: 3 });
    const it = rb.subscribe()[Symbol.asyncIterator]();
    assert.equal(rb.subscriberCount, 1);

    // Push 4 events without consuming — exceeds limit of 3.
    rb.onEvent(mkEvent('e1'));
    rb.onEvent(mkEvent('e2'));
    rb.onEvent(mkEvent('e3'));
    rb.onEvent(mkEvent('e4'));

    // Subscriber should have been evicted on the 4th push.
    assert.equal(rb.subscriberCount, 0);
    await it.return!();
  });

  it('return() cleans up the subscription', async () => {
    const rb = new TraceRingBuffer();
    const it = rb.subscribe()[Symbol.asyncIterator]();
    assert.equal(rb.subscriberCount, 1);
    await it.return!();
    assert.equal(rb.subscriberCount, 0);
    // Subsequent next() returns done.
    const r = await it.next();
    assert.equal(r.done, true);
  });

  it('exit via for-await break cleans up', async () => {
    const rb = new TraceRingBuffer();
    const sub = rb.subscribe();
    queueMicrotask(() => {
      rb.onEvent(mkEvent('a'));
      rb.onEvent(mkEvent('b'));
    });
    const out: string[] = [];
    for await (const ev of sub) {
      out.push(ev.name);
      if (out.length === 2) break;
    }
    assert.deepEqual(out, ['a', 'b']);
    assert.equal(rb.subscriberCount, 0);
  });
});
