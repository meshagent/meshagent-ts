import { expect } from "chai";

import { RoomClient } from "../room-client";
import { RemoteParticipant } from "../participant";
import {
  Protocol,
  ProtocolChannel,
  ProtocolCloseKind,
  ProtocolHandshakeException,
  ProtocolReconnectUnsupportedException,
} from "../protocol";
import {
  BinaryContent,
  Content,
  ControlContent,
  EmptyContent,
  JsonContent,
  unpackContent,
} from "../response";
import { RoomStatusEvent } from "../room-event";
import { RoomServerException } from "../room-server-client";
import { MeshSchema, ElementType } from "../schema";
import type { OAuthTokenRequest, SecretRequest } from "../secrets-client";
import { packMessage, unpackMessage } from "../utils";

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
      throw new ProtocolReconnectUnsupportedException(
        "protocolFactory was not configured for reconnecting this protocol",
      );
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

class IdleProtocolChannel implements ProtocolChannel {
  public start(
    _onDataReceived: (data: Uint8Array) => void,
    _params: { onDone?: () => void; onError?: (error: unknown) => void },
  ): void {}

  public dispose(): void {}

  public async sendData(_data: Uint8Array): Promise<void> {}
}

class HandshakeStatusChannel implements ProtocolChannel {
  private readonly _statusCode: number;
  private readonly _statusText: string;
  private _started = false;

  constructor({ statusCode, statusText }: { statusCode: number; statusText: string }) {
    this._statusCode = statusCode;
    this._statusText = statusText;
  }

  public start(
    _onDataReceived: (data: Uint8Array) => void,
    { onError }: { onDone?: () => void; onError?: (error: unknown) => void },
  ): void {
    if (this._started) {
      throw new Error("Already started");
    }
    this._started = true;
    queueMicrotask(() => {
      onError?.(
        new ProtocolHandshakeException({
          statusCode: this._statusCode,
          statusText: this._statusText,
        }),
      );
    });
  }

  public dispose(): void {
    this._started = false;
  }

  public async sendData(_data: Uint8Array): Promise<void> {}
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

async function sendToolCallResponseChunk(params: {
  protocol: Protocol;
  toolCallId: string;
  chunk: Content;
}): Promise<void> {
  const packed = params.chunk.pack();
  const [header, payload] = unpackMessage(packed);
  await params.protocol.send(
    "room.tool_call_response_chunk",
    packMessage(
      {
        tool_call_id: params.toolCallId,
        chunk: header,
      },
      payload.length > 0 ? payload : undefined,
    ),
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

function decodeInvokeJsonInput(
  header: Record<string, unknown>,
  payload: Uint8Array,
): Record<string, unknown> {
  const content = unpackContent(
    packMessage(
      header["arguments"] as Record<string, any>,
      payload.length > 0 ? payload : undefined,
    ),
  );
  if (!(content instanceof JsonContent)) {
    throw new Error("expected JsonContent input");
  }
  return content.json;
}

describe("room_client_request_lifecycle", () => {
  it("defaults to an environment-backed websocket protocol factory", () => {
    const previousRoom = process.env.MESHAGENT_ROOM;
    const previousToken = process.env.MESHAGENT_TOKEN;
    const previousApiUrl = process.env.MESHAGENT_API_URL;

    process.env.MESHAGENT_ROOM = "sample-room";
    process.env.MESHAGENT_TOKEN = "sample-token";
    process.env.MESHAGENT_API_URL = "https://example.test";

    try {
      const room = new RoomClient();
      expect(room.protocol.url).to.equal("wss://example.test/rooms/sample-room");
      expect(room.protocol.token).to.equal("sample-token");
      room.dispose();
    } finally {
      if (previousRoom === undefined) {
        delete process.env.MESHAGENT_ROOM;
      } else {
        process.env.MESHAGENT_ROOM = previousRoom;
      }
      if (previousToken === undefined) {
        delete process.env.MESHAGENT_TOKEN;
      } else {
        process.env.MESHAGENT_TOKEN = previousToken;
      }
      if (previousApiUrl === undefined) {
        delete process.env.MESHAGENT_API_URL;
      } else {
        process.env.MESHAGENT_API_URL = previousApiUrl;
      }
    }
  });

  it("waitForClose stays pending during reconnect attempts and closes after reconnect timeout", async () => {
    const pair = new ProtocolPair();
    let reconnectAttempts = 0;
    const statuses: string[] = [];

    const room = new RoomClient({
      protocolFactory: () => {
        if (reconnectAttempts === 0) {
          reconnectAttempts += 1;
          return pair.clientProtocolFactory();
        }
        reconnectAttempts += 1;
        return new Protocol({ channel: new IdleProtocolChannel() });
      },
      reconnectTimeout: 50,
    });

    room.on("disconnected", (event) => {
      statuses.push((event as RoomStatusEvent).status);
    });
    room.on("reconnected", (event) => {
      statuses.push((event as RoomStatusEvent).status);
    });

    pair.serverProtocol.start({ onMessage: async () => {} });

    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    const waitForClose = room.waitForClose().then(() => "closed");
    pair.disconnectClientWithError(new Error("socket disconnected"));

    const earlyState = await Promise.race([
      waitForClose,
      new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 10)),
    ]);
    expect(earlyState).to.equal("waiting");

    expect(await waitForClose).to.equal("closed");
    expect(room.isClosed).to.equal(true);
    expect(room.closeKind).to.equal(ProtocolCloseKind.ERROR);
    expect(room.closeReason).to.contain("room reconnect timed out");
    expect(statuses).to.include("disconnected");
    expect(statuses).to.not.include("reconnected");
    expect(reconnectAttempts).to.be.greaterThan(1);

    pair.dispose();
  });

  it("routes inbound secret requests through RoomClient handler options", async () => {
    const pair = new ProtocolPair();
    const oauthRequests: OAuthTokenRequest[] = [];
    const secretRequests: SecretRequest[] = [];

    pair.serverProtocol.start({ onMessage: async () => {} });

    const room = new RoomClient({
      protocolFactory: () => pair.clientProtocolFactory(),
      oauthTokenRequestHandler: (request) => {
        oauthRequests.push(request);
      },
      secretRequestHandler: (request) => {
        secretRequests.push(request);
      },
    });

    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    await pair.serverProtocol.send(
      "secrets.request_oauth_token",
      packMessage({
        request_id: "req-1",
        request: {
          oauth: {
            client_id: "client-id",
            authorization_endpoint: "https://example.com/authorize",
            token_endpoint: "https://example.com/token",
            scopes: ["openid"],
          },
        },
        challenge: "challenge",
      }),
    );
    await pair.serverProtocol.send(
      "secrets.request_secret",
      packMessage({
        request_id: "req-2",
        request: {
          url: "https://example.com/secret",
          type: "text/plain",
          delegate_to: "agent",
        },
      }),
    );

    await waitUntil(() => oauthRequests.length === 1 && secretRequests.length === 1);

    expect(oauthRequests).to.deep.equal([
      {
        requestId: "req-1",
        authorizationEndpoint: "https://example.com/authorize",
        tokenEndpoint: "https://example.com/token",
        challenge: "challenge",
        scopes: ["openid"],
        clientId: "client-id",
      },
    ]);
    expect(secretRequests).to.deep.equal([
      {
        requestId: "req-2",
        url: "https://example.com/secret",
        type: "text/plain",
        delegateTo: "agent",
      },
    ]);

    room.dispose();
    pair.dispose();
  });

  for (const handshakeStatus of [
    { statusCode: 403, statusText: "Forbidden" },
    { statusCode: 404, statusText: "Not Found" },
  ]) {
    it(`start does not retry websocket handshake status ${handshakeStatus.statusCode}`, async () => {
      let protocolFactoryCalls = 0;
      const room = new RoomClient({
        protocolFactory: () => {
          protocolFactoryCalls += 1;
          return new Protocol({
            channel: new HandshakeStatusChannel(handshakeStatus),
          });
        },
        reconnectTimeout: 500,
      });

      try {
        await room.start();
        throw new Error("expected start to fail");
      } catch (error) {
        expect(error).to.be.instanceOf(RoomServerException);
        expect((error as RoomServerException).message).to.equal(
          `websocket connect failed with status ${handshakeStatus.statusCode}: ${handshakeStatus.statusText}`,
        );
      } finally {
        room.dispose();
      }

      expect(protocolFactoryCalls).to.equal(1);
    });

    it(`reconnect does not retry websocket handshake status ${handshakeStatus.statusCode}`, async () => {
      const pair = new ProtocolPair();
      let protocolFactoryCalls = 0;

      const room = new RoomClient({
        protocolFactory: () => {
          protocolFactoryCalls += 1;
          if (protocolFactoryCalls === 1) {
            return pair.clientProtocolFactory();
          }
          return new Protocol({
            channel: new HandshakeStatusChannel(handshakeStatus),
          });
        },
        reconnectTimeout: 500,
      });

      pair.serverProtocol.start({ onMessage: async () => {} });

      const start = room.start();
      await sendRoomReady(pair.serverProtocol);
      await start;

      pair.disconnectClientWithError(new Error("socket disconnected"));
      await room.waitForClose();

      expect(protocolFactoryCalls).to.equal(2);
      expect(room.isClosed).to.equal(true);
      expect(room.closeKind).to.equal(ProtocolCloseKind.ERROR);
      expect(room.closeReason).to.equal(
        `websocket connect failed with status ${handshakeStatus.statusCode}: ${handshakeStatus.statusText}`,
      );

      try {
        await room.sendRequest("noop", {});
        throw new Error("expected sendRequest to fail");
      } catch (error) {
        expect(error).to.be.instanceOf(RoomServerException);
        expect((error as RoomServerException).message).to.equal(
          `room connection unexpectedly closed before request completed: websocket connect failed with status ${handshakeStatus.statusCode}: ${handshakeStatus.statusText}`,
        );
      } finally {
        room.dispose();
        pair.dispose();
      }
    });
  }

  it("reconnect resends local attributes, reenables messaging, reopens sync docs, and flushes queued sends", async () => {
    const pair1 = new ProtocolPair();
    const pair2 = new ProtocolPair();
    const pairs = [pair1, pair2];
    let nextPairIndex = 0;
    const schema = new MeshSchema({
      rootTagName: "thread",
      elements: [new ElementType({ tagName: "thread", properties: [] })],
    });

    const syncOpenHeaders: Array<{ connection: number; headers: Record<string, unknown> }> = [];
    const messagingEnableCalls: number[] = [];
    const setAttributePayloads: Array<{ connection: number; payload: Record<string, unknown> }> = [];
    const messagingSendInputs: Array<{ connection: number; input: Record<string, unknown> }> = [];

    function startServer(pair: ProtocolPair, connectionIndex: number): void {
      let activeSyncToolCallId: string | null = null;

      pair.serverProtocol.start({
        onMessage: async (protocol, messageId, type, data) => {
          if (data == null) {
            return;
          }

          if (type === "set_attributes") {
            const [payload] = unpackMessage(data);
            setAttributePayloads.push({
              connection: connectionIndex,
              payload,
            });
            return;
          }

          if (type === "room.invoke_tool") {
            const [header, payload] = unpackMessage(data);
            if (header["toolkit"] === "sync" && header["tool"] === "open") {
              activeSyncToolCallId = header["tool_call_id"] as string;
              await protocol.send(
                "__response__",
                new ControlContent({ method: "open" }).pack(),
                messageId,
              );
              return;
            }

            if (header["toolkit"] === "messaging" && header["tool"] === "enable") {
              messagingEnableCalls.push(connectionIndex);
              await protocol.send("__response__", new EmptyContent().pack(), messageId);
              await protocol.send(
                "messaging.send",
                packMessage({
                  from_participant_id: "remote-1",
                  type: "messaging.enabled",
                  message: {
                    participants: [{
                      id: "remote-1",
                      role: "member",
                      attributes: { name: "Remote User" },
                    }],
                  },
                }),
              );
              return;
            }

            if (header["toolkit"] === "messaging" && header["tool"] === "send") {
              messagingSendInputs.push({
                connection: connectionIndex,
                input: decodeInvokeJsonInput(header, payload),
              });
              await protocol.send("__response__", new EmptyContent().pack(), messageId);
              return;
            }
          }

          if (type !== "room.tool_call_request_chunk") {
            return;
          }

          const [message, payload] = unpackMessage(data);
          await protocol.send("__response__", new EmptyContent().pack(), messageId);
          if (activeSyncToolCallId == null) {
            return;
          }

          const chunk = unpackContent(
            packMessage(
              message["chunk"] as Record<string, any>,
              payload.length > 0 ? payload : undefined,
            ),
          );
          if (!(chunk instanceof BinaryContent) || chunk.headers["kind"] !== "start") {
            return;
          }

          syncOpenHeaders.push({
            connection: connectionIndex,
            headers: { ...chunk.headers },
          });
          await sendToolCallResponseChunk({
            protocol,
            toolCallId: activeSyncToolCallId,
            chunk: new BinaryContent({
              data: new Uint8Array(),
              headers: {
                kind: "state",
                path: "thread.thread",
                schema: schema.toJson(),
              },
            }),
          });
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

    room.messaging.enable();
    await waitUntil(() => room.messaging.online);

    room.localParticipant!.setAttribute("status", "ready");
    await waitUntil(() =>
      setAttributePayloads.some(
        (entry) =>
          entry.connection === 0 &&
          entry.payload["status"] === "ready",
      ),
    );

    const doc = await room.sync.open("thread.thread", { schema });
    const expectedVector = doc.getStateVector();
    expect(syncOpenHeaders[0]!.headers["vector"]).to.equal(null);

    pair1.disconnectClientWithError(new Error("socket disconnected"));
    await waitUntil(() => room.isConnected === false);

    room.localParticipant!.setAttribute("mode", "offline");

    const sendTask = room.messaging.sendMessage({
      to: new RemoteParticipant(room, "remote-1", "member"),
      type: "direct",
      message: { value: 1 },
    });

    setTimeout(() => {
      void sendRoomReady(pair2.serverProtocol);
    }, 10);

    await waitUntil(() => room.isConnected);
    await sendTask;

    expect(messagingEnableCalls).to.deep.equal([0, 1]);
    expect(syncOpenHeaders[1]!.headers["vector"]).to.equal(expectedVector);
    expect(messagingSendInputs).to.deep.equal([
      {
        connection: 1,
        input: {
          to_participant_id: "remote-1",
          type: "direct",
          message_json: JSON.stringify({ value: 1 }),
        },
      },
    ]);
    expect(
      setAttributePayloads.some(
        (entry) =>
          entry.connection === 1 &&
          entry.payload["name"] === "self" &&
          entry.payload["status"] === "ready" &&
          entry.payload["mode"] === "offline",
      ),
    ).to.equal(true);
    expect(room.messaging.online).to.equal(true);
    expect(room.messaging.remoteParticipants).to.have.length(1);

    room.dispose();
    pair1.dispose();
    pair2.dispose();
  });

  it("fails in-flight requests when the room is disposed", async () => {
    const pair = new ProtocolPair();
    let requestReceived = false;

    pair.serverProtocol.start({
      onMessage: async (_protocol, _messageId, type) => {
        if (type === "test.hang") {
          requestReceived = true;
        }
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    const pending = room.sendRequest("test.hang", { value: 1 });
    await waitUntil(() => requestReceived);
    room.dispose();

    try {
      await pending;
      expect.fail("expected request to fail");
    } catch (error) {
      expect(error).to.be.instanceOf(RoomServerException);
      expect((error as RoomServerException).message).to.equal(
        "room client was closed before request completed",
      );
    }

    pair.dispose();
  });
});
