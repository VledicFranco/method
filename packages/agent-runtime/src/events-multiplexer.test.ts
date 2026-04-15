/**
 * Unit tests for EventsMultiplexer — PRD-058 §6.4 D4 + §4 criterion 6.
 *
 * Focus:
 *   - `events()` + `onEvent` mutual exclusion (G-EVENTS-MUTEX)
 *   - async-iterable semantics (attach-before-invoke, single-consumer)
 *   - user callback isolation (R6)
 *   - overflow drop-oldest (PRD-058 §12 Judgment Call 1)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentEvent } from '@method/pacta';
import { EventsMultiplexer } from './events-multiplexer.js';
import { IllegalStateError } from './errors.js';

function textEvent(content: string): AgentEvent {
  return { type: 'text', content };
}

describe('EventsMultiplexer', () => {
  it('fans out to user onEvent callback', () => {
    const seen: string[] = [];
    const mux = new EventsMultiplexer({
      asyncIterableEnabled: false,
      onEvent: (e) => {
        if (e.type === 'text') seen.push(e.content);
      },
    });
    mux.fanIn(textEvent('a'));
    mux.fanIn(textEvent('b'));
    assert.deepStrictEqual(seen, ['a', 'b']);
  });

  it('G-EVENTS-MUTEX: events() throws IllegalStateError when onEvent was provided', () => {
    const mux = new EventsMultiplexer({
      asyncIterableEnabled: true,
      onEvent: () => {
        /* no-op */
      },
    });
    assert.throws(() => mux.events(), IllegalStateError);
  });

  it('events() throws IllegalStateError when async-iterable not enabled', () => {
    const mux = new EventsMultiplexer({ asyncIterableEnabled: false });
    assert.throws(() => mux.events(), IllegalStateError);
  });

  it('events() async-iterable delivers queued + live events', async () => {
    const mux = new EventsMultiplexer({ asyncIterableEnabled: true });
    const iterable = mux.events();
    const iterator = iterable[Symbol.asyncIterator]();

    // Emit before consumer reads — queued.
    mux.fanIn(textEvent('pre-1'));
    mux.fanIn(textEvent('pre-2'));

    // Drain queued.
    const first = await iterator.next();
    assert.deepStrictEqual(first.value, textEvent('pre-1'));
    const second = await iterator.next();
    assert.deepStrictEqual(second.value, textEvent('pre-2'));

    // Next read waits — then a live event fulfills it.
    const thirdP = iterator.next();
    mux.fanIn(textEvent('live-1'));
    const third = await thirdP;
    assert.deepStrictEqual(third.value, textEvent('live-1'));

    // Close releases pending waiters with done:true.
    const pendingP = iterator.next();
    mux.close();
    const pending = await pendingP;
    assert.strictEqual(pending.done, true);
  });

  it('events() can only be iterated once per handle', () => {
    const mux = new EventsMultiplexer({ asyncIterableEnabled: true });
    mux.events();
    assert.throws(() => mux.events(), IllegalStateError);
  });

  it('R6: user onEvent throw does NOT crash fanIn or skip internal subscribers', () => {
    const internal: string[] = [];
    const logs: string[] = [];
    const mux = new EventsMultiplexer({
      asyncIterableEnabled: false,
      onEvent: () => {
        throw new Error('boom');
      },
      internalSubscribers: [
        (e) => {
          if (e.type === 'text') internal.push(e.content);
        },
      ],
      logger: {
        info: () => {
          /* no-op */
        },
        warn: (msg) => {
          logs.push(msg);
        },
        error: () => {
          /* no-op */
        },
      },
    });
    mux.fanIn(textEvent('ok'));
    assert.deepStrictEqual(internal, ['ok']);
    assert.strictEqual(logs.length, 1, 'user-callback throw logged');
    assert.match(logs[0]!, /user onEvent callback threw/);
  });

  it('overflow: drop-oldest + warn when queue exceeds capacity', async () => {
    const warnings: string[] = [];
    const mux = new EventsMultiplexer({
      asyncIterableEnabled: true,
      queueCapacity: 3,
      logger: {
        info: () => {
          /* no-op */
        },
        warn: (msg) => {
          warnings.push(msg);
        },
        error: () => {
          /* no-op */
        },
      },
    });
    // No consumer yet → queue fills.
    mux.fanIn(textEvent('1'));
    mux.fanIn(textEvent('2'));
    mux.fanIn(textEvent('3'));
    mux.fanIn(textEvent('4')); // drops '1'
    mux.fanIn(textEvent('5')); // drops '2'

    const iterator = mux.events()[Symbol.asyncIterator]();
    const a = await iterator.next();
    const b = await iterator.next();
    const c = await iterator.next();
    assert.deepStrictEqual([a.value, b.value, c.value].map((e) => (e as any).content), ['3', '4', '5']);
    assert.strictEqual(warnings.length, 2, 'two drops => two warnings');
  });
});
