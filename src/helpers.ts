import { MeshSchema, MeshSchemaValidationException } from './schema';
import { RoomClient } from './room-client';
import { ParticipantToken } from './participant-token';
import { WebSocketProtocolChannel } from './protocol';
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
export async function deploySchema({room, schema, name, overwrite = true}: {
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
  return process.env.MESHAGENT_API_URL || 'https://api.meshagent.com';
}

/**
 * Construct the WebSocket URL for a given room.
 * (Python: websocket_room_url)
 */
export function websocketRoomUrl({roomName, baseUrl}: {
  roomName: string;
  baseUrl?: string;
}): string {
  if (!baseUrl) {
    const envApiUrl = process.env.MESHAGENT_API_URL;
    if (!envApiUrl) {
      baseUrl = 'wss://api.meshagent.com';
    } else {
      // Convert http/https to ws/wss if needed
      if (envApiUrl.startsWith('https:')) {
        baseUrl = 'wss:' + envApiUrl.substring('https:'.length);
      } else if (envApiUrl.startsWith('http:')) {
        baseUrl = 'ws:' + envApiUrl.substring('http:'.length);
      } else {
        baseUrl = envApiUrl;
      }
    }
  }

  return `${baseUrl}/rooms/${roomName}`;
}

/**
 * Create a participant token; requires environment variables to be set.
 * (Python: participant_token)
 */
export function participantToken({participantName, roomName, role}: {
  participantName: string;
  roomName: string;
  role?: string;
}): ParticipantToken {
  const projectId = process.env.MESHAGENT_PROJECT_ID;
  const apiKeyId = process.env.MESHAGENT_KEY_ID;
  const secret = process.env.MESHAGENT_SECRET;

  if (!projectId) {
    throw new Error(
      'MESHAGENT_PROJECT_ID must be set. You can find this in the Meshagent Studio under API keys.'
    );
  }

  if (!apiKeyId) {
    throw new Error(
      'MESHAGENT_KEY_ID must be set. You can find this in the Meshagent Studio under API keys.'
    );
  }

  if (!secret) {
    throw new Error(
      'MESHAGENT_SECRET must be set. You can find this in the Meshagent Studio under API keys.'
    );
  }

  const token = new ParticipantToken({name: participantName, projectId, apiKeyId});

  token.addRoomGrant(roomName);

  if (role) {
    token.addRoleGrant(role);
  }

  return token;
}

/**
 * Create a WebSocket protocol instance for the given participant and room.
 */
export async function websocketProtocol({participantName, roomName, role}: {
  participantName: string;
  roomName: string;
  role?: string;
}): Promise<WebSocketClientProtocol> {
  const url = websocketRoomUrl({roomName});
  const token = participantToken({participantName, roomName, role});

  const secret = process.env.MESHAGENT_SECRET;
  if (!secret) {
    throw new Error('MESHAGENT_SECRET must be set in the environment.');
  }

  const jwt = await token.toJwt({token: secret});

  return new WebSocketClientProtocol({
      url,
      token: jwt,
  });
}
