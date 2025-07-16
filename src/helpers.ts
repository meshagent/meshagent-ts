import { MeshSchema, MeshSchemaValidationException } from './schema';
import { RoomClient } from './room-client';
import { ParticipantToken } from './participant-token';
import { WebSocketClientProtocol } from './protocol';

/**
 * Validate schema name: cannot contain '.'.
 */
export function validateSchemaName(name: string) {
    if (name.includes('.')) {
        throw new MeshSchemaValidationException("schema name cannot contain '.'");
    }
}

/**
 * Deploy a schema to the room’s storage.
 */
export async function deploySchema({ room, schema, name, overwrite = true }: {
    room: RoomClient;
    schema: MeshSchema;
    name: string;
    overwrite?: boolean;
}): Promise<void> {
    validateSchemaName(name);

    const handle = await room.storage.open(`.schemas/${name}.json`, { overwrite });
    const data = Buffer.from(JSON.stringify(schema.toJson()), 'utf-8');

    await room.storage.write(handle, data);
    await room.storage.close(handle);
}

/**
 * Return the base URL for meshagent, checking environment variables first.
 * (Python: meshagent_base_url)
 */
export function meshagentBaseUrl(baseUrl?: string): string {
    if (baseUrl) {
        return baseUrl;
    }

    return 'https://api.meshagent.com';
}

/**
 * Construct the WebSocket URL for a given room.
 * (Python: websocket_room_url)
 */
export function websocketRoomUrl({ roomName, apiUrl }: {
    roomName: string;
    apiUrl?: string;
}): string {
    const baseUrl = apiUrl || 'wss://api.meshagent.com';

    let url = baseUrl;

    // Convert http/https to ws/wss if needed
    if (baseUrl.startsWith('https:')) {
        url = 'wss:' + baseUrl.substring('https:'.length);
    } else if (baseUrl.startsWith('http:')) {
        url = 'ws:' + baseUrl.substring('http:'.length);
    }

    return `${url}/rooms/${roomName}`;
}

export function participantToken({
    participantName,
    roomName,
    role,
    projectId,
    apiKeyId,
}: {
    participantName: string;
    roomName: string;
    role?: string;
    projectId: string;
    apiKeyId: string;
}): ParticipantToken {
    const token = new ParticipantToken({ name: participantName, projectId, apiKeyId });

    token.addRoomGrant(roomName);

    if (role) {
        token.addRoleGrant(role);
    }

    return token;
}

/**
 * Create a WebSocket protocol instance for the given participant and room.
 */
export async function websocketProtocol({ participantName, roomName, role, projectId, apiKeyId, secret, apiUrl }: {
    participantName: string;
    roomName: string;
    role?: string;
    projectId: string;
    apiKeyId: string;
    secret: string;
    apiUrl?: string;
}): Promise<WebSocketClientProtocol> {
    const url = websocketRoomUrl({ roomName, apiUrl });
    const token = participantToken({ participantName, roomName, role, projectId, apiKeyId });
    const jwt = await token.toJwt({ token: secret });

    return new WebSocketClientProtocol({ url, token: jwt });
}

