// agent.ts

import { Protocol } from "./protocol";
import { RoomClient } from "./room-client";
import { RequiredToolkit } from "./requirement";
import { ErrorContent, JsonContent, type Content } from "./response";
import { RoomServerException } from "./room-server-client";
import { ToolContentSpec } from "./tool-content-type";
import { unpackMessage } from "./utils";
import { RoomEvent, RoomStatusEvent } from "./room-event";

/*
-------------------------------------------------------------------------
Tool (abstract)
-------------------------------------------------------------------------
*/
export abstract class Tool {
    public readonly name: string;
    public readonly description: string;
    public readonly title: string;
    public readonly inputSpec?: ToolContentSpec;
    public readonly outputSpec?: ToolContentSpec;

    constructor({ name, description, title, inputSchema, inputSpec, outputSpec, outputSchema }: {
        name: string;
        description: string;
        title: string;
        inputSchema?: Record<string, any>;
        inputSpec?: ToolContentSpec;
        outputSpec?: ToolContentSpec;
        outputSchema?: Record<string, any>;
    }) {
        this.name = name;
        this.description = description;
        this.title = title;
        if (inputSpec !== undefined && inputSchema !== undefined) {
            this.inputSpec = new ToolContentSpec({
                types: [...inputSpec.types],
                stream: inputSpec.stream,
                schema: inputSchema,
            });
        } else if (inputSpec !== undefined) {
            this.inputSpec = inputSpec;
        } else if (inputSchema !== undefined) {
            this.inputSpec = new ToolContentSpec({
                types: ["json"],
                stream: false,
                schema: inputSchema,
            });
        }

        if (outputSpec !== undefined && outputSchema !== undefined) {
            this.outputSpec = new ToolContentSpec({
                types: [...outputSpec.types],
                stream: outputSpec.stream,
                schema: outputSchema,
            });
        } else if (outputSpec !== undefined) {
            this.outputSpec = outputSpec;
        } else if (outputSchema !== undefined) {
            this.outputSpec = new ToolContentSpec({
                types: ["json"],
                stream: false,
                schema: outputSchema,
            });
        }
    }

    public get inputSchema(): Record<string, any> | undefined {
        return this.inputSpec?.schema as Record<string, any> | undefined;
    }

    public get outputSchema(): Record<string, any> | undefined {
        return this.outputSpec?.schema as Record<string, any> | undefined;
    }

    /**
     * Executes the tool with the given arguments, returning a Content.
     */
    abstract execute(arguments_: Record<string, any>): Promise<Content>;
}

/*
-------------------------------------------------------------------------
Toolkit
-------------------------------------------------------------------------
*/
export class Toolkit {
    readonly name: string;
    readonly title: string;
    readonly description: string;
    readonly tools: Tool[];
    readonly rules: string[];

    constructor({name, title = name, description = "", tools, rules = []}: {
        name: string;
        title?: string;
        description?: string;
        tools: Tool[];
        rules?: string[];
    }) {
        this.name = name;
        this.title = title;
        this.description = description;
        this.tools = tools;
        this.rules = rules;
    }

    getTool(name: string): Tool {
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
                input_spec: tool.inputSpec?.toJson(),
                output_spec: tool.outputSpec?.toJson(),
            };
        }
        return json;
    }

    async execute(name: string, args: Record<string, any>): Promise<Content> {
        return this.getTool(name).execute(args);
    }
}

/*
-------------------------------------------------------------------------
HostedToolkit
-------------------------------------------------------------------------
*/
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
    private readonly _roomEventHandler = this._onRoomEvent.bind(this);
    private _registrationId?: string;
    private _started = false;
    private _public = false;
    private _registerTask: Promise<void> | null = null;

    constructor({ toolkit, room }: {
        toolkit: Toolkit;
        room: RoomClient;
    }) {
        this.toolkit = toolkit;
        this.client = room;
    }

    async start({ public_: isPublic = false }: { public_?: boolean } = {}): Promise<void> {
        if (this._started) {
            throw new RoomServerException(`toolkit '${this.toolkit.name}' is already started`);
        }

        this._public = isPublic;
        this.client.protocol.addHandler(`room.tool_call.${this.toolkit.name}`, this._toolCallHandler);
        this.client.on("disconnected", this._roomEventHandler);
        this.client.on("reconnected", this._roomEventHandler);

        try {
            await this._register(isPublic);
            this._started = true;
        } catch (error) {
            this.client.off("disconnected", this._roomEventHandler);
            this.client.off("reconnected", this._roomEventHandler);
            this.client.protocol.removeHandler(`room.tool_call.${this.toolkit.name}`, this._toolCallHandler);
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
        try {
            await this._unregister();
        } finally {
            this.client.protocol.removeHandler(`room.tool_call.${this.toolkit.name}`, this._toolCallHandler);
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

        // Assume response is a JsonContent
        const json = response.json;

        this._registrationId = json["id"];
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
            return;
        }

        if (event.status === "reconnected") {
            this._scheduleRegisterIfNeeded();
        }
    }

    private async _toolCall(protocol: Protocol, messageId: number, type: string, data?: Uint8Array): Promise<void> {
        if (!this.client.isActiveProtocol(protocol)) {
            return;
        }
        try {
            const [ message, _ ] = unpackMessage(data!);
            const toolName = message["name"] as string;
            const rawArguments = message["arguments"];
            let args: Record<string, any>;
            if (
                rawArguments &&
                typeof rawArguments === "object" &&
                !Array.isArray(rawArguments) &&
                "type" in rawArguments
            ) {
                const content = rawArguments as Record<string, any>;
                const contentType = content["type"];
                if (contentType === "json") {
                    args = (content["json"] as Record<string, any>) ?? {};
                } else if (contentType === "empty") {
                    args = {};
                } else {
                    throw new Error(
                        `tool '${toolName}' requires JSON object input, received content type '${String(contentType)}'`,
                    );
                }
            } else {
                args = (rawArguments as Record<string, any>) ?? {};
            }

            const response = await this.toolkit.execute(toolName, args);
            await this.client.protocol.send("room.tool_call_response", response.pack(), { id: messageId });

        } catch (e: any) {
            // On error
            const err = new ErrorContent({text: String(e)});

            await this.client.protocol.send("room.tool_call_response", err.pack(), { id: messageId });
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
