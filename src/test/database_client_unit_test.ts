import { expect } from "chai";

import { DatabaseClient } from "../database-client";
import { IntDataType } from "../data-types";
import { Content, ControlContent, JsonContent } from "../response";

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

type InvokeParams = {
  toolkit: string;
  tool: string;
  arguments?: Record<string, any>;
  input?: Record<string, any> | Content;
  participantId?: string;
  onBehalfOfId?: string;
  callerContext?: Record<string, any>;
};

type InvokeStreamParams = {
  toolkit: string;
  tool: string;
  input: AsyncIterable<Content>;
  participantId?: string;
  onBehalfOfId?: string;
  callerContext?: Record<string, any>;
};

class FakeDatabaseRoom {
  public readonly invokeCalls: InvokeParams[] = [];
  public readonly writeStarts: Record<string, Array<Record<string, unknown>>> = {};
  public readonly writeChunks: Record<string, Array<Record<string, unknown>>> = {};
  public readonly readStarts: Record<string, Array<Record<string, unknown>>> = {};
  public readonly readPulls: Record<string, Array<Record<string, unknown>>> = {};

  public async invoke(params: InvokeParams): Promise<Content> {
    this.invokeCalls.push(params);

    switch (params.tool) {
      case "inspect":
        return new JsonContent({
          json: {
            fields: [
              {
                name: "id",
                data_type: { type: "int", nullable: null, metadata: null },
              },
            ],
          },
        });
      case "count":
        return new JsonContent({ json: { count: 3 } });
      case "list_versions":
        return new JsonContent({
          json: {
            versions: [
              {
                version: 1,
                timestamp: "2025-01-01T00:00:00Z",
                metadata_json: JSON.stringify({ kind: "demo" }),
              },
            ],
          },
        });
      case "list_indexes":
        return new JsonContent({
          json: {
            indexes: [
              {
                name: "idx_records_id",
                columns: ["id"],
                type: "btree",
              },
            ],
          },
        });
      case "list_branches":
        return new JsonContent({
          json: {
            branches: [
              {
                name: "main",
                parent_branch: null,
                parent_version: null,
                created_at: "2025-01-01T00:00:00Z",
                manifest_size: 1,
              },
            ],
          },
        });
      default:
        return new JsonContent({ json: {} });
    }
  }

  public async invokeStream(params: InvokeStreamParams): Promise<AsyncIterable<Content>> {
    if (params.tool === "create_table" || params.tool === "insert" || params.tool === "merge") {
      return this.handleWriteStream(params.tool, params.input);
    }
    if (params.tool === "search" || params.tool === "sql") {
      return this.handleReadStream(params.tool, params.input);
    }
    throw new Error(`unsupported streamed database operation: ${params.tool}`);
  }

  private async *handleWriteStream(tool: string, input: AsyncIterable<Content>): AsyncIterable<Content> {
    const iterator = input[Symbol.asyncIterator]();
    const start = await iterator.next();
    if (start.done || !(start.value instanceof JsonContent)) {
      throw new Error(`expected JsonContent start for ${tool}`);
    }
    if (!this.writeStarts[tool]) {
      this.writeStarts[tool] = [];
    }
    this.writeStarts[tool].push(start.value.json);

    while (true) {
      yield new JsonContent({ json: { kind: "pull" } });
      const chunk = await iterator.next();
      if (chunk.done) {
        yield new ControlContent({ method: "close" });
        return;
      }
      if (!(chunk.value instanceof JsonContent)) {
        throw new Error(`expected JsonContent chunk for ${tool}`);
      }
      if (!this.writeChunks[tool]) {
        this.writeChunks[tool] = [];
      }
      this.writeChunks[tool].push(chunk.value.json);
    }
  }

  private async *handleReadStream(tool: string, input: AsyncIterable<Content>): AsyncIterable<Content> {
    const iterator = input[Symbol.asyncIterator]();
    const start = await iterator.next();
    if (start.done || !(start.value instanceof JsonContent)) {
      throw new Error(`expected JsonContent start for ${tool}`);
    }
    if (!this.readStarts[tool]) {
      this.readStarts[tool] = [];
    }
    this.readStarts[tool].push(start.value.json);

    while (true) {
      const pull = await iterator.next();
      if (pull.done) {
        return;
      }
      if (!(pull.value instanceof JsonContent)) {
        throw new Error(`expected JsonContent pull for ${tool}`);
      }
      if (!this.readPulls[tool]) {
        this.readPulls[tool] = [];
      }
      this.readPulls[tool].push(pull.value.json);

      if (this.readPulls[tool].length === 1) {
        if (tool === "search") {
          yield new JsonContent({ json: rowsChunk([{ id: 1 }]) });
        } else {
          yield new JsonContent({ json: rowsChunk([{ id: 1, payload: "sql-result" }]) });
        }
        continue;
      }

      yield new ControlContent({ method: "close" });
      return;
    }
  }
}

describe("database_client_unit_test", () => {
  it("forwards create-table metadata and namespace, and supports typed addColumns", async () => {
    const room = new FakeDatabaseRoom();
    const client = new DatabaseClient({ room });

    await client.createTableWithSchema({
      name: "records",
      schema: { id: new IntDataType() },
      data: [{ id: 1 }],
      namespace: ["team"],
      branch: "exp",
      metadata: { kind: "demo" },
    });

    await client.addColumns({
      table: "records",
      namespace: ["team"],
      branch: "exp",
      newColumns: {
        email: "'hello'",
        visits: new IntDataType(),
      },
    });

    expect(room.writeStarts["create_table"]).to.deep.equal([
      {
        kind: "start",
        name: "records",
        fields: [
          {
            name: "id",
            data_type: { type: "int", nullable: null, metadata: null },
          },
        ],
        mode: "create",
        namespace: ["team"],
        branch: "exp",
        metadata: [{ key: "kind", value: "demo" }],
      },
    ]);
    expect(room.writeChunks["create_table"]).to.deep.equal([
      rowsChunk([{ id: 1 }]),
    ]);

    const addColumnsCall = room.invokeCalls.find((call) => call.tool === "add_columns");
    expect(addColumnsCall).to.not.equal(undefined);
    expect(addColumnsCall!.input).to.deep.equal({
      table: "records",
      columns: [
        { name: "email", value_sql: "'hello'", data_type: null },
        { name: "visits", value_sql: null, data_type: { type: "int", nullable: null, metadata: null } },
      ],
      namespace: ["team"],
      branch: "exp",
    });
  });

  it("supports branch-aware inspect, search, counts, versions, and lifecycle operations", async () => {
    const room = new FakeDatabaseRoom();
    const client = new DatabaseClient({ room });

    const schema = await client.inspect({ table: "records", namespace: ["team"], branch: "exp", version: 7 });
    expect(schema["id"]).to.be.instanceOf(IntDataType);

    const rows = await client.search({
      table: "records",
      where: { id: 1, active: true, name: "Alice" },
      offset: 5,
      limit: 10,
      namespace: ["team"],
      branch: "exp",
      version: 7,
    });
    expect(rows).to.deep.equal([{ id: 1 }]);
    expect(room.readStarts["search"]).to.deep.equal([
      {
        kind: "start",
        table: "records",
        text: null,
        vector: null,
        text_columns: null,
        where: 'id = 1 AND active = true AND name = "Alice"',
        offset: 5,
        limit: 10,
        select: null,
        namespace: ["team"],
        branch: "exp",
        version: 7,
      },
    ]);

    const count = await client.count({
      table: "records",
      where: { id: 1 },
      namespace: ["team"],
      branch: "exp",
      version: 7,
    });
    expect(count).to.equal(3);

    const versions = await client.listVersions({ table: "records", namespace: ["team"], branch: "exp" });
    expect(versions).to.have.length(1);
    expect(versions[0].metadata).to.deep.equal({ kind: "demo" });

    const branches = await client.listBranches({ namespace: ["team"] });
    expect(branches).to.have.length(1);
    expect(branches[0]).to.deep.equal({
      name: "main",
      parentBranch: null,
      parentVersion: null,
      createdAt: new Date("2025-01-01T00:00:00Z"),
      manifestSize: 1,
    });

    await client.createBranch({ branch: "exp", fromBranch: "main", namespace: ["team"] });
    await client.dropIndex({ table: "records", name: "idx_records_id", namespace: ["team"], branch: "exp" });
    await client.restore({ table: "records", version: 2, namespace: ["team"], branch: "exp" });
    await client.optimize({ table: "records", namespace: ["team"], branch: "exp" });
    await client.deleteBranch({ branch: "exp", namespace: ["team"] });

    const indexes = await client.listIndexes({
      table: "records",
      namespace: ["team"],
      branch: "exp",
      version: 7,
    });
    expect(indexes).to.deep.equal([
      { name: "idx_records_id", columns: ["id"], type: "btree" },
    ]);

    const inspectCall = room.invokeCalls.find((call) => call.tool === "inspect");
    expect(inspectCall?.input).to.deep.equal({
      table: "records",
      namespace: ["team"],
      branch: "exp",
      version: 7,
    });

    const countCall = room.invokeCalls.find((call) => call.tool === "count");
    expect(countCall?.input).to.deep.equal({
      table: "records",
      text: null,
      vector: null,
      text_columns: null,
      where: "id = 1",
      namespace: ["team"],
      branch: "exp",
      version: 7,
    });

    const listVersionsCall = room.invokeCalls.find((call) => call.tool === "list_versions");
    expect(listVersionsCall?.input).to.deep.equal({
      table: "records",
      namespace: ["team"],
      branch: "exp",
    });

    const listIndexesCall = room.invokeCalls.find((call) => call.tool === "list_indexes");
    expect(listIndexesCall?.input).to.deep.equal({
      table: "records",
      namespace: ["team"],
      branch: "exp",
      version: 7,
    });

    const createBranchCall = room.invokeCalls.find((call) => call.tool === "create_branch");
    expect(createBranchCall?.input).to.deep.equal({
      branch: "exp",
      from_branch: "main",
      namespace: ["team"],
    });

    const deleteBranchCall = room.invokeCalls.find((call) => call.tool === "delete_branch");
    expect(deleteBranchCall?.input).to.deep.equal({
      branch: "exp",
      namespace: ["team"],
    });
  });

  it("accepts string SQL table references", async () => {
    const room = new FakeDatabaseRoom();
    const client = new DatabaseClient({ room });

    const rows = await client.sql({
      query: "SELECT * FROM records",
      tables: ["records"],
      params: { id: 1 },
    });

    expect(rows).to.deep.equal([{ id: 1, payload: "sql-result" }]);
    expect(room.readStarts["sql"]).to.deep.equal([
      {
        kind: "start",
        query: "SELECT * FROM records",
        tables: [{ name: "records" }],
        params_json: '{"id":1}',
      },
    ]);
  });
});
