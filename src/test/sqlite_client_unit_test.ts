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
import { DatasetJson } from "../datasets-client.js";
import { SqliteClient } from "../sqlite-client.js";
import { BinaryContent, Content, ControlContent, EmptyContent, JsonContent } from "../response.js";

type InvokeParams = {
  toolkit: string;
  tool: string;
  input?: Record<string, any> | Content;
};

type InvokeStreamParams = {
  toolkit: string;
  tool: string;
  input: AsyncIterable<Content>;
};

class FakeSqliteRoom {
  public readonly invokeCalls: InvokeParams[] = [];
  public readonly writeStarts: Record<string, Array<Record<string, unknown>>> = {};
  public readonly writeChunks: Record<string, Array<Record<string, unknown>>> = {};
  public readonly readStarts: Record<string, Array<Record<string, unknown>>> = {};
  public readonly readPulls: Record<string, Array<Record<string, unknown>>> = {};
  public inspectSchema: Schema = new Schema([Field.new("id", new Int32())]);
  public searchTable: Table = tableFromArrays({ id: Int32Array.from([1]) });
  public sqlTable: Table = tableFromArrays({ id: Int32Array.from([1]), payload: ["sql-result"] });

  public async invokeContent(params: InvokeParams): Promise<Content> {
    this.invokeCalls.push(params);

    switch (params.tool) {
      case "list_databases":
        return new JsonContent({ json: { databases: ["app"] } });
      case "create_database":
      case "drop_database":
      case "drop_table":
      case "rename_table":
      case "add_columns":
      case "drop_columns":
      case "close_sql_query":
        return new EmptyContent();
      case "inspect_database":
        return new JsonContent({ json: { name: "app", namespace: ["team"], tables: 2, size_bytes: 4096 } });
      case "list_tables":
        return new JsonContent({ json: { tables: ["records"] } });
      case "inspect":
        return new BinaryContent({ data: tableToIPC(new Table(this.inspectSchema), "stream") });
      case "update":
      case "delete":
      case "execute_sql_statement":
        return new JsonContent({ json: { rows_affected: 3 } });
      case "count":
        return new JsonContent({ json: { count: 3 } });
      case "open_sql_query":
      case "execute_sql":
        if (!(params.input instanceof BinaryContent)) {
          throw new Error(`expected BinaryContent input for ${params.tool}`);
        }
        return new BinaryContent({
          data: tableToIPC(new Table(this.sqlTable.schema), "stream"),
          headers: { kind: "query", query_id: "sql-query-1" },
        });
      case "cancel_sql_query":
        return new JsonContent({ json: { status: "not_cancellable" } });
      default:
        return new JsonContent({ json: {} });
    }
  }

  public async invokeStream(params: InvokeStreamParams): Promise<AsyncIterable<Content>> {
    if (params.tool === "create_table" || params.tool === "insert") {
      return this.handleWriteStream(params.tool, params.input);
    }
    if (params.tool === "search" || params.tool === "read_sql_query") {
      return this.handleReadStream(params.tool, params.input);
    }
    throw new Error(`unsupported streamed sqlite operation: ${params.tool}`);
  }

  private async *handleWriteStream(tool: string, input: AsyncIterable<Content>): AsyncIterable<Content> {
    const iterator = input[Symbol.asyncIterator]();
    const start = await iterator.next();
    if (start.done || !(start.value instanceof BinaryContent)) {
      throw new Error(`expected BinaryContent start for ${tool}`);
    }
    if (!this.writeStarts[tool]) {
      this.writeStarts[tool] = [];
    }
    this.writeStarts[tool].push(start.value.headers);

    while (true) {
      yield new BinaryContent({ data: new Uint8Array(), headers: { kind: "pull" } });
      const chunk = await iterator.next();
      if (chunk.done) {
        yield new ControlContent({ method: "close" });
        return;
      }
      if (!(chunk.value instanceof BinaryContent)) {
        throw new Error(`expected BinaryContent chunk for ${tool}`);
      }
      if (!this.writeChunks[tool]) {
        this.writeChunks[tool] = [];
      }
      this.writeChunks[tool].push({ headers: chunk.value.headers, data: chunk.value.data });
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

describe("sqlite_client_unit_test", () => {
  it("forwards database lifecycle and exposes the room client property", async () => {
    const room = new FakeSqliteRoom();
    const client = new SqliteClient({ room });
    const db = client.database("app", { namespace: ["team"] });

    expect(await client.listDatabases({ namespace: ["team"] })).to.deep.equal(["app"]);
    await client.createDatabase({ name: "app", namespace: ["team"], mode: "create_if_not_exists" });
    const details = await client.inspectDatabase({ name: "app", namespace: ["team"] });
    await client.dropDatabase({ name: "app", namespace: ["team"], ignoreMissing: true });
    await db.createDatabase({ mode: "create_if_not_exists" });
    const boundDetails = await db.inspectDatabase();
    await db.dropDatabase({ ignoreMissing: true });

    expect(details).to.deep.equal({ name: "app", namespace: ["team"], tables: 2, sizeBytes: 4096 });
    expect(boundDetails).to.deep.equal({ name: "app", namespace: ["team"], tables: 2, sizeBytes: 4096 });
    expect(room.invokeCalls.map((call) => [call.tool, call.input])).to.deep.include.members([
      ["list_databases", { namespace: ["team"] }],
      ["create_database", { name: "app", namespace: ["team"], mode: "create_if_not_exists" }],
      ["inspect_database", { name: "app", namespace: ["team"] }],
      ["drop_database", { name: "app", namespace: ["team"], ignore_missing: true }],
    ]);
  });

  it("uses binary Arrow streams for table creation, inserts, search, inspect, and SQL", async () => {
    const room = new FakeSqliteRoom();
    const client = new SqliteClient({ room });
    const table = tableFromArrays({ id: Int32Array.from([1]), payload: ["hello"] });
    const db = client.database("app", { namespace: ["team"] });

    await db.createTableWithSchema({ name: "records", schema: table.schema, data: table });
    await db.insert({ table: "records", records: table });
    expect(await db.listTables()).to.deep.equal(["records"]);

    room.inspectSchema = new Schema([Field.new("payload", new Utf8())]);
    const schema = await db.inspect({ table: "records" });
    expect(schema.fields.map((field) => field.name)).to.deep.equal(["payload"]);

    const searchRows = await db.searchTable({ table: "records", where: { payload: new DatasetJson({ kind: "demo" }) }, select: ["payload"] });
    expect(searchRows.getChild("id")?.get(0)).to.equal(1);

    const sqlRows = await db.sqlTable({ query: "SELECT * FROM records WHERE id = ?", params: [1] });
    expect(sqlRows.getChild("payload")?.get(0)).to.equal("sql-result");

    expect(room.writeStarts["create_table"]).to.deep.equal([
      { kind: "start", database: "app", name: "records", mode: "create", namespace: ["team"] },
    ]);
    expect(room.writeChunks["create_table"]).to.have.length(1);
    expect(room.writeStarts["insert"]).to.deep.equal([
      { kind: "start", database: "app", table: "records", namespace: ["team"] },
    ]);
    expect(room.readStarts["search"]).to.deep.equal([
      {
        kind: "start",
        database: "app",
        table: "records",
        where: { payload: { json: { kind: "demo" } } },
        params: null,
        offset: null,
        limit: null,
        select: ["payload"],
        namespace: ["team"],
      },
    ]);

    const inspectCall = room.invokeCalls.find((call) => call.tool === "inspect");
    expect(inspectCall?.input).to.deep.equal({ database: "app", table: "records", namespace: ["team"] });

    const executeSqlCall = room.invokeCalls.find((call) => call.tool === "execute_sql");
    expect(executeSqlCall?.input).to.be.instanceOf(BinaryContent);
    expect((executeSqlCall?.input as BinaryContent).headers).to.deep.equal({
      database: "app",
      query: "SELECT * FROM records WHERE id = ?",
      params: [1],
      namespace: ["team"],
    });
    const closeCall = room.invokeCalls.find((call) => call.tool === "close_sql_query");
    expect(closeCall?.input).to.deep.equal({ query_id: "sql-query-1" });
  });

  it("forwards mutation and SQL handle operations", async () => {
    const room = new FakeSqliteRoom();
    const client = new SqliteClient({ room });
    const db = client.database("app", { namespace: ["team"] });

    await db.addColumns({ table: "records", newColumns: new Schema([Field.new("email", new Utf8())]) });
    await db.dropColumns({ table: "records", columns: ["email"] });
    await db.renameTable({ name: "old_records", newName: "records" });
    const updated = await db.update({ table: "records", where: "id = ?", params: [1], values: { email: "alice@example.com" } });
    const deleted = await db.delete({ table: "records", where: "id = ?", params: [1] });
    const count = await db.count({ table: "records", where: { email: "alice@example.com" } });
    const opened = await db.executeSql({ query: "SELECT * FROM records" });
    const rowsAffected = await db.executeSqlStatement({ query: "DELETE FROM records WHERE id = ?", params: [1] });
    const cancelResult = await client.cancelSqlQuery({ queryId: "sql-query-1" });
    await client.closeSqlQuery({ queryId: "sql-query-1" });

    expect(updated).to.equal(3);
    expect(deleted).to.equal(3);
    expect(count).to.equal(3);
    expect(opened.kind).to.equal("query");
    expect(rowsAffected).to.equal(3);
    expect(cancelResult.status).to.equal("not_cancellable");

    const addColumnsCall = room.invokeCalls.find((call) => call.tool === "add_columns");
    expect(addColumnsCall?.input).to.be.instanceOf(BinaryContent);
    expect((addColumnsCall?.input as BinaryContent).headers).to.deep.equal({
      database: "app",
      table: "records",
      namespace: ["team"],
      content_type: "application/vnd.apache.arrow.stream",
    });
    expect(room.invokeCalls.find((call) => call.tool === "drop_columns")?.input).to.deep.equal({
      database: "app",
      table: "records",
      columns: ["email"],
      namespace: ["team"],
    });
    expect(room.invokeCalls.find((call) => call.tool === "rename_table")?.input).to.deep.equal({
      database: "app",
      name: "old_records",
      new_name: "records",
      namespace: ["team"],
    });
    expect(room.invokeCalls.find((call) => call.tool === "update")?.input).to.deep.equal({
      database: "app",
      table: "records",
      where: "id = ?",
      values: [{ column: "email", value_json: '"alice@example.com"' }],
      params: [1],
      namespace: ["team"],
    });
    expect(room.invokeCalls.find((call) => call.tool === "delete")?.input).to.deep.equal({
      database: "app",
      table: "records",
      where: "id = ?",
      params: [1],
      namespace: ["team"],
    });
    expect(room.invokeCalls.find((call) => call.tool === "count")?.input).to.deep.equal({
      database: "app",
      table: "records",
      where: { email: "alice@example.com" },
      params: null,
      namespace: ["team"],
    });
  });
});
