import { Completer } from "./completer";
import { Protocol } from "./protocol";
import { packMessage, decoder } from "./utils";
import { LocalParticipant } from "./participant";
import { StreamController } from "./stream-controller";

import { SyncClient } from "./sync-client";
import { DeveloperClient } from "./developer-client";
import { StorageClient } from "./storage-client";
import { MessagingClient } from "./messaging-client";
import { QueuesClient } from "./queues-client";
import { DatabaseClient } from "./database-client";
import { AgentsClient } from "./agent-client";

import { RoomEvent } from "./room-event";
import { ErrorResponse, Response, unpackResponse } from "./response";

/**
 * Represents a request/response structure for your protocol.
 * If you have a specific shape, define it more strictly here.
 */
interface RequestHeader {
    [key: string]: any;
}

/**
 * The main RoomClient class
 */
export class RoomClient {
    public protocol: Protocol;

    // clients
    public sync: SyncClient;
    public storage: StorageClient;
    public developer: DeveloperClient;
    public messaging: MessagingClient;
    public queues: QueuesClient;
    public database: DatabaseClient;
    public agents: AgentsClient;

    private _pendingRequests: Map<number, Completer<any>> = new Map();
    private _ready = new Completer<boolean>();
    private _localParticipant: LocalParticipant | null = null;
    private _eventsController = new StreamController<RoomEvent>();

    constructor(protocol: Protocol) {
        this.protocol = protocol;

        protocol.addHandler("room_ready", this._handleRoomReady.bind(this));
        protocol.addHandler("connected", this._handleParticipant.bind(this));
        protocol.addHandler("__response__", this._handleResponse.bind(this));

        this.sync = new SyncClient(this);
        this.storage = new StorageClient(this);
        this.developer = new DeveloperClient(this);
        this.messaging = new MessagingClient(this);
        this.queues = new QueuesClient(this);
        this.database = new DatabaseClient(this);
        this.agents = new AgentsClient(this);
    }

    public get ready(): Promise<boolean> {
        return this._ready.fut;
    }

    /**
     * Starts the protocol and begins processing outgoing changes
     */
    public start(): void {
        this.sync.start();
    }

    /**
     * Disposes of the protocol and closes the sync stream.
     */
    public dispose(): void {
        for (const prKey of this._pendingRequests.keys()) {
            const pr = this._pendingRequests.get(prKey);
            pr?.reject(new Error("Disposed"));
            this._pendingRequests.delete(prKey);
        }

        this.sync.dispose();
        this.protocol.dispose();
        this._localParticipant = null;
    }

    /**
     * Sends a request, optionally with a binary trailer.
     * @param type The request type
     * @param request The request header
     * @param data Additional data for the request
     * @returns A promise resolving to the server response
     */
    public async sendRequest(type: string, request: RequestHeader, data?: Uint8Array): Promise<Response> {
        const requestId = this.protocol.getNextMessageId();

        const pr = new Completer<Response>();

        this._pendingRequests.set(requestId, pr);

        const message = packMessage(request, data);

        await this.protocol.send(type, message, requestId);

        return await pr.fut; // Wait for response
    }

    /**
     * Handler for protocol responses to requests.
     */
    private async _handleResponse(protocol: Protocol, messageId: number, type: string, data?: Uint8Array): Promise<void> {
        if (!data) {
            console.error("No data in response");
            return;
        }

        const response = unpackResponse(data);

        console.log("GOT RESPONSE", response);

        if (!response) {
            console.error("No response");
            return;
        }

        if (this._pendingRequests.has(messageId)) {
            const pr = this._pendingRequests.get(messageId)!;

            this._pendingRequests.delete(messageId);
            if (response instanceof ErrorResponse) {
                pr.reject(new Error(response.text));
            } else {
                pr.resolve(response);
            }
        } else {
            // warning
            console.warn(`Received a response for a request that is not pending ${messageId}`);
        }
    }

    /**
     * Handler for "room_ready" messages.
     */
    async _handleRoomReady(protocol: Protocol, messageId: number, type: string, data?: Uint8Array): Promise<void> {
        this._ready.complete(JSON.parse(decoder.decode(data))["room_name"]);
    }

    get localParticipant(): LocalParticipant | null {
        return this._localParticipant;
    }

    private _onParticipantInit(participantId: string, attributes: Record<string, any>): void {
        this._localParticipant = new LocalParticipant(this, participantId);

        for (const k in attributes) {
            this._localParticipant.setAttribute(k, attributes[k]);
        }
    }

    private async _handleParticipant(protocol: Protocol, messageId: number, type: string, data?: Uint8Array): Promise<void> {
        const message = JSON.parse(decoder.decode(data));

        switch (message["type"]) {
            case "init": this._onParticipantInit(message["participantId"], message["attributes"]);
        }
    }

    public emitt(event: RoomEvent): void {
        this._eventsController.add(event);
    }

    public listen(): AsyncIterable<RoomEvent> {
        return this._eventsController.stream;
    }
}
