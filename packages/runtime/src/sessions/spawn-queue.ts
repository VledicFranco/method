// SPDX-License-Identifier: Apache-2.0
/**
 * SpawnQueue — enforces a minimum gap between PTY session spawns.
 *
 * Problem: concurrent spawns cause API rate-limit contention and resource
 * spikes (PRD 012 observation). The bridge HTTP handler already staggers
 * batch spawns with setTimeout, but individual bridge_spawn calls from
 * different orchestrators can still fire simultaneously.
 *
 * Solution: all spawn requests pass through SpawnQueue.enqueue(), which
 * ensures at least MIN_SPAWN_GAP_MS between actual PTY process launches.
 * The queue is FIFO and serializes execution.
 */

export interface SpawnQueueOptions {
  /** Minimum milliseconds between consecutive spawns. */
  minGapMs?: number;
}

const DEFAULT_MIN_SPAWN_GAP_MS = 2000;

export class SpawnQueue {
  private readonly minGapMs: number;
  private lastSpawnAt = 0;
  private queue: Array<{
    execute: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];
  private processing = false;

  constructor(options?: SpawnQueueOptions) {
    this.minGapMs = options?.minGapMs ?? DEFAULT_MIN_SPAWN_GAP_MS;
  }

  enqueue<T>(execute: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: execute as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });
  }

  get pending(): number {
    return this.queue.length;
  }

  get lastSpawnTime(): number {
    return this.lastSpawnAt;
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;

      const elapsed = Date.now() - this.lastSpawnAt;
      if (elapsed < this.minGapMs && this.lastSpawnAt > 0) {
        const waitMs = this.minGapMs - elapsed;
        await new Promise(r => setTimeout(r, waitMs));
      }

      try {
        const result = await item.execute();
        this.lastSpawnAt = Date.now();
        item.resolve(result);
      } catch (err) {
        this.lastSpawnAt = Date.now();
        item.reject(err);
      }
    }

    this.processing = false;
  }
}
