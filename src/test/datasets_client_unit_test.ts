import { expect } from "chai";

import {
  Field,
  Int32,
  Schema,
  Table,
  Utf8,
  tableFromArrays,
  tableToIPC,
} from "apache-arrow";
import {
  DatasetsClient,
  DatasetDate,
  DatasetExpression,
  DatasetJson,
  DatasetStruct,
  DatasetUuid,
} from "../datasets-client";
import { BinaryContent, Content, ControlContent, JsonContent } from "../response";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodedDatasetValue(value: unknown): unknown {
  if (value == null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof DatasetExpression) {
    return { expression: value.expression };
  }
  if (value instanceof DatasetDate) {
    return { date: value.toString() };
  }
  if (value instanceof DatasetUuid) {
    return { uuid: value.toString() };
  }
  if (value instanceof Uint8Array) {
    return { binary: Buffer.from(value).toString("base64") };
  }
  if (value instanceof Date) {
    return { timestamp: value.toISOString().replace("+00:00", "Z") };
  }
  if (value instanceof DatasetStruct) {
    return { struct: value.toJson() };
  }
  if (value instanceof DatasetJson) {
    return { json: value.toJson() };
  }
  if (Array.isArray(value)) {
    return { list: value.map((entry) => encodedDatasetValue(entry)) };
  }
  if (isRecord(value)) {
    return {
      struct: Object.fromEntries(
        Object.entries(value).map(([name, fieldValue]) => [name, encodedDatasetValue(fieldValue)]),
      ),
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
        value: encodedDatasetValue(value),
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

class FakeDatasetsRoom {
  public readonly invokeCalls: InvokeParams[] = [];
  public readonly writeStarts: Record<string, Array<Record<string, unknown>>> = {};
  public readonly writeChunks: Record<string, Array<Record<string, unknown>>> = {};
  public readonly readStarts: Record<string, Array<Record<string, unknown>>> = {};
  public readonly readPulls: Record<string, Array<Record<string, unknown>>> = {};
  public inspectSchema: Schema = tableFromArrays({ id: Int32Array.from([0]) }).schema;
  public searchTable: Table = tableFromArrays({ id: Int32Array.from([1]) });
  public sqlTable: Table = tableFromArrays({ id: Int32Array.from([1]), payload: ["sql-result"] });

  public async invoke(params: InvokeParams): Promise<Content> {
    this.invokeCalls.push(params);

    switch (params.tool) {
      case "inspect":
        return new BinaryContent({ data: tableToIPC(new Table(this.inspectSchema), "stream") });
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
    throw new Error(`unsupported streamed datasets operation: ${params.tool}`);
  }

  private async *handleWriteStream(tool: string, input: AsyncIterable<Content>): AsyncIterable<Content> {
    const iterator = input[Symbol.asyncIterator]();
    const start = await iterator.next();
    if (start.done || !(start.value instanceof JsonContent || start.value instanceof BinaryContent)) {
      throw new Error(`expected JsonContent or BinaryContent start for ${tool}`);
    }
    if (!this.writeStarts[tool]) {
      this.writeStarts[tool] = [];
    }
    this.writeStarts[tool].push(start.value instanceof BinaryContent ? start.value.headers : start.value.json);

    while (true) {
      yield start.value instanceof BinaryContent
        ? new BinaryContent({ data: new Uint8Array(), headers: { kind: "pull" } })
        : new JsonContent({ json: { kind: "pull" } });
      const chunk = await iterator.next();
      if (chunk.done) {
        yield new ControlContent({ method: "close" });
        return;
      }
      if (!(chunk.value instanceof JsonContent || chunk.value instanceof BinaryContent)) {
        throw new Error(`expected JsonContent or BinaryContent chunk for ${tool}`);
      }
      if (!this.writeChunks[tool]) {
        this.writeChunks[tool] = [];
      }
      this.writeChunks[tool].push(
        chunk.value instanceof BinaryContent
          ? { headers: chunk.value.headers, data: chunk.value.data }
          : chunk.value.json,
      );
    }
  }

  private async *handleReadStream(tool: string, input: AsyncIterable<Content>): AsyncIterable<Content> {
    const iterator = input[Symbol.asyncIterator]();
    const start = await iterator.next();
    if (start.done || !(start.value instanceof BinaryContent)) {
      throw new Error(`expected BinaryContent start for ${tool}`);
    }
    if (!this.readStarts[tool]) {
      this.readStarts[tool] = [];
    }
    this.readStarts[tool].push(start.value.headers);

    while (true) {
      const pull = await iterator.next();
      if (pull.done) {
        return;
      }
      if (!(pull.value instanceof BinaryContent)) {
        throw new Error(`expected BinaryContent pull for ${tool}`);
      }
      if (!this.readPulls[tool]) {
        this.readPulls[tool] = [];
      }
      this.readPulls[tool].push(pull.value.headers);

      if (this.readPulls[tool].length === 1) {
        yield new BinaryContent({
          data: tableToIPC(tool === "search" ? this.searchTable : this.sqlTable, "stream"),
          headers: { kind: "data" },
        });
        continue;
      }

      yield new ControlContent({ method: "close" });
      return;
    }
  }
}

describe("datasets_client_unit_test", () => {
  it("forwards create-table metadata and namespace, and supports expression addColumns", async () => {
    const room = new FakeDatasetsRoom();
    const client = new DatasetsClient({ room });
    const table = tableFromArrays({ id: Int32Array.from([1]) });

    await client.createTableWithSchema({
      name: "records",
      schema: table.schema,
      data: table,
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
      },
    });

    expect(room.writeStarts["create_table"]).to.deep.equal([
      {
        kind: "start",
        name: "records",
        mode: "create",
        namespace: ["team"],
        branch: "exp",
        metadata: [{ key: "kind", value: "demo" }],
      },
    ]);
    expect(room.writeChunks["create_table"]).to.have.length(1);
    expect(room.writeChunks["create_table"][0]["headers"]).to.deep.equal({
      kind: "data",
      content_type: "application/vnd.apache.arrow.stream",
    });

    const addColumnsCall = room.invokeCalls.find((call) => call.tool === "add_columns");
    expect(addColumnsCall).to.not.equal(undefined);
    expect(addColumnsCall!.input).to.deep.equal({
      table: "records",
      columns: [
        { name: "email", value_sql: "'hello'" },
      ],
      namespace: ["team"],
      branch: "exp",
    });
  });

  it("supports branch-aware inspect, search, counts, versions, and lifecycle operations", async () => {
    const room = new FakeDatasetsRoom();
    const client = new DatasetsClient({ room });

    const schema = await client.inspect({ table: "records", namespace: ["team"], branch: "exp", version: 7 });
    expect(schema.fields.map((field) => field.name)).to.deep.equal(["id"]);

    const rows = await client.search({
      table: "records",
      where: { id: 1, active: true, name: "Alice" },
      offset: 5,
      limit: 10,
      namespace: ["team"],
      branch: "exp",
      version: 7,
    });
    expect(rows).to.have.length(1);
    expect(rows[0].numRows).to.equal(1);
    expect(rows[0].getChild("id")?.get(0)).to.equal(1);
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
    const room = new FakeDatasetsRoom();
    const client = new DatasetsClient({ room });

    const rows = await client.sql({
      query: "SELECT * FROM records",
      tables: ["records"],
      params: { id: 1 },
    });

    expect(rows).to.have.length(1);
    expect(rows[0].getChild("id")?.get(0)).to.equal(1);
    expect(rows[0].getChild("payload")?.get(0)).to.equal("sql-result");
    expect(room.readStarts["sql"]).to.deep.equal([
      {
        kind: "start",
        query: "SELECT * FROM records",
        tables: [{ name: "records" }],
        params_json: '{"id":1}',
      },
    ]);
  });

  it("supports uuid schemas, values, and where filters", async () => {
    const room = new FakeDatasetsRoom();
    const client = new DatasetsClient({ room });
    const id = new DatasetUuid("123e4567-e89b-12d3-a456-426614174000");

    room.inspectSchema = new Schema([Field.new("id", new Utf8())]);
    room.searchTable = tableFromArrays({ id: [id.toString()] });

    await client.createTableWithSchema({
      name: "uuid_records",
      schema: room.inspectSchema,
      data: room.searchTable,
    });

    const schema = await client.inspect({ table: "uuid_records" });
    expect(schema.fields.map((field) => field.name)).to.deep.equal(["id"]);

    const rows = await client.search({
      table: "uuid_records",
      where: { id },
    });
    expect(rows).to.have.length(1);
    expect(rows[0].getChild("id")?.get(0)).to.equal(id.toString());

    await client.count({
      table: "uuid_records",
      where: { id },
    });

    expect(room.writeStarts["create_table"]).to.deep.equal([
      {
        kind: "start",
        name: "uuid_records",
        mode: "create",
        namespace: null,
        branch: null,
        metadata: null,
      },
    ]);
    expect(room.writeChunks["create_table"]).to.have.length(1);
    expect(room.readStarts["search"]).to.deep.equal([
      {
        kind: "start",
        table: "uuid_records",
        text: null,
        vector: null,
        text_columns: null,
        where: "id = X'123e4567e89b12d3a456426614174000'",
        offset: null,
        limit: null,
        select: null,
        namespace: null,
        branch: null,
        version: null,
      },
    ]);

    const countCall = room.invokeCalls.find((call) => call.tool === "count");
    expect(countCall?.input).to.deep.equal({
      table: "uuid_records",
      text: null,
      vector: null,
      text_columns: null,
      where: "id = X'123e4567e89b12d3a456426614174000'",
      namespace: null,
      branch: null,
      version: null,
    });
  });

  it("supports json schemas and values", async () => {
    const room = new FakeDatasetsRoom();
    const client = new DatasetsClient({ room });
    const payload = new DatasetJson({ kind: "demo", count: 3, tags: ["a", "b"] });

    room.inspectSchema = new Schema([Field.new("payload", new Utf8())]);
    room.searchTable = tableFromArrays({ payload: [JSON.stringify(payload.toJson())] });

    await client.createTableWithSchema({
      name: "json_records",
      schema: room.inspectSchema,
    });

    await client.insert({
      table: "json_records",
      records: room.searchTable,
    });

    const schema = await client.inspect({ table: "json_records" });
    expect(schema.fields.map((field) => field.name)).to.deep.equal(["payload"]);

    const rows = await client.search({
      table: "json_records",
    });
    expect(rows).to.have.length(1);
    expect(rows[0].getChild("payload")?.get(0)).to.equal(JSON.stringify(payload.toJson()));

    expect(room.writeStarts["create_table"]).to.deep.equal([
      {
        kind: "start",
        name: "json_records",
        mode: "create",
        namespace: null,
        branch: null,
        metadata: null,
      },
    ]);
    expect(room.writeChunks["insert"]).to.have.length(1);
  });

  it("encodes expression values for streamed writes and updates", async () => {
    const room = new FakeDatasetsRoom();
    const client = new DatasetsClient({ room });

    await client.insert({
      table: "records",
      namespace: ["team"],
      branch: "exp",
      records: tableFromArrays({ id: ["uuid()"], upper_name: ["upper(name)"] }),
    });

    await client.update({
      table: "records",
      where: "true",
      namespace: ["team"],
      branch: "exp",
      values: {
        id: new DatasetExpression("uuid()"),
        upper_name: new DatasetExpression("upper(name)"),
      },
    });

    expect(room.writeStarts["insert"]).to.deep.equal([
      {
        kind: "start",
        table: "records",
        namespace: ["team"],
        branch: "exp",
      },
    ]);
    expect(room.writeChunks["insert"]).to.have.length(1);

    const updateCall = room.invokeCalls.find((call) => call.tool === "update");
    expect(updateCall?.input).to.deep.equal({
      table: "records",
      where: "true",
      values: [
        { column: "id", value_json: '{"expression":"uuid()"}' },
        { column: "upper_name", value_json: '{"expression":"upper(name)"}' },
      ],
      namespace: ["team"],
      branch: "exp",
    });
  });

  it("decodes typed date and timestamp row values", async () => {
    const room = new FakeDatasetsRoom();
    const client = new DatasetsClient({ room });
    room.searchTable = tableFromArrays({ event_date: ["2026-04-09"], created_at: [new Date("2026-04-09T12:30:45Z")] });
    room.sqlTable = tableFromArrays({ event_date: ["2026-04-09"], created_at: [new Date("2026-04-09T12:30:45Z")] });

    const searchRows = await client.search({ table: "records" });
    const sqlRows = await client.sql({ query: "SELECT * FROM records", tables: ["records"] });

    expect(searchRows[0].getChild("event_date")?.get(0)).to.equal("2026-04-09");
    expect(sqlRows[0].getChild("event_date")?.get(0)).to.equal("2026-04-09");
  });
});
