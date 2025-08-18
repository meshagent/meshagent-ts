/** A simple broadcast event emitter for "RoomEvent". */
export class StreamController<T> {
  private closed = false;

  // One entry per active iterator
  private subs = new Set<{
    queue: T[];
    waiter: ((r: IteratorResult<T>) => void) | null;
  }>();

  get stream(): AsyncIterable<T> {
    const self = this;

    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        // Each iterator gets its own queue + waiter
        const sub = {
          queue: [] as T[],
          waiter: null as ((r: IteratorResult<T>) => void) | null
        };

        self.subs.add(sub);

        const cleanup = () => {
          // Resolve any pending waiter as done and remove the sub
          if (sub.waiter) {
            const w = sub.waiter;
            sub.waiter = null;

            w({ done: true, value: undefined as any });
          }
          self.subs.delete(sub);
        };

        return {
          async next(): Promise<IteratorResult<T>> {
            if (sub.queue.length > 0) {
              return { done: false, value: sub.queue.shift()! };
            }
            if (self.closed) {
              cleanup();
              return { done: true, value: undefined as any };
            }
            // Otherwise park this iterator until the next add()/close()
            return new Promise<IteratorResult<T>>(resolve => {
              sub.waiter = resolve;
            });
          },

          async return(): Promise<IteratorResult<T>> {
            // Consumer stopped early
            cleanup();
            return { done: true, value: undefined as any };
          },

          async throw(e?: unknown): Promise<IteratorResult<T>> {
            cleanup();
            return Promise.reject(e);
          }
        };
      }
    };
  }

  /** Broadcast a value to all current listeners (no replay for future listeners). */
  add(value: T): void {
    if (this.closed) return;

    // Snapshot to avoid issues if a waiter unsubscribes inside a callback
    for (const sub of [...this.subs]) {
      if (sub.waiter) {
        const w = sub.waiter;

        sub.waiter = null;

        // Deliver immediately to a parked iterator
        w({ done: false, value });
      } else {
        // Buffer for this iterator to pull later
        sub.queue.push(value);
      }
    }
  }

  /** Complete the stream: all current listeners receive done=true. */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    for (const sub of [...this.subs]) {
      if (sub.waiter) {
        const w = sub.waiter;
        sub.waiter = null;

        w({ done: true, value: undefined as any });
      }
    }
  }
}
