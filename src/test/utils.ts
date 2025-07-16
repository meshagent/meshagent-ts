import { v4 as uuid } from "uuid";

export const room = uuid();

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
 
export function getEnvVar(key: string): string | undefined {
  // Node.js (or any ESM runtime that provides process.env)
  if (typeof process !== 'undefined' && process.env[key] !== undefined) {
    return process.env[key];
  }
}

export function getConfig() {
    const projectId = getEnvVar("MESHAGENT_PROJECT_ID");
    if (!projectId) {
        throw new Error('MESHAGENT_PROJECT_ID must be set in the environment.');
    }

    const apiKeyId = getEnvVar("MESHAGENT_KEY_ID");
    if (!apiKeyId) {
        throw new Error('MESHAGENT_KEY_ID must be set in the environment.');
    }

    const secret = getEnvVar("MESHAGENT_SECRET");
    if (!secret) {
        throw new Error('MESHAGENT_SECRET must be set in the environment.');
    }

    const apiUrl = getEnvVar("MESHAGENT_API_URL") || "https://api.meshagent.life";

    return {
        projectId,
        apiKeyId,
        secret,
        apiUrl
    };
}
