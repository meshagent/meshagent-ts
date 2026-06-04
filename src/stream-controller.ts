/** A simple broadcast event emitter for "RoomEvent". */
export class StreamController<T> {
  private closed = false;

  // One entry per active iterator
  private subs = new Set<{
    queue: Array<{ kind: "value"; value: T } | { kind: "error"; error: unknown }>;
    waiter: {
      resolve: (r: IteratorResult<T>) => void;
      reject: (error: unknown) => void;
    } | null;
  }>();

  get stream(): AsyncIterable<T> {
    const self = this;

    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        // Each iterator gets its own queue + waiter
        const sub = {
          queue: [] as Array<{ kind: "value"; value: T } | { kind: "error"; error: unknown }>,
          waiter: null as {
            resolve: (r: IteratorResult<T>) => void;
            reject: (error: unknown) => void;
          } | null
        };

        self.subs.add(sub);

        const cleanup = () => {
          // Resolve any pending waiter as done and remove the sub
          if (sub.waiter) {
            const w = sub.waiter;
            sub.waiter = null;

            w.resolve({ done: true, value: undefined as any });
          }
          self.subs.delete(sub);
        };

        return {
          async next(): Promise<IteratorResult<T>> {
            if (sub.queue.length > 0) {
              const item = sub.queue.shift()!;
              if (item.kind === "error") {
                cleanup();
                return Promise.reject(item.error);
              }
              return { done: false, value: item.value };
            }
            if (self.closed) {
              cleanup();
              return { done: true, value: undefined as any };
            }
            // Otherwise park this iterator until the next add()/close()
            return new Promise<IteratorResult<T>>((resolve, reject) => {
              sub.waiter = { resolve, reject };
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
        w.resolve({ done: false, value });
      } else {
        // Buffer for this iterator to pull later
        sub.queue.push({ kind: "value", value });
      }
    }
  }

  /** Fail the stream: current and already-created future iterators reject. */
  addError(error: unknown): void {
    if (this.closed) return;

    for (const sub of [...this.subs]) {
      if (sub.waiter) {
        const w = sub.waiter;
        sub.waiter = null;
        w.reject(error);
        this.subs.delete(sub);
      } else {
        sub.queue.push({ kind: "error", error });
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

        w.resolve({ done: true, value: undefined as any });
      }
    }
  }
}
