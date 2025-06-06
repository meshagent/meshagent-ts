// agent.ts

import { Protocol } from "./protocol";
import { RoomClient } from "./room-client";
import { RequiredToolkit } from "./requirement";
import { Response, ErrorResponse, JsonResponse } from "./response";
import { decoder, encoder, packMessage, unpackMessage } from "./utils";

export class AgentChatContext {
    messages: Array<Record<string, any>>;
    readonly systemRole: string;

    constructor({messages, systemRole = "system"}: {
        messages?: Array<Record<string, any>>;
        systemRole?: string;
    }) {
        // Deep copy if needed:
        this.messages = messages ? [...messages] : [];
        this.systemRole = systemRole;
    }

    appendRules(rules: string[]): void {
        let systemMessage = this.messages.find((m) => m["role"] === this.systemRole);

        if (!systemMessage) {
            systemMessage = { role: this.systemRole, content: "" };
            this.messages.push(systemMessage);
        }

        const plan = `
        Rules:
            -${rules.join("\n-")}
        `;
        systemMessage["content"] += plan;
    }

    appendUserMessage(message: string): void {
        this.messages.push({ role: "user", content: message });
    }

    appendUserImage(url: string): void {
        this.messages.push({
            role: "user",
            content: [
                {
                    type: "image_url",
                    image_url: { url: url, detail: "auto" },
                },
            ],
        });
    }

    copy(): AgentChatContext {
        // Deep clone using JSON
        const cloned = JSON.parse(JSON.stringify(this.messages));
        return new AgentChatContext({
            messages: cloned,
            systemRole: this.systemRole,
        });
    }

    toJson(): Record<string, any> {
        return {
            messages: this.messages,
            system_role: this.systemRole,
        };
    }

    static fromJson(json: Record<string, any>): AgentChatContext {
        return new AgentChatContext({
            messages: json["messages"] as Array<Record<string, any>>,
            systemRole: json["system_role"] || "system",
        });
    }
}

/*
-------------------------------------------------------------------------
AgentCallContext
-------------------------------------------------------------------------
*/

export class AgentCallContext {
    private readonly _jwt: string;
    private readonly _chat: AgentChatContext;
    private readonly _apiUrl: string;

    constructor({ chat, jwt, api_url }: {
        chat: AgentChatContext;
        jwt: string;
        api_url: string;
    }) {
        this._jwt = jwt;
        this._chat = chat;
        this._apiUrl = api_url;
    }

    get chat(): AgentChatContext {
        return this._chat;
    }
    get jwt(): string {
        return this._jwt;
    }
    get api_url(): string {
        return this._apiUrl;
    }
}

/*
-------------------------------------------------------------------------
Tool (abstract)
-------------------------------------------------------------------------
*/
export abstract class Tool {
    public readonly name: string;
    public readonly description: string;
    public readonly title: string;
    public readonly inputSchema: Record<string, any>;
    public readonly thumbnailUrl?: string;

    constructor({ name, description, title, inputSchema, thumbnailUrl }: {
        name: string;
        description: string;
        title: string;
        inputSchema: Record<string, any>;
        thumbnailUrl?: string;
    }) {
        this.name = name;
        this.description = description;
        this.title = title;
        this.inputSchema = inputSchema;
        this.thumbnailUrl = thumbnailUrl;
    }

    /**
     * Executes the tool with the given arguments, returning a Response.
     */
    abstract execute(arguments_: Record<string, any>): Promise<Response>;
}

/*
-------------------------------------------------------------------------
Toolkit (abstract)
-------------------------------------------------------------------------
*/
export abstract class Toolkit {
    readonly tools: Tool[];
    readonly rules: string[];

    constructor({tools, rules = []}: {
        tools: Tool[];
        rules?: string[];
    }) {
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
                input_schema: tool.inputSchema,
                thumbnail_url: tool.thumbnailUrl,
            };
        }
        return json;
    }

    async execute(name: string, args: Record<string, any>): Promise<Response> {
        return this.getTool(name).execute(args);
    }
}

/*
-------------------------------------------------------------------------
RemoteToolkit (abstract)
-------------------------------------------------------------------------
*/
export abstract class RemoteToolkit extends Toolkit {
    protected readonly client: RoomClient;
    protected readonly name: string;
    protected readonly title: string;
    protected readonly description: string;
    private _registrationId?: string;

    constructor({ name, title, description, room, tools, rules = [] }: {
        name: string;
        title: string;
        description: string;
        room: RoomClient;
        tools: Tool[];
        rules?: string[];
    }) {
        super({ tools, rules });

        this.client = room;
        this.name = name;
        this.title = title;
        this.description = description;
    }

    async start({ public_: isPublic = false }: { public_?: boolean } = {}): Promise<void> {
        // Add a handler for agent.tool_call.<name>
        const handler = this._toolCall.bind(this);

        this.client.protocol.addHandler(`agent.tool_call.${this.name}`, handler);

        await this._register(isPublic);
    }

    async stop(): Promise<void> {
        await this._unregister();

        // Remove the handler
        this.client.protocol.removeHandler(`agent.tool_call.${this.name}`);
    }

    private async _register(public_: boolean): Promise<void> {
        const response = await this.client.sendRequest("agent.register_toolkit", {
            name: this.name,
            title: this.title,
            description: this.description,
            tools: this.getTools(),
            public: public_,
        }) as JsonResponse;

        // Assume response is a JsonResponse
        const json = response.json;

        this._registrationId = json["id"];
    }

    private async _unregister(): Promise<void> {
        if (!this._registrationId) return;

        await this.client.sendRequest("agent.unregister_toolkit", {
            id: this._registrationId,
        });
    }

    private async _toolCall(protocol: Protocol, messageId: number, type: string, data?: Uint8Array): Promise<void> {
        try {
            const raw = unpackMessage(data!)[0];
            const message = JSON.parse(raw) as Record<string, any>;
            const toolName = message["name"] as string;
            const args = message["arguments"] as Record<string, any>;

            const response = await this.execute(toolName, args);
            await this.client.protocol.send("agent.tool_call_response", response.pack(), messageId);

        } catch (e: any) {
            // On error
            const err = new ErrorResponse({text: String(e)});

            await this.client.protocol.send("agent.tool_call_response", err.pack(), messageId);
        }
    }
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
        const handler = this._ask.bind(this);

        this.client.protocol.addHandler("agent.ask", handler);

        await this._register();
    }

    async stop(): Promise<void> {
        await this._unregister();

        this.client.protocol.removeHandler("agent.ask");
    }

    protected async _register(): Promise<void> {
        const res = await this.client.sendRequest("agent.register_agent", {
            name: this.name,
            description: this.description,
            input_schema: this.inputSchema,
            output_schema: this.outputSchema,
            supports_tools: this.supportsTools,
            requires: this.required.map((r) => ({
                toolkit: r.name,
                tools: r.tools,
            })),
        }) as JsonResponse;

        this._registrationId = res.json["id"];
    }

    protected async _unregister(): Promise<void> {
        if (!this._registrationId) return;

        await this.client.sendRequest("agent.unregister_agent", {id: this._registrationId});
    }

    /**
     * Called when an "ask" request arrives. Must be implemented by subclass.
     * This method should return the result as an object.
     */
    abstract ask(context: AgentCallContext, arguments_: Record<string, any>): Promise<Record<string, any>>;

    private async _ask(protocol: Protocol, messageId: number, msgType: string, data?: Uint8Array): Promise<void> {
        // Example logging
        console.info("_ask handler invoked with data", data);

        try {
            const [ message, _ ] = unpackMessage(data!)
            console.info("got message", message);

            const jwt = message["jwt"] as string;
            const args = message["arguments"] as Record<string, any>;
            const task_id = message["task_id"] as string;
            const context_json = message["context"] as Record<string, any>;
            const api_url = message["api_url"] as string;

            const chat = AgentChatContext.fromJson(context_json);
            const callContext = new AgentCallContext({chat, jwt, api_url});

            const answer = await this.ask(callContext, args);
            const encoded = packMessage({task_id, answer});

            await protocol.send("agent.ask_response", encoded);

        } catch (e: any) {
            const rawError = {
                task_id: "",
                error: String(e),
            };

            await protocol.send("agent.ask_response", packMessage(rawError));
        }
    }
}
