import { Completer } from "./completer";
import { Protocol } from "./protocol";
import { packMessage, splitMessageHeader, splitMessagePayload, unpackMessage } from "./utils";
import { LocalParticipant } from "./participant";
import { StreamController } from "./stream-controller";


import { SyncClient } from "./sync-client";
import { DeveloperClient } from "./developer-client";
import { StorageClient } from "./storage-client";
import { MessagingClient } from "./messaging-client";
import { QueuesClient } from "./queues-client";
import { DatabaseClient } from "./database-client";
import { AgentsClient, ToolkitDescription } from "./agent-client";
import { SecretsClient } from "./secrets-client";
import { RoomServerException } from "./room-server-client";

import { RoomEvent } from "./room-event";
import { BinaryContent, Content, ControlContent, EmptyContent, ErrorContent, FileContent, JsonContent, LinkContent, TextContent, unpackContent } from "./response";

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
    public readonly sync: SyncClient;
    public readonly storage: StorageClient;
    public readonly developer: DeveloperClient;
    public readonly messaging: MessagingClient;
    public readonly queues: QueuesClient;
    public readonly database: DatabaseClient;
    public readonly agents: AgentsClient;
    public readonly secrets: SecretsClient;

    private _pendingRequests: Map<number, Completer<any>> = new Map();
    private _ready = new Completer<boolean>();
    private _localParticipant: LocalParticipant | null = null;
    private _eventsController = new StreamController<RoomEvent>();
    private _toolCallStreams: Map<string, StreamController<Content>> = new Map();

    constructor({protocol} : {protocol: Protocol}) {
        this.protocol = protocol;

        protocol.addHandler("room_ready", this._handleRoomReady.bind(this));
        protocol.addHandler("connected", this._handleParticipant.bind(this));
        protocol.addHandler("__response__", this._handleResponse.bind(this));
        protocol.addHandler("room.tool_call_response_chunk", this._handleToolCallResponseChunk.bind(this));

        this.sync = new SyncClient({room: this});
        this.storage = new StorageClient({room: this});
        this.developer = new DeveloperClient({room: this});
        this.messaging = new MessagingClient({room: this});
        this.queues = new QueuesClient({room: this});
        this.database = new DatabaseClient({room: this});
        this.agents = new AgentsClient({room: this});
        this.secrets = new SecretsClient({room: this});
    }

    get localParticipant(): LocalParticipant | null {
        return this._localParticipant;
    }

    public get ready(): Promise<boolean> {
        return this._ready.fut;
    }

    /**
     * Starts the protocol and begins processing outgoing changes
     */
    public async start({onDone, onError}: {
        onDone?: () => void;
        onError?: (error: Error) => void;
    } = {}): Promise<void> {

        this.sync.start({onDone, onError});

        await this.ready;
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
        for (const stream of this._toolCallStreams.values()) {
            stream.close();
        }
        this._toolCallStreams.clear();
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
    public async sendRequest(type: string, request: RequestHeader, data?: Uint8Array): Promise<Content> {
        const requestId = this.protocol.getNextMessageId();

        const pr = new Completer<Content>();

        this._pendingRequests.set(requestId, pr);

        const message = packMessage(request, data);

        await this.protocol.send(type, message, requestId);

        return await pr.fut; // Wait for response
    }

    public async call(params: {
        name: string;
        url: string;
        arguments: Record<string, any>;
    }): Promise<void> {
        await this.sendRequest("room.call", params);
    }

    public async listToolkits(params?: {
        participantId?: string;
        participantName?: string;
        timeout?: number;
    }): Promise<ToolkitDescription[]> {
        const request: Record<string, any> = {};
        if (params?.participantId != null) {
            request["participant_id"] = params.participantId;
        }
        if (params?.participantName != null) {
            request["participant_name"] = params.participantName;
        }
        if (params?.timeout !== undefined) {
            request["timeout"] = params.timeout;
        }

        const result = await this.sendRequest("room.list_toolkits", request);
        if (!(result instanceof JsonContent)) {
            throw new RoomServerException("unexpected return type from room.list_toolkits");
        }

        const tools = result.json["tools"];
        if (typeof tools !== "object" || tools === null || Array.isArray(tools)) {
            throw new RoomServerException("unexpected return type from room.list_toolkits");
        }

        const toolkits: ToolkitDescription[] = [];
        for (const [name, data] of Object.entries(tools as Record<string, unknown>)) {
            if (typeof data !== "object" || data === null || Array.isArray(data)) {
                throw new RoomServerException("unexpected toolkit description from room.list_toolkits");
            }
            toolkits.push(ToolkitDescription.fromJson(data as Record<string, any>, { name }));
        }

        return toolkits;
    }

    public async invoke(params: {
        toolkit: string;
        tool: string;
        arguments?: Record<string, any>;
        input?: Record<string, any> | Content;
        participantId?: string;
        onBehalfOfId?: string;
        callerContext?: Record<string, any>;
    }): Promise<Content> {
        const input = params.input ?? params.arguments ?? new EmptyContent();
        const request: Record<string, any> = {
            toolkit: params.toolkit,
            tool: params.tool,
        };

        let requestData: Uint8Array | undefined;
        if (
            input instanceof BinaryContent ||
            input instanceof EmptyContent ||
            input instanceof ErrorContent ||
            input instanceof FileContent ||
            input instanceof JsonContent ||
            input instanceof LinkContent ||
            input instanceof TextContent
        ) {
            const packed = input.pack();
            request["arguments"] = JSON.parse(splitMessageHeader(packed));
            const payload = splitMessagePayload(packed);
            if (payload.length > 0) {
                requestData = payload;
            }
        } else if (typeof input === "object" && input !== null && !Array.isArray(input)) {
            request["arguments"] = {
                type: "json",
                json: input,
            };
        } else {
            throw new RoomServerException("invoke input must be a content value or JSON object");
        }

        if (params.participantId != null) {
            request["participant_id"] = params.participantId;
        }
        if (params.onBehalfOfId != null) {
            request["on_behalf_of_id"] = params.onBehalfOfId;
        }
        if (params.callerContext != null) {
            request["caller_context"] = params.callerContext;
        }

        return await this.sendRequest("room.invoke_tool", request, requestData);
    }

    public async invokeWithStreamInput(params: {
        toolkit: string;
        tool: string;
        input: AsyncIterable<Content>;
        participantId?: string;
        onBehalfOfId?: string;
        callerContext?: Record<string, any>;
    }): Promise<Content> {
        const toolCallId = `${Date.now()}-${this.protocol.getNextMessageId()}-${Math.random().toString(16).slice(2)}`;
        const request: Record<string, any> = {
            toolkit: params.toolkit,
            tool: params.tool,
            tool_call_id: toolCallId,
            arguments: { type: "control", method: "open" },
        };
        if (params.participantId != null) {
            request["participant_id"] = params.participantId;
        }
        if (params.onBehalfOfId != null) {
            request["on_behalf_of_id"] = params.onBehalfOfId;
        }
        if (params.callerContext != null) {
            request["caller_context"] = params.callerContext;
        }

        const requestTask = this._streamInvokeToolRequestChunks(toolCallId, params.input);
        try {
            const response = await this.sendRequest("room.invoke_tool", request);
            await requestTask;
            if (response instanceof ControlContent && response.method === "open") {
                throw new RoomServerException(`unexpected return type from ${params.toolkit}.${params.tool}`);
            }
            return response;
        } catch (error) {
            await Promise.resolve(requestTask).catch(() => undefined);
            throw error;
        }
    }

    public async invokeStream(params: {
        toolkit: string;
        tool: string;
        input: AsyncIterable<Content>;
        participantId?: string;
        onBehalfOfId?: string;
        callerContext?: Record<string, any>;
    }): Promise<AsyncIterable<Content>> {
        const toolCallId = `${Date.now()}-${this.protocol.getNextMessageId()}-${Math.random().toString(16).slice(2)}`;
        const controller = new StreamController<Content>();
        const responseIterator = controller.stream[Symbol.asyncIterator]();
        this._toolCallStreams.set(toolCallId, controller);

        const request: Record<string, any> = {
            toolkit: params.toolkit,
            tool: params.tool,
            tool_call_id: toolCallId,
            arguments: { type: "control", method: "open" },
        };
        if (params.participantId != null) {
            request["participant_id"] = params.participantId;
        }
        if (params.onBehalfOfId != null) {
            request["on_behalf_of_id"] = params.onBehalfOfId;
        }
        if (params.callerContext != null) {
            request["caller_context"] = params.callerContext;
        }

        const response = await this.sendRequest("room.invoke_tool", request);
        if (!(response instanceof ControlContent) || response.method !== "open") {
            this._toolCallStreams.delete(toolCallId);
            controller.close();
            throw new RoomServerException(`unexpected return type from ${params.toolkit}.${params.tool}`);
        }

        void this._streamInvokeToolRequestChunks(toolCallId, params.input).catch((error: unknown) => {
            const stream = this._toolCallStreams.get(toolCallId);
            if (!stream) {
                return;
            }
            stream.add(new ErrorContent({ text: `request stream failed: ${String(error)}` }));
            stream.close();
            this._toolCallStreams.delete(toolCallId);
        });

        return {
            [Symbol.asyncIterator](): AsyncIterator<Content> {
                return responseIterator;
            },
        };
    }

    private async _sendToolCallRequestChunk(toolCallId: string, chunk: Content): Promise<void> {
        const packed = chunk.pack();
        const request: Record<string, any> = {
            tool_call_id: toolCallId,
            chunk: JSON.parse(splitMessageHeader(packed)),
        };
        const payload = splitMessagePayload(packed);
        await this.sendRequest(
            "room.tool_call_request_chunk",
            request,
            payload.length > 0 ? payload : undefined,
        );
    }

    private async _streamInvokeToolRequestChunks(toolCallId: string, input: AsyncIterable<Content>): Promise<void> {
        await Promise.resolve();
        try {
            for await (const item of input) {
                await this._sendToolCallRequestChunk(toolCallId, item);
            }
        } finally {
            await this._sendToolCallRequestChunk(toolCallId, new ControlContent({ method: "close" }));
        }
    }

    private _decodeToolCallContent(params: {
        header: Record<string, any>;
        payload: Uint8Array;
    }): Content {
        const chunk = params.header["chunk"];
        if (typeof chunk === "object" && chunk !== null && !Array.isArray(chunk)) {
            const chunkMap = chunk as Record<string, any>;
            if (typeof chunkMap["type"] === "string") {
                return unpackContent(packMessage(chunkMap, params.payload.length > 0 ? params.payload : undefined));
            }
            return new JsonContent({ json: chunkMap });
        }

        return new JsonContent({ json: { chunk } });
    }

    private async _handleToolCallResponseChunk(protocol: Protocol, messageId: number, type: string, data?: Uint8Array): Promise<void> {
        if (!data) {
            return;
        }

        const [header, payload] = unpackMessage(data);
        const toolCallId = header["tool_call_id"];
        if (typeof toolCallId !== "string" || toolCallId.length === 0) {
            return;
        }

        const stream = this._toolCallStreams.get(toolCallId);
        if (!stream) {
            return;
        }

        const content = this._decodeToolCallContent({ header, payload });
        stream.add(content);

        if (content instanceof ControlContent && content.method === "close") {
            stream.close();
            this._toolCallStreams.delete(toolCallId);
        }
    }

    /**
     * Handler for protocol responses to requests.
     */
    private async _handleResponse(protocol: Protocol, messageId: number, type: string, data?: Uint8Array): Promise<void> {
        if (!data) {
            console.error("No data in response");
            return;
        }

        const response = unpackContent(data);

        console.log("GOT RESPONSE", response);

        if (!response) {
            console.error("No response");
            return;
        }

        if (this._pendingRequests.has(messageId)) {
            const pr = this._pendingRequests.get(messageId)!;

            this._pendingRequests.delete(messageId);
            if (response instanceof ErrorContent) {
                pr.reject(new RoomServerException(response.text, response.code));
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
    private async _handleRoomReady(protocol: Protocol, messageId: number, type: string, data?: Uint8Array): Promise<void> {
        const [ message, _ ] = unpackMessage(data!);
        this._ready.complete(message["room_name"]);
    }

    private _onParticipantInit(participantId: string, attributes: Record<string, any>): void {
        this._localParticipant = new LocalParticipant(this, participantId);

        for (const k in attributes) {
            this._localParticipant.setAttribute(k, attributes[k]);
        }
    }

    private async _handleParticipant(protocol: Protocol, messageId: number, type: string, data?: Uint8Array): Promise<void> {
        const [ message, _ ] = unpackMessage(data!);

        switch (message["type"]) {
            case "init": this._onParticipantInit(message["participantId"], message["attributes"]);
        }
    }

    public emit(event: RoomEvent): void {
        this._eventsController.add(event);
    }

    public listen(): AsyncIterable<RoomEvent> {
        return this._eventsController.stream;
    }
}
