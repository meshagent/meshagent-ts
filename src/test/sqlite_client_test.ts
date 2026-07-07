import { expect } from "chai";
import { Field, Int64, Schema, Table, Utf8, vectorFromArray } from "apache-arrow";

import { RoomClient, websocketProtocol } from "../index.js";
import { getConfig, getEnvVar, room } from "./utils.js";

function rows(table: Table): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  const fields = table.schema.fields.map((field) => field.name);
  for (let index = 0; index < table.numRows; index += 1) {
    const row: Record<string, unknown> = {};
    for (const field of fields) {
      row[field] = table.getChild(field)?.get(index);
    }
    output.push(row);
  }
  return output;
}

function rowTable(data: { id: number[]; email?: string[]; active?: number[]; label?: string[] }): Table {
  const columns = {
    id: vectorFromArray(data.id.map((value) => BigInt(value)), new Int64()),
    ...(data.email ? { email: vectorFromArray(data.email, new Utf8()) } : {}),
    ...(data.active ? { active: vectorFromArray(data.active.map((value) => BigInt(value)), new Int64()) } : {}),
    ...(data.label ? { label: vectorFromArray(data.label, new Utf8()) } : {}),
  };
  return new Table(columns);
}

function schema(fields: Record<string, "int64" | "utf8">): Schema {
  return new Schema(Object.entries(fields).map(([name, type]) => Field.new(name, type === "int64" ? new Int64() : new Utf8())));
}

function sqliteDatabaseName(suffix: string): string {
  return `ts_sqlite_${room.replace(/-/g, "_")}_${suffix}`;
}

function sqliteRoomName(participant: string): string {
  return `${room}-sqlite-${participant}`;
}

const sqliteIntegrationDescribe = getEnvVar("MESHAGENT_PROJECT_ID") && getEnvVar("MESHAGENT_KEY_ID") && getEnvVar("MESHAGENT_SECRET")
  && getEnvVar("RUN_MESHAGENT_SQLITE_LITESTREAM_TESTS") === "1"
  ? describe
  : describe.skip;

sqliteIntegrationDescribe("sqlite_client_test", function (this: Mocha.Suite) {
  this.timeout(30000);

  let client1: RoomClient;
  let client2: RoomClient;

  before(async () => {
    const config = getConfig();
    const protocolFactory1 = await websocketProtocol({ roomName: sqliteRoomName("round-trip"), participantName: "sqlite-client1", ...config });
    const protocolFactory2 = await websocketProtocol({ roomName: sqliteRoomName("round-trip"), participantName: "sqlite-client2", ...config });

    client1 = new RoomClient({ protocolFactory: protocolFactory1 });
    client2 = new RoomClient({ protocolFactory: protocolFactory2 });
    await client1.start();
    await client2.start();
  });

  after(async () => {
    client1?.dispose();
    client2?.dispose();
  });

  it("round trips sqlite operations through the room server", async () => {
    const appName = sqliteDatabaseName("app");
    const db = client1.sqlite.database(appName, { namespace: ["team"] });
    const secondDb = client2.sqlite.database(appName, { namespace: ["team"] });

    await client1.sqlite.createDatabase({ name: appName, namespace: ["team"] });
    expect(await client1.sqlite.listDatabases({ namespace: ["team"] })).to.include(appName);
    expect(await client2.sqlite.listDatabases({ namespace: ["team"] })).to.include(appName);

    const details = await db.inspectDatabase();
    expect(details.name).to.equal(appName);
    expect(details.namespace).to.deep.equal(["team"]);

    const users = rowTable({
      id: [1, 2],
      email: ["alice@example.com", "bob@example.com"],
      active: [1, 0],
    });
    await db.createTableWithSchema({ name: "users", schema: users.schema });
    expect(await secondDb.listTables()).to.include("users");
    expect((await db.inspect({ table: "users" })).fields.map((field) => field.name)).to.deep.equal(["id", "email", "active"]);

    await db.addColumnsWithSchema({ table: "users", schema: schema({ nickname: "utf8" }) });
    expect((await db.inspect({ table: "users" })).fields.map((field) => field.name)).to.include("nickname");
    await db.dropColumns({ table: "users", columns: ["nickname"] });
    expect((await db.inspect({ table: "users" })).fields.map((field) => field.name)).not.to.include("nickname");

    await db.insertTable({ table: "users", records: users });
    expect(await db.count({ table: "users" })).to.equal(2);
    expect(rows(await db.searchTable({ table: "users", where: { active: 1 }, select: ["email"] }))).to.deep.equal([
      { email: "alice@example.com" },
    ]);
    expect(rows(await secondDb.searchTable({ table: "users", where: { active: 0 }, select: ["email"] }))).to.deep.equal([
      { email: "bob@example.com" },
    ]);

    expect(rows(await db.sqlTable({ query: "SELECT id, email FROM users WHERE id = ?", params: [2] }))).to.deep.equal([
      { id: 2n, email: "bob@example.com" },
    ]);
    expect(await db.executeSqlStatement({ query: "UPDATE users SET active = ? WHERE id = ?", params: [1, 2] })).to.equal(1);
    expect(await db.count({ table: "users", where: { active: 1 } })).to.equal(2);

    await db.renameTable({ name: "users", newName: "members" });
    expect(await secondDb.listTables()).to.include("members");
    await db.renameTable({ name: "members", newName: "users" });

    const searchTables = await db.search({ table: "users", where: "active = ?", params: [1], select: ["id"] });
    expect(searchTables.flatMap((table) => rows(table))).to.deep.equal([{ id: 1n }, { id: 2n }]);

    const sqlTables = await db.sql({ query: "SELECT email FROM users ORDER BY id" });
    expect(sqlTables.flatMap((table) => rows(table))).to.deep.equal([
      { email: "alice@example.com" },
      { email: "bob@example.com" },
    ]);

    const query = await client1.sqlite.openSqlQuery({
      database: db.database,
      namespace: db.namespace,
      query: "SELECT id FROM users ORDER BY id",
    });
    const queryRows: Array<Record<string, unknown>> = [];
    for await (const table of client1.sqlite.readSqlQuery({ queryId: query.queryId })) {
      queryRows.push(...rows(table));
    }
    expect(queryRows).to.deep.equal([{ id: 1n }, { id: 2n }]);
    await client1.sqlite.closeSqlQuery({ queryId: query.queryId });
    expect((await client1.sqlite.cancelSqlQuery({ queryId: query.queryId })).status).to.equal("not_cancellable");

    const bulkRows = 128;
    await db.createTableFromArrowTable({
      name: "bulk_events",
      table: rowTable({
        id: Array.from({ length: bulkRows }, (_, index) => index),
        label: Array.from({ length: bulkRows }, (_, index) => `event-${index}`),
      }),
    });
    const streamedBulk = await db.search({ table: "bulk_events", select: ["id"] });
    expect(streamedBulk.reduce((sum, table) => sum + table.numRows, 0)).to.equal(bulkRows);

    await db.dropTable({ name: "bulk_events" });
    await db.dropTable({ name: "users" });
    await db.dropDatabase();
    expect(await client1.sqlite.listDatabases({ namespace: ["team"] })).not.to.include(appName);
  });

  it("isolates sqlite databases and namespaces through the room server", async () => {
    const appName = sqliteDatabaseName("isolated_app");
    const analyticsName = sqliteDatabaseName("isolated_analytics");
    const records = [
      { database: client1.sqlite.database(appName, { namespace: ["team"] }), label: "team-app" },
      { database: client1.sqlite.database(analyticsName, { namespace: ["team"] }), label: "team-analytics" },
      { database: client1.sqlite.database(appName, { namespace: ["other"] }), label: "other-app" },
    ];
    for (const record of records) {
      await record.database.createDatabase();
      await record.database.createTableFromArrowBatches({
        name: "events",
        batches: [rowTable({ id: [1], label: [record.label] })],
      });
    }

    expect(await client1.sqlite.listDatabases({ namespace: ["team"] })).to.include.members([analyticsName, appName]);
    expect(await client1.sqlite.listDatabases({ namespace: ["other"] })).to.include(appName);

    for (const record of records) {
      expect(rows(await record.database.searchTable({ table: "events", select: ["label"] }))).to.deep.equal([{ label: record.label }]);
      await record.database.dropTable({ name: "events" });
      await record.database.dropDatabase();
    }
  });
});
