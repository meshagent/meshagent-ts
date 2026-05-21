// agent.ts

import { Protocol } from "./protocol";
import { RoomClient } from "./room-client";
import { RequiredToolkit } from "./requirement";
import {
    BinaryContent,
    ControlCloseStatus,
    ControlContent,
    EmptyContent,
    ErrorContent,
    FileContent,
    JsonContent,
    LinkContent,
    TextContent,
    type Content,
    unpackContent,
} from "./response";
import { RoomServerException } from "./room-server-client";
import { ToolContentSpec, type ToolContentType } from "./tool-content-type";
import { packMessage, unpackMessage } from "./utils";
import { RoomEvent, RoomStatusEvent } from "./room-event";
import { Participant, RemoteParticipant } from "./participant";
import { StreamController } from "./stream-controller";

export type ValidationMode = "full" | "contentTypes" | "none";

export class InvalidToolDataException extends RoomServerException {
    constructor(message: string) {
        super(message);
        this.name = "InvalidToolDataException";
    }
}

export class ToolContext {
    public readonly caller?: Participant;
    public readonly onBehalfOf?: Participant;

    constructor({ caller, onBehalfOf }: { caller?: Participant; onBehalfOf?: Participant } = {}) {
        this.caller = caller;
        this.onBehalfOf = onBehalfOf;
    }
}

export class RoomToolContext extends ToolContext {
    public readonly room: RoomClient;

    constructor({ room, caller, onBehalfOf }: { room: RoomClient; caller?: Participant; onBehalfOf?: Participant }) {
        super({ caller, onBehalfOf });
        this.room = room;
    }
}

export abstract class ToolInput {}

export class ToolContentInput extends ToolInput {
    public readonly content: Content;

    constructor(content: Content) {
        super();
        this.content = content;
    }
}

export class ToolStreamInput extends ToolInput {
    public readonly stream: AsyncIterable<Content>;

    constructor(stream: AsyncIterable<Content>) {
        super();
        this.stream = stream;
    }
}

export abstract class ToolCallOutput {}

export class ToolContentOutput extends ToolCallOutput {
    public readonly content: Content;

    constructor(content: Content) {
        super();
        this.content = content;
    }
}

export class ToolStreamOutput extends ToolCallOutput {
    public readonly stream: AsyncIterable<Content>;
    public readonly inputClosed?: Promise<void>;

    constructor(stream: AsyncIterable<Content>, { inputClosed }: { inputClosed?: Promise<void> } = {}) {
        super();
        this.stream = stream;
        this.inputClosed = inputClosed;
    }
}

export abstract class BaseTool {
    public readonly name: string;
    public readonly description?: string;
    public readonly title?: string;
    public readonly inputSchema?: Record<string, any>;
    public readonly inputSpec?: ToolContentSpec;
    public readonly outputSpec?: ToolContentSpec;
    public readonly outputSchema?: Record<string, any>;
    public readonly defs?: Record<string, any>;

    constructor({ name, description, title, inputSchema, inputSpec, outputSpec, outputSchema, defs }: {
        name: string;
        description?: string;
        title?: string;
        inputSchema?: Record<string, any>;
        inputSpec?: ToolContentSpec;
        outputSpec?: ToolContentSpec;
        outputSchema?: Record<string, any>;
        defs?: Record<string, any>;
    }) {
        this.name = name;
        this.description = description;
        this.title = title;
        this.inputSchema = inputSchema;
        this.inputSpec = inputSpec;
        this.outputSpec = outputSpec;
        this.outputSchema = outputSchema;
        this.defs = defs;
    }
}

export abstract class FunctionTool extends BaseTool {
    abstract execute(context: ToolContext, arguments_: Record<string, any>): Promise<Content>;

    public async *executeStream(context: ToolContext, arguments_: Record<string, any>): AsyncIterable<Content> {
        yield await this.execute(context, arguments_);
    }
}

export abstract class ContentTool extends BaseTool {
    abstract execute(context: ToolContext, input: ToolInput): Promise<ToolCallOutput>;
}

export abstract class Tool extends BaseTool {
    constructor(params: {
        name: string;
        description?: string;
        title?: string;
        inputSchema?: Record<string, any>;
        inputSpec?: ToolContentSpec;
        outputSpec?: ToolContentSpec;
        outputSchema?: Record<string, any>;
        defs?: Record<string, any>;
    }) {
        const inputSpec = params.inputSpec !== undefined && params.inputSchema !== undefined
            ? new ToolContentSpec({ types: [...params.inputSpec.types], stream: params.inputSpec.stream, schema: params.inputSchema })
            : params.inputSpec;
        const outputSpec = params.outputSpec !== undefined && params.outputSchema !== undefined
            ? new ToolContentSpec({ types: [...params.outputSpec.types], stream: params.outputSpec.stream, schema: params.outputSchema })
            : params.outputSpec;
        super({
            name: params.name,
            description: params.description,
            title: params.title,
            inputSchema: params.inputSchema,
            inputSpec: inputSpec ?? (params.inputSchema !== undefined
                ? new ToolContentSpec({ types: ["json"], stream: false, schema: params.inputSchema })
                : undefined),
            outputSpec: outputSpec ?? (params.outputSchema !== undefined
                ? new ToolContentSpec({ types: ["json"], stream: false, schema: params.outputSchema })
                : undefined),
            outputSchema: params.outputSchema,
            defs: params.defs,
        });
    }

    abstract execute(arguments_: Record<string, any>): Promise<Content>;
}

type StreamItem = { content: Content } | { error: unknown };

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentType(content: Content): ToolContentType | undefined {
    if (content instanceof BinaryContent) return "binary";
    if (content instanceof JsonContent) return "json";
    if (content instanceof TextContent) return "text";
    if (content instanceof FileContent) return "file";
    if (content instanceof LinkContent) return "link";
    if (content instanceof EmptyContent) return "empty";
    return undefined;
}

function schemaValue(content: Content): unknown {
    if (content instanceof BinaryContent) return content.headers;
    if (content instanceof JsonContent) return content.json;
    if (content instanceof TextContent) return content.text;
    if (content instanceof EmptyContent) return null;
    if (content instanceof LinkContent) return { name: content.name, url: content.url };
    if (content instanceof FileContent) return { name: content.name, mime_type: content.mimeType, size: content.data.length };
    if (content instanceof ControlContent) return { method: content.method };
    if (content instanceof ErrorContent) return content.code === undefined ? { text: content.text } : { text: content.text, code: content.code };
    const [header] = unpackMessage(content.pack());
    return header;
}

function schemaWithDefs(schema?: Record<string, any>, defs?: Record<string, any>): Record<string, any> | undefined {
    if (schema === undefined) return undefined;
    if (defs === undefined) return { ...schema };
    const merged = { ...schema };
    const existingDefs = merged["$defs"];
    merged["$defs"] = isRecord(existingDefs) ? { ...defs, ...existingDefs } : { ...defs };
    return merged;
}

function validateJsonSchemaValue(schema: Record<string, any>, value: unknown, root: Record<string, any> = schema): string | undefined {
    if (typeof schema["$ref"] === "string") {
        const ref = schema["$ref"] as string;
        if (ref.startsWith("#/$defs/")) {
            const name = ref.slice("#/$defs/".length);
            const defs = root["$defs"];
            if (isRecord(defs) && isRecord(defs[name])) {
                return validateJsonSchemaValue(defs[name], value, root);
            }
        }
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((item: unknown) => JSON.stringify(item) === JSON.stringify(value))) {
        return "value is not one of the allowed enum values";
    }
    if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) {
        return "value does not match const";
    }
    const rawType = schema.type;
    const types = Array.isArray(rawType) ? rawType : rawType === undefined ? [] : [rawType];
    const matchesType = (type: unknown): boolean => {
        switch (type) {
            case "object": return isRecord(value);
            case "array": return Array.isArray(value);
            case "string": return typeof value === "string";
            case "number": return typeof value === "number" && Number.isFinite(value);
            case "integer": return typeof value === "number" && Number.isInteger(value);
            case "boolean": return typeof value === "boolean";
            case "null": return value === null;
            default: return true;
        }
    };
    if (types.length > 0 && !types.some(matchesType)) {
        return `expected type ${types.join(" or ")}`;
    }
    if (isRecord(value)) {
        const required = Array.isArray(schema.required) ? schema.required : [];
        for (const key of required) {
            if (typeof key === "string" && !(key in value)) {
                return `missing required property ${key}`;
            }
        }
        const properties = isRecord(schema.properties) ? schema.properties : {};
        for (const [key, propertySchema] of Object.entries(properties)) {
            if (key in value && isRecord(propertySchema)) {
                const error = validateJsonSchemaValue(propertySchema, value[key], root);
                if (error !== undefined) return `${key}: ${error}`;
            }
        }
        if (schema.additionalProperties === false) {
            for (const key of Object.keys(value)) {
                if (!(key in properties)) return `unexpected property ${key}`;
            }
        }
    }
    if (Array.isArray(value) && isRecord(schema.items)) {
        for (let index = 0; index < value.length; index += 1) {
            const error = validateJsonSchemaValue(schema.items, value[index], root);
            if (error !== undefined) return `${index}: ${error}`;
        }
    }
    if (typeof value === "string") {
        if (typeof schema.minLength === "number" && value.length < schema.minLength) return `string is shorter than ${schema.minLength}`;
        if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return `string is longer than ${schema.maxLength}`;
    }
    if (typeof value === "number") {
        if (typeof schema.minimum === "number" && value < schema.minimum) return `number is less than ${schema.minimum}`;
        if (typeof schema.maximum === "number" && value > schema.maximum) return `number is greater than ${schema.maximum}`;
    }
    return undefined;
}

export class Toolkit {
    readonly name: string;
    readonly title?: string;
    readonly description?: string;
    readonly tools: BaseTool[];
    readonly rules: string[];
    readonly validationMode: ValidationMode;

    constructor({ name, title = name, description = "", tools, rules = [], validationMode = "full" }: {
        name: string;
        title?: string;
        description?: string;
        tools: BaseTool[];
        rules?: string[];
        validationMode?: ValidationMode;
    }) {
        this.name = name;
        this.title = title;
        this.description = description;
        this.tools = tools;
        this.rules = rules;
        this.validationMode = validationMode;
    }

    getTool(name: string): BaseTool {
        const tool = this.tools.find((t) => t.name === name);
        if (!tool) {
            throw new Error(`Tool was not found ${name}`);
        }
        return tool;
    }

    getTools(): Record<string, any> {
        const json: Record<string, any> = {};
        for (const tool of this.tools) {
            json[tool.name] = {
                description: tool.description,
                title: tool.title,
                input_spec: this.resolveInputSpec(tool)?.toJson(),
                output_spec: this.resolveOutputSpec(tool)?.toJson(),
                defs: tool.defs,
            };
        }
        return json;
    }

    async execute(name: string, args: Record<string, any>): Promise<Content>;
    async execute(context: ToolContext, name: string, input: ToolInput): Promise<ToolCallOutput>;
    async execute(first: ToolContext | string, second: string | Record<string, any>, third?: ToolInput): Promise<Content | ToolCallOutput> {
        if (typeof first === "string") {
            const output = await this.executeTool(new ToolContext(), first, new ToolContentInput(new JsonContent({ json: second as Record<string, any> })));
            if (output instanceof ToolContentOutput) {
                return output.content;
            }
            throw new Error(`tool ${first} returned streamed output`);
        }
        if (typeof second !== "string" || third === undefined) {
            throw new Error("toolkit execute requires a tool name and input");
        }
        return await this.executeTool(first, second, third);
    }

    private async executeTool(context: ToolContext, name: string, input: ToolInput): Promise<ToolCallOutput> {
        const tool = this.getTool(name);
        if (tool instanceof ContentTool) {
            return await tool.execute(context, input);
        }
        if (!(input instanceof ToolContentInput)) {
            throw new Error(`tool ${name} does not accept streamed input`);
        }
        const args = this.decodeFunctionToolArguments(name, input.content);
        if (tool instanceof FunctionTool) {
            return new ToolContentOutput(await tool.execute(context, args));
        }
        if (tool instanceof Tool) {
            return new ToolContentOutput(await tool.execute(args));
        }
        throw new Error(`tool ${name} has unsupported type`);
    }

    private decodeFunctionToolArguments(toolName: string, input: Content): Record<string, any> {
        if (input instanceof EmptyContent) return {};
        if (input instanceof JsonContent) {
            if (!isRecord(input.json)) {
                throw new Error(`tool ${toolName} requires JSON object input`);
            }
            return input.json;
        }
        throw new Error(`tool ${toolName} requires JSON object input`);
    }

    private get shouldValidateContentTypes(): boolean {
        return this.validationMode === "full" || this.validationMode === "contentTypes";
    }

    private get shouldValidateSchema(): boolean {
        return this.validationMode === "full";
    }

    public resolveInputSpec(tool: BaseTool): ToolContentSpec | undefined {
        if (tool instanceof ContentTool) return tool.inputSpec;
        if (tool.inputSpec !== undefined) return tool.inputSpec;
        return new ToolContentSpec({ types: ["json"], stream: false, schema: tool.inputSchema ?? { type: "object", additionalProperties: true } });
    }

    public resolveOutputSpec(tool: BaseTool): ToolContentSpec | undefined {
        if (tool.outputSpec !== undefined) {
            if (tool.outputSchema !== undefined && tool.outputSpec.schema === undefined && tool.outputSpec.types.includes("json")) {
                return new ToolContentSpec({ types: [...tool.outputSpec.types], stream: tool.outputSpec.stream, schema: tool.outputSchema });
            }
            return tool.outputSpec;
        }
        if (tool.outputSchema === undefined) return undefined;
        return new ToolContentSpec({ types: ["json"], stream: false, schema: tool.outputSchema });
    }

    public validateStreamMode({ tool, direction, spec, stream }: { tool: BaseTool; direction: "input" | "output"; spec?: ToolContentSpec; stream: boolean }): void {
        if (!this.shouldValidateContentTypes || spec === undefined) return;
        if (spec.stream !== stream) {
            const expected = spec.stream ? "streamed" : "single-content";
            const actual = stream ? "streamed" : "single-content";
            throw new InvalidToolDataException(`tool ${tool.name} ${direction} is ${actual} but ${direction}_spec requires ${expected} ${direction}`);
        }
    }

    public validateContentType({ tool, direction, spec, content }: { tool: BaseTool; direction: "input" | "output"; spec?: ToolContentSpec; content: Content }): void {
        if (!this.shouldValidateContentTypes || spec === undefined) return;
        const type = contentType(content);
        if (type === undefined || !spec.types.includes(type)) {
            const allowed = spec.types.join(", ");
            const actual = type ?? content.constructor.name;
            throw new InvalidToolDataException(`tool ${tool.name} ${direction} content type ${actual} is not allowed by ${direction}_spec (${allowed})`);
        }
    }

    public validateSchema({ tool, direction, content, schema }: { tool: BaseTool; direction: "input" | "output"; content: Content; schema?: Record<string, any> }): void {
        if (!this.shouldValidateSchema) return;
        const resolved = schemaWithDefs(schema, tool.defs);
        if (resolved === undefined) return;
        const error = validateJsonSchemaValue(resolved, schemaValue(content), resolved);
        if (error !== undefined) {
            throw new InvalidToolDataException(`tool ${tool.name} ${direction} does not match ${direction}_schema: ${error}`);
        }
    }

    public validateInputContent(tool: BaseTool, content: Content): void {
        const spec = this.resolveInputSpec(tool);
        this.validateContentType({ tool, direction: "input", spec, content });
        this.validateSchema({ tool, direction: "input", content, schema: spec?.schema });
    }

    public validateOutputContent(tool: BaseTool, content: Content): void {
        const spec = this.resolveOutputSpec(tool);
        this.validateContentType({ tool, direction: "output", spec, content });
        this.validateSchema({ tool, direction: "output", content, schema: spec?.schema });
    }
}

export class HostedToolkit {
    public readonly toolkit: Toolkit;
    private readonly _stopHostedToolkit: () => Promise<void>;

    constructor({ toolkit, stopHostedToolkit }: {
        toolkit: Toolkit;
        stopHostedToolkit: () => Promise<void>;
    }) {
        this.toolkit = toolkit;
        this._stopHostedToolkit = stopHostedToolkit;
    }

    async stop(): Promise<void> {
        await this._stopHostedToolkit();
    }
}

class _RemoteToolkitWrapper {
    protected readonly client: RoomClient;
    protected readonly toolkit: Toolkit;
    private readonly _toolCallHandler = this._toolCall.bind(this);
    private readonly _toolCallRequestChunkHandler = this._toolCallRequestChunk.bind(this);
    private readonly _roomEventHandler = this._onRoomEvent.bind(this);
    private _registrationId?: string;
    private _started = false;
    private _public = false;
    private _registerTask: Promise<void> | null = null;
    private readonly _requestStreams = new Map<string, StreamController<StreamItem>>();
    private readonly _requestStreamTools = new Map<string, BaseTool>();
    private readonly _pendingRequestChunks = new Map<string, Content[]>();

    constructor({ toolkit, room }: {
        toolkit: Toolkit;
        room: RoomClient;
    }) {
        this.toolkit = toolkit;
        this.client = room;
    }

    async start({ public_: isPublic = false }: { public_?: boolean } = {}): Promise<void> {
        if (this._started) {
            throw new RoomServerException(`toolkit ${this.toolkit.name} is already started`);
        }

        this._public = isPublic;
        this.client.protocol.addHandler(`room.tool_call.${this.toolkit.name}`, this._toolCallHandler);
        this.client.protocol.addHandler(`room.tool_call_request_chunk.${this.toolkit.name}`, this._toolCallRequestChunkHandler);
        this.client.on("disconnected", this._roomEventHandler);
        this.client.on("reconnected", this._roomEventHandler);

        try {
            await this._register(isPublic);
            this._started = true;
        } catch (error) {
            this.client.off("disconnected", this._roomEventHandler);
            this.client.off("reconnected", this._roomEventHandler);
            this.client.protocol.removeHandler(`room.tool_call.${this.toolkit.name}`, this._toolCallHandler);
            this.client.protocol.removeHandler(`room.tool_call_request_chunk.${this.toolkit.name}`, this._toolCallRequestChunkHandler);
            throw error;
        }
    }

    async stop(): Promise<void> {
        if (!this._started) {
            return;
        }
        this._started = false;
        this.client.off("disconnected", this._roomEventHandler);
        this.client.off("reconnected", this._roomEventHandler);
        this._failActiveRequestStreams(new RoomServerException("hosted toolkit stopped"));
        try {
            await this._unregister();
        } finally {
            this.client.protocol.removeHandler(`room.tool_call.${this.toolkit.name}`, this._toolCallHandler);
            this.client.protocol.removeHandler(`room.tool_call_request_chunk.${this.toolkit.name}`, this._toolCallRequestChunkHandler);
        }
    }

    private async _register(public_: boolean): Promise<void> {
        const response = await this.client.sendRequest("room.register_toolkit", {
            name: this.toolkit.name,
            title: this.toolkit.title,
            description: this.toolkit.description,
            tools: this.toolkit.getTools(),
            public: public_,
        }) as JsonContent;

        this._registrationId = response.json["id"];
    }

    private async _unregister(): Promise<void> {
        const registrationId = this._registrationId;
        this._registrationId = undefined;
        if (registrationId == null || this.client.isClosed) {
            return;
        }

        await this.client.sendRequest("room.unregister_toolkit", {
            id: registrationId,
        });
    }

    private _failActiveRequestStreams(error: unknown): void {
        const streams = [...this._requestStreams.values()];
        this._requestStreams.clear();
        this._requestStreamTools.clear();
        this._pendingRequestChunks.clear();
        for (const stream of streams) {
            stream.add({ error });
            stream.close();
        }
    }

    private _closeRequestStream(toolCallId: string): void {
        this._pendingRequestChunks.delete(toolCallId);
        this._requestStreamTools.delete(toolCallId);
        const stream = this._requestStreams.get(toolCallId);
        this._requestStreams.delete(toolCallId);
        stream?.close();
    }

    private _scheduleRegisterIfNeeded(): void {
        if (!this._started || this._registrationId != null || this._registerTask != null || this.client.isClosed) {
            return;
        }

        this._registerTask = this._register(this._public)
            .catch((error: unknown) => {
                console.warn(`unable to reregister hosted toolkit ${this.toolkit.name}`, error);
            })
            .finally(() => {
                this._registerTask = null;
            });
    }

    private _onRoomEvent(event: RoomEvent): void {
        if (!this._started || !(event instanceof RoomStatusEvent)) {
            return;
        }

        if (event.status === "disconnected") {
            this._registrationId = undefined;
            const message = event.message?.trim();
            this._failActiveRequestStreams(new RoomServerException(message == null || message.length === 0
                ? "room connection lost before streamed tool call request completed"
                : `room connection lost before streamed tool call request completed: ${message}`));
            return;
        }

        if (event.status === "reconnected") {
            this._scheduleRegisterIfNeeded();
        }
    }

    private _resolveParticipant(participantId: unknown): Participant | undefined {
        if (typeof participantId !== "string" || participantId.length === 0) return undefined;
        const local = this.client.localParticipant;
        if (local != null && local.id === participantId) return local;
        for (const remote of this.client.messaging.remoteParticipants) {
            if (remote.id === participantId) return remote;
        }
        return new RemoteParticipant(this.client, participantId, "user");
    }

    private _contentFromToolCallArguments(rawArguments: unknown, payload: Uint8Array): Content {
        if (!isRecord(rawArguments)) {
            throw new Error("arguments must be a content header object");
        }
        if (typeof rawArguments.type === "string") {
            return unpackContent(packMessage(rawArguments, payload.length > 0 ? payload : undefined));
        }
        return new JsonContent({ json: rawArguments });
    }

    private async _sendToolCallResponse(messageId: number, chunk: Content): Promise<boolean> {
        try {
            await this.client.protocol.send("room.tool_call_response", chunk.pack(), { id: messageId });
            return true;
        } catch (error) {
            console.debug("unable to send tool call response", error);
            return false;
        }
    }

    private async _sendToolCallResponseChunk(messageId: number, toolCallId: string, chunk: Content): Promise<boolean> {
        const [header, payload] = unpackMessage(chunk.pack());
        try {
            await this.client.protocol.send(
                "room.tool_call_response_chunk",
                packMessage({ tool_call_id: toolCallId, chunk: header }, payload.length > 0 ? payload : undefined),
                { id: messageId },
            );
            return true;
        } catch (error) {
            console.debug("unable to send tool call response chunk", error);
            return false;
        }
    }

    private _streamFromController(controller: StreamController<StreamItem>): AsyncIterable<Content> {
        return {
            async *[Symbol.asyncIterator]() {
                for await (const item of controller.stream) {
                    if ("error" in item) throw item.error;
                    yield item.content;
                }
            },
        };
    }

    private _enqueueRequestStreamChunk(stream: StreamController<StreamItem>, chunk: Content, tool?: BaseTool): void {
        if (chunk instanceof ControlContent) {
            if (chunk.method === "open") return;
            if (chunk.method === "close") {
                stream.close();
                return;
            }
            return;
        }
        if (tool !== undefined) {
            try {
                this.toolkit.validateInputContent(tool, chunk);
            } catch (error) {
                stream.add({ error });
                stream.close();
                return;
            }
        }
        stream.add({ content: chunk });
    }

    private async _toolCall(protocol: Protocol, messageId: number, _type: string, data?: Uint8Array): Promise<void> {
        if (!this.client.isActiveProtocol(protocol)) {
            return;
        }
        const toolCallIdFallback = `${messageId}`;
        let toolCallId = toolCallIdFallback;
        let openedResponseStream = false;
        try {
            const [message, payload] = unpackMessage(data!);
            const toolName = message["name"];
            if (typeof toolName !== "string" || toolName.length === 0) {
                throw new Error("tool call requires a tool name");
            }
            toolCallId = typeof message["tool_call_id"] === "string" && message["tool_call_id"].length > 0
                ? message["tool_call_id"]
                : toolCallIdFallback;
            const inputChunk = this._contentFromToolCallArguments(message["arguments"], payload);
            const requestStream = inputChunk instanceof ControlContent && inputChunk.method === "open";
            if (inputChunk instanceof ControlContent && !requestStream) {
                await this._sendToolCallResponse(messageId, new ErrorContent({ text: "request stream must start with an open control chunk" }));
                return;
            }
            const tool = this.toolkit.getTool(toolName);
            this.toolkit.validateStreamMode({ tool, direction: "input", spec: this.toolkit.resolveInputSpec(tool), stream: requestStream });

            let resolvedInput: ToolInput;
            if (requestStream) {
                const controller = new StreamController<StreamItem>();
                this._requestStreams.set(toolCallId, controller);
                this._requestStreamTools.set(toolCallId, tool);
                this._enqueueRequestStreamChunk(controller, new ControlContent({ method: "open" }), tool);
                const buffered = this._pendingRequestChunks.get(toolCallId) ?? [];
                this._pendingRequestChunks.delete(toolCallId);
                for (const chunk of buffered) {
                    this._enqueueRequestStreamChunk(controller, chunk, tool);
                }
                resolvedInput = new ToolStreamInput(this._streamFromController(controller));
            } else {
                this.toolkit.validateInputContent(tool, inputChunk);
                resolvedInput = new ToolContentInput(inputChunk);
            }

            const context = new RoomToolContext({
                room: this.client,
                caller: this._resolveParticipant(message["caller_id"]),
                onBehalfOf: this._resolveParticipant(message["on_behalf_of_id"]),
            });
            const output = await this.toolkit.execute(context, toolName, resolvedInput);
            if (output instanceof ToolContentOutput) {
                this.toolkit.validateStreamMode({ tool, direction: "output", spec: this.toolkit.resolveOutputSpec(tool), stream: false });
                this.toolkit.validateOutputContent(tool, output.content);
                await this._sendToolCallResponse(messageId, output.content);
                return;
            }
            if (output instanceof ToolStreamOutput) {
                this.toolkit.validateStreamMode({ tool, direction: "output", spec: this.toolkit.resolveOutputSpec(tool), stream: true });
                openedResponseStream = true;
                if (!await this._sendToolCallResponse(messageId, new ControlContent({ method: "open" }))) return;
                for await (const chunk of output.stream) {
                    this.toolkit.validateOutputContent(tool, chunk);
                    if (!await this._sendToolCallResponseChunk(messageId, toolCallId, chunk)) return;
                }
                await this._sendToolCallResponseChunk(messageId, toolCallId, new ControlContent({ method: "close" }));
                return;
            }
            throw new Error(`tool ${toolName} returned unsupported output`);
        } catch (error: any) {
            if (!openedResponseStream) {
                await this._sendToolCallResponse(messageId, new ErrorContent({ text: String(error) }));
                return;
            }
            if (!(error instanceof InvalidToolDataException)) {
                await this._sendToolCallResponseChunk(messageId, toolCallId, new ErrorContent({ text: String(error) }));
            }
            await this._sendToolCallResponseChunk(messageId, toolCallId, new ControlContent({
                method: "close",
                statusCode: error instanceof InvalidToolDataException ? ControlCloseStatus.INVALID_DATA : undefined,
                message: error instanceof InvalidToolDataException ? error.message : undefined,
            }));
        } finally {
            this._closeRequestStream(toolCallId);
        }
    }

    private async _toolCallRequestChunk(protocol: Protocol, _messageId: number, _type: string, data?: Uint8Array): Promise<void> {
        if (!this.client.isActiveProtocol(protocol)) {
            return;
        }
        try {
            const [message, payload] = unpackMessage(data!);
            const toolCallId = message["tool_call_id"];
            if (typeof toolCallId !== "string" || toolCallId.length === 0) return;
            const chunkHeader = message["chunk"];
            if (!isRecord(chunkHeader)) return;
            const chunk = unpackContent(packMessage(chunkHeader, payload.length > 0 ? payload : undefined));
            const stream = this._requestStreams.get(toolCallId);
            if (stream === undefined) {
                const buffered = this._pendingRequestChunks.get(toolCallId) ?? [];
                buffered.push(chunk);
                this._pendingRequestChunks.set(toolCallId, buffered);
                return;
            }
            this._enqueueRequestStreamChunk(stream, chunk, this._requestStreamTools.get(toolCallId));
        } catch (error) {
            console.warn("ignoring malformed request stream chunk", error);
        }
    }
}

export async function startHostedToolkit({ room, toolkit, public_: isPublic = false }: {
    room: RoomClient;
    toolkit: Toolkit;
    public_?: boolean;
}): Promise<HostedToolkit> {
    const wrapper = new _RemoteToolkitWrapper({ toolkit, room });
    await wrapper.start({ public_: isPublic });
    return new HostedToolkit({
        toolkit,
        stopHostedToolkit: () => wrapper.stop(),
    });
}

/*
-------------------------------------------------------------------------
RemoteTaskRunner (abstract)
-------------------------------------------------------------------------
*/
export abstract class RemoteTaskRunner {
    protected readonly client: RoomClient;
    protected readonly name: string;
    protected readonly description: string;
    protected readonly inputSchema?: Record<string, any>;
    protected readonly outputSchema?: Record<string, any>;
    protected readonly supportsTools: boolean;
    protected readonly required: RequiredToolkit[];
    private _registrationId?: string;

    constructor({
        name,
        description,
        client,
        inputSchema,
        outputSchema,
        supportsTools = false,
        required = [],
    }: {
        name: string;
        description: string;
        client: RoomClient;
        inputSchema?: Record<string, any>;
        outputSchema?: Record<string, any>;
        supportsTools?: boolean;
        required?: RequiredToolkit[];
    }) {
        this.client = client;
        this.name = name;
        this.description = description;
        this.inputSchema = inputSchema;
        this.outputSchema = outputSchema;
        this.supportsTools = supportsTools;
        this.required = required;
    }

    async start(): Promise<void> {
    }

    async stop(): Promise<void> {
    
        const handler = this.client.protocol.getHandler("agent.ask");
        if (handler != null) {
            this.client.protocol.removeHandler("agent.ask", handler);
        }
    }

    /**
     * Called when an "ask" request arrives. Must be implemented by subclass.
     * This method should return the result as an object.
     */
    abstract ask(arguments_: Record<string, any>): Promise<Record<string, any>>;

}
