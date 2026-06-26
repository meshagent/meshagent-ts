import { Schema, Table, tableFromIPC, tableToIPC } from "apache-arrow";
import { RoomClient } from "./room-client.js";
import { RoomServerException } from "./room-server-client.js";
import { BinaryContent, ControlContent, EmptyContent, ErrorContent, JsonContent, type Content } from "./response.js";
import { DatasetRecord, DatasetValue, DatasetValueEncoder } from "./datasets-client.js";

export type SqliteCreateMode = "create" | "overwrite" | "create_if_not_exists";
export type SqliteWhere = string | Record<string, DatasetValue>;
export type SqliteSqlCancelStatus = "cancelled" | "cancelling" | "not_cancellable";
const ARROW_IPC_STREAM_MIME_TYPE = "application/vnd.apache.arrow.stream";

export interface SqliteDatabaseDetails {
  name: string;
  namespace: string[] | null;
  tables: number;
  sizeBytes: number;
}

export interface SqliteSqlQuery {
  kind: "query";
  schema: Schema;
  queryId: string;
}

export interface SqliteSqlStatement {
  kind: "statement";
  rowsAffected: number;
}

export type SqliteSqlExecution = SqliteSqlQuery | SqliteSqlStatement;

export interface SqliteSqlCancelResult {
  status: SqliteSqlCancelStatus;
}

type SqliteRoomInvoker = Pick<RoomClient, "invokeContent" | "invokeStream">;
type ArrowTableChunks = Iterable<Table> | AsyncIterable<Table>;
const globalScope = globalThis as typeof globalThis & {
  Buffer?: {
    from(data: Uint8Array | string, encoding?: string): { toString(encoding: string): string };
  };
  btoa?: (data: string) => string;
};

async function* toAsyncArrowIterable(chunks: ArrowTableChunks): AsyncIterable<Table> {
  if (Symbol.asyncIterator in chunks) {
    for await (const chunk of chunks as AsyncIterable<Table>) {
      yield chunk;
    }
    return;
  }
  for (const chunk of chunks as Iterable<Table>) {
    yield chunk;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  if (globalScope.Buffer) {
    return globalScope.Buffer.from(bytes).toString("base64");
  }

  if (!globalScope.btoa) {
    throw new Error("base64 encoding is not available in this runtime");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalScope.btoa(binary);
}

function encodeRecordValue(value: unknown): unknown {
  if (value instanceof DatasetValueEncoder) {
    return value.encodeDatasetValue();
  }
  if (value instanceof Uint8Array) {
    return {
      binary: bytesToBase64(value),
    };
  }
  if (value instanceof Date) {
    return {
      timestamp: value.toISOString().replace("+00:00", "Z"),
    };
  }
  if (Array.isArray(value)) {
    return {
      list: value.map((item) => encodeRecordValue(item)),
    };
  }
  if (isRecord(value)) {
    throw new RoomServerException("sqlite object values must use DatasetStruct or DatasetJson");
  }
  return value;
}

function buildWhereClause(where?: SqliteWhere): string | Record<string, DatasetValue> | null {
  if (where != null && typeof where === "object" && !Array.isArray(where)) {
    return Object.fromEntries(
      Object.entries(where).map(([key, value]) => [key, encodeRecordValue(value)]),
    ) as Record<string, DatasetValue>;
  }
  if (typeof where === "string") {
    return where;
  }
  return null;
}

function schemaToIPC(schema: Schema): Uint8Array {
  return tableToIPC(new Table(schema, []), "stream");
}

function tableFromIPCBytes(data: Uint8Array): Table {
  const table = tableFromIPC(data);
  if (table instanceof Promise) {
    throw new RoomServerException("unexpected async Arrow IPC result");
  }
  return table;
}

function tableFromChunks(chunks: Table[]): Table {
  if (chunks.length === 0) {
    return new Table(new Schema([]), []);
  }
  const [first, ...rest] = chunks;
  return first.concat(...rest);
}

function schemaFromIPCBytes(data: Uint8Array): Schema {
  return tableFromIPCBytes(data).schema;
}

class SqliteArrowWriteInputStream {
  private readonly source: AsyncIterator<Table>;
  private readonly pulls: Array<() => void> = [];
  private closed = false;

  public constructor(
    private readonly start: Record<string, unknown>,
    chunks: ArrowTableChunks,
    private readonly schema?: Schema,
  ) {
    this.source = toAsyncArrowIterable(chunks)[Symbol.asyncIterator]();
  }

  public requestNext(): void {
    if (this.closed) {
      return;
    }
    const waiter = this.pulls.shift();
    if (waiter) {
      waiter();
      return;
    }
    this.pulls.push(() => undefined);
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.pulls.length > 0) {
      const waiter = this.pulls.shift();
      waiter?.();
    }
    void this.source.return?.();
  }

  private async waitForPull(): Promise<void> {
    if (this.closed) {
      return;
    }
    const waiter = this.pulls.shift();
    if (waiter) {
      waiter();
      return;
    }
    await new Promise<void>((resolve) => {
      this.pulls.push(resolve);
    });
  }

  public async *stream(): AsyncIterable<Content> {
    yield new BinaryContent({
      data: this.schema == null ? new Uint8Array() : schemaToIPC(this.schema),
      headers: this.start,
    });
    while (!this.closed) {
      await this.waitForPull();
      if (this.closed) {
        return;
      }
      const nextChunk = await this.source.next();
      if (nextChunk.done) {
        return;
      }
      if (nextChunk.value.numRows === 0) {
        continue;
      }
      yield new BinaryContent({
        data: tableToIPC(nextChunk.value, "stream"),
        headers: { kind: "data", content_type: ARROW_IPC_STREAM_MIME_TYPE },
      });
    }
  }
}

class SqliteArrowReadInputStream {
  private readonly pulls: Array<() => void> = [];
  private closed = false;

  public constructor(private readonly start: Record<string, unknown>) {}

  public requestNext(): void {
    if (this.closed) {
      return;
    }
    const waiter = this.pulls.shift();
    if (waiter) {
      waiter();
      return;
    }
    this.pulls.push(() => undefined);
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.pulls.length > 0) {
      const waiter = this.pulls.shift();
      waiter?.();
    }
  }

  private async waitForPull(): Promise<void> {
    if (this.closed) {
      return;
    }
    const waiter = this.pulls.shift();
    if (waiter) {
      waiter();
      return;
    }
    await new Promise<void>((resolve) => {
      this.pulls.push(resolve);
    });
  }

  public async *stream(): AsyncIterable<Content> {
    yield new BinaryContent({ data: new Uint8Array(), headers: this.start });
    while (!this.closed) {
      await this.waitForPull();
      if (this.closed) {
        return;
      }
      yield new BinaryContent({ data: new Uint8Array(), headers: { kind: "pull" } });
    }
  }
}

export class SqliteDatabaseClient {
  public constructor(
    private readonly client: SqliteClient,
    public readonly database: string,
    public readonly namespace?: string[],
  ) {}

  public async createDatabase({ mode = "create" }: { mode?: SqliteCreateMode } = {}): Promise<void> {
    return this.client.createDatabase({ name: this.database, namespace: this.namespace, mode });
  }

  public async dropDatabase({ ignoreMissing = false }: { ignoreMissing?: boolean } = {}): Promise<void> {
    return this.client.dropDatabase({ name: this.database, namespace: this.namespace, ignoreMissing });
  }

  public async inspectDatabase(): Promise<SqliteDatabaseDetails> {
    return this.client.inspectDatabase({ name: this.database, namespace: this.namespace });
  }

  public async listTables(): Promise<string[]> {
    return this.client.listTables({ database: this.database, namespace: this.namespace });
  }

  public async createTableWithSchema(params: {
    name: string;
    schema?: Schema;
    data?: Iterable<Table> | Table;
    mode?: SqliteCreateMode;
  }): Promise<void> {
    return this.client.createTableWithSchema({ ...params, database: this.database, namespace: this.namespace });
  }

  public async createTableFromData(params: {
    name: string;
    data?: Iterable<Table> | Table;
    mode?: SqliteCreateMode;
  }): Promise<void> {
    return this.client.createTableFromData({ ...params, database: this.database, namespace: this.namespace });
  }

  public async dropTable(params: { name: string; ignoreMissing?: boolean }): Promise<void> {
    return this.client.dropTable({ ...params, database: this.database, namespace: this.namespace });
  }

  public async renameTable(params: { name: string; newName: string }): Promise<void> {
    return this.client.renameTable({ ...params, database: this.database, namespace: this.namespace });
  }

  public async inspect(params: { table: string }): Promise<Schema> {
    return this.client.inspect({ ...params, database: this.database, namespace: this.namespace });
  }

  public async addColumns(params: { table: string; newColumns: Schema }): Promise<void> {
    return this.client.addColumns({ ...params, database: this.database, namespace: this.namespace });
  }

  public async dropColumns(params: { table: string; columns: string[] }): Promise<void> {
    return this.client.dropColumns({ ...params, database: this.database, namespace: this.namespace });
  }

  public async insert(params: { table: string; records: Table }): Promise<void> {
    return this.client.insert({ ...params, database: this.database, namespace: this.namespace });
  }

  public async update(params: { table: string; where: string; values: DatasetRecord; params?: unknown }): Promise<number> {
    return this.client.update({ ...params, database: this.database, namespace: this.namespace });
  }

  public async delete(params: { table: string; where: string; params?: unknown }): Promise<number> {
    return this.client.delete({ ...params, database: this.database, namespace: this.namespace });
  }

  public async search(params: {
    table: string;
    where?: SqliteWhere;
    params?: unknown;
    offset?: number;
    limit?: number;
    select?: string[];
  }): Promise<Table[]> {
    return this.client.search({ ...params, database: this.database, namespace: this.namespace });
  }

  public async searchTable(params: {
    table: string;
    where?: SqliteWhere;
    params?: unknown;
    offset?: number;
    limit?: number;
    select?: string[];
  }): Promise<Table> {
    return this.client.searchTable({ ...params, database: this.database, namespace: this.namespace });
  }

  public async searchStream(params: {
    table: string;
    where?: SqliteWhere;
    params?: unknown;
    offset?: number;
    limit?: number;
    select?: string[];
  }): Promise<AsyncIterable<Table>> {
    return this.client.searchStream({ ...params, database: this.database, namespace: this.namespace });
  }

  public async count(params: { table: string; where?: SqliteWhere; params?: unknown }): Promise<number> {
    return this.client.count({ ...params, database: this.database, namespace: this.namespace });
  }

  public async sql(params: { query: string; params?: unknown }): Promise<Table[]> {
    return this.client.sql({ ...params, database: this.database, namespace: this.namespace });
  }

  public async sqlTable(params: { query: string; params?: unknown }): Promise<Table> {
    return this.client.sqlTable({ ...params, database: this.database, namespace: this.namespace });
  }

  public async *sqlStream(params: { query: string; params?: unknown }): AsyncIterable<Table> {
    yield* this.client.sqlStream({ ...params, database: this.database, namespace: this.namespace });
  }

  public async executeSql(params: { query: string; params?: unknown }): Promise<SqliteSqlExecution> {
    return this.client.executeSql({ ...params, database: this.database, namespace: this.namespace });
  }

  public async executeSqlStatement(params: { query: string; params?: unknown }): Promise<number> {
    return this.client.executeSqlStatement({ ...params, database: this.database, namespace: this.namespace });
  }
}

export class SqliteClient {
  private readonly room: SqliteRoomInvoker;

  public constructor({ room }: { room: SqliteRoomInvoker }) {
    this.room = room;
  }

  private unexpectedResponseError(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from sqlite.${operation}`);
  }

  public database(name: string, { namespace }: { namespace?: string[] } = {}): SqliteDatabaseClient {
    return new SqliteDatabaseClient(this, name, namespace);
  }

  private async invoke(operation: string, input: Record<string, unknown>): Promise<Content> {
    return await this.room.invokeContent({ toolkit: "sqlite", tool: operation, input });
  }

  private async invokeContent(operation: string, input: Content): Promise<Content> {
    return await this.room.invokeContent({ toolkit: "sqlite", tool: operation, input });
  }

  private async invokeStream(operation: string, input: AsyncIterable<Content>): Promise<AsyncIterable<Content>> {
    return await this.room.invokeStream({ toolkit: "sqlite", tool: operation, input });
  }

  private async drainWriteStream(operation: string, input: SqliteArrowWriteInputStream): Promise<void> {
    const response = await this.invokeStream(operation, input.stream());
    try {
      for await (const chunk of response) {
        if (chunk instanceof ErrorContent) {
          throw new RoomServerException(chunk.text, chunk.code);
        }
        if (chunk instanceof ControlContent) {
          if (chunk.method === "close") {
            return;
          }
          throw this.unexpectedResponseError(operation);
        }
        if (!(chunk instanceof BinaryContent) || chunk.headers.kind !== "pull") {
          throw this.unexpectedResponseError(operation);
        }
        input.requestNext();
      }
    } finally {
      input.close();
    }
  }

  private async *streamArrow(operation: string, start: Record<string, unknown>): AsyncIterable<Table> {
    const input = new SqliteArrowReadInputStream(start);
    const response = await this.invokeStream(operation, input.stream());
    input.requestNext();
    try {
      for await (const chunk of response) {
        if (chunk instanceof ErrorContent) {
          throw new RoomServerException(chunk.text, chunk.code);
        }
        if (chunk instanceof ControlContent) {
          if (chunk.method === "close") {
            return;
          }
          throw this.unexpectedResponseError(operation);
        }
        if (!(chunk instanceof BinaryContent) || chunk.headers.kind !== "data") {
          throw this.unexpectedResponseError(operation);
        }
        yield tableFromIPCBytes(chunk.data);
        input.requestNext();
      }
    } finally {
      input.close();
    }
  }

  public async listDatabases({ namespace }: { namespace?: string[] } = {}): Promise<string[]> {
    const response = await this.invoke("list_databases", { namespace: namespace ?? null });
    if (!(response instanceof JsonContent) || !Array.isArray(response.json.databases)) {
      throw this.unexpectedResponseError("list_databases");
    }
    return response.json.databases as string[];
  }

  public async createDatabase({ name, namespace, mode = "create" }: {
    name: string;
    namespace?: string[];
    mode?: SqliteCreateMode;
  }): Promise<void> {
    const response = await this.invoke("create_database", { name, namespace: namespace ?? null, mode });
    if (!(response instanceof EmptyContent)) {
      throw this.unexpectedResponseError("create_database");
    }
  }

  public async dropDatabase({ name, namespace, ignoreMissing = false }: {
    name: string;
    namespace?: string[];
    ignoreMissing?: boolean;
  }): Promise<void> {
    const response = await this.invoke("drop_database", { name, namespace: namespace ?? null, ignore_missing: ignoreMissing });
    if (!(response instanceof EmptyContent)) {
      throw this.unexpectedResponseError("drop_database");
    }
  }

  public async inspectDatabase({ name, namespace }: { name: string; namespace?: string[] }): Promise<SqliteDatabaseDetails> {
    const response = await this.invoke("inspect_database", { name, namespace: namespace ?? null });
    if (!(response instanceof JsonContent) || typeof response.json.name !== "string" || typeof response.json.tables !== "number") {
      throw this.unexpectedResponseError("inspect_database");
    }
    return {
      name: response.json.name,
      namespace: Array.isArray(response.json.namespace) ? response.json.namespace as string[] : null,
      tables: response.json.tables,
      sizeBytes: typeof response.json.size_bytes === "number" ? response.json.size_bytes : 0,
    };
  }

  public async listTables({ database, namespace }: { database: string; namespace?: string[] }): Promise<string[]> {
    const response = await this.invoke("list_tables", { database, namespace: namespace ?? null });
    if (!(response instanceof JsonContent) || !Array.isArray(response.json.tables)) {
      throw this.unexpectedResponseError("list_tables");
    }
    return response.json.tables as string[];
  }

  private async createTable({
    database,
    name,
    data,
    schema,
    mode = "create",
    namespace,
  }: {
    database: string;
    name: string;
    data?: ArrowTableChunks;
    schema?: Schema;
    mode?: SqliteCreateMode;
    namespace?: string[];
  }): Promise<void> {
    const input = new SqliteArrowWriteInputStream(
      {
        kind: "start",
        database,
        name,
        mode,
        namespace: namespace ?? null,
      },
      data ?? [],
      schema,
    );
    await this.drainWriteStream("create_table", input);
  }

  public async createTableWithSchema({ database, name, schema, data, mode = "create", namespace }: {
    database: string;
    name: string;
    schema?: Schema;
    data?: Iterable<Table> | Table;
    mode?: SqliteCreateMode;
    namespace?: string[];
  }): Promise<void> {
    return this.createTable({
      database,
      name,
      schema,
      data: data == null ? undefined : data instanceof Table ? [data] : data,
      mode,
      namespace,
    });
  }

  public async createTableFromData({ database, name, data, mode = "create", namespace }: {
    database: string;
    name: string;
    data?: Iterable<Table> | Table;
    mode?: SqliteCreateMode;
    namespace?: string[];
  }): Promise<void> {
    return this.createTable({
      database,
      name,
      data: data == null ? undefined : data instanceof Table ? [data] : data,
      mode,
      namespace,
    });
  }

  public async dropTable({ database, name, ignoreMissing = false, namespace }: {
    database: string;
    name: string;
    ignoreMissing?: boolean;
    namespace?: string[];
  }): Promise<void> {
    const response = await this.invoke("drop_table", { database, name, ignore_missing: ignoreMissing, namespace: namespace ?? null });
    if (!(response instanceof EmptyContent)) {
      throw this.unexpectedResponseError("drop_table");
    }
  }

  public async renameTable({ database, name, newName, namespace }: {
    database: string;
    name: string;
    newName: string;
    namespace?: string[];
  }): Promise<void> {
    const response = await this.invoke("rename_table", { database, name, new_name: newName, namespace: namespace ?? null });
    if (!(response instanceof EmptyContent)) {
      throw this.unexpectedResponseError("rename_table");
    }
  }

  public async inspect({ database, table, namespace }: {
    database: string;
    table: string;
    namespace?: string[];
  }): Promise<Schema> {
    const response = await this.invoke("inspect", { database, table, namespace: namespace ?? null });
    if (!(response instanceof BinaryContent)) {
      throw this.unexpectedResponseError("inspect");
    }
    return schemaFromIPCBytes(response.data);
  }

  public async addColumns({ database, table, newColumns, namespace }: {
    database: string;
    table: string;
    newColumns: Schema;
    namespace?: string[];
  }): Promise<void> {
    const response = await this.invokeContent("add_columns", new BinaryContent({
      data: schemaToIPC(newColumns),
      headers: {
        database,
        table,
        namespace: namespace ?? null,
        content_type: ARROW_IPC_STREAM_MIME_TYPE,
      },
    }));
    if (!(response instanceof EmptyContent)) {
      throw this.unexpectedResponseError("add_columns");
    }
  }

  public async dropColumns({ database, table, columns, namespace }: {
    database: string;
    table: string;
    columns: string[];
    namespace?: string[];
  }): Promise<void> {
    const response = await this.invoke("drop_columns", { database, table, columns, namespace: namespace ?? null });
    if (!(response instanceof EmptyContent)) {
      throw this.unexpectedResponseError("drop_columns");
    }
  }

  public async insert({ database, table, records, namespace }: {
    database: string;
    table: string;
    records: Table;
    namespace?: string[];
  }): Promise<void> {
    await this.insertStream({ database, table, chunks: [records], namespace });
  }

  public async insertStream({ database, table, chunks, namespace }: {
    database: string;
    table: string;
    chunks: ArrowTableChunks;
    namespace?: string[];
  }): Promise<void> {
    const input = new SqliteArrowWriteInputStream({
      kind: "start",
      database,
      table,
      namespace: namespace ?? null,
    }, chunks);
    await this.drainWriteStream("insert", input);
  }

  public async update({ database, table, where, values, params, namespace }: {
    database: string;
    table: string;
    where: string;
    values: DatasetRecord;
    params?: unknown;
    namespace?: string[];
  }): Promise<number> {
    const response = await this.invoke("update", {
      database,
      table,
      where,
      values: Object.entries(values).map(([column, value]) => ({ column, value_json: JSON.stringify(encodeRecordValue(value)) })),
      params: params ?? null,
      namespace: namespace ?? null,
    });
    if (!(response instanceof JsonContent) || typeof response.json.rows_affected !== "number") {
      throw this.unexpectedResponseError("update");
    }
    return response.json.rows_affected;
  }

  public async delete({ database, table, where, params, namespace }: {
    database: string;
    table: string;
    where: string;
    params?: unknown;
    namespace?: string[];
  }): Promise<number> {
    const response = await this.invoke("delete", { database, table, where, params: params ?? null, namespace: namespace ?? null });
    if (!(response instanceof JsonContent) || typeof response.json.rows_affected !== "number") {
      throw this.unexpectedResponseError("delete");
    }
    return response.json.rows_affected;
  }

  public async search({ database, table, where, params, offset, limit, select, namespace }: {
    database: string;
    table: string;
    where?: SqliteWhere;
    params?: unknown;
    offset?: number;
    limit?: number;
    select?: string[];
    namespace?: string[];
  }): Promise<Table[]> {
    const results: Table[] = [];
    for await (const chunk of this.searchStream({ database, table, where, params, offset, limit, select, namespace })) {
      results.push(chunk);
    }
    return results;
  }

  public async searchTable({ database, table, where, params, offset, limit, select, namespace }: {
    database: string;
    table: string;
    where?: SqliteWhere;
    params?: unknown;
    offset?: number;
    limit?: number;
    select?: string[];
    namespace?: string[];
  }): Promise<Table> {
    return tableFromChunks(await this.search({ database, table, where, params, offset, limit, select, namespace }));
  }

  public async *searchStream({ database, table, where, params, offset, limit, select, namespace }: {
    database: string;
    table: string;
    where?: SqliteWhere;
    params?: unknown;
    offset?: number;
    limit?: number;
    select?: string[];
    namespace?: string[];
  }): AsyncIterable<Table> {
    yield* this.streamArrow("search", {
      kind: "start",
      database,
      table,
      where: buildWhereClause(where),
      params: params ?? null,
      offset: offset ?? null,
      limit: limit ?? null,
      select: select ?? null,
      namespace: namespace ?? null,
    });
  }

  public async count({ database, table, where, params, namespace }: {
    database: string;
    table: string;
    where?: SqliteWhere;
    params?: unknown;
    namespace?: string[];
  }): Promise<number> {
    const response = await this.invoke("count", {
      database,
      table,
      where: buildWhereClause(where),
      params: params ?? null,
      namespace: namespace ?? null,
    });
    if (!(response instanceof JsonContent) || typeof response.json.count !== "number" || !Number.isInteger(response.json.count)) {
      throw this.unexpectedResponseError("count");
    }
    return response.json.count;
  }

  public async sql({ database, query, params, namespace }: {
    database: string;
    query: string;
    params?: unknown;
    namespace?: string[];
  }): Promise<Table[]> {
    const results: Table[] = [];
    for await (const chunk of this.sqlStream({ database, query, params, namespace })) {
      results.push(chunk);
    }
    return results;
  }

  public async sqlTable({ database, query, params, namespace }: {
    database: string;
    query: string;
    params?: unknown;
    namespace?: string[];
  }): Promise<Table> {
    return tableFromChunks(await this.sql({ database, query, params, namespace }));
  }

  public async openSqlQuery({ database, query, params, namespace }: {
    database: string;
    query: string;
    params?: unknown;
    namespace?: string[];
  }): Promise<SqliteSqlQuery> {
    const response = await this.invokeContent("open_sql_query", new BinaryContent({
      data: new Uint8Array(),
      headers: { database, query, params: params ?? null, namespace: namespace ?? null },
    }));
    if (!(response instanceof BinaryContent)) {
      throw this.unexpectedResponseError("open_sql_query");
    }
    const queryId = response.headers.query_id;
    if (typeof queryId !== "string" || queryId === "") {
      throw this.unexpectedResponseError("open_sql_query");
    }
    return {
      schema: schemaFromIPCBytes(response.data),
      kind: "query",
      queryId,
    };
  }

  public async executeSql({ database, query, params, namespace }: {
    database: string;
    query: string;
    params?: unknown;
    namespace?: string[];
  }): Promise<SqliteSqlExecution> {
    const response = await this.invokeContent("execute_sql", new BinaryContent({
      data: new Uint8Array(),
      headers: { database, query, params: params ?? null, namespace: namespace ?? null },
    }));
    if (response instanceof BinaryContent) {
      if (response.headers.kind !== "query") {
        throw this.unexpectedResponseError("execute_sql");
      }
      const queryId = response.headers.query_id;
      if (typeof queryId !== "string" || queryId === "") {
        throw this.unexpectedResponseError("execute_sql");
      }
      return {
        kind: "query",
        schema: schemaFromIPCBytes(response.data),
        queryId,
      };
    }
    if (response instanceof JsonContent) {
      if (response.json.kind !== "statement"
        || typeof response.json.rows_affected !== "number"
        || !Number.isInteger(response.json.rows_affected)) {
        throw this.unexpectedResponseError("execute_sql");
      }
      return {
        kind: "statement",
        rowsAffected: response.json.rows_affected,
      };
    }
    throw this.unexpectedResponseError("execute_sql");
  }

  public async *sqlStream({ database, query, params, namespace }: {
    database: string;
    query: string;
    params?: unknown;
    namespace?: string[];
  }): AsyncIterable<Table> {
    const result = await this.executeSql({ database, query, params, namespace });
    if (result.kind === "statement") {
      throw new RoomServerException(`SQL statement did not return rows; rows_affected=${result.rowsAffected}`);
    }
    try {
      yield* this.readSqlQuery({ queryId: result.queryId });
    } finally {
      await this.closeSqlQuery({ queryId: result.queryId });
    }
  }

  public async *readSqlQuery({ queryId }: { queryId: string }): AsyncIterable<Table> {
    yield* this.streamArrow("read_sql_query", { kind: "start", query_id: queryId });
  }

  public async closeSqlQuery({ queryId }: { queryId: string }): Promise<void> {
    const response = await this.invoke("close_sql_query", { query_id: queryId });
    if (!(response instanceof EmptyContent)) {
      throw this.unexpectedResponseError("close_sql_query");
    }
  }

  public async cancelSqlQuery({ queryId }: { queryId: string }): Promise<SqliteSqlCancelResult> {
    const response = await this.invoke("cancel_sql_query", { query_id: queryId });
    if (!(response instanceof JsonContent)
      || !["cancelled", "cancelling", "not_cancellable"].includes(response.json.status as string)) {
      throw this.unexpectedResponseError("cancel_sql_query");
    }
    return { status: response.json.status as SqliteSqlCancelStatus };
  }

  public async executeSqlStatement({ database, query, params, namespace }: {
    database: string;
    query: string;
    params?: unknown;
    namespace?: string[];
  }): Promise<number> {
    const response = await this.invokeContent("execute_sql_statement", new BinaryContent({
      data: new Uint8Array(),
      headers: { database, query, params: params ?? null, namespace: namespace ?? null },
    }));
    if (!(response instanceof JsonContent)
      || typeof response.json.rows_affected !== "number"
      || !Number.isInteger(response.json.rows_affected)) {
      throw this.unexpectedResponseError("execute_sql_statement");
    }
    return response.json.rows_affected;
  }
}
