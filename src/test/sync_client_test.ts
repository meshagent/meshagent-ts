import { expect } from "chai";

import { RoomClient } from "../room-client";
import { Protocol, ProtocolMessageStream, StreamProtocolChannel } from "../protocol";
import { BinaryContent, Content, ControlContent, EmptyContent, unpackContent } from "../response";
import { MeshSchema } from "../schema";
import { ElementType } from "../schema";
import { encoder, packMessage, unpackMessage } from "../utils";

class ProtocolPair {
  public readonly clientProtocol: Protocol;
  public readonly serverProtocol: Protocol;

  private readonly clientToServer = new ProtocolMessageStream<Uint8Array>();
  private readonly serverToClient = new ProtocolMessageStream<Uint8Array>();

  constructor() {
    this.clientProtocol = new Protocol({
      channel: new StreamProtocolChannel({
        input: this.serverToClient,
        output: this.clientToServer,
      }),
    });
    this.serverProtocol = new Protocol({
      channel: new StreamProtocolChannel({
        input: this.clientToServer,
        output: this.serverToClient,
      }),
    });
  }

  dispose(): void {
    this.clientProtocol.dispose();
    this.serverProtocol.dispose();
    this.clientToServer.close();
    this.serverToClient.close();
  }
}

async function sendRoomReady(protocol: Protocol): Promise<void> {
  await protocol.send("room_ready", packMessage({
    room_name: "test-room",
    room_url: "ws://example/rooms/test-room",
    session_id: "session-1",
  }));
}

async function sendToolCallResponseChunk(params: {
  protocol: Protocol;
  toolCallId: string;
  chunk: Content;
}): Promise<void> {
  const packed = params.chunk.pack();
  const [header, payload] = unpackMessage(packed);
  await params.protocol.send("room.tool_call_response_chunk", packMessage({
    tool_call_id: params.toolCallId,
    chunk: header,
  }, payload.length > 0 ? payload : undefined));
}

describe("sync_client_test", () => {
  it("streams open, sync, and close through sync.open", async () => {
    const pair = new ProtocolPair();
    const schema = new MeshSchema({
      rootTagName: "thread",
      elements: [new ElementType({ tagName: "thread", properties: [] })],
    });

    let toolCallId: string | undefined;
    const requestChunks: Content[] = [];

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (!data) {
          return;
        }

        if (type === "room.invoke_tool") {
          const [request] = unpackMessage(data);
          expect(request["toolkit"]).to.equal("sync");
          expect(request["tool"]).to.equal("open");
          expect(request["arguments"]).to.deep.equal({ type: "control", method: "open" });
          expect(request["tool_call_id"]).to.be.a("string");
          toolCallId = request["tool_call_id"];
          await protocol.send("__response__", new ControlContent({ method: "open" }).pack(), messageId);
          return;
        }

        if (type !== "room.tool_call_request_chunk") {
          return;
        }

        const [message, payload] = unpackMessage(data);
        const chunkHeader = message["chunk"] as Record<string, any>;
        const chunk = unpackContent(packMessage(chunkHeader, payload.length > 0 ? payload : undefined));
        requestChunks.push(chunk);
        await protocol.send("__response__", new EmptyContent().pack(), messageId);

        if (!toolCallId) {
          return;
        }

        if (chunk instanceof BinaryContent && chunk.headers["kind"] === "start") {
          await sendToolCallResponseChunk({
            protocol,
            toolCallId,
            chunk: new BinaryContent({
              data: new Uint8Array(),
                headers: {
                  kind: "state",
                  path: "thread.thread",
                  schema: schema.toJson(),
                },
              }),
          });
          return;
        }

        if (chunk instanceof ControlContent && chunk.method === "close") {
          await sendToolCallResponseChunk({
            protocol,
            toolCallId,
            chunk: new ControlContent({ method: "close" }),
          });
        }
      },
    });

    const room = new RoomClient({ protocol: pair.clientProtocol });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    try {
      const doc = await room.sync.open("/thread.thread");
      expect(await doc.synchronized).to.equal(true);

      await room.sync.sync("/thread.thread", encoder.encode("YQ=="));
      await new Promise((resolve) => setTimeout(resolve, 50));
      await room.sync.close("/thread.thread");

      expect(requestChunks).to.have.length.greaterThanOrEqual(3);

      expect(requestChunks[0]).to.be.instanceOf(BinaryContent);
      const startChunk = requestChunks[0] as BinaryContent;
      expect(startChunk.headers["kind"]).to.equal("start");
      expect(startChunk.headers["path"]).to.equal("thread.thread");
      expect(startChunk.headers["create"]).to.equal(true);

      expect(requestChunks[1]).to.be.instanceOf(BinaryContent);
      const syncChunk = requestChunks[1] as BinaryContent;
      expect(syncChunk.headers).to.deep.equal({ kind: "sync" });
      expect(Array.from(syncChunk.data)).to.deep.equal(Array.from(encoder.encode("YQ==")));

      expect(requestChunks[requestChunks.length - 1]).to.be.instanceOf(ControlContent);
      const closeChunk = requestChunks[requestChunks.length - 1] as ControlContent;
      expect(closeChunk.method).to.equal("close");
    } finally {
      room.dispose();
      pair.dispose();
    }
  });
});
