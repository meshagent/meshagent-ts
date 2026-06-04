import { expect } from "chai";

import { RoomClient } from "../room-client.js";
import { RoomStatusEvent } from "../room-event.js";
import { Protocol, ProtocolMessageStream, StreamProtocolChannel } from "../protocol.js";
import { ToolContentInput, ToolStreamInput, ToolStreamOutput } from "../agent.js";
import {
  BinaryContent,
  Content,
  ControlCloseStatus,
  ControlContent,
  EmptyContent,
  ErrorContent,
  JsonContent,
  TextContent,
  unpackContent,
} from "../response.js";
import { RoomServerException } from "../room-server-client.js";
import { packMessage, unpackMessage } from "../utils.js";

class ProtocolPair {
  public readonly serverProtocol: Protocol;

  private readonly clientToServer = new ProtocolMessageStream<Uint8Array>();
  private readonly serverToClient = new ProtocolMessageStream<Uint8Array>();
  private _clientProtocol: Protocol | null = null;

  constructor() {
    this.serverProtocol = new Protocol({
      channel: new StreamProtocolChannel({
        input: this.clientToServer,
        output: this.serverToClient,
      }),
    });
  }

  public clientProtocolFactory(): Protocol {
    if (this._clientProtocol != null) {
      throw new Error("protocolFactory was not configured for reconnecting this protocol");
    }
    const protocol = new Protocol({
      channel: new StreamProtocolChannel({
        input: this.serverToClient,
        output: this.clientToServer,
      }),
    });
    this._clientProtocol = protocol;
    return protocol;
  }

  dispose(): void {
    this._clientProtocol?.dispose();
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
  await protocol.send("connected", packMessage({
    type: "init",
    participantId: "self",
    attributes: { name: "self" },
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

class AsyncContentQueue implements AsyncIterable<Content> {
  private readonly values: Content[] = [];
  private waiter: (() => void) | null = null;
  private closed = false;

  public add(content: Content): void {
    this.values.push(content);
    this.waiter?.();
    this.waiter = null;
  }

  public close(): void {
    this.closed = true;
    this.waiter?.();
    this.waiter = null;
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<Content> {
    while (true) {
      if (this.values.length > 0) {
        yield this.values.shift()!;
        continue;
      }
      if (this.closed) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
  }
}

async function expectRoomServerException(
  promise: Promise<unknown>,
  expectedMessage: string,
): Promise<RoomServerException> {
  try {
    await promise;
  } catch (error) {
    expect(error).to.be.instanceOf(RoomServerException);
    const roomError = error as RoomServerException;
    expect(roomError.message).to.contain(expectedMessage);
    return roomError;
  }
  throw new Error("expected RoomServerException");
}

async function collectStreamResult(stream: AsyncIterable<Content>): Promise<{
  received: Content[];
  error?: unknown;
}> {
  const received: Content[] = [];
  try {
    for await (const chunk of stream) {
      received.push(chunk);
    }
    return { received };
  } catch (error) {
    return { received, error };
  }
}

describe("room_client_stream_test", () => {
  it("invokeTool fails fast when server returns invoke response error", async () => {
    const pair = new ProtocolPair();

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type) => {
        if (type !== "room.invoke_tool") {
          return;
        }
        await protocol.send(
          "__response__",
          new ErrorContent({ text: "tool 'stream' requires streamed input", code: 1002 }).pack(),
          messageId,
        );
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    try {
      const error = await expectRoomServerException(
        room.agents.invokeTool({
          toolkit: "test-stream-toolkit",
          tool: "stream",
          input: new ToolContentInput(new JsonContent({ json: {} })),
        }),
        "requires streamed input",
      );
      expect(error.code).to.equal(1002);
    } finally {
      room.dispose();
      pair.dispose();
    }
  });

  it("invokeTool fails when error chunk arrives before invoke response", async () => {
    const pair = new ProtocolPair();

    pair.serverProtocol.start({
      onMessage: async (protocol, _messageId, type, data) => {
        if (!data || type !== "room.invoke_tool") {
          return;
        }
        const [request] = unpackMessage(data);
        const toolCallId = request["tool_call_id"] as string;
        await protocol.send(
          "room.tool_call_response_chunk",
          packMessage({
            tool_call_id: toolCallId,
            toolkit: "test-stream-toolkit",
            tool: "stream",
            chunk: { type: "error", text: "tool 'stream' requires streamed input", code: 1002 },
          }),
        );
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    try {
      const error = await expectRoomServerException(
        room.agents.invokeTool({
          toolkit: "test-stream-toolkit",
          tool: "stream",
          input: new ToolContentInput(new JsonContent({ json: {} })),
        }),
        "requires streamed input",
      );
      expect(error.code).to.equal(1002);
    } finally {
      room.dispose();
      pair.dispose();
    }
  });

  it("invokeTool stream emits error when request chunk send fails after open", async () => {
    const pair = new ProtocolPair();
    let sawTextChunk = false;

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (type === "room.invoke_tool") {
          await protocol.send("__response__", new ControlContent({ method: "open" }).pack(), messageId);
          return;
        }
        if (!data || type !== "room.tool_call_request_chunk") {
          return;
        }

        const [message] = unpackMessage(data);
        const chunk = message["chunk"] as Record<string, unknown>;
        if (chunk["type"] === "text") {
          sawTextChunk = true;
          await protocol.send("__response__", new ErrorContent({ text: "schema mismatch" }).pack(), messageId);
          return;
        }
        await protocol.send("__response__", new EmptyContent().pack(), messageId);
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    try {
      const input = new AsyncContentQueue();
      const response = await room.agents.invokeTool({
        toolkit: "test-stream-toolkit",
        tool: "stream",
        input: new ToolStreamInput(input),
      });
      expect(response).to.be.instanceOf(ToolStreamOutput);

      const resultPromise = collectStreamResult((response as ToolStreamOutput).stream);
      input.add(new TextContent({ text: "bad" }));
      input.close();

      const result = await resultPromise;
      expect(sawTextChunk).to.equal(true);
      expect(result.error).to.be.instanceOf(RoomServerException);
      expect((result.error as RoomServerException).message).to.contain("schema mismatch");
    } finally {
      room.dispose();
      pair.dispose();
    }
  });

  it("invokeTool stream delivers ErrorContent chunk and then closes when server closes stream", async () => {
    const pair = new ProtocolPair();
    let toolCallId: string | undefined;
    let sentFailureChunks = false;

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (!data) {
          return;
        }
        if (type === "room.invoke_tool") {
          const [request] = unpackMessage(data);
          toolCallId = request["tool_call_id"] as string;
          await protocol.send("__response__", new ControlContent({ method: "open" }).pack(), messageId);
          return;
        }
        if (type !== "room.tool_call_request_chunk") {
          return;
        }

        await protocol.send("__response__", new EmptyContent().pack(), messageId);
        if (sentFailureChunks || toolCallId == null) {
          return;
        }
        sentFailureChunks = true;
        await sendToolCallResponseChunk({
          protocol,
          toolCallId,
          chunk: new ErrorContent({ text: "schema mismatch" }),
        });
        await sendToolCallResponseChunk({
          protocol,
          toolCallId,
          chunk: new ControlContent({ method: "close" }),
        });
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    try {
      const input = new AsyncContentQueue();
      const response = await room.agents.invokeTool({
        toolkit: "test-stream-toolkit",
        tool: "stream",
        input: new ToolStreamInput(input),
      });
      expect(response).to.be.instanceOf(ToolStreamOutput);

      const resultPromise = collectStreamResult((response as ToolStreamOutput).stream);
      input.add(new TextContent({ text: "bad" }));
      input.close();

      const result = await resultPromise;
      expect(result.error).to.equal(undefined);
      expect(result.received).to.have.length(2);
      expect(result.received[0]).to.be.instanceOf(ErrorContent);
      expect((result.received[0] as ErrorContent).text).to.contain("schema mismatch");
      expect(result.received[1]).to.be.instanceOf(ControlContent);
      expect((result.received[1] as ControlContent).method).to.equal("close");
    } finally {
      room.dispose();
      pair.dispose();
    }
  });

  it("invokeTool stream raises when close control chunk is abnormal", async () => {
    const pair = new ProtocolPair();
    let toolCallId: string | undefined;
    let sentClose = false;

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (!data) {
          return;
        }
        if (type === "room.invoke_tool") {
          const [request] = unpackMessage(data);
          toolCallId = request["tool_call_id"] as string;
          await protocol.send("__response__", new ControlContent({ method: "open" }).pack(), messageId);
          return;
        }
        if (type !== "room.tool_call_request_chunk") {
          return;
        }

        await protocol.send("__response__", new EmptyContent().pack(), messageId);
        if (sentClose || toolCallId == null) {
          return;
        }
        sentClose = true;
        await sendToolCallResponseChunk({
          protocol,
          toolCallId,
          chunk: new ControlContent({
            method: "close",
            statusCode: ControlCloseStatus.INVALID_DATA,
            message: "schema mismatch",
          }),
        });
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    try {
      const input = new AsyncContentQueue();
      const response = await room.agents.invokeTool({
        toolkit: "test-stream-toolkit",
        tool: "stream",
        input: new ToolStreamInput(input),
      });
      expect(response).to.be.instanceOf(ToolStreamOutput);
      const streamOutput = response as ToolStreamOutput;

      const resultPromise = collectStreamResult(streamOutput.stream);
      input.add(new TextContent({ text: "bad" }));
      input.close();

      const result = await resultPromise;
      await streamOutput.inputClosed?.catch(() => undefined);
      expect(result.error).to.be.instanceOf(RoomServerException);
      const error = result.error as RoomServerException;
      expect(error.message).to.contain("schema mismatch");
      expect(error.statusCode).to.equal(ControlCloseStatus.INVALID_DATA);
    } finally {
      room.dispose();
      pair.dispose();
    }
  });

  it("invokeTool stream preserves abnormal close error when close arrives before listener attaches", async () => {
    const pair = new ProtocolPair();

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (!data || type !== "room.invoke_tool") {
          return;
        }
        const [request] = unpackMessage(data);
        const toolCallId = request["tool_call_id"] as string;
        await protocol.send("__response__", new ControlContent({ method: "open" }).pack(), messageId);
        await sendToolCallResponseChunk({
          protocol,
          toolCallId,
          chunk: new ControlContent({
            method: "close",
            statusCode: ControlCloseStatus.INVALID_DATA,
            message: "schema mismatch",
          }),
        });
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    try {
      const response = await room.agents.invokeTool({
        toolkit: "test-stream-toolkit",
        tool: "stream",
        input: new ToolContentInput(new JsonContent({ json: {} })),
      });
      expect(response).to.be.instanceOf(ToolStreamOutput);

      const result = await collectStreamResult((response as ToolStreamOutput).stream);
      expect(result.error).to.be.instanceOf(RoomServerException);
      const error = result.error as RoomServerException;
      expect(error.message).to.contain("schema mismatch");
      expect(error.statusCode).to.equal(ControlCloseStatus.INVALID_DATA);
    } finally {
      room.dispose();
      pair.dispose();
    }
  });

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

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
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

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
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

  it("returns single invoke responses as an async iterable", async () => {
    const pair = new ProtocolPair();

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (!data || type !== "room.invoke_tool") {
          return;
        }

        const [request] = unpackMessage(data);
        expect(request["toolkit"]).to.equal("demo");
        expect(request["tool"]).to.equal("echo");
        expect(request["arguments"]).to.deep.equal({ type: "json", json: { value: "hello" } });
        expect(request["tool_call_id"]).to.be.a("string");
        await protocol.send("__response__", new JsonContent({ json: { ok: true } }).pack(), messageId);
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    try {
      const stream = room.invoke({
        toolkit: "demo",
        tool: "echo",
        input: { value: "hello" },
      });

      const received: Content[] = [];
      for await (const chunk of stream) {
        received.push(chunk);
      }

      expect(received).to.have.length(1);
      expect(received[0]).to.be.instanceOf(JsonContent);
      expect((received[0] as JsonContent).json).to.deep.equal({ ok: true });
    } finally {
      room.dispose();
      pair.dispose();
    }
  });

  it("returns streamed invoke responses as an async iterable", async () => {
    const pair = new ProtocolPair();
    let toolCallId: string | undefined;

    pair.serverProtocol.start({
      onMessage: async (protocol, messageId, type, data) => {
        if (!data || type !== "room.invoke_tool") {
          return;
        }

        const [request] = unpackMessage(data);
        expect(request["toolkit"]).to.equal("demo");
        expect(request["tool"]).to.equal("stream");
        expect(request["arguments"]).to.deep.equal({ type: "json", json: { prompt: "hello" } });
        expect(request["tool_call_id"]).to.be.a("string");
        toolCallId = request["tool_call_id"] as string;
        await protocol.send("__response__", new ControlContent({ method: "open" }).pack(), messageId);
        await sendToolCallResponseChunk({
          protocol,
          toolCallId,
          chunk: new TextContent({ text: "one" }),
        });
        await sendToolCallResponseChunk({
          protocol,
          toolCallId,
          chunk: new TextContent({ text: "two" }),
        });
        await sendToolCallResponseChunk({
          protocol,
          toolCallId,
          chunk: new ControlContent({ method: "close" }),
        });
      },
    });

    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const start = room.start();
    await sendRoomReady(pair.serverProtocol);
    await start;

    try {
      const stream = room.invoke({
        toolkit: "demo",
        tool: "stream",
        input: { prompt: "hello" },
      });

      const received: Content[] = [];
      for await (const chunk of stream) {
        received.push(chunk);
      }

      expect(received).to.have.length(3);
      expect(received[0]).to.be.instanceOf(TextContent);
      expect((received[0] as TextContent).text).to.equal("one");
      expect(received[1]).to.be.instanceOf(TextContent);
      expect((received[1] as TextContent).text).to.equal("two");
      expect(received[2]).to.be.instanceOf(ControlContent);
      expect((received[2] as ControlContent).method).to.equal("close");
    } finally {
      room.dispose();
      pair.dispose();
    }
  });

  it("rejects listen iteration when the signal is already aborted", async () => {
    const pair = new ProtocolPair();
    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const controller = new AbortController();
    controller.abort(new Error("stop listening"));

    try {
      const iterator = room.listen({abortSignal: controller.signal})[Symbol.asyncIterator]();

      try {
        await iterator.next();
        throw new Error("expected listen iterator to reject");
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal("stop listening");
      }
    } finally {
      room.dispose();
      pair.dispose();
    }
  });

  it("rejects pending listen iteration when the signal aborts", async () => {
    const pair = new ProtocolPair();
    const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
    const controller = new AbortController();

    try {
      const iterator = room.listen({abortSignal: controller.signal})[Symbol.asyncIterator]();
      const next = iterator.next();
      controller.abort(new Error("stop listening"));

      try {
        await next;
        throw new Error("expected listen iterator to reject");
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal("stop listening");
      }

      room.emit(new RoomStatusEvent({ status: "ready", message: "ready" }));
      const plainIterator = room.listen()[Symbol.asyncIterator]();
      const plainNext = plainIterator.next();
      room.emit(new RoomStatusEvent({ status: "still-ready", message: "still ready" }));
      const result = await plainNext;

      expect(result.done).to.equal(false);
      expect(result.value.name).to.equal("still-ready");
      await plainIterator.return?.();
    } finally {
      room.dispose();
      pair.dispose();
    }
  });
});
