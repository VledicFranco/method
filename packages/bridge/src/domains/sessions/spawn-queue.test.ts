import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SpawnQueue } from './spawn-queue.js';

describe('SpawnQueue', () => {
  it('executes a single enqueued operation', async () => {
    const queue = new SpawnQueue({ minGapMs: 0 });
    const result = await queue.enqueue(() => Promise.resolve('hello'));
    assert.equal(result, 'hello');
  });

  it('enforces minimum gap between consecutive spawns', async () => {
    const gapMs = 100;
    const queue = new SpawnQueue({ minGapMs: gapMs });
    const timestamps: number[] = [];

    await queue.enqueue(async () => { timestamps.push(Date.now()); });
    await queue.enqueue(async () => { timestamps.push(Date.now()); });

    assert.equal(timestamps.length, 2);
    const elapsed = timestamps[1] - timestamps[0];
    assert.ok(elapsed >= gapMs - 20, `Expected >= ${gapMs - 20}ms gap, got ${elapsed}ms`);
  });

  it('does not delay the first spawn', async () => {
    const queue = new SpawnQueue({ minGapMs: 5000 });
    const before = Date.now();
    await queue.enqueue(async () => 'fast');
    const elapsed = Date.now() - before;
    assert.ok(elapsed < 100, `First spawn should be immediate, took ${elapsed}ms`);
  });

  it('serializes concurrent enqueue calls', async () => {
    const gapMs = 50;
    const queue = new SpawnQueue({ minGapMs: gapMs });
    const order: number[] = [];

    const p1 = queue.enqueue(async () => { order.push(1); return 1; });
    const p2 = queue.enqueue(async () => { order.push(2); return 2; });
    const p3 = queue.enqueue(async () => { order.push(3); return 3; });

    const results = await Promise.all([p1, p2, p3]);

    assert.deepEqual(order, [1, 2, 3]);
    assert.deepEqual(results, [1, 2, 3]);
  });

  it('propagates errors without blocking the queue', async () => {
    const queue = new SpawnQueue({ minGapMs: 0 });

    await assert.rejects(
      () => queue.enqueue(async () => { throw new Error('boom'); }),
      /boom/,
    );

    const result = await queue.enqueue(async () => 'recovered');
    assert.equal(result, 'recovered');
  });

  it('reports pending count', async () => {
    const queue = new SpawnQueue({ minGapMs: 100 });

    assert.equal(queue.pending, 0);

    let pendingDuringSecond = -1;
    const p1 = queue.enqueue(async () => 'a');
    const p2 = queue.enqueue(async () => {
      pendingDuringSecond = queue.pending;
      return 'b';
    });
    const p3 = queue.enqueue(async () => 'c');

    await Promise.all([p1, p2, p3]);

    assert.equal(pendingDuringSecond, 1);
    assert.equal(queue.pending, 0);
  });

  it('uses default minGapMs when no options provided', async () => {
    const queue = new SpawnQueue();
    const result = await queue.enqueue(async () => 42);
    assert.equal(result, 42);
  });
});
