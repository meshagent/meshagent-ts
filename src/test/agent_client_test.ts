// agent_tests_mocha.ts

import { expect } from "chai";

import {
    AgentsClient,
    AgentCallContext,
    FileResponse,
    JsonResponse,
    TextResponse,
    EmptyResponse,
    RemoteTaskRunner,
    RemoteToolkit,
    RemoteParticipant,
    RequiredToolkit,
    RoomClient,
    Tool,
    websocketProtocol,
} from "../index";

import { encoder, decoder } from "../utils";

import { room, getConfig } from "./utils";

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
        return new JsonResponse({
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
        return new EmptyResponse();
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
        return new TextResponse({ text: String(a + b) });
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
        return new FileResponse({
            data: encoder.encode("hello world"),
            name: "hello.text",
            mimeType: "application/text",
        });
    }
}

class RemoteTestToolkit extends RemoteToolkit {
    constructor(client: RoomClient) {
        super({
            name: "test-toolkit",
            title: "Test Toolkit",
            description: "A toolkit for testing",
            room: client,
            tools: [
                new AddToolJson(),
                new AddToolText(),
                new EmptyTool(),
                new FileTool(),
            ],
        });
    }
}

// A minimal test agent
class AddAgent extends RemoteTaskRunner {
    constructor(client: RoomClient) {
        super({
            client: client,
            name: "add",
            description: "Adds two numbers",
            inputSchema: addSchema,
            outputSchema: {
                type: "object",
                required: ["sum"],
                additionalProperties: false,
                properties: { sum: { type: "number" } },
            },
        });
    }

    async ask(context: AgentCallContext, args: Record<string, any>): Promise<Record<string, any>> {
        return {
            sum: args.a + args.b,
        };
    }
}

describe("agent_client_test", function () {
    // Increase timeout if necessary for WebSocket connections
    this.timeout(30000);

    let client1: RoomClient;
    let client2: RoomClient;
    let agent: AddAgent;

    before(async () => {
        const config = getConfig();

        const protocol1 = await websocketProtocol({
            roomName: room,
            participantName: 'client1',
            ...config,
        });

        const protocol2 = await websocketProtocol({
            roomName: room,
            participantName: 'client2',
            ...config,
        });

        client1 = new RoomClient({ protocol: protocol1 });
        client2 = new RoomClient({ protocol: protocol2 });

        await client1.start();
        await client2.start();

        // Create and start an agent
        agent = new AddAgent(client1);

        await agent.start();
    });

    after(async () => {
        await agent.stop();

        client1.dispose();
        client2.dispose();
    });

    it("test_can_list_agents", async () => {
        const agents = await client1.agents.listAgents();
        expect(agents.length).to.greaterThanOrEqual(1, `Expected at least 1 agent, got ${agents.length}`);

        for (let i = 0; i < agents.length; i++) {
            let agent = agents[i];
            expect(agent.name).to.equal("add");
        }
    });

    it("test_can_ask_agent", async () => {
        const result = await client1.agents.ask({
            agent: "add",
            arguments: { a: 1, b: 2 },
        });

        expect(result).to.be.instanceOf(JsonResponse);
        expect(result.json).to.have.property("sum");
        expect(result.json.sum).to.equal(3);
    });

    it("test_ask_includes_optional_arguments", async () => {
        const calls: { type: string; payload: Record<string, any> }[] = [];
        const fakeRoom = {
            async sendRequest(type: string, payload: Record<string, any>) {
                calls.push({ type, payload });
                return new JsonResponse({ json: { answer: { result: "ok" } } });
            },
        };

        const agentsClient = new AgentsClient({ room: fakeRoom as unknown as RoomClient });
        const onBehalfOf = new RemoteParticipant(fakeRoom as unknown as RoomClient, "participant-123", "tester");
        const requires = [new RequiredToolkit({ name: "test-toolkit", tools: ["alpha"] })];

        const response = await agentsClient.ask({
            agent: "test-agent",
            arguments: { foo: "bar" },
            onBehalfOf,
            requires
        });

        expect(calls).to.have.lengthOf(1);
        expect(calls[0].type).to.equal("agent.ask");

        expect(calls[0].payload).to.deep.equal({
            agent: "test-agent",
            arguments: { foo: "bar" },
            on_behalf_of_id: "participant-123",
            requires: requires.map((req) => req.toJson()),
        });

        expect(response).to.be.instanceOf(JsonResponse);
        expect(response.json).to.deep.equal({ result: "ok" });
    });

    it("test_ask_omits_optional_arguments_when_not_provided", async () => {
        let received: Record<string, any> | undefined;
        const fakeRoom = {
            async sendRequest(type: string, payload: Record<string, any>) {
                received = payload;
                return new JsonResponse({ json: { answer: { status: "ok" } } });
            },
        };

        const agentsClient = new AgentsClient({ room: fakeRoom as unknown as RoomClient });

        const response = await agentsClient.ask({
            agent: "simple-agent",
            arguments: { ping: true },
        });

        expect(received).to.deep.equal({
            agent: "simple-agent",
            arguments: { ping: true },
        });

        expect(response.json).to.deep.equal({ status: "ok" });
    });

    it("test_can_invoke_json_tool", async () => {
        // Start toolkit
        const remote = new RemoteTestToolkit(client1);

        await remote.start();

        // 1) add-file
        const result1 = (await client1.agents.invokeTool({
            toolkit: "test-toolkit",
            tool: "add-file",
            arguments: { a: 1, b: 2 },
        })) as FileResponse;

        const dt1 = decoder.decode(result1.data);
        expect(dt1).to.be.a("string");
        expect(dt1).to.equal("hello world");

        // 2) add-json
        const result2 = (await client1.agents.invokeTool({
            toolkit: "test-toolkit",
            tool: "add-json",
            arguments: { a: 1, b: 2 },
        })) as JsonResponse;

        expect(result2.json).to.be.an("object");
        expect(result2.json["c"]).to.equal(3);

        // 3) add-text
        const result3 = (await client1.agents.invokeTool({
            toolkit: "test-toolkit",
            tool: "add-text",
            arguments: { a: 1, b: 2 },
        })) as TextResponse;

        expect(result3.text).to.be.a("string");
        expect(result3.text).to.equal("3");

        // 4) add-none
        const result4 = await client1.agents.invokeTool({
            toolkit: "test-toolkit",
            tool: "add-none",
            arguments: { a: 1, b: 2 },
        });
        expect(result4).to.be.instanceOf(EmptyResponse);

        // 5) add-file (again)
        const result5 = (await client1.agents.invokeTool({
            toolkit: "test-toolkit",
            tool: "add-file",
            arguments: { a: 1, b: 2 },
        })) as FileResponse;

        expect(result5).to.be.an("object");
        expect(result5.name).to.equal("hello.text");
        expect(result5.mimeType).to.equal("application/text");
        expect(decoder.decode(result5.data)).to.equal("hello world");

        await remote.stop();
    });
});
