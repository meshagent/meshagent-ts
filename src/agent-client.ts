// agents_client.ts

// Replace these with your real imports:
import { RoomClient } from "./room-client";
import { Chunk, JsonChunk } from "./response";
import { RemoteParticipant } from "./participant";
import { Requirement, RequiredToolkit, RequiredSchema } from "./requirement";
import { ToolContentSpec } from "./tool-content-type";

/**
 * Example of a "ToolDescription" / "ToolkitDescription" class
 */
export class ToolDescription {
    public title: string;
    public name: string;
    public description: string;
    public inputSpec?: ToolContentSpec;
    public outputSpec?: ToolContentSpec;
    public defs?: Record<string, any>;
    public thumbnailUrl?: string;
    public pricing?: string;
    public supportsContext?: boolean;

    constructor({ title, name, description, inputSchema, inputSpec, outputSpec, outputSchema, thumbnailUrl, defs, pricing, supportsContext }: {
        title: string;
        name: string;
        description: string;
        inputSchema?: Record<string, any>;
        inputSpec?: ToolContentSpec;
        outputSpec?: ToolContentSpec;
        outputSchema?: Record<string, any>;
        thumbnailUrl?: string;
        defs?: Record<string, any>;
        pricing?: string;
        supportsContext?: boolean;
    }) {
        this.title = title;
        this.name = name;
        this.description = description;
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
        this.thumbnailUrl = thumbnailUrl;
        this.defs = defs;
        this.pricing = pricing;
        this.supportsContext = supportsContext ?? false;
    }

    public get inputSchema(): Record<string, any> | undefined {
        return this.inputSpec?.schema as Record<string, any> | undefined;
    }

    public get outputSchema(): Record<string, any> | undefined {
        return this.outputSpec?.schema as Record<string, any> | undefined;
    }
}

export class ToolkitDescription {
    public readonly title: string;
    public readonly name: string;
    public readonly description: string;
    public readonly tools: ToolDescription[];
    public readonly thumbnailUrl?: string;
    public readonly participantId?: string;

    private _byName: Map<string, ToolDescription>;

    constructor({ title, name, description, tools, thumbnailUrl, participantId }: {
        title: string;
        name: string;
        description: string;
        tools: ToolDescription[];
        thumbnailUrl?: string;
        participantId?: string;
    }) {
        this.title = title;
        this.name = name;
        this.description = description;
        this.tools = tools;
        this.thumbnailUrl = thumbnailUrl;
        this.participantId = participantId;

        // Build the map from tool name -> ToolDescription
        this._byName = new Map<string, ToolDescription>(this.tools.map((tool) => [tool.name, tool]));
    }

    /**
     * Looks up a tool by its name.
     * (Equivalent to Dart’s `operator [](String name)`.)
     */
    public getTool(name: string): ToolDescription | undefined {
        return this._byName.get(name);
    }

    /**
     * 
     */
    public toJson(): Record<string, any> {
        return {
            name: this.name,
            description: this.description,
            title: this.title,
            thumbnail_url: this.thumbnailUrl,
            ...(this.participantId !== undefined && {
                participant_id: this.participantId,
            }),
            tools: this.tools.map((tool) => ({
                name: tool.name,
                title: tool.title,
                description: tool.description,
                input_spec: tool.inputSpec?.toJson(),
                output_spec: tool.outputSpec?.toJson(),
                thumbnail_url: tool.thumbnailUrl,
                defs: tool.defs,
                pricing: tool.pricing,
                supports_context: tool.supportsContext,
            })),
        };
    }

    /**
     * Static factory method to create a ToolkitDescription from JSON data.
     * @param json The JSON object to parse.
     * @param name If provided, overrides json["name"].
     */
    public static fromJson(json: Record<string, any>, opts?: { name?: string }): ToolkitDescription {
        const { name } = opts ?? {};
        const title = json["title"] ?? "";
        const finalName = name ?? json["name"] ?? "";
        const description = json["description"] ?? "";
        const thumbnailUrl = json["thumbnail_url"] ?? undefined;
        const participantId = json["participant_id"] ?? undefined;

        // We can have tools as a List or Map in the original structure
        const toolsList: ToolDescription[] = [];

        // If tools is a list
        if (Array.isArray(json["tools"])) {
            for (const tool of json["tools"]) {
                toolsList.push(
                    new ToolDescription({
                        title: tool["title"],
                        name: tool["name"],
                        description: tool["description"],
                        inputSchema: tool["input_schema"],
                        inputSpec: ToolContentSpec.fromJson(tool["input_spec"]),
                        outputSchema: tool["output_schema"],
                        outputSpec: ToolContentSpec.fromJson(tool["output_spec"]),
                        thumbnailUrl: tool["thumbnail_url"],
                        defs: tool["defs"],
                        pricing: tool["pricing"],
                        supportsContext: tool["supports_context"] ?? tool["supportsContext"],
                    })
                );
            }
        }

        // If tools is a map
        else if (typeof json["tools"] === "object" && json["tools"] !== null) {
            const toolsMap = json["tools"] as Record<string, any>;
            for (const toolName of Object.keys(toolsMap)) {
                const tool = toolsMap[toolName];
                toolsList.push(
                    new ToolDescription({
                        title: tool["title"],
                        name: toolName,
                        description: tool["description"],
                        inputSchema: tool["input_schema"],
                        inputSpec: ToolContentSpec.fromJson(tool["input_spec"]),
                        outputSchema: tool["output_schema"],
                        outputSpec: ToolContentSpec.fromJson(tool["output_spec"]),
                        thumbnailUrl: tool["thumbnail_url"],
                        defs: tool["defs"],
                        pricing: tool["pricing"],
                        supportsContext: tool["supports_context"] ?? tool["supportsContext"],
                    })
                );
            }
        }

        return new ToolkitDescription({
            title,
            name: finalName,
            description,
            thumbnailUrl,
            participantId,
            tools: toolsList,
        });
    }
}

/**
 * A config for specifying which tools to use
 */
export class ToolkitConfiguration {
    constructor(
        public name: string,
        public use?: string[] // null => use all
    ) { }

    toJson(): Record<string, any> {
        if (!this.use) {
            return {
                [this.name]: {},
            };
        } else {
            return {
                [this.name]: {
                    use: this.use.reduce((acc, tool) => {
                        acc[tool] = {};
                        return acc;
                    }, {} as Record<string, any>),
                },
            };
        }
    }
}


/**
 * The AgentsClient class.
 */
export class AgentsClient {
    private client: RoomClient;

    constructor({ room }: { room: RoomClient }) {
        this.client = room;
    }

    /**
     * Calls an agent with the specified name, URL, and arguments.
     */
    public async call(params: {
        name: string;
        url: string;
        arguments: Record<string, any>;
    }): Promise<void> {
        await this.client.sendRequest("agent.call", params);
    }

    /**
     * Lists available toolkits.
     */
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

        const result = (await this.client.sendRequest("agent.list_toolkits", request)) as JsonChunk;
        const tools = result.json["tools"] as Record<string, any>;
        const toolkits: ToolkitDescription[] = [];

        for (const name of Object.keys(tools)) {
            const data = tools[name];

            // Example: if ToolkitDescription has a static fromJson(data, name), adapt as needed
            toolkits.push(ToolkitDescription.fromJson(data, { name }));
        }

        return toolkits;
    }
    /**
     * Invokes a tool on a specified toolkit with arguments, returning a Chunk.
     */
    public async invokeTool(params: {
        toolkit: string;
        tool: string;
        arguments: Record<string, any>;
    }): Promise<Chunk> {
        const request: Record<string, any> = {
            toolkit: params.toolkit,
            tool: params.tool,
            arguments: {
                type: "json",
                json: params.arguments,
            },
        };
        return await this.client.sendRequest("agent.invoke_tool", request);
    }
}
