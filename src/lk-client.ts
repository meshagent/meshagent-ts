import { RoomClient } from './room-client';
import { JsonChunk } from './response';

export class LivekitConnectionInfo {
    public url: string;
    public token: string;

    constructor({url, token}: {
        url: string;
        token: string;
    }) {
        this.url = url;
        this.token = token;
    }
}

export class LivekitClient {
    public room: RoomClient;

    constructor({ room } : {
        room: RoomClient;
    }) {
        this.room = room;
    }

    public async getConnectionInfo({breakoutRoom}: {
        breakoutRoom?: string;
    }): Promise<LivekitConnectionInfo> {
        const response = (await this.room.sendRequest(
            'livekit.connect',
            { breakout_room: breakoutRoom }
        )) as JsonChunk;

        if (!response || !response.json) {
            throw new Error('Failed to get connection info');
        }

        const { url, token } = response.json;

        return new LivekitConnectionInfo({url, token});
    }
}
