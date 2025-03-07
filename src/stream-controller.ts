/** A simple broadcast event emitter for "RoomEvent". */
export class StreamController<T> {
  private closed = false;

  get stream(): AsyncIterable<T> {
    const self = this;

    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<T>> {
            if (self.queue.length > 0) {
              return {
                  done: false,
                  value: self.queue.shift()!
              };
            }
            if (self.closed) {
              return {
                  done: true,
                  value: undefined
              };
            }
            return new Promise<IteratorResult<T>>((resolve) => {
              self.waiters.push(resolve);
            });
          },
        };
      },
    };
  }

  private queue: T[] = [];
  private waiters: Array<(res: IteratorResult<T>) => void> = [];

  add(value: T) {
    if (this.closed) return;

    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;

      waiter({done: false, value});
    } else {
      this.queue.push(value);
    }
  }

  close() {
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;

      waiter({done: true, value: undefined});
    }
  }
}
