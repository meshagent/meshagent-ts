import type { ProtocolChannel } from './protocol';

import type { Room, RemoteParticipant } from 'livekit-client';
import { RoomEvent } from 'livekit-client';

export type DataHandler = (data: Uint8Array) => void;
export type StartOptions = {
    onDone?: () => void; // not used by LiveKit data, but provided for API parity
    onError?: (error: unknown) => void;
};

export class LivekitProtocolChannel implements ProtocolChannel {
    private room: Room;
    private remote: RemoteParticipant;
    private topic: string;
    private onDataReceived?: DataHandler;
    private boundOnData?: (
        payload: Uint8Array,
        participant: RemoteParticipant | undefined,
        ...rest: any[]
    ) => void;

    constructor({room, remote, topic}: {
        room: Room,
        remote: RemoteParticipant,
        topic: string
    }) {
        this.room = room;
        this.remote = remote;
        this.topic = topic;
    }

    public start(onDataReceived: (data: Uint8Array) => void, _opts?: StartOptions): void {
        this.onDataReceived = onDataReceived;

        this.boundOnData = (payload, participant, ...rest) => {
            const identityMatches = participant?.identity === this.remote.identity;
            const topicArg = (rest?.[rest.length - 1] as string | undefined) ?? undefined;

            if (topicArg === this.topic && identityMatches) {
                this.onDataReceived?.(payload);
            }
        };

        this.room.on(RoomEvent.DataReceived, this.boundOnData);
    }

    public async sendData(data: Uint8Array) {
        await this.room.localParticipant.publishData(data, {
            reliable: true,
            topic: this.topic,
            destinationIdentities: [this.remote.identity],
        });
    }

    public dispose(): void {
        if (this.boundOnData) {
            this.room.off(RoomEvent.DataReceived, this.boundOnData);
        }
        this.boundOnData = undefined;
        this.onDataReceived = undefined;
    }
}


