import { expect } from "chai";

import { RoomClient } from "../room-client";
import { Protocol, ProtocolChannel } from "../protocol";
import { EmptyContent, JsonContent, type Content } from "../response";
import { startHostedToolkit, Tool, Toolkit } from "../agent";
import { packMessage } from "../utils";

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

describe("remote_toolkit_test", () => {
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
