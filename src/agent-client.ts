// agents_client.ts

// Replace these with your real imports:
import { RoomClient } from "./room-client";
import { Response, JsonResponse } from "./response";
import { Requirement, RequiredToolkit, RequiredSchema } from "./requirement";

/**
 * Represents an agent’s descriptive information.
 */
export class AgentDescription {
  public readonly name: string;
  public readonly title: string;
  public readonly description: string;
  public readonly outputSchema?: Record<string, any>;
  public readonly inputSchema?: Record<string, any>;
  public readonly requires: Requirement[];
  public readonly labels: string[];
  public readonly supportsTools: boolean;

  constructor({
    name,
    title,
    description,
    outputSchema,
    inputSchema,
    requires,
    labels,
    supportsTools,
  }: {
    name: string;
    title: string;
    description: string;
    outputSchema?: Record<string, any>;
    inputSchema?: Record<string, any>;
    requires: Requirement[];
    labels: string[];
    supportsTools: boolean;
  }) {
    this.name = name;
    this.title = title;
    this.description = description;
    this.outputSchema = outputSchema;
    this.inputSchema = inputSchema;
    this.requires = requires;
    this.labels = labels;
    this.supportsTools = supportsTools;
  }

  /**
   * Creates an AgentDescription from a JSON-like object.
   */
  public static fromJson(a: Record<string, any>): AgentDescription {
    // If 'requires' is present, parse each entry as either a RequiredToolkit or a RequiredSchema
    let requires: Requirement[] = [];

    if (Array.isArray(a["requires"])) {
      requires = a["requires"].map((e: Record<string, any>) => {
        if (e["toolkit"] != null) {
          return RequiredToolkit.fromJson(e);
        }

        if (e["schema"] != null) {
          return RequiredSchema.fromJson(e);
        }
        // Adjust or throw an error if needed
        throw new Error("Invalid requirement object");
      });
    }

    // Collect label strings, filtering out non-string items
    let labels: string[] = [];
    if (Array.isArray(a["labels"])) {
      labels = a["labels"].filter((item) => typeof item === "string");
    }

    return new AgentDescription({
      name: a["name"],
      title: a["title"] ?? "",
      description: a["description"] ?? "",
      inputSchema: a["input_schema"] ?? undefined,
      outputSchema: a["output_schema"] ?? undefined,
      requires,
      supportsTools: a["supports_tools"] === true,
      labels,
    });
  }
}


/**
 * Example of a "ToolDescription" / "ToolkitDescription" class
 */
export class ToolDescription {
  public title: string;
  public name: string;
  public description: string;
  public inputSchema: Record<string, any>;
  public defs?: Record<string, any>;
  public thumbnailUrl?: string

  constructor({ title, name, description, inputSchema, thumbnailUrl, defs }: {
    title: string;
    name: string;
    description: string;
    inputSchema: Record<string, any>;
    thumbnailUrl?: string;
    defs?: Record<string, any>;
  }) {
    this.title = title;
    this.name = name;
    this.description = description;
    this.inputSchema = inputSchema;
    this.thumbnailUrl = thumbnailUrl;
    this.defs = defs;
  }
}

export class ToolkitDescription {
  public readonly title: string;
  public readonly name: string;
  public readonly description: string;
  public readonly tools: ToolDescription[];
  public readonly thumbnailUrl?: string;

  private _byName: Map<string, ToolDescription>;

  constructor({ title, name, description, tools, thumbnailUrl }: {
    title: string;
    name: string;
    description: string;
    tools: ToolDescription[];
    thumbnailUrl?: string;
  }) {
    this.title = title;
    this.name = name;
    this.description = description;
    this.tools = tools;
    this.thumbnailUrl = thumbnailUrl;

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
            thumbnailUrl: tool["thumbnail_url"],
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
            thumbnailUrl: tool["thumbnail_url"],
            defs: tool["defs"],
          })
        );
      }
    }

    return new ToolkitDescription({
      title,
      name: finalName,
      description,
      thumbnailUrl,
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
  ) {}

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

  constructor(client: RoomClient) {
    this.client = client;
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
   * Asks a question to the specified agent, optionally passing toolkits.
   * Returns the "answer" field from the JSON response.
   */
  public async ask(params: {
    agentName: string;
    toolkits?: ToolkitConfiguration[];
    arguments: Record<string, any>;
  }): Promise<Record<string, any>> {
    const { agentName, toolkits = [], arguments: args } = params;

    // Merge all toolkits into one object
    const usedToolkits: Record<string, any> = {};
    for (const t of toolkits) {
      Object.assign(usedToolkits, t.toJson());
    }

    const result = (await this.client.sendRequest("agent.ask", {
      agent: agentName,
      arguments: args,
      toolkits: usedToolkits,
    })) as JsonResponse;

    return result.json["answer"];
  }

  /**
   * Lists available toolkits.
   */
  public async listToolkits(): Promise<ToolkitDescription[]> {
    const result = (await this.client.sendRequest("agent.list_toolkits", {})) as JsonResponse;
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
   * Lists available agents, returning an array of AgentDescription.
   */
  public async listAgents(): Promise<AgentDescription[]> {
    const result = (await this.client.sendRequest("agent.list_agents", {})) as JsonResponse;

    return (result.json["agents"] || []).map(AgentDescription.fromJson);
  }

  /**
   * Invokes a tool on a specified toolkit with arguments, returning a Response.
   */
  public async invokeTool(params: {
    toolkit: string;
    tool: string;
    arguments: Record<string, any>;
  }): Promise<Response> {
    return await this.client.sendRequest("agent.invoke_tool", params) as JsonResponse;
  }
}
