// agent_tests_mocha.ts

import { expect } from "chai";

import {
    FileContent,
    JsonContent,
    TextContent,
    EmptyContent,
    RoomClient,
    startHostedToolkit,
    Tool,
    ToolkitDescription,
    Toolkit,
    websocketProtocol,
} from "../index.js";

import { encoder, decoder } from "../utils.js";

import { room, getConfig } from "./utils.js";

// A sample schema
const addSchema = {
    type: "object",
    required: ["a", "b"],
    additionalProperties: false,
    properties: {
        a: { type: "number" },
        b: { type: "number" },
    },
};

class AddToolJson extends Tool {
    constructor() {
        super({
            name: "add-json",
            description: "Adds two numbers",
            title: "Add two numbers",
            inputSchema: addSchema,
        });
    }

    async execute({ a, b }: { a: number; b: number }) {
        return new JsonContent({
            json: { c: a + b }
        });
    }
}

class EmptyTool extends Tool {
    constructor() {
        super({
            name: "add-none",
            description: "Adds two numbers",
            title: "Add two numbers",
            inputSchema: addSchema,
        });
    }

    async execute({ context, a, b }: { context: any; a: number; b: number }) {
        return new EmptyContent();
    }
}

class AddToolText extends Tool {
    constructor() {
        super({
            name: "add-text",
            description: "Adds two numbers",
            title: "Add two numbers",
            inputSchema: addSchema,
        });
    }

    async execute({ context, a, b }: { context: any; a: number; b: number }) {
        return new TextContent({ text: String(a + b) });
    }
}

class FileTool extends Tool {
    constructor() {
        super({
            name: "add-file",
            description: "Adds two numbers",
            title: "Add two numbers",
            inputSchema: addSchema,
        });
    }

    async execute({ context, a, b }: { context: any; a: number; b: number }) {
        return new FileContent({
            data: encoder.encode("hello world"),
            name: "hello.text",
            mimeType: "application/text",
        });
    }
}

class TestToolkit extends Toolkit {
    constructor() {
        super({
            name: "test-toolkit",
            title: "Test Toolkit",
            description: "A toolkit for testing",
            tools: [
                new AddToolJson(),
                new AddToolText(),
                new EmptyTool(),
                new FileTool(),
            ],
        });
    }
}

describe("agent_client_test", function (this: Mocha.Suite) {
    // Increase timeout if necessary for WebSocket connections
    this.timeout(30000);

    let client1: RoomClient;
    let client2: RoomClient;

    before(async () => {
        const config = getConfig();

        const protocolFactory1 = await websocketProtocol({
            roomName: room,
            participantName: 'client1',
            ...config,
        });

        const protocolFactory2 = await websocketProtocol({
            roomName: room,
            participantName: 'client2',
            ...config,
        });

        client1 = new RoomClient({ protocolFactory: protocolFactory1 });
        client2 = new RoomClient({ protocolFactory: protocolFactory2 });

        await client1.start();
        await client2.start();
    });

    after(async () => {
        client1.dispose();
        client2.dispose();
    });


    it("test_toolkit_description_json_round_trip", () => {
        const rawToolkit = {
            name: "math",
            title: "Math Toolkit",
            description: "Performs mathematical operations",
            thumbnail_url: "https://example.com/toolkit.png",
            tools: [
                {
                    name: "adder",
                    title: "Adder",
                    description: "Adds two numbers",
                    input_spec: {
                        types: ["json"],
                        stream: false,
                        schema: { type: "object" },
                    },
                    output_spec: {
                        types: ["json", "text"],
                        stream: true,
                        schema: { type: "object", properties: { c: { type: "number" } } },
                    },
                    thumbnail_url: "https://example.com/tool.png",
                    defs: { NumberInput: { type: "number" } },
                },
                {
                    name: "subtractor",
                    title: "Subtractor",
                    description: "Subtracts numbers",
                    input_spec: {
                        types: ["json"],
                        stream: false,
                        schema: { type: "object" },
                    },
                    thumbnail_url: undefined,
                    defs: undefined,
                },
            ],
        };

        const toolkit = ToolkitDescription.fromJson(rawToolkit);

        expect(toolkit.toJson()).to.deep.equal({
            name: "math",
            title: "Math Toolkit",
            description: "Performs mathematical operations",
            tools: [
                {
                    name: "adder",
                    title: "Adder",
                    description: "Adds two numbers",
                    input_spec: {
                        types: ["json"],
                        stream: false,
                        schema: { type: "object" },
                    },
                    output_spec: {
                        types: ["json", "text"],
                        stream: true,
                        schema: { type: "object", properties: { c: { type: "number" } } },
                    },
                    defs: { NumberInput: { type: "number" } },
                },
                {
                    name: "subtractor",
                    title: "Subtractor",
                    description: "Subtracts numbers",
                    input_spec: {
                        types: ["json"],
                        stream: false,
                        schema: { type: "object" },
                    },
                    output_spec: undefined,
                    defs: undefined,
                },
            ],
        });
    });

    it("test_can_invoke_json_tool", async () => {
        const toolkit = new TestToolkit();
        const hostedToolkit = await startHostedToolkit({ room: client1, toolkit });

        // 1) add-file
        const result1 = (await client1.agents.invokeTool({
            toolkit: "test-toolkit",
            tool: "add-file",
            arguments: { a: 1, b: 2 },
        })) as FileContent;

        const dt1 = decoder.decode(result1.data);
        expect(dt1).to.be.a("string");
        expect(dt1).to.equal("hello world");

        // 2) add-json
        const result2 = (await client1.agents.invokeTool({
            toolkit: "test-toolkit",
            tool: "add-json",
            arguments: { a: 1, b: 2 },
        })) as JsonContent;

        expect(result2.json).to.be.an("object");
        expect(result2.json["c"]).to.equal(3);

        // 3) add-text
        const result3 = (await client1.agents.invokeTool({
            toolkit: "test-toolkit",
            tool: "add-text",
            arguments: { a: 1, b: 2 },
        })) as TextContent;

        expect(result3.text).to.be.a("string");
        expect(result3.text).to.equal("3");

        // 4) add-none
        const result4 = await client1.agents.invokeTool({
            toolkit: "test-toolkit",
            tool: "add-none",
            arguments: { a: 1, b: 2 },
        });
        expect(result4).to.be.instanceOf(EmptyContent);

        // 5) add-file (again)
        const result5 = (await client1.agents.invokeTool({
            toolkit: "test-toolkit",
            tool: "add-file",
            arguments: { a: 1, b: 2 },
        })) as FileContent;

        expect(result5).to.be.an("object");
        expect(result5.name).to.equal("hello.text");
        expect(result5.mimeType).to.equal("application/text");
        expect(decoder.decode(result5.data)).to.equal("hello world");

        await hostedToolkit.stop();
    });
});
