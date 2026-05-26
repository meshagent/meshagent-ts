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
