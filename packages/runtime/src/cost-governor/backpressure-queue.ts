/**
 * Backpressure Queue — async FIFO queue with abort support.
 *
 * Callers wait for capacity; abort signal removes them from
 * the queue without keeping the event loop alive.
 */

interface QueueEntry {
  resolve: (value: void) => void;
  reject: (reason: unknown) => void;
  cleanup: () => void;
  removed: boolean;
}

export class BackpressureQueue {
  private queue: QueueEntry[] = [];

  get size(): number {
    return this.queue.filter(e => !e.removed).length;
  }

  /**
   * Wait until signalled. Rejects with an Error if signal fires
   * or timeoutMs elapses.
   */
  enqueue(timeoutMs: number, abortSignal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (abortSignal?.aborted) {
        reject(new Error('Aborted before enqueue'));
        return;
      }

      let timer: NodeJS.Timeout | undefined;
      let abortHandler: (() => void) | undefined;

      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (abortHandler && abortSignal) {
          abortSignal.removeEventListener('abort', abortHandler);
          abortHandler = undefined;
        }
      };

      const entry: QueueEntry = {
        resolve: (v) => { cleanup(); resolve(v); },
        reject: (r) => { cleanup(); reject(r); },
        cleanup,
        removed: false,
      };

      timer = setTimeout(() => {
        entry.removed = true;
        entry.reject(new Error(`Queue wait exceeded ${timeoutMs}ms`));
      }, timeoutMs);

      if (abortSignal) {
        abortHandler = () => {
          entry.removed = true;
          entry.reject(new Error('Aborted while queued'));
        };
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      this.queue.push(entry);
    });
  }

  /** Signal the next non-removed entry in the queue. */
  dequeue(): boolean {
    while (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      if (!entry.removed) {
        entry.resolve();
        return true;
      }
    }
    return false;
  }

  /** Remove all entries, rejecting them. */
  clear(): void {
    const entries = this.queue;
    this.queue = [];
    for (const entry of entries) {
      if (!entry.removed) {
        entry.removed = true;
        entry.reject(new Error('Queue cleared'));
      }
    }
  }
}
