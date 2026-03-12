import { expect } from "chai";

import { RoomClient } from "../room-client";
import { Protocol, ProtocolMessageStream, StreamProtocolChannel } from "../protocol";
import {
  BinaryContent,
  Content,
  ControlContent,
  EmptyContent,
  JsonContent,
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

type RecordedRequest = {
  tool: string;
  input: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class FakeContainersServer {
  public readonly requests: RecordedRequest[] = [];
  public readonly execChunks: BinaryContent[] = [];
  public readonly logChunks: BinaryContent[] = [];
  public readonly streamTools = new Map<string, string>();

  private readonly encoder = new TextEncoder();
  private readonly logCloseWaiters = new Map<string, Array<() => void>>();
  private readonly execCloseWaiters = new Map<string, Array<() => void>>();
  private readonly closedLogs = new Set<string>();
  private readonly closedExec = new Set<string>();
  private readonly logFollowByToolCall = new Map<string, boolean>();

  public waitForLogsClose(toolCallId: string): Promise<void> {
    if (!this.streamTools.has(toolCallId)) {
      throw new Error(`no logs stream recorded for ${toolCallId}`);
    }
    if (this.closedLogs.has(toolCallId)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const existing = this.logCloseWaiters.get(toolCallId) ?? [];
      existing.push(resolve);
      this.logCloseWaiters.set(toolCallId, existing);
    });
  }

  public waitForExecClose(toolCallId: string): Promise<void> {
    if (!this.streamTools.has(toolCallId)) {
      throw new Error(`no exec stream recorded for ${toolCallId}`);
    }
    if (this.closedExec.has(toolCallId)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const existing = this.execCloseWaiters.get(toolCallId) ?? [];
      existing.push(resolve);
      this.execCloseWaiters.set(toolCallId, existing);
    });
  }

  public async handleMessage(protocol: Protocol, messageId: number, type: string, data?: Uint8Array): Promise<void> {
    if (!data) {
      return;
    }

    if (type === "room.invoke_tool") {
      const [header, payload] = unpackMessage(data);
      if (header["toolkit"] !== "containers") {
        return;
      }

      const tool = header["tool"];
      if (typeof tool !== "string") {
        throw new Error("containers tool must be a string");
      }

      if (tool === "exec" || tool === "logs") {
        const toolCallId = header["tool_call_id"];
        if (typeof toolCallId !== "string") {
          throw new Error("expected string tool_call_id");
        }
        this.streamTools.set(toolCallId, tool);
        await protocol.send("__response__", new ControlContent({ method: "open" }).pack(), messageId);
        return;
      }

      const input = this.decodeInput(header, payload);
      if (!(input instanceof JsonContent) || !isRecord(input.json)) {
        throw new Error(`containers.${tool} expected JsonContent input`);
      }
      this.requests.push({ tool, input: { ...input.json } });

      switch (tool) {
        case "list_images":
          await protocol.send("__response__", new JsonContent({
            json: {
              images: [{
                id: "img-1",
                tags: ["demo:latest"],
                size: 1,
                labels: {},
              }],
            },
          }).pack(), messageId);
          return;
        case "run":
        case "run_service":
          await protocol.send("__response__", new JsonContent({ json: { container_id: `${tool}-ctr` } }).pack(), messageId);
          return;
        case "pull_image":
        case "stop_container":
        case "delete_container":
          await protocol.send("__response__", new EmptyContent().pack(), messageId);
          return;
        case "list_containers":
          await protocol.send("__response__", new JsonContent({
            json: {
              containers: [{
                id: "container-1",
                image: "demo:latest",
                name: "demo",
                started_by: { id: "p1", name: "user" },
                state: "RUNNING",
                private: false,
                service_id: null,
              }],
            },
          }).pack(), messageId);
          return;
        case "wait_for_exit":
          await protocol.send("__response__", new JsonContent({ json: { exit_code: 0 } }).pack(), messageId);
          return;
        default:
          throw new Error(`unsupported containers operation: ${tool}`);
      }
    }

    if (type !== "room.tool_call_request_chunk") {
      return;
    }

    const [header, payload] = unpackMessage(data);
    const toolCallId = header["tool_call_id"];
    if (typeof toolCallId !== "string") {
      await protocol.send("__response__", new EmptyContent().pack(), messageId);
      return;
    }

    const chunkHeader = header["chunk"];
    if (!isRecord(chunkHeader)) {
      throw new Error("expected chunk header object");
    }

    const chunk = unpackContent(packMessage(chunkHeader, payload.length > 0 ? payload : undefined));
    if (chunk instanceof ControlContent) {
      this.closedExec.add(toolCallId);
      this.closedLogs.add(toolCallId);
      this.resolveWaiters(this.execCloseWaiters, toolCallId);
      this.resolveWaiters(this.logCloseWaiters, toolCallId);

      if (this.streamTools.get(toolCallId) === "logs" && this.logFollowByToolCall.get(toolCallId) === true) {
        await this.sendToolCallChunk(protocol, toolCallId, new ControlContent({ method: "close" }));
      }
      await protocol.send("__response__", new EmptyContent().pack(), messageId);
      return;
    }

    if (!(chunk instanceof BinaryContent)) {
      throw new Error("containers expected BinaryContent stream chunks");
    }

    const tool = this.streamTools.get(toolCallId);
    if (tool === "exec") {
      this.execChunks.push(chunk);
      if (this.execChunks.length === 2) {
        await this.sendToolCallChunk(protocol, toolCallId, new BinaryContent({
          data: this.encoder.encode("hello"),
          headers: {
            request_id: this.execChunks[0].headers["request_id"],
            container_id: this.execChunks[0].headers["container_id"],
            channel: 1,
          },
        }));
        await this.sendToolCallChunk(protocol, toolCallId, new BinaryContent({
          data: this.encoder.encode('{"status": 0}'),
          headers: {
            request_id: this.execChunks[0].headers["request_id"],
            container_id: this.execChunks[0].headers["container_id"],
            channel: 3,
          },
        }));
        await this.sendToolCallChunk(protocol, toolCallId, new ControlContent({ method: "close" }));
      }
    } else if (tool === "logs") {
      this.logChunks.push(chunk);
      this.requests.push({ tool: "logs", input: { ...chunk.headers } });
      const follow = chunk.headers["follow"] === true;
      this.logFollowByToolCall.set(toolCallId, follow);

      await this.sendToolCallChunk(protocol, toolCallId, new BinaryContent({
        data: this.encoder.encode("line 1"),
        headers: {
          request_id: chunk.headers["request_id"],
          container_id: chunk.headers["container_id"],
          channel: 1,
        },
      }));

      if (!follow) {
        await this.sendToolCallChunk(protocol, toolCallId, new BinaryContent({
          data: this.encoder.encode("line 2"),
          headers: {
            request_id: chunk.headers["request_id"],
            container_id: chunk.headers["container_id"],
            channel: 1,
          },
        }));
        await this.sendToolCallChunk(protocol, toolCallId, new ControlContent({ method: "close" }));
      }
    }

    await protocol.send("__response__", new EmptyContent().pack(), messageId);
  }

  private decodeInput(requestHeader: Record<string, unknown>, payload: Uint8Array): Content {
    const args = requestHeader["arguments"];
    if (!isRecord(args)) {
      throw new Error("expected request arguments object");
    }
    return unpackContent(packMessage(args, payload.length > 0 ? payload : undefined));
  }

  private async sendToolCallChunk(protocol: Protocol, toolCallId: string, chunk: Content): Promise<void> {
    const [header, payload] = unpackMessage(chunk.pack());
    await protocol.send("room.tool_call_response_chunk", packMessage({
      tool_call_id: toolCallId,
      chunk: header,
    }, payload.length > 0 ? payload : undefined));
  }

  private resolveWaiters(map: Map<string, Array<() => void>>, toolCallId: string): void {
    const waiters = map.get(toolCallId);
    if (!waiters) {
      return;
    }
    map.delete(toolCallId);
    for (const resolve of waiters) {
      resolve();
    }
  }
}

async function startContainersHarness(): Promise<{
  pair: ProtocolPair;
  room: RoomClient;
  server: FakeContainersServer;
}> {
  const pair = new ProtocolPair();
  const server = new FakeContainersServer();
  pair.serverProtocol.start({ onMessage: server.handleMessage.bind(server) });

  const room = new RoomClient({ protocol: pair.clientProtocol });
  const startFuture = room.start();
  await sendRoomReady(pair.serverProtocol);
  await startFuture;

  return { pair, room, server };
}

async function waitForToolCallId(server: FakeContainersServer, tool: string): Promise<string> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const id = Array.from(server.streamTools.entries()).find((entry) => entry[1] === tool)?.[0];
    if (typeof id === "string") {
      return id;
    }
    await Promise.resolve();
  }
  throw new Error(`timed out waiting for tool call id: ${tool}`);
}

describe("container_client_test", () => {
  it("containers client uses room.invoke and streams exec/logs", async () => {
    const harness = await startContainersHarness();
    const decoder = new TextDecoder();
    try {
      await harness.room.containers.pullImage({
        tag: "demo:latest",
        credentials: [{ username: "u", password: "p", registry: "https://example.com", email: "u@example.com" }],
      });
      expect(await harness.room.containers.run({ image: "demo:latest", env: { KEY: "VALUE" }, ports: { 8080: 80 } })).to.equal("run-ctr");
      expect(await harness.room.containers.runService({ serviceId: "svc-1", env: { A: "1" } })).to.equal("run_service-ctr");

      const images = await harness.room.containers.listImages();
      expect(images).to.have.length(1);
      expect(images[0].tags).to.deep.equal(["demo:latest"]);

      const containers = await harness.room.containers.list();
      expect(containers).to.have.length(1);
      expect(containers[0].id).to.equal("container-1");
      expect(await harness.room.containers.waitForExit({ containerId: "container-1" })).to.equal(0);

      const exec = harness.room.containers.exec({ containerId: "container-1", command: "echo hi" });
      await exec.write(new TextEncoder().encode("ping"));
      expect(await exec.result).to.equal(0);
      expect(decoder.decode(exec.previousOutput[0])).to.equal("hello");

      const execToolCallId = await waitForToolCallId(harness.server, "exec");
      await harness.server.waitForExecClose(execToolCallId);

      const logs = harness.room.containers.logs({ containerId: "container-1", follow: false });
      const lines: string[] = [];
      for await (const line of logs.stream) {
        lines.push(line);
      }
      expect(lines).to.deep.equal(["line 1", "line 2"]);
      await logs.result;

      const logsToolCallId = await waitForToolCallId(harness.server, "logs");
      await harness.server.waitForLogsClose(logsToolCallId);

      expect(harness.server.requests.map((entry) => entry.tool)).to.deep.equal([
        "pull_image",
        "run",
        "run_service",
        "list_images",
        "list_containers",
        "wait_for_exit",
        "logs",
      ]);

      const runInput = harness.server.requests[1].input;
      expect(runInput["env"]).to.deep.equal([{ key: "KEY", value: "VALUE" }]);
      expect(runInput["ports"]).to.deep.equal([{ container_port: 8080, host_port: 80 }]);
      const runServiceInput = harness.server.requests[2].input;
      expect(runServiceInput["env"]).to.deep.equal([{ key: "A", value: "1" }]);

      const logsInput = harness.server.requests[6].input;
      expect(logsInput["kind"]).to.equal("start");
      expect(logsInput["container_id"]).to.equal("container-1");
      expect(logsInput["follow"]).to.equal(false);

      expect(harness.server.execChunks).to.have.length(2);
      expect(harness.server.execChunks[0].headers["kind"]).to.equal("start");
      expect(harness.server.execChunks[0].headers["container_id"]).to.equal("container-1");
      expect(harness.server.execChunks[1].headers["channel"]).to.equal(1);
      expect(decoder.decode(harness.server.execChunks[1].data)).to.equal("ping");
    } finally {
      harness.room.dispose();
      harness.pair.dispose();
    }
  });

  it("containers logs closes request stream when output stream is canceled early", async () => {
    const harness = await startContainersHarness();
    try {
      const logs = harness.room.containers.logs({ containerId: "container-1", follow: true });
      const iterator = logs.stream[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).to.equal(false);
      expect(first.value).to.equal("line 1");
      await iterator.return?.();

      const logsToolCallId = await waitForToolCallId(harness.server, "logs");
      await harness.server.waitForLogsClose(logsToolCallId);
      await logs.result;
    } finally {
      harness.room.dispose();
      harness.pair.dispose();
    }
  });

  it("containers exec coalesces duplicate resize events", async () => {
    const harness = await startContainersHarness();
    try {
      const exec = harness.room.containers.exec({ containerId: "container-1", command: "bash", tty: true });
      await exec.resize({ width: 80, height: 24 });
      await exec.resize({ width: 80, height: 24 });

      expect(await exec.result).to.equal(0);
      expect(harness.server.execChunks).to.have.length(2);
      expect(harness.server.execChunks[1].headers["channel"]).to.equal(4);
      expect(harness.server.execChunks[1].headers["width"]).to.equal(80);
      expect(harness.server.execChunks[1].headers["height"]).to.equal(24);
    } finally {
      harness.room.dispose();
      harness.pair.dispose();
    }
  });

  it("containers exec stop closes stdin without sending hard-stop control", async () => {
    const harness = await startContainersHarness();
    try {
      const exec = harness.room.containers.exec({ containerId: "container-1", command: "bash", tty: true });
      void exec.result.catch(() => undefined);
      await exec.stop();

      const execToolCallId = await waitForToolCallId(harness.server, "exec");
      await harness.server.waitForExecClose(execToolCallId);

      expect(harness.server.execChunks).to.have.length(1);
      expect(harness.server.execChunks[0].headers["kind"]).to.equal("start");
    } finally {
      harness.room.dispose();
      harness.pair.dispose();
    }
  });
});
