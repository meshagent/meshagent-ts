import { RoomClient } from './room-client';
import { JsonContent } from './response';
import { RoomServerException } from './room-server-client';

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
        const response = await this.room.invoke({
            toolkit: 'livekit',
            tool: 'connect',
            input: { breakout_room: breakoutRoom ?? null },
        });

        if (!(response instanceof JsonContent)) {
            throw new RoomServerException('unexpected return type from livekit.connect');
        }

        const { url, token } = response.json;
        if (typeof url !== 'string' || typeof token !== 'string') {
            throw new RoomServerException('unexpected return type from livekit.connect');
        }

        return new LivekitConnectionInfo({url, token});
    }
}
