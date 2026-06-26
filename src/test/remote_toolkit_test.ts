import { expect } from "chai";

import { RoomClient } from "../room-client.js";
import { Protocol, ProtocolChannel } from "../protocol.js";
import { ControlContent, EmptyContent, ErrorContent, JsonContent, TextContent, type Content, unpackContent } from "../response.js";
import {
  ContentTool,
  FunctionTool,
  startHostedToolkit,
  Tool,
  Toolkit,
  ToolContentInput,
  ToolContentOutput,
  ToolCallOutput,
  ToolInput,
  ToolStreamInput,
  ToolStreamOutput,
  type ToolContext,
} from "../agent.js";
import { ToolContentSpec } from "../tool-content-type.js";
import { packMessage, unpackMessage } from "../utils.js";

class LinkedProtocolChannel implements ProtocolChannel {
  private _peer: LinkedProtocolChannel | null = null;
  private _onData?: (data: Uint8Array) => void;
  private _onDone?: () => void;
  private _onError?: (error: unknown) => void;
  private _closed = false;

  public connect(peer: LinkedProtocolChannel): void {
    this._peer = peer;
  }

  public start(
    onDataReceived: (data: Uint8Array) => void,
    {
      onDone,
      onError,
    }: {
      onDone?: () => void;
      onError?: (error: unknown) => void;
    },
  ): void {
    this._onData = onDataReceived;
    this._onDone = onDone;
    this._onError = onError;
  }

  public dispose(): void {
    this.close();
  }

  public async sendData(data: Uint8Array): Promise<void> {
    if (this._closed) {
      throw new Error("channel is closed");
    }
    const peer = this._peer;
    if (peer == null) {
      throw new Error("channel peer is not connected");
    }
    peer.receive(data);
  }

  public receive(data: Uint8Array): void {
    if (this._closed) {
      return;
    }
    this._onData?.(data);
  }

  public close(): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this._onDone?.();
  }

  public closeWithError(error: unknown = new Error("socket disconnected")): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this._onError?.(error);
  }
}

class ProtocolPair {
  public readonly serverProtocol: Protocol;
  private readonly _clientChannel = new LinkedProtocolChannel();
  private readonly _serverChannel = new LinkedProtocolChannel();
  private _clientProtocol: Protocol | null = null;

  constructor() {
    this._clientChannel.connect(this._serverChannel);
    this._serverChannel.connect(this._clientChannel);
    this.serverProtocol = new Protocol({ channel: this._serverChannel });
  }

  public clientProtocolFactory(): Protocol {
    if (this._clientProtocol != null) {
      throw new Error("protocolFactory was not configured for reconnecting this protocol");
    }
    const protocol = new Protocol({ channel: this._clientChannel });
    this._clientProtocol = protocol;
    return protocol;
  }

  public disconnectClientWithError(error?: unknown): void {
    this._clientChannel.closeWithError(error ?? new Error("socket disconnected"));
  }

  public disconnectClient(): void {
    this._clientChannel.close();
  }

  public dispose(): void {
    this._clientProtocol?.dispose();
    this.serverProtocol.dispose();
    this._clientChannel.close();
    this._serverChannel.close();
  }
}

async function sendRoomReady(protocol: Protocol): Promise<void> {
  await protocol.send(
    "room_ready",
    packMessage({
      room_name: "test-room",
      room_url: "ws://example/rooms/test-room",
      session_id: "session-1",
    }),
  );
  await protocol.send(
    "connected",
    packMessage({
      type: "init",
      participantId: "self",
      attributes: { name: "self" },
    }),
  );
}

async function waitUntil(
  condition: () => boolean,
  {
    timeoutMs = 1000,
  }: {
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("condition was not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

class EchoTool extends Tool {
  constructor() {
    super({
      name: "echo",
      title: "Echo",
      description: "echo tool",
      inputSchema: { type: "object", additionalProperties: true },
    });
  }

  public async execute(_arguments_: Record<string, any>): Promise<Content> {
    return new JsonContent({ json: { ok: true } });
  }
}

class SumFunctionTool extends FunctionTool {
  constructor() {
    super({
      name: "sum",
      title: "Sum",
      description: "sum tool",
      inputSchema: {
        type: "object",
        required: ["a", "b"],
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "number" } },
        additionalProperties: false,
      },
    });
  }

  public async execute(_context: ToolContext, arguments_: Record<string, any>): Promise<Content> {
    return new JsonContent({ json: { result: arguments_["a"] + arguments_["b"] } });
  }
}

class InvalidOutputTool extends FunctionTool {
  constructor() {
    super({
      name: "invalid_output",
      title: "InvalidOutput",
      description: "returns output that does not match schema",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      outputSchema: {
        type: "object",
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
        additionalProperties: false,
      },
    });
  }

  public async execute(_context: ToolContext, _arguments_: Record<string, any>): Promise<Content> {
    return new JsonContent({ json: { missing: true } });
  }
}

class CollectStreamTool extends ContentTool {
  constructor() {
    super({
      name: "collect",
      title: "Collect",
      description: "collect streamed text chunks",
      inputSchema: {},
      inputSpec: new ToolContentSpec({ types: ["text"], stream: true }),
      outputSpec: new ToolContentSpec({
        types: ["json"],
        stream: true,
        schema: {
          type: "object",
          required: ["value"],
          properties: { value: { type: "string" } },
          additionalProperties: false,
        },
      }),
    });
  }

  public async execute(_context: ToolContext, input: ToolInput): Promise<ToolCallOutput> {
    if (!(input instanceof ToolStreamInput)) {
      throw new Error("expected streamed input");
    }
    const stream = input.stream;
    async function* output(): AsyncIterable<Content> {
      for await (const chunk of stream) {
        if (!(chunk instanceof TextContent)) {
          throw new Error("expected text chunk");
        }
        yield new JsonContent({ json: { value: chunk.text } });
      }
    }
    return new ToolStreamOutput(output());
  }
}

class EchoContentInputTool extends ContentTool {
  constructor() {
    super({
      name: "echo_content_input",
      title: "EchoContentInput",
      description: "echoes the first content input item",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    });
  }

  public async execute(_context: ToolContext, input: ToolInput): Promise<ToolCallOutput> {
    if (!(input instanceof ToolContentInput)) {
      throw new Error("echo_content_input requires single content input");
    }
    const content = input.content;
    let first: unknown;
    if (content instanceof JsonContent) {
      first = content.json;
    } else if (content instanceof TextContent) {
      first = content.text;
    } else if (content instanceof EmptyContent) {
      first = null;
    }
    return new ToolContentOutput(new JsonContent({ json: { count: 1, first } }));
  }
}

class WaitForDisconnectTool extends ContentTool {
  public started?: () => void;
  public ended?: (error: unknown) => void;

  constructor() {
    super({
      name: "wait_for_disconnect",
      title: "WaitForDisconnect",
      description: "waits for request stream termination",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      inputSpec: new ToolContentSpec({ types: ["text"], stream: true }),
    });
  }

  public async execute(_context: ToolContext, input: ToolInput): Promise<ToolCallOutput> {
    if (!(input instanceof ToolStreamInput)) {
      throw new Error("wait_for_disconnect requires streamed input");
    }
    const stream = input.stream;
    this.started?.();
    const ended = this.ended;
    async function* output(): AsyncIterable<Content> {
      try {
        for await (const _chunk of stream) {
          // Consume until the hosted room disconnects or the request stream closes.
        }
        ended?.(undefined);
        yield new JsonContent({ json: { closed: true } });
      } catch (error) {
        ended?.(error);
        throw error;
      }
    }
    return new ToolStreamOutput(output());
  }
}

function contentHeader(content: Content): { header: Record<string, any>; payload?: Uint8Array } {
  const [header, payload] = unpackMessage(content.pack());
  return { header, payload: payload.length > 0 ? payload : undefined };
}


describe("remote_toolkit_test", () => {
  it("hosts function tools with schema validation", async () => {
    const pair = new ProtocolPair();
    const responses: Content[] = [];
    let registeredTools: Record<string, any> | undefined;

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (type === "room.register_toolkit") {
          const [header] = unpackMessage(data);
          registeredTools = header["tools"] as Record<string, any>;
          await protocol.send("__response__", new JsonContent({ json: { id: "registration-1" } }).pack(), messageId);
          return;
        }
        if (type === "room.unregister_toolkit") {
          await protocol.send("__response__", new EmptyContent().pack(), messageId);
          return;
        }
        if (type === "room.tool_call_response") {
          responses.push(unpackContent(data));
        }
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    const hostedToolkit = await startHostedToolkit({
      room,
      toolkit: new Toolkit({ name: "math", tools: [new SumFunctionTool()] }),
    });

    expect(registeredTools?.["sum"]?.input_spec?.schema?.required).to.deep.equal(["a", "b"]);

    const validInput = contentHeader(new JsonContent({ json: { a: 2, b: 3 } }));
    await pair.serverProtocol.send(
      "room.tool_call.math",
      packMessage({ name: "sum", arguments: validInput.header }, validInput.payload),
      200,
    );
    await waitUntil(() => responses.length === 1);
    expect(responses[0]).to.be.instanceOf(JsonContent);
    expect((responses[0] as JsonContent).json).to.deep.equal({ result: 5 });

    const invalidInput = contentHeader(new JsonContent({ json: { a: 2 } }));
    await pair.serverProtocol.send(
      "room.tool_call.math",
      packMessage({ name: "sum", arguments: invalidInput.header }, invalidInput.payload),
      201,
    );
    await waitUntil(() => responses.length === 2);
    expect(responses[1]).to.be.instanceOf(ErrorContent);
    expect((responses[1] as ErrorContent).text).to.contain("input_schema");

    await hostedToolkit.stop();
    room.dispose();
    pair.dispose();
  });

  it("hosts content tools with streamed input and output", async () => {
    const pair = new ProtocolPair();
    const responses: Content[] = [];
    const responseChunks: Content[] = [];

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (type === "room.register_toolkit") {
          await protocol.send("__response__", new JsonContent({ json: { id: "registration-1" } }).pack(), messageId);
          return;
        }
        if (type === "room.unregister_toolkit") {
          await protocol.send("__response__", new EmptyContent().pack(), messageId);
          return;
        }
        if (type === "room.tool_call_response") {
          responses.push(unpackContent(data));
          return;
        }
        if (type === "room.tool_call_response_chunk") {
          const [header, payload] = unpackMessage(data);
          const chunk = header["chunk"] as Record<string, any>;
          responseChunks.push(unpackContent(packMessage(chunk, payload.length > 0 ? payload : undefined)));
        }
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    const hostedToolkit = await startHostedToolkit({
      room,
      toolkit: new Toolkit({ name: "streamkit", tools: [new CollectStreamTool()] }),
    });

    const open = contentHeader(new ControlContent({ method: "open" }));
    await pair.serverProtocol.send(
      "room.tool_call.streamkit",
      packMessage({ name: "collect", tool_call_id: "call-1", arguments: open.header }, open.payload),
      300,
    );
    await waitUntil(() => responses.length === 1);
    expect(responses[0]).to.be.instanceOf(ControlContent);
    expect((responses[0] as ControlContent).method).to.equal("open");

    for (const text of ["alpha", "beta"]) {
      const chunk = contentHeader(new TextContent({ text }));
      await pair.serverProtocol.send(
        "room.tool_call_request_chunk.streamkit",
        packMessage({ tool_call_id: "call-1", chunk: chunk.header }, chunk.payload),
      );
    }
    const close = contentHeader(new ControlContent({ method: "close" }));
    await pair.serverProtocol.send(
      "room.tool_call_request_chunk.streamkit",
      packMessage({ tool_call_id: "call-1", chunk: close.header }, close.payload),
    );

    await waitUntil(() => responseChunks.length === 3);
    expect(responseChunks[0]).to.be.instanceOf(JsonContent);
    expect((responseChunks[0] as JsonContent).json).to.deep.equal({ value: "alpha" });
    expect((responseChunks[1] as JsonContent).json).to.deep.equal({ value: "beta" });
    expect(responseChunks[2]).to.be.instanceOf(ControlContent);
    expect((responseChunks[2] as ControlContent).method).to.equal("close");

    await hostedToolkit.stop();
    room.dispose();
    pair.dispose();
  });

  it("rejects streamed input for non-stream tools", async () => {
    const pair = new ProtocolPair();
    const responses: Content[] = [];

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (type === "room.register_toolkit") {
          await protocol.send("__response__", new JsonContent({ json: { id: "registration-1" } }).pack(), messageId);
          return;
        }
        if (type === "room.unregister_toolkit") {
          await protocol.send("__response__", new EmptyContent().pack(), messageId);
          return;
        }
        if (type === "room.tool_call_response") {
          responses.push(unpackContent(data));
        }
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    const hostedToolkit = await startHostedToolkit({
      room,
      toolkit: new Toolkit({ name: "test", tools: [new EchoTool()] }),
    });

    const open = contentHeader(new ControlContent({ method: "open" }));
    await pair.serverProtocol.send(
      "room.tool_call.test",
      packMessage({ name: "echo", tool_call_id: "call-1", arguments: open.header }, open.payload),
      400,
    );

    await waitUntil(() => responses.length === 1);
    expect(responses[0]).to.be.instanceOf(ErrorContent);
    expect((responses[0] as ErrorContent).text).to.contain("input_spec requires single-content input");

    await hostedToolkit.stop();
    room.dispose();
    pair.dispose();
  });

  it("accepts non-stream input for ContentTool", async () => {
    const pair = new ProtocolPair();
    const responses: Content[] = [];

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (type === "room.register_toolkit") {
          await protocol.send("__response__", new JsonContent({ json: { id: "registration-1" } }).pack(), messageId);
          return;
        }
        if (type === "room.unregister_toolkit") {
          await protocol.send("__response__", new EmptyContent().pack(), messageId);
          return;
        }
        if (type === "room.tool_call_response") {
          responses.push(unpackContent(data));
        }
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    const hostedToolkit = await startHostedToolkit({
      room,
      toolkit: new Toolkit({ name: "test", tools: [new EchoContentInputTool()] }),
    });

    const input = contentHeader(new JsonContent({ json: { value: 1 } }));
    await pair.serverProtocol.send(
      "room.tool_call.test",
      packMessage({ name: "echo_content_input", tool_call_id: "call-1", arguments: input.header }, input.payload),
      401,
    );

    await waitUntil(() => responses.length === 1);
    expect(responses[0]).to.be.instanceOf(JsonContent);
    expect((responses[0] as JsonContent).json).to.deep.equal({ count: 1, first: { value: 1 } });

    await hostedToolkit.stop();
    room.dispose();
    pair.dispose();
  });

  it("validates unary output against JSON schema", async () => {
    const pair = new ProtocolPair();
    const responses: Content[] = [];

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (type === "room.register_toolkit") {
          await protocol.send("__response__", new JsonContent({ json: { id: "registration-1" } }).pack(), messageId);
          return;
        }
        if (type === "room.unregister_toolkit") {
          await protocol.send("__response__", new EmptyContent().pack(), messageId);
          return;
        }
        if (type === "room.tool_call_response") {
          responses.push(unpackContent(data));
        }
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    const hostedToolkit = await startHostedToolkit({
      room,
      toolkit: new Toolkit({ name: "test", tools: [new InvalidOutputTool()] }),
    });

    const input = contentHeader(new JsonContent({ json: {} }));
    await pair.serverProtocol.send(
      "room.tool_call.test",
      packMessage({ name: "invalid_output", tool_call_id: "call-1", arguments: input.header }, input.payload),
      402,
    );

    await waitUntil(() => responses.length === 1);
    expect(responses[0]).to.be.instanceOf(ErrorContent);
    expect((responses[0] as ErrorContent).text).to.contain("output does not match output_schema");

    await hostedToolkit.stop();
    room.dispose();
    pair.dispose();
  });

  it("closes request stream when room disconnects mid-call", async () => {
    const pair = new ProtocolPair();
    const tool = new WaitForDisconnectTool();
    let started = false;
    let ended = false;
    let responseOpened = false;
    tool.started = () => {
      started = true;
    };
    tool.ended = () => {
      ended = true;
    };

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (type === "room.register_toolkit") {
          await protocol.send("__response__", new JsonContent({ json: { id: "registration-1" } }).pack(), messageId);
          return;
        }
        if (type === "room.unregister_toolkit") {
          await protocol.send("__response__", new EmptyContent().pack(), messageId);
          return;
        }
        if (type === "room.tool_call_response") {
          const response = unpackContent(data);
          responseOpened = response instanceof ControlContent && response.method === "open";
        }
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    await startHostedToolkit({
      room,
      toolkit: new Toolkit({ name: "test", tools: [tool] }),
    });

    const open = contentHeader(new ControlContent({ method: "open" }));
    await pair.serverProtocol.send(
      "room.tool_call.test",
      packMessage({ name: "wait_for_disconnect", tool_call_id: "call-disconnect", arguments: open.header }, open.payload),
      403,
    );

    await waitUntil(() => started);
    await waitUntil(() => responseOpened);
    const originalDebug = console.debug;
    console.debug = (message?: unknown, ...optionalParams: unknown[]) => {
      if (typeof message === "string" && message.startsWith("unable to send tool call response chunk")) {
        return;
      }
      originalDebug(message, ...optionalParams);
    };
    try {
      pair.disconnectClient();
      await waitUntil(() => ended);
    } finally {
      console.debug = originalDebug;
    }

    room.dispose();
    pair.dispose();
  });


  it("reregisters hosted toolkits after reconnect", async () => {
    const pair1 = new ProtocolPair();
    const pair2 = new ProtocolPair();
    const pairs = [pair1, pair2];
    let nextPairIndex = 0;
    const registerCalls: number[] = [];
    const unregisterCalls: number[] = [];

    function startServer(pair: ProtocolPair, connectionIndex: number): void {
      pair.serverProtocol.start({
        onMessage: async (protocol, messageId, type) => {
          if (type === "room.register_toolkit") {
            registerCalls.push(connectionIndex);
            await protocol.send(
              "__response__",
              new JsonContent({ json: { id: `registration-${connectionIndex}` } }).pack(),
              messageId,
            );
            return;
          }

          if (type === "room.unregister_toolkit") {
            unregisterCalls.push(connectionIndex);
            await protocol.send("__response__", new EmptyContent().pack(), messageId);
          }
        },
      });
    }

    startServer(pair1, 0);
    startServer(pair2, 1);

    const room = new RoomClient({
      protocolFactory: () => {
        const pair = pairs[nextPairIndex];
        if (pair == null) {
          throw new Error("no queued protocol pairs available");
        }
        nextPairIndex += 1;
        return pair.clientProtocolFactory();
      },
      reconnectTimeout: 500,
    });

    const start = room.start();
    await sendRoomReady(pair1.serverProtocol);
    await start;

    const toolkit = new Toolkit({
      name: "test",
      title: "Test",
      description: "Test toolkit",
      tools: [new EchoTool()],
    });
    const hostedToolkit = await startHostedToolkit({ room, toolkit, public_: true });

    expect(registerCalls).to.deep.equal([0]);

    pair1.disconnectClientWithError(new Error("socket disconnected"));
    setTimeout(() => {
      void sendRoomReady(pair2.serverProtocol);
    }, 10);

    await waitUntil(() => registerCalls.length === 2);
    expect(registerCalls).to.deep.equal([0, 1]);

    await hostedToolkit.stop();
    expect(unregisterCalls).to.deep.equal([1]);

    room.dispose();
    pair1.dispose();
    pair2.dispose();
  });
});
