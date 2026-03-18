import { expect } from "chai";

import { RoomClient } from "../room-client";
import { Protocol, ProtocolMessageStream, StreamProtocolChannel } from "../protocol";
import { EmptyContent, JsonContent, unpackContent } from "../response";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class FakeMemoryServicesServer {
  public readonly memoryRequests: Array<Record<string, unknown>> = [];
  public readonly serviceRequests: Array<Record<string, unknown>> = [];

  public async handleMessage(protocol: Protocol, messageId: number, type: string, data?: Uint8Array): Promise<void> {
    if (type !== "room.invoke_tool" || !data) {
      return;
    }

    const [header, payload] = unpackMessage(data);
    const toolkit = header["toolkit"];
    const tool = header["tool"];

    if (typeof toolkit !== "string" || typeof tool !== "string") {
      throw new Error("expected string toolkit and tool");
    }

    const input = unpackContent(packMessage(header["arguments"], payload.length > 0 ? payload : undefined));
    if (!(input instanceof JsonContent) || !isRecord(input.json)) {
      throw new Error(`expected JsonContent input for ${toolkit}.${tool}`);
    }

    if (toolkit === "memory") {
      this.memoryRequests.push({ tool, ...input.json });

      if (tool === "list") {
        await protocol.send("__response__", new JsonContent({
          json: { memories: ["alpha", "beta"] },
        }).pack(), messageId);
        return;
      }

      if (tool === "create" || tool === "drop") {
        await protocol.send("__response__", new EmptyContent().pack(), messageId);
        return;
      }
    }

    if (toolkit === "services") {
      this.serviceRequests.push({ tool, ...input.json });

      if (tool === "list") {
        await protocol.send("__response__", new JsonContent({
          json: {
            services_json: [
              JSON.stringify({
                id: "svc-1",
                kind: "Service",
                version: "v1",
                metadata: { name: "svc-1" },
              }),
            ],
            service_states: [
              {
                service_id: "svc-1",
                state: "running",
                container_id: "ctr-1",
                restart_count: 2,
              },
            ],
          },
        }).pack(), messageId);
        return;
      }

      if (tool === "restart") {
        await protocol.send("__response__", new EmptyContent().pack(), messageId);
        return;
      }
    }

    throw new Error(`unsupported toolkit operation: ${toolkit}.${tool}`);
  }
}

async function startHarness(): Promise<{
  pair: ProtocolPair;
  room: RoomClient;
  server: FakeMemoryServicesServer;
}> {
  const pair = new ProtocolPair();
  const server = new FakeMemoryServicesServer();
  pair.serverProtocol.start({ onMessage: server.handleMessage.bind(server) });

  const room = new RoomClient({ protocol: pair.clientProtocol });
  const startFuture = room.start();
  await sendRoomReady(pair.serverProtocol);
  await startFuture;

  return { pair, room, server };
}

describe("memory_services_client_test", () => {
  it("exposes memory and services room clients", async () => {
    const harness = await startHarness();

    try {
      expect(await harness.room.memory.list({ namespace: ["demo"] })).to.deep.equal(["alpha", "beta"]);
      await harness.room.memory.create({ name: "graph", namespace: ["demo"], overwrite: true, ignoreExists: true });
      await harness.room.memory.drop({ name: "graph", namespace: ["demo"], ignoreMissing: true });

      const services = await harness.room.services.listWithState();
      expect(services.services).to.have.length(1);
      expect(services.services[0]?.id).to.equal("svc-1");
      expect(services.serviceStates["svc-1"]?.containerId).to.equal("ctr-1");
      expect(services.serviceStates["svc-1"]?.restartCount).to.equal(2);

      await harness.room.services.restart({ serviceId: "svc-1" });

      expect(harness.server.memoryRequests).to.deep.equal([
        { tool: "list", namespace: ["demo"] },
        { tool: "create", name: "graph", namespace: ["demo"], overwrite: true, ignore_exists: true },
        { tool: "drop", name: "graph", namespace: ["demo"], ignore_missing: true },
      ]);
      expect(harness.server.serviceRequests).to.deep.equal([
        { tool: "list" },
        { tool: "restart", service_id: "svc-1" },
      ]);
    } finally {
      harness.room.dispose();
      harness.pair.dispose();
    }
  });
});
