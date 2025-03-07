// agent_tests_mocha.ts

// import { describe, it, before, after } from "mocha";
import { expect } from "chai";

import {
  AgentCallContext,
  FileResponse,
  JsonResponse,
  TextResponse,
  EmptyResponse,
  Protocol,
  RemoteTaskRunner,
  RemoteToolkit,
  RoomClient,
  Tool,
  WebSocketProtocolChannel,
} from "../src/index";

import { encoder, decoder } from "../src/utils";

import {
  createJwt,
  MESHAGENT_URL,
  room,
} from "./utils";

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
    return new JsonResponse({ c: a + b });
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
    return new TextResponse(String(a + b));
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
    return new FileResponse(encoder.encode("hello world"), "hello.text", "application/text");
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
  this.timeout(10000);

  const url = `${MESHAGENT_URL}/rooms/${room}`;

  let token1: string;
  let token2: string;

  let chan1: WebSocketProtocolChannel;
  let chan2: WebSocketProtocolChannel;

  let protocol1: Protocol;
  let protocol2: Protocol;

  let client1: RoomClient;
  let client2: RoomClient;

  let agent: AddAgent;

  before(async () => {
    token1 = await createJwt("client1");
    token2 = await createJwt("client2");

    // Set up channels, protocols, and clients
    chan1 = new WebSocketProtocolChannel(url, token1);
    chan2 = new WebSocketProtocolChannel(url, token2);

    protocol1 = new Protocol(chan1);
    protocol2 = new Protocol(chan2);

    client1 = new RoomClient(protocol1);
    client2 = new RoomClient(protocol2);

    // Start the clients
    client1.start();
    client2.start();

    await client1.ready;
    await client2.ready;

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

    // Expecting 3 agents: 2 from other clients? + 1 we just created
    expect(agents.length).to.equal(3, `Expected 3 agents, got ${agents.length}`);
  });

  it("test_can_ask_agent", async () => {
    const result = await client1.agents.ask({
      agentName: "add",
      arguments: { a: 1, b: 2 },
    });

    expect(result).to.have.property("sum");
    expect(result.sum).to.equal(3);
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
