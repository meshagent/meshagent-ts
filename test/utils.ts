import { v4 as uuid } from "uuid";

export const room = 'test-room-' + uuid();

export function subscribe<T>(iterator: AsyncIterable<T>, { next, error, complete }: {
    next: (value: T) => void;
    error?: (err: Error) => void;
    complete?: () => void;
}) {
    const controller = new AbortController();

    (async () => {
        try {
            for await (const value of iterator) {
                if (controller.signal.aborted) {
                    break;
                }

                if (next) {
                    next(value);
                }
            }
            if (!controller.signal.aborted && complete) {
                complete();
            }
        } catch (err) {
            if (!controller.signal.aborted && error) {
                error(err as Error);
            }
        }
    })();

    return {
        unsubscribe: () => controller.abort()
    };
}

