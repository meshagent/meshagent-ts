import { expect } from "chai";

import { RoomClient } from "../room-client";
import { Protocol, ProtocolMessageStream, StreamProtocolChannel } from "../protocol";
import {
  BinaryContent,
  Content,
  ControlContent,
  EmptyContent,
  unpackContent,
} from "../response";
import { packMessage, unpackMessage } from "../utils";

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

describe("room_client_stream_test", () => {
  it("starts request chunks before waiting for the open response", async () => {
    const pair = new ProtocolPair();
    let toolCallId: string | undefined;
    let invokeMessageId: number | undefined;
    let openSent = false;
    const requestChunks: Content[] = [];

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (!data) {
          return;
        }

        if (type === "room.invoke_tool") {
          const [request] = unpackMessage(data);
          expect(request["toolkit"]).to.equal("storage");
          expect(request["tool"]).to.equal("upload");
          expect(request["arguments"]).to.deep.equal({ type: "control", method: "open" });
          toolCallId = request["tool_call_id"];
          invokeMessageId = messageId;
          return;
        }

        if (type !== "room.tool_call_request_chunk") {
          return;
        }

        const [message, payload] = unpackMessage(data);
        const chunkHeader = message["chunk"] as Record<string, unknown>;
        const chunk = unpackContent(packMessage(
          chunkHeader,
          payload.length > 0 ? payload : undefined,
        ));
        requestChunks.push(chunk);

        await protocol.send("__response__", new EmptyContent().pack(), messageId);

        if (!toolCallId || invokeMessageId == null) {
          return;
        }

        if (!openSent && chunk instanceof BinaryContent && chunk.headers["kind"] === "start") {
          openSent = true;
          await protocol.send("__response__", new ControlContent({ method: "open" }).pack(), invokeMessageId);
          await sendToolCallResponseChunk({
            protocol,
            toolCallId,
            chunk: new BinaryContent({
              data: new Uint8Array(0),
              headers: { kind: "pull" },
            }),
          });
          return;
        }

        if (chunk instanceof BinaryContent && chunk.headers["kind"] === "data") {
          await sendToolCallResponseChunk({
            protocol,
            toolCallId,
            chunk: new BinaryContent({
              data: new Uint8Array(0),
              headers: { kind: "pull" },
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
      async function* input(): AsyncIterable<Content> {
        yield new BinaryContent({
          data: new Uint8Array(0),
          headers: { kind: "start", path: "docs/file.txt", overwrite: false },
        });
        yield new BinaryContent({
          data: new Uint8Array([1, 2, 3]),
          headers: { kind: "data" },
        });
      }

      const stream = await room.invokeStream({
        toolkit: "storage",
        tool: "upload",
        input: input(),
      });

      const received: Content[] = [];
      for await (const chunk of stream) {
        received.push(chunk);
      }

      expect(received).to.have.length(3);
      expect(received[0]).to.be.instanceOf(BinaryContent);
      expect((received[0] as BinaryContent).headers["kind"]).to.equal("pull");
      expect(received[1]).to.be.instanceOf(BinaryContent);
      expect((received[1] as BinaryContent).headers["kind"]).to.equal("pull");
      expect(received[2]).to.be.instanceOf(ControlContent);
      expect((received[2] as ControlContent).method).to.equal("close");

      expect(requestChunks).to.have.length(3);
      expect(requestChunks[0]).to.be.instanceOf(BinaryContent);
      expect((requestChunks[0] as BinaryContent).headers["kind"]).to.equal("start");
      expect(requestChunks[1]).to.be.instanceOf(BinaryContent);
      expect((requestChunks[1] as BinaryContent).headers["kind"]).to.equal("data");
      expect(requestChunks[2]).to.be.instanceOf(ControlContent);
      expect((requestChunks[2] as ControlContent).method).to.equal("close");
    } finally {
      room.dispose();
      pair.dispose();
    }
  });

  it("buffers tool stream chunks emitted before the consumer starts iterating", async () => {
    const pair = new ProtocolPair();
    let toolCallId: string | undefined;
    const requestChunks: Content[] = [];

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (!data) {
          return;
        }

        if (type === "room.invoke_tool") {
          const [request] = unpackMessage(data);
          expect(request["toolkit"]).to.equal("storage");
          expect(request["tool"]).to.equal("upload");
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
        const chunkHeader = message["chunk"] as Record<string, unknown>;
        const chunk = unpackContent(packMessage(
          chunkHeader,
          payload.length > 0 ? payload : undefined,
        ));
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
              data: new Uint8Array(0),
              headers: { kind: "pull" },
            }),
          });
          return;
        }

        if (chunk instanceof BinaryContent && chunk.headers["kind"] === "data") {
          await sendToolCallResponseChunk({
            protocol,
            toolCallId,
            chunk: new BinaryContent({
              data: new Uint8Array(0),
              headers: { kind: "pull" },
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
      async function* input(): AsyncIterable<Content> {
        yield new BinaryContent({
          data: new Uint8Array(0),
          headers: { kind: "start", path: "docs/file.txt", overwrite: false },
        });
        yield new BinaryContent({
          data: new Uint8Array([1, 2, 3]),
          headers: { kind: "data" },
        });
      }

      const stream = await room.invokeStream({
        toolkit: "storage",
        tool: "upload",
        input: input(),
      });

      // Give the request task a chance to push the first server chunk before
      // the consumer begins iterating. This was previously dropped.
      await Promise.resolve();

      const received: Content[] = [];
      for await (const chunk of stream) {
        received.push(chunk);
      }

      expect(received).to.have.length(3);
      expect(received[0]).to.be.instanceOf(BinaryContent);
      expect((received[0] as BinaryContent).headers["kind"]).to.equal("pull");
      expect(received[1]).to.be.instanceOf(BinaryContent);
      expect((received[1] as BinaryContent).headers["kind"]).to.equal("pull");
      expect(received[2]).to.be.instanceOf(ControlContent);
      expect((received[2] as ControlContent).method).to.equal("close");

      expect(requestChunks).to.have.length(3);
      expect(requestChunks[0]).to.be.instanceOf(BinaryContent);
      expect((requestChunks[0] as BinaryContent).headers["kind"]).to.equal("start");
      expect(requestChunks[1]).to.be.instanceOf(BinaryContent);
      expect((requestChunks[1] as BinaryContent).headers["kind"]).to.equal("data");
      expect(requestChunks[2]).to.be.instanceOf(ControlContent);
      expect((requestChunks[2] as ControlContent).method).to.equal("close");
    } finally {
      room.dispose();
      pair.dispose();
    }
  });
});
