// agents_client.ts

import { RoomClient } from "./room-client.js";
import type { Content } from "./response.js";
import {
    ToolContentInput,
    ToolContentOutput,
    ToolInput,
    ToolStreamInput,
    ToolStreamOutput,
    type ToolCallOutput,
} from "./agent.js";
import { ToolContentSpec } from "./tool-content-type.js";

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

    constructor({ title, name, description, inputSchema, inputSpec, outputSpec, outputSchema, defs }: {
        title: string;
        name: string;
        description: string;
        inputSchema?: Record<string, any>;
        inputSpec?: ToolContentSpec;
        outputSpec?: ToolContentSpec;
        outputSchema?: Record<string, any>;
        defs?: Record<string, any>;
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
        this.defs = defs;
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
    public readonly participantId?: string;

    private _byName: Map<string, ToolDescription>;

    constructor({ title, name, description, tools, participantId }: {
        title: string;
        name: string;
        description: string;
        tools: ToolDescription[];
        participantId?: string;
    }) {
        this.title = title;
        this.name = name;
        this.description = description;
        this.tools = tools;
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
            ...(this.participantId !== undefined && {
                participant_id: this.participantId,
            }),
            tools: this.tools.map((tool) => ({
                name: tool.name,
                title: tool.title,
                description: tool.description,
                input_spec: tool.inputSpec?.toJson(),
                output_spec: tool.outputSpec?.toJson(),
                defs: tool.defs,
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
                        defs: tool["defs"],
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
                        defs: tool["defs"],
                    })
                );
            }
        }

        return new ToolkitDescription({
            title,
            name: finalName,
            description,
            participantId,
            tools: toolsList,
        });
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
        await this.client.call(params);
    }

    /**
     * Lists available toolkits.
     */
    public async listToolkits(params?: {
        participantId?: string;
        participantName?: string;
        timeout?: number;
    }): Promise<ToolkitDescription[]> {
        return await this.client.listToolkits(params);
    }
    /**
     * Invokes a tool on a specified toolkit.
     */
    public async invokeTool(params: {
        toolkit: string;
        tool: string;
        input: ToolInput;
        participantId?: string;
        onBehalfOfId?: string;
    }): Promise<ToolCallOutput>;
    public async invokeTool(params: {
        toolkit: string;
        tool: string;
        arguments: Record<string, any>;
        participantId?: string;
        onBehalfOfId?: string;
    }): Promise<Content>;
    public async invokeTool(params: {
        toolkit: string;
        tool: string;
        input?: ToolInput;
        arguments?: Record<string, any>;
        participantId?: string;
        onBehalfOfId?: string;
    }): Promise<ToolCallOutput | Content> {
        if (params.input === undefined) {
            return await this.client.invokeContent({
                toolkit: params.toolkit,
                tool: params.tool,
                arguments: params.arguments ?? {},
                participantId: params.participantId,
                onBehalfOfId: params.onBehalfOfId,
            });
        }

        if (params.input instanceof ToolContentInput) {
            const output = await this.client.invokeToolCall({
                toolkit: params.toolkit,
                tool: params.tool,
                input: params.input.content,
                participantId: params.participantId,
                onBehalfOfId: params.onBehalfOfId,
            });
            return output.kind === "content"
                ? new ToolContentOutput(output.content)
                : new ToolStreamOutput(output.stream, { inputClosed: output.inputClosed });
        }

        if (params.input instanceof ToolStreamInput) {
            const output = await this.client.invokeToolCall({
                toolkit: params.toolkit,
                tool: params.tool,
                input: params.input.stream,
                streamInput: true,
                participantId: params.participantId,
                onBehalfOfId: params.onBehalfOfId,
            });
            return output.kind === "content"
                ? new ToolContentOutput(output.content)
                : new ToolStreamOutput(output.stream, { inputClosed: output.inputClosed });
        }

        throw new Error("invokeTool input must be ToolContentInput or ToolStreamInput");
    }
}
