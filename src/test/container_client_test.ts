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
  public readonly buildLogChunks: BinaryContent[] = [];
  public readonly buildChunks: BinaryContent[] = [];
  public readonly streamTools = new Map<string, string>();

  private readonly encoder = new TextEncoder();
  private readonly logCloseWaiters = new Map<string, Array<() => void>>();
  private readonly execCloseWaiters = new Map<string, Array<() => void>>();
  private readonly pendingBuildRequests = new Map<string, { protocol: Protocol; messageId: number }>();
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

      if (tool === "exec" || tool === "logs" || tool === "get_build_logs" || tool === "build") {
        const toolCallId = header["tool_call_id"];
        if (typeof toolCallId !== "string") {
          throw new Error("expected string tool_call_id");
        }
        this.streamTools.set(toolCallId, tool);
        if (tool === "build") {
          this.pendingBuildRequests.set(toolCallId, { protocol, messageId });
          return;
        }
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
                preferred_ref: "demo:latest",
                references: ["demo:latest"],
                labels: [{ key: "role", value: "demo" }],
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-02T00:00:00Z",
                target_media_type: "application/vnd.oci.image.manifest.v1+json",
              }],
            },
          }).pack(), messageId);
          return;
        case "inspect_image":
          await protocol.send("__response__", new JsonContent({
            json: {
              image: {
                id: "img-1",
                preferred_ref: "demo:latest",
                references: ["demo:latest"],
                labels: [{ key: "role", value: "demo" }],
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-02T00:00:00Z",
                target_media_type: "application/vnd.oci.image.manifest.v1+json",
              },
              target: {
                digest: "sha256:target",
                media_type: "application/vnd.oci.image.manifest.v1+json",
                size: 123,
                annotations: [],
              },
              selected_manifest: {
                digest: "sha256:target",
                media_type: "application/vnd.oci.image.manifest.v1+json",
                size: 123,
                annotations: [],
              },
              manifests: [],
              config: {
                digest: "sha256:config",
                media_type: "application/vnd.oci.image.config.v1+json",
                size: 45,
                annotations: [],
              },
              layers: [{
                digest: "sha256:layer-1",
                media_type: "application/vnd.oci.image.layer.v1.tar+gzip",
                size: 67,
                annotations: [],
              }],
              content_size: 235,
            },
          }).pack(), messageId);
          return;
        case "run":
        case "run_service":
        case "push_image":
        case "load_image":
        case "save_image":
          await protocol.send("__response__", new JsonContent({ json: { container_id: `${tool}-ctr` } }).pack(), messageId);
          return;
        case "load":
          await protocol.send("__response__", new JsonContent({
            json: {
              resolved_ref: "registry.meshagent.com/images/example.tar:latest",
              refs: ["registry.meshagent.com/images/example.tar:latest"],
            },
          }).pack(), messageId);
          return;
        case "pull_image":
        case "delete_image":
        case "cancel_build":
        case "delete_build":
        case "stop_container":
        case "delete_container":
          await protocol.send("__response__", new EmptyContent().pack(), messageId);
          return;
        case "list_builds":
          await protocol.send("__response__", new JsonContent({
            json: {
              builds: [{
                id: "build-1",
                tag: "demo:latest",
                status: "succeeded",
                exit_code: 0,
              }],
            },
          }).pack(), messageId);
          return;
        case "list_containers":
          await protocol.send("__response__", new JsonContent({
            json: {
              containers: [{
                id: "container-1",
                image: "demo:latest",
                name: "demo",
                ports: [8080],
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

      if (this.streamTools.get(toolCallId) === "build") {
        const pending = this.pendingBuildRequests.get(toolCallId);
        if (!pending) {
          throw new Error(`no build request recorded for ${toolCallId}`);
        }
        await pending.protocol.send(
          "__response__",
          new JsonContent({ json: { build_id: "build-job" } }).pack(),
          pending.messageId,
        );
        this.pendingBuildRequests.delete(toolCallId);
      }

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
          data: this.encoder.encode("stderr"),
          headers: {
            request_id: this.execChunks[0].headers["request_id"],
            container_id: this.execChunks[0].headers["container_id"],
            channel: 2,
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
    } else if (tool === "build") {
      this.buildChunks.push(chunk);
      if (chunk.headers["kind"] === "start") {
        this.requests.push({ tool: "build", input: { ...chunk.headers } });
      }
    } else if (tool === "get_build_logs") {
      this.buildLogChunks.push(chunk);
      this.requests.push({ tool: "get_build_logs", input: { ...chunk.headers } });
      await this.sendToolCallChunk(protocol, toolCallId, new BinaryContent({
        data: this.encoder.encode("build line"),
        headers: {
          request_id: chunk.headers["request_id"],
          build_id: chunk.headers["build_id"],
          channel: 1,
        },
      }));
      await this.sendToolCallChunk(protocol, toolCallId, new BinaryContent({
        data: this.encoder.encode('{"status": 0}'),
        headers: {
          request_id: chunk.headers["request_id"],
          build_id: chunk.headers["build_id"],
          channel: 3,
        },
      }));
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

  const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
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
      expect(images[0].preferredRef).to.equal("demo:latest");
      expect(images[0].references).to.deep.equal(["demo:latest"]);
      expect(images[0].labels).to.deep.equal({ role: "demo" });
      expect(images[0].createdAt?.toISOString()).to.equal("2026-01-01T00:00:00.000Z");
      expect(images[0].targetMediaType).to.equal("application/vnd.oci.image.manifest.v1+json");

      const inspection = await harness.room.containers.inspectImage({ imageId: "img-1" });
      expect(inspection.image.preferredRef).to.equal("demo:latest");
      expect(inspection.target.digest).to.equal("sha256:target");
      expect(inspection.layers[0].digest).to.equal("sha256:layer-1");
      expect(inspection.contentSize).to.equal(235);

      const containers = await harness.room.containers.list();
      expect(containers).to.have.length(1);
      expect(containers[0].id).to.equal("container-1");
      expect(containers[0].ports).to.deep.equal([8080]);
      expect(await harness.room.containers.waitForExit({ containerId: "container-1" })).to.equal(0);

      const exec = harness.room.containers.exec({ containerId: "container-1", command: "echo hi" });
      await exec.write(new TextEncoder().encode("ping"));
      expect(await exec.result).to.equal(0);
      expect(decoder.decode(exec.previousOutput[0])).to.equal("hello");
      expect(decoder.decode(exec.previousError[0])).to.equal("stderr");

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
        "inspect_image",
        "list_containers",
        "wait_for_exit",
        "logs",
      ]);

      const runInput = harness.server.requests[1].input;
      expect(runInput["env"]).to.deep.equal([{ key: "KEY", value: "VALUE" }]);
      expect(runInput["ports"]).to.deep.equal([{ container_port: 8080, host_port: 80 }]);
      const runServiceInput = harness.server.requests[2].input;
      expect(runServiceInput["env"]).to.deep.equal([{ key: "A", value: "1" }]);

      const logsInput = harness.server.requests[7].input;
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

  it("containers client supports build and image archive operations", async () => {
    const harness = await startContainersHarness();
    const mounts = [{ room: [{ path: "/workspace", read_only: false }], configs: [{ path: "/var/run/meshagent" }] }];
    try {
      await harness.room.containers.deleteImage({ image: "demo:latest" });
      expect(await harness.room.containers.pushImage({ tag: "demo:latest", private: true })).to.equal("push_image-ctr");

      const imported = await harness.room.containers.load({ archivePath: "/images/example.tar" });
      expect(imported).to.deep.equal({
        resolvedRef: "registry.meshagent.com/images/example.tar:latest",
        refs: ["registry.meshagent.com/images/example.tar:latest"],
      });

      expect(await harness.room.containers.loadImage({
        mounts,
        archivePath: "/workspace/example.tar",
        private: true,
      })).to.equal("load_image-ctr");

      expect(await harness.room.containers.saveImage({
        tag: "demo:latest",
        mounts,
        archivePath: "/workspace/example.tar",
        private: true,
      })).to.equal("save_image-ctr");

      async function* buildChunks(): AsyncIterable<Uint8Array> {
        yield new TextEncoder().encode("hello ");
        yield new TextEncoder().encode("world");
      }

      expect(await harness.room.containers.build({
        tag: "example:latest",
        mountPath: "/context",
        contextPath: "/workspace",
        chunks: buildChunks(),
        dockerfilePath: "/workspace/Dockerfile",
        optimizeImage: false,
        private: true,
        credentials: [{ username: "u", password: "p" }],
        builderName: "builder-1",
        size: 11,
      })).to.equal("build-job");

      expect(await harness.room.containers.listBuilds()).to.deep.equal([{
        id: "build-1",
        tag: "demo:latest",
        status: "succeeded",
        exitCode: 0,
      }]);

      await harness.room.containers.cancelBuild({ buildId: "build-1" });
      await harness.room.containers.deleteBuild({ buildId: "build-1" });

      const buildLogs = harness.room.containers.getBuildLogs({ buildId: "build-1", follow: true });
      const buildLines: string[] = [];
      for await (const line of buildLogs.stream) {
        buildLines.push(line);
      }
      expect(buildLines).to.deep.equal(["build line"]);
      expect(await buildLogs.result).to.equal(0);

      await harness.room.containers.stop({ containerId: "container-1" });

      expect(harness.server.requests.map((entry) => entry.tool)).to.deep.equal([
        "delete_image",
        "push_image",
        "load",
        "load_image",
        "save_image",
        "build",
        "list_builds",
        "cancel_build",
        "delete_build",
        "get_build_logs",
        "stop_container",
      ]);

      const loadImageInput = harness.server.requests[3].input;
      expect(loadImageInput["mounts"]).to.deep.equal(mounts);
      expect(loadImageInput["archive_path"]).to.equal("/workspace/example.tar");
      expect(loadImageInput["private"]).to.equal(true);

      const buildInput = harness.server.requests.find((entry) => entry.tool === "build")?.input as Record<string, unknown> | undefined;
      expect(buildInput).to.not.equal(undefined);
      if (!buildInput) {
        throw new Error("missing build request");
      }
      expect(buildInput["mount_path"]).to.equal("/context");
      expect(buildInput["context_path"]).to.equal("/workspace");
      expect(buildInput["dockerfile_path"]).to.equal("/workspace/Dockerfile");
      expect(buildInput["optimize_image"]).to.equal(false);
      expect(buildInput["private"]).to.equal(true);
      expect(buildInput["credentials"]).to.deep.equal([
        { registry: null, username: "u", password: "p" },
      ]);
      expect(buildInput["builder_name"]).to.equal("builder-1");
      expect(buildInput["size"]).to.equal(11);

      const buildLogsInput = harness.server.requests.find((entry) => entry.tool === "get_build_logs")?.input as Record<string, unknown> | undefined;
      expect(buildLogsInput).to.not.equal(undefined);
      if (!buildLogsInput) {
        throw new Error("missing get_build_logs request");
      }
      expect(buildLogsInput["kind"]).to.equal("start");
      expect(buildLogsInput["build_id"]).to.equal("build-1");
      expect(buildLogsInput["follow"]).to.equal(true);

      const stopInput = harness.server.requests.find((entry) => entry.tool === "stop_container")?.input as Record<string, unknown> | undefined;
      expect(stopInput).to.not.equal(undefined);
      if (!stopInput) {
        throw new Error("missing stop_container request");
      }
      expect(stopInput["force"]).to.equal(false);
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
