// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackpressureQueue } from './backpressure-queue.js';

test('enqueue + dequeue resolves in FIFO order', async () => {
  const queue = new BackpressureQueue();
  const order: number[] = [];

  const p1 = queue.enqueue(5000).then(() => order.push(1));
  const p2 = queue.enqueue(5000).then(() => order.push(2));

  assert.equal(queue.size, 2);

  queue.dequeue();
  await p1;
  queue.dequeue();
  await p2;

  assert.deepEqual(order, [1, 2]);
});

test('dequeue returns false when empty', () => {
  const queue = new BackpressureQueue();
  assert.equal(queue.dequeue(), false);
});

test('timeout rejects after timeoutMs', async () => {
  const queue = new BackpressureQueue();
  await assert.rejects(
    queue.enqueue(10),
    (err: Error) => err.message.includes('exceeded'),
  );
});

test('abort signal rejects', async () => {
  const queue = new BackpressureQueue();
  const ac = new AbortController();
  const p = queue.enqueue(5000, ac.signal);
  ac.abort();
  await assert.rejects(p, (err: Error) => err.message.includes('Aborted'));
  assert.equal(queue.size, 0);
});

test('already-aborted signal rejects synchronously', async () => {
  const queue = new BackpressureQueue();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    queue.enqueue(5000, ac.signal),
    (err: Error) => err.message.includes('Aborted'),
  );
});

test('clear rejects all entries', async () => {
  const queue = new BackpressureQueue();
  const p1 = queue.enqueue(5000);
  const p2 = queue.enqueue(5000);
  queue.clear();
  await assert.rejects(p1);
  await assert.rejects(p2);
  assert.equal(queue.size, 0);
});
