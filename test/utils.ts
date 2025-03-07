import { v4 as uuid } from "uuid";

import { ParticipantToken } from "../src/index";

export const MESHAGENT_URL = 'wss://api.meshagent.com';
export const MESHAGENT_PROJECT_ID = 'ebdf8290-e552-411f-94a2-9125fc3e95a8';
export const MESHAGENT_KEY_ID = '428af1a5-57d6-4c1c-b357-59a5cf7998ed';
export const MESHAGENT_SECRET = 'EpBgE1Jzkc_JfB3VjnZtLGXNtE1-uLiIllsOqONMMrQ';
export const room = 'test-room-' + uuid();

export async function createJwt(name: string): Promise<string> {
    const token = new ParticipantToken({
        name,
        projectId: MESHAGENT_PROJECT_ID,
        apiKeyId: MESHAGENT_KEY_ID,
    });

    token.addRoomGrant(room);

    return await token.toJwt(MESHAGENT_SECRET);
}

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

    return { unsubscribe: () => controller.abort() };
}

