import { expect } from "chai";

import { RoomClient } from "../room-client.js";
import { Protocol, ProtocolMessageStream, StreamProtocolChannel } from "../protocol.js";
import { EmptyContent, JsonContent, unpackContent } from "../response.js";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typedValue(value: unknown): Record<string, unknown> {
  if (value == null) {
    return { type: "null" };
  }
  if (typeof value === "boolean") {
    return { type: "bool", value };
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? { type: "int", value } : { type: "float", value };
  }
  if (typeof value === "string") {
    return { type: "text", value };
  }
  if (value instanceof Uint8Array) {
    return { type: "binary", data: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) {
    return { type: "list", items: value.map((entry) => typedValue(entry)) };
  }
  if (isRecord(value)) {
    return {
      type: "struct",
      fields: Object.entries(value).map(([name, fieldValue]) => ({
        name,
        value: typedValue(fieldValue),
      })),
    };
  }
  throw new Error(`unsupported typed value: ${typeof value}`);
}

function rowsChunk(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    kind: "rows",
    rows: rows.map((row) => ({
      columns: Object.entries(row).map(([name, value]) => ({
        name,
        value: typedValue(value),
      })),
    })),
  };
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

      if (tool === "inspect") {
        await protocol.send("__response__", new JsonContent({
          json: {
            name: "graph",
            namespace: ["demo"],
            path: "/memory/demo/graph",
            datasets: [
              { name: "Entity", rows: 2, columns: ["entity_id", "name"] },
              { name: "Relationship", rows: 1, columns: ["source_entity_id", "target_entity_id"] },
            ],
          },
        }).pack(), messageId);
        return;
      }

      if (tool === "query") {
        await protocol.send("__response__", new JsonContent({
          json: rowsChunk([
            {
              entity_id: "acme",
              name: "ACME",
              confidence: 0.9,
              count: 2,
              tags: ["customer", "renewal"],
              info: { owner: "sales" },
            },
          ]),
        }).pack(), messageId);
        return;
      }

      if (tool === "upsert_table" || tool === "upsert_nodes" || tool === "upsert_relationships") {
        await protocol.send("__response__", new JsonContent({
          json: { rows_written: 1 },
        }).pack(), messageId);
        return;
      }

      if (tool === "ingest_text" || tool === "ingest_image" || tool === "ingest_file" || tool === "ingest_from_table" || tool === "ingest_from_storage") {
        await protocol.send("__response__", new JsonContent({
          json: {
            name: "graph",
            stats: { entities: 2, relationships: 1, sources: 1 },
            entity_ids: ["acme", "renewal"],
          },
        }).pack(), messageId);
        return;
      }

      if (tool === "recall") {
        await protocol.send("__response__", new JsonContent({
          json: {
            name: "graph",
            query: "renewal",
            items: [
              {
                entity_id: "acme",
                name: "ACME",
                entity_type: "company",
                context: "Enterprise customer",
                confidence: 0.95,
                created_at: "2025-01-01T00:00:00Z",
                valid_at: null,
                score: 0.88,
                relationships: [
                  {
                    source_entity_id: "acme",
                    target_entity_id: "renewal-q3",
                    relationship_type: "HAS_MILESTONE",
                    description: "Renewal target quarter",
                  },
                ],
              },
            ],
          },
        }).pack(), messageId);
        return;
      }

      if (tool === "delete_entities") {
        await protocol.send("__response__", new JsonContent({
          json: {
            name: "graph",
            deleted_entities: 1,
            deleted_relationships: 2,
          },
        }).pack(), messageId);
        return;
      }

      if (tool === "delete_relationships") {
        await protocol.send("__response__", new JsonContent({
          json: {
            name: "graph",
            deleted_relationships: 1,
          },
        }).pack(), messageId);
        return;
      }

      if (tool === "optimize") {
        await protocol.send("__response__", new JsonContent({
          json: {
            name: "graph",
            datasets: [
              {
                dataset: "Entity",
                fragments_added: 1,
                fragments_removed: 1,
                files_added: 1,
                files_removed: 1,
                old_versions_removed: 1,
                bytes_removed: 512,
              },
            ],
          },
        }).pack(), messageId);
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
                last_start_error: "container.environment.token.identity is required",
                last_start_error_at: 124,
                events: [
                  {
                    type: "Warning",
                    reason: "FailedStart",
                    message: "Unable to start service svc-1: container.environment.token.identity is required",
                    count: 2,
                    first_timestamp: 123,
                    last_timestamp: 124,
                  },
                ],
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

  const room = new RoomClient({ protocolFactory: () => pair.clientProtocolFactory() });
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
      expect(await harness.room.memory.inspect({ name: "graph", namespace: ["demo"] })).to.deep.equal({
        name: "graph",
        namespace: ["demo"],
        path: "/memory/demo/graph",
        datasets: [
          { name: "Entity", rows: 2, columns: ["entity_id", "name"] },
          { name: "Relationship", rows: 1, columns: ["source_entity_id", "target_entity_id"] },
        ],
      });
      expect(await harness.room.memory.query({
        name: "graph",
        namespace: ["demo"],
        statement: "MATCH (e) RETURN e.name as name",
      })).to.deep.equal([
        {
          entity_id: "acme",
          name: "ACME",
          confidence: 0.9,
          count: 2,
          tags: ["customer", "renewal"],
          info: { owner: "sales" },
        },
      ]);
      await harness.room.memory.upsertTable({
        name: "graph",
        namespace: ["demo"],
        table: "facts",
        records: [
          { entity_id: "acme", note: "Renewal in Q3", seen_at: new Date("2025-01-01T00:00:00Z") },
        ],
      });
      await harness.room.memory.upsertNodes({
        name: "graph",
        namespace: ["demo"],
        records: [{ entityId: "acme", name: "ACME", entityType: "company", confidence: 0.8 }],
      });
      await harness.room.memory.upsertRelationships({
        name: "graph",
        namespace: ["demo"],
        records: [{ sourceEntityId: "acme", targetEntityId: "renewal-q3", relationshipType: "HAS_MILESTONE" }],
      });
      expect(await harness.room.memory.ingestText({
        name: "graph",
        namespace: ["demo"],
        text: "ACME has a Q3 renewal.",
        strategy: "llm",
        llmModel: "gpt-4o-mini",
        llmTemperature: 0.2,
      })).to.deep.equal({
        name: "graph",
        stats: { entities: 2, relationships: 1, sources: 1 },
        entityIds: ["acme", "renewal"],
      });
      expect(await harness.room.memory.recall({
        name: "graph",
        namespace: ["demo"],
        query: "renewal",
        limit: 10,
        includeRelationships: true,
      })).to.deep.equal({
        name: "graph",
        query: "renewal",
        items: [
          {
            entityId: "acme",
            name: "ACME",
            entityType: "company",
            context: "Enterprise customer",
            confidence: 0.95,
            createdAt: "2025-01-01T00:00:00Z",
            validAt: null,
            score: 0.88,
            relationships: [
              {
                sourceEntityId: "acme",
                targetEntityId: "renewal-q3",
                relationshipType: "HAS_MILESTONE",
                description: "Renewal target quarter",
                createdAt: null,
                validAt: null,
                expiredAt: null,
                invalidAt: null,
              },
            ],
          },
        ],
      });
      expect(await harness.room.memory.deleteEntities({
        name: "graph",
        namespace: ["demo"],
        entityIds: ["acme"],
      })).to.deep.equal({
        name: "graph",
        deletedEntities: 1,
        deletedRelationships: 2,
      });
      expect(await harness.room.memory.deleteRelationships({
        name: "graph",
        namespace: ["demo"],
        relationships: [{ sourceEntityId: "acme", targetEntityId: "renewal-q3", relationshipType: "HAS_MILESTONE" }],
      })).to.deep.equal({
        name: "graph",
        deletedRelationships: 1,
      });
      expect(await harness.room.memory.optimize({
        name: "graph",
        namespace: ["demo"],
      })).to.deep.equal({
        name: "graph",
        datasets: [
          {
            dataset: "Entity",
            fragmentsAdded: 1,
            fragmentsRemoved: 1,
            filesAdded: 1,
            filesRemoved: 1,
            oldVersionsRemoved: 1,
            bytesRemoved: 512,
          },
        ],
      });

      const services = await harness.room.services.list();
      expect(services.services).to.have.length(1);
      expect(services.services[0]?.id).to.equal("svc-1");
      expect(services.serviceStates["svc-1"]?.containerId).to.equal("ctr-1");
      expect(services.serviceStates["svc-1"]?.restartCount).to.equal(2);
      expect(services.serviceStates["svc-1"]?.lastStartError).to.equal("container.environment.token.identity is required");
      expect(services.serviceStates["svc-1"]?.lastStartErrorAt).to.equal(124);
      expect(services.serviceStates["svc-1"]?.events[0]?.reason).to.equal("FailedStart");
      expect(services.serviceStates["svc-1"]?.events[0]?.message).to.contain("token.identity");

      await harness.room.services.restart({ serviceId: "svc-1" });

      expect(harness.server.memoryRequests.map((request) => request.tool)).to.deep.equal([
        "list",
        "create",
        "drop",
        "inspect",
        "query",
        "upsert_table",
        "upsert_nodes",
        "upsert_relationships",
        "ingest_text",
        "recall",
        "delete_entities",
        "delete_relationships",
        "optimize",
      ]);
      expect(harness.server.memoryRequests[0]).to.deep.equal({ tool: "list", namespace: ["demo"] });
      expect(harness.server.memoryRequests[1]).to.deep.equal({
        tool: "create",
        name: "graph",
        namespace: ["demo"],
        overwrite: true,
        ignore_exists: true,
      });
      expect(harness.server.memoryRequests[2]).to.deep.equal({
        tool: "drop",
        name: "graph",
        namespace: ["demo"],
        ignore_missing: true,
      });
      expect(harness.server.memoryRequests[3]).to.deep.equal({
        tool: "inspect",
        name: "graph",
        namespace: ["demo"],
      });
      expect(harness.server.memoryRequests[4]).to.deep.equal({
        tool: "query",
        name: "graph",
        namespace: ["demo"],
        statement: "MATCH (e) RETURN e.name as name",
      });

      const upsertTableRequest = harness.server.memoryRequests[5];
      expect(upsertTableRequest.tool).to.equal("upsert_table");
      expect(upsertTableRequest.name).to.equal("graph");
      expect(upsertTableRequest.table).to.equal("facts");
      expect(JSON.parse(String(upsertTableRequest.records_json))).to.deep.equal([
        {
          entity_id: "acme",
          note: "Renewal in Q3",
          seen_at: "2025-01-01T00:00:00.000Z",
        },
      ]);

      const upsertNodesRequest = harness.server.memoryRequests[6];
      expect(JSON.parse(String(upsertNodesRequest.records_json))).to.deep.equal([
        {
          entity_id: "acme",
          name: "ACME",
          entity_type: "company",
          context: null,
          confidence: 0.8,
          created_at: null,
          valid_at: null,
          metadata: null,
        },
      ]);

      const upsertRelationshipsRequest = harness.server.memoryRequests[7];
      expect(JSON.parse(String(upsertRelationshipsRequest.records_json))).to.deep.equal([
        {
          source_entity_id: "acme",
          target_entity_id: "renewal-q3",
          relationship_type: "HAS_MILESTONE",
          description: null,
          confidence: null,
          created_at: null,
          valid_at: null,
          expired_at: null,
          invalid_at: null,
          source_entity_name: null,
          target_entity_name: null,
          metadata: null,
        },
      ]);
      expect(harness.server.memoryRequests[8]).to.deep.equal({
        tool: "ingest_text",
        name: "graph",
        namespace: ["demo"],
        text: "ACME has a Q3 renewal.",
        strategy: "llm",
        llm_model: "gpt-4o-mini",
        llm_temperature: 0.2,
      });
      expect(harness.server.memoryRequests[9]).to.deep.equal({
        tool: "recall",
        name: "graph",
        namespace: ["demo"],
        query: "renewal",
        limit: 10,
        include_relationships: true,
      });
      expect(harness.server.memoryRequests[10]).to.deep.equal({
        tool: "delete_entities",
        name: "graph",
        namespace: ["demo"],
        entity_ids: ["acme"],
      });
      expect(harness.server.memoryRequests[11]).to.deep.equal({
        tool: "delete_relationships",
        name: "graph",
        namespace: ["demo"],
        relationships: [
          {
            source_entity_id: "acme",
            target_entity_id: "renewal-q3",
            relationship_type: "HAS_MILESTONE",
          },
        ],
      });
      expect(harness.server.memoryRequests[12]).to.deep.equal({
        tool: "optimize",
        name: "graph",
        namespace: ["demo"],
        compact: true,
        cleanup: true,
      });
      expect(harness.server.serviceRequests).to.deep.equal([
        { tool: "list" },
        { tool: "restart", service_id: "svc-1" },
      ]);
    } finally {
      harness.room.dispose();
      harness.pair.dispose();
    }
  });

  it("encodes image and storage-based ingest requests", async () => {
    const harness = await startHarness();

    try {
      await harness.room.memory.ingestImage({
        name: "graph",
        namespace: ["demo"],
        caption: "whiteboard",
        data: Uint8Array.from([1, 2, 3]),
        mimeType: "image/png",
        source: "whiteboard.png",
        annotations: { scene: "planning" },
      });
      await harness.room.memory.ingestFile({
        name: "graph",
        namespace: ["demo"],
        text: "inline text",
        mimeType: "text/plain",
      });
      await harness.room.memory.ingestFromTable({
        name: "graph",
        namespace: ["demo"],
        table: "facts",
        textColumns: ["summary"],
        tableNamespace: ["tables"],
        limit: 5,
      });
      await harness.room.memory.ingestFromStorage({
        name: "graph",
        namespace: ["demo"],
        paths: ["notes.txt"],
      });

      const imageRequest = harness.server.memoryRequests[0];
      expect(imageRequest).to.deep.equal({
        tool: "ingest_image",
        name: "graph",
        namespace: ["demo"],
        caption: "whiteboard",
        data_base64: Buffer.from(Uint8Array.from([1, 2, 3])).toString("base64"),
        mime_type: "image/png",
        source: "whiteboard.png",
        annotations_json: JSON.stringify({ scene: "planning" }),
        strategy: "heuristic",
        llm_model: null,
        llm_temperature: null,
      });
      expect(harness.server.memoryRequests[1]).to.deep.equal({
        tool: "ingest_file",
        name: "graph",
        namespace: ["demo"],
        path: null,
        text: "inline text",
        mime_type: "text/plain",
        strategy: "heuristic",
        llm_model: null,
        llm_temperature: null,
      });
      expect(harness.server.memoryRequests[2]).to.deep.equal({
        tool: "ingest_from_table",
        name: "graph",
        namespace: ["demo"],
        table: "facts",
        text_columns: ["summary"],
        table_namespace: ["tables"],
        limit: 5,
        strategy: "heuristic",
        llm_model: null,
        llm_temperature: null,
      });
      expect(harness.server.memoryRequests[3]).to.deep.equal({
        tool: "ingest_from_storage",
        name: "graph",
        namespace: ["demo"],
        paths: ["notes.txt"],
        strategy: "heuristic",
        llm_model: null,
        llm_temperature: null,
      });
    } finally {
      harness.room.dispose();
      harness.pair.dispose();
    }
  });
});
