import { DataType } from "./data-types";
import { RoomClient } from "./room-client";
import { RoomServerException } from "./room-server-client";
import { Content, ControlContent, ErrorContent, JsonContent } from "./response";

export type CreateMode = "create" | "overwrite" | "create_if_not_exists";

export interface TableRef {
  name: string;
  namespace?: string[];
  alias?: string;
}

type TypedValue =
  | { type: "null" }
  | { type: "bool"; value: boolean }
  | { type: "int"; value: number }
  | { type: "float"; value: number }
  | { type: "text"; value: string }
  | { type: "binary"; data: string }
  | { type: "date"; value: string }
  | { type: "timestamp"; value: string }
  | { type: "list"; items: TypedValue[] }
  | { type: "struct"; fields: Array<{ name: string; value: TypedValue }> };

type RowChunkJson = {
  kind: "rows";
  rows: Array<{
    columns: Array<{
      name: string;
      value: TypedValue;
    }>;
  }>;
};

const globalScope = globalThis as typeof globalThis & {
  Buffer?: {
    from(data: Uint8Array | string, encoding?: string): { toString(encoding: string): string };
  };
  btoa?: (data: string) => string;
  atob?: (data: string) => string;
};

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

function base64ToBytes(base64: string): Uint8Array {
  if (globalScope.Buffer) {
    return Uint8Array.from(globalScope.Buffer.from(base64, "base64") as unknown as ArrayLike<number>);
  }

  if (!globalScope.atob) {
    throw new Error("base64 decoding is not available in this runtime");
  }

  const binary = globalScope.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataEntries(metadata?: Record<string, unknown>): Array<{ key: string; value: string }> | null {
  if (metadata == null) {
    return null;
  }
  return Object.entries(metadata).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(encodeLegacyValue(value)),
  }));
}

function toolkitDataTypeJson(dataType: DataType): Record<string, unknown> {
  const json = dataType.toJson() as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    type: json.type,
    nullable: json.nullable ?? null,
    metadata: metadataEntries(json.metadata as Record<string, unknown> | undefined),
  };

  if (json.type === "vector" || json.type === "list") {
    payload.element_type = toolkitDataTypeJson(DataType.fromJson(json.element_type as Record<string, unknown>));
  } else if (json.type === "struct") {
    const fields = json.fields;
    if (!Array.isArray(fields)) {
      throw new RoomServerException("unexpected return type from database.inspect");
    }
    payload.fields = fields.map((field) => {
      if (!isRecord(field) || typeof field.name !== "string" || !isRecord(field.data_type)) {
        throw new RoomServerException("unexpected return type from database.inspect");
      }
      return {
        name: field.name,
        data_type: toolkitDataTypeJson(DataType.fromJson(field.data_type)),
      };
    });
  }
  if (json.type === "vector") {
    payload.size = json.size;
  }

  return payload;
}

function schemaEntries(schema?: Record<string, DataType>): Array<Record<string, unknown>> | null {
  if (schema == null) {
    return null;
  }
  return Object.entries(schema).map(([name, dataType]) => ({
    name,
    data_type: toolkitDataTypeJson(dataType),
  }));
}

function publicDataTypeJson(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new RoomServerException("unexpected return type from database.inspect");
  }

  const type = value.type;
  if (typeof type !== "string") {
    throw new RoomServerException("unexpected return type from database.inspect");
  }

  const metadataList = value.metadata;
  let metadata: Record<string, string> | undefined;
  if (metadataList != null) {
    if (!Array.isArray(metadataList)) {
      throw new RoomServerException("unexpected return type from database.inspect");
    }
    metadata = {};
    for (const entry of metadataList) {
      if (!isRecord(entry) || typeof entry.key !== "string" || typeof entry.value !== "string") {
        throw new RoomServerException("unexpected return type from database.inspect");
      }
      metadata[entry.key] = entry.value;
    }
  }

  const payload: Record<string, unknown> = {
    type,
    nullable: value.nullable,
    metadata,
  };

  if (type === "vector") {
    payload.size = value.size;
    payload.element_type = publicDataTypeJson(value.element_type);
  } else if (type === "list") {
    payload.element_type = publicDataTypeJson(value.element_type);
  } else if (type === "struct") {
    const rawFields = value.fields;
    if (!Array.isArray(rawFields)) {
      throw new RoomServerException("unexpected return type from database.inspect");
    }
    payload.fields = Object.fromEntries(rawFields.map((field) => {
      if (!isRecord(field) || typeof field.name !== "string") {
        throw new RoomServerException("unexpected return type from database.inspect");
      }
      return [field.name, publicDataTypeJson(field.data_type)];
    }));
  }

  return payload;
}

function encodeLegacyValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      encoding: "base64",
      data: bytesToBase64(value),
    };
  }
  if (value instanceof Date) {
    return value.toISOString().replace("+00:00", "Z");
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeLegacyValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, encodeLegacyValue(entryValue)]));
  }
  return value;
}

function encodeStreamValue(value: unknown): TypedValue {
  if (value == null) {
    return { type: "null" };
  }
  if (typeof value === "boolean") {
    return { type: "bool", value };
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { type: "int", value };
    }
    return { type: "float", value };
  }
  if (typeof value === "string") {
    return { type: "text", value };
  }
  if (value instanceof Uint8Array) {
    return {
      type: "binary",
      data: bytesToBase64(value),
    };
  }
  if (value instanceof Date) {
    return {
      type: "timestamp",
      value: value.toISOString().replace("+00:00", "Z"),
    };
  }
  if (Array.isArray(value)) {
    return {
      type: "list",
      items: value.map((item) => encodeStreamValue(item)),
    };
  }
  if (isRecord(value)) {
    return {
      type: "struct",
      fields: Object.entries(value).map(([name, fieldValue]) => ({
        name,
        value: encodeStreamValue(fieldValue),
      })),
    };
  }
  throw new RoomServerException(`database stream does not support value type ${typeof value}`);
}

function decodeStreamValue(value: unknown, operation: string): unknown {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new RoomServerException(`unexpected return type from database.${operation}`);
  }

  switch (value.type) {
    case "null":
      return null;
    case "bool":
      if (typeof value.value !== "boolean") {
        throw new RoomServerException(`unexpected return type from database.${operation}`);
      }
      return value.value;
    case "int":
    case "float":
      if (typeof value.value !== "number") {
        throw new RoomServerException(`unexpected return type from database.${operation}`);
      }
      return value.value;
    case "text":
    case "date":
    case "timestamp":
      if (typeof value.value !== "string") {
        throw new RoomServerException(`unexpected return type from database.${operation}`);
      }
      return value.value;
    case "binary":
      if (typeof value.data !== "string") {
        throw new RoomServerException(`unexpected return type from database.${operation}`);
      }
      return base64ToBytes(value.data);
    case "list":
      if (!Array.isArray(value.items)) {
        throw new RoomServerException(`unexpected return type from database.${operation}`);
      }
      return value.items.map((item) => decodeStreamValue(item, operation));
    case "struct":
      if (!Array.isArray(value.fields)) {
        throw new RoomServerException(`unexpected return type from database.${operation}`);
      }
      return Object.fromEntries(value.fields.map((field) => {
        if (!isRecord(field) || typeof field.name !== "string") {
          throw new RoomServerException(`unexpected return type from database.${operation}`);
        }
        return [field.name, decodeStreamValue(field.value, operation)];
      }));
    default:
      throw new RoomServerException(`unexpected return type from database.${operation}`);
  }
}

function rowsChunk(records: Array<Record<string, unknown>>): RowChunkJson {
  return {
    kind: "rows",
    rows: records.map((record) => ({
      columns: Object.entries(record).map(([name, value]) => ({
        name,
        value: encodeStreamValue(value),
      })),
    })),
  };
}

function recordsFromRowsChunk(payload: unknown, operation: string): Array<Record<string, any>> {
  if (!isRecord(payload) || payload.kind !== "rows" || !Array.isArray(payload.rows)) {
    throw new RoomServerException(`unexpected return type from database.${operation}`);
  }

  return payload.rows.map((row) => {
    if (!isRecord(row) || !Array.isArray(row.columns)) {
      throw new RoomServerException(`unexpected return type from database.${operation}`);
    }
    return Object.fromEntries(row.columns.map((column) => {
      if (!isRecord(column) || typeof column.name !== "string") {
        throw new RoomServerException(`unexpected return type from database.${operation}`);
      }
      return [column.name, decodeStreamValue(column.value, operation)];
    }));
  });
}

function rowChunkList(records: Array<Record<string, any>>, rowsPerChunk = 128): Array<Array<Record<string, any>>> {
  if (rowsPerChunk <= 0) {
    throw new RoomServerException("rowsPerChunk must be greater than zero");
  }
  const chunks: Array<Array<Record<string, any>>> = [];
  for (let index = 0; index < records.length; index += rowsPerChunk) {
    chunks.push(records.slice(index, index + rowsPerChunk));
  }
  return chunks;
}

async function* toAsyncIterable<T>(chunks: AsyncIterable<T> | Iterable<T>): AsyncIterable<T> {
  if (Symbol.asyncIterator in Object(chunks)) {
    for await (const chunk of chunks as AsyncIterable<T>) {
      yield chunk;
    }
    return;
  }
  for (const chunk of chunks as Iterable<T>) {
    yield chunk;
  }
}

function buildWhereClause(where?: string | Record<string, any>): string | null {
  if (where != null && typeof where === "object" && !Array.isArray(where)) {
    return Object.entries(where)
      .map(([key, value]) => `${key} = ${JSON.stringify(encodeLegacyValue(value))}`)
      .join(" AND ");
  }
  if (typeof where === "string") {
    return where;
  }
  return null;
}

class DatabaseWriteInputStream {
  private readonly source: AsyncIterator<Array<Record<string, any>>>;
  private readonly pulls: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly start: Record<string, any>,
    chunks: AsyncIterable<Array<Record<string, any>>> | Iterable<Array<Record<string, any>>>,
  ) {
    this.source = toAsyncIterable(chunks)[Symbol.asyncIterator]();
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
    yield new JsonContent({ json: this.start });
    while (!this.closed) {
      await this.waitForPull();
      if (this.closed) {
        return;
      }
      const nextChunk = await this.source.next();
      if (nextChunk.done) {
        return;
      }
      if (nextChunk.value.length === 0) {
        continue;
      }
      yield new JsonContent({ json: rowsChunk(nextChunk.value) });
    }
  }
}

class DatabaseReadInputStream {
  private readonly pulls: Array<() => void> = [];
  private closed = false;

  constructor(private readonly start: Record<string, any>) {}

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
    yield new JsonContent({ json: this.start });
    while (!this.closed) {
      await this.waitForPull();
      if (this.closed) {
        return;
      }
      yield new JsonContent({ json: { kind: "pull" } });
    }
  }
}

export class DatabaseClient {
  private room: RoomClient;

  constructor({room}: {room: RoomClient}) {
    this.room = room;
  }

  private _unexpectedResponseError(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from database.${operation}`);
  }

  private async invoke(operation: string, input: Record<string, any>): Promise<JsonContent | null> {
    const response = await this.room.invoke({ toolkit: "database", tool: operation, input });
    if (response instanceof JsonContent) {
      return response;
    }
    if (response == null) {
      return null;
    }
    return null;
  }

  private async invokeStream(operation: string, input: AsyncIterable<Content>): Promise<AsyncIterable<Content>> {
    return await this.room.invokeStream({ toolkit: "database", tool: operation, input });
  }

  private async drainWriteStream(operation: string, input: DatabaseWriteInputStream): Promise<void> {
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
          throw this._unexpectedResponseError(operation);
        }
        if (!(chunk instanceof JsonContent) || chunk.json.kind !== "pull") {
          throw this._unexpectedResponseError(operation);
        }
        input.requestNext();
      }
    } finally {
      input.close();
    }
  }

  private async *streamRows(operation: string, start: Record<string, any>): AsyncIterable<Array<Record<string, any>>> {
    const input = new DatabaseReadInputStream(start);
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
          throw this._unexpectedResponseError(operation);
        }
        if (!(chunk instanceof JsonContent)) {
          throw this._unexpectedResponseError(operation);
        }
        yield recordsFromRowsChunk(chunk.json, operation);
        input.requestNext();
      }
    } finally {
      input.close();
    }
  }

  public async listTables(): Promise<string[]> {
    const response = await this.invoke("list_tables", { namespace: null });
    if (!(response instanceof JsonContent)) {
      throw this._unexpectedResponseError("list_tables");
    }
    return Array.isArray(response.json.tables) ? response.json.tables as string[] : [];
  }

  private async createTable({
    name,
    data,
    schema,
    mode = "create",
  }: {
    name: string;
    data?: AsyncIterable<Array<Record<string, any>>> | Iterable<Array<Record<string, any>>>;
    schema?: Record<string, DataType>;
    mode?: CreateMode;
  }): Promise<void> {
    const input = new DatabaseWriteInputStream(
      {
        kind: "start",
        name,
        fields: schemaEntries(schema),
        mode,
        namespace: null,
        metadata: null,
      },
      data ?? [],
    );
    await this.drainWriteStream("create_table", input);
  }

  public async createTableWithSchema({ name, schema, data, mode = "create" }: {
    name: string;
    schema?: Record<string, DataType>;
    data?: Array<Record<string, any>>;
    mode?: CreateMode;
  }): Promise<void> {
    return this.createTable({
      name,
      schema,
      data: data == null ? undefined : rowChunkList(data),
      mode,
    });
  }

  public async createTableFromData({ name, data, mode = "create" }: {
    name: string;
    data?: Array<Record<string, any>>;
    mode?: CreateMode;
  }): Promise<void> {
    return this.createTable({
      name,
      data: data == null ? undefined : rowChunkList(data),
      mode,
    });
  }

  public async createTableFromDataStream({ name, chunks, schema, mode = "create" }: {
    name: string;
    chunks: AsyncIterable<Array<Record<string, any>>> | Iterable<Array<Record<string, any>>>;
    schema?: Record<string, DataType>;
    mode?: CreateMode;
  }): Promise<void> {
    return this.createTable({ name, data: chunks, schema, mode });
  }

  public async dropTable({ name, ignoreMissing = false }: {
    name: string;
    ignoreMissing?: boolean;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "drop_table",
      input: { name, ignore_missing: ignoreMissing, namespace: null },
    });
  }

  public async addColumns({ table, newColumns }: {
    table: string;
    newColumns: Record<string, string>;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "add_columns",
      input: {
        table,
        columns: Object.entries(newColumns).map(([name, valueSql]) => ({ name, value_sql: valueSql, data_type: null })),
        namespace: null,
      },
    });
  }

  public async dropColumns({ table, columns }: {
    table: string;
    columns: string[];
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "drop_columns",
      input: { table, columns, namespace: null },
    });
  }

  public async insert({ table, records }: {
    table: string;
    records: Array<Record<string, any>>;
  }): Promise<void> {
    await this.insertStream({ table, chunks: rowChunkList(records) });
  }

  public async insertStream({ table, chunks }: {
    table: string;
    chunks: AsyncIterable<Array<Record<string, any>>> | Iterable<Array<Record<string, any>>>;
  }): Promise<void> {
    const input = new DatabaseWriteInputStream({
      kind: "start",
      table,
      namespace: null,
    }, chunks);
    await this.drainWriteStream("insert", input);
  }

  public async update({ table, where, values, valuesSql }: {
    table: string;
    where: string;
    values?: Record<string, any>;
    valuesSql?: Record<string, string>;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "update",
      input: {
        table,
        where,
        values: values == null ? null : Object.entries(values).map(([column, value]) => ({ column, value_json: JSON.stringify(encodeLegacyValue(value)) })),
        values_sql: valuesSql == null ? null : Object.entries(valuesSql).map(([column, expression]) => ({ column, expression })),
        namespace: null,
      },
    });
  }

  public async delete({ table, where }: {
    table: string;
    where: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "delete",
      input: { table, where, namespace: null },
    });
  }

  public async merge({ table, on, records }: {
    table: string;
    on: string;
    records: Array<Record<string, any>>;
  }): Promise<void> {
    await this.mergeStream({ table, on, chunks: rowChunkList(records) });
  }

  public async mergeStream({ table, on, chunks }: {
    table: string;
    on: string;
    chunks: AsyncIterable<Array<Record<string, any>>> | Iterable<Array<Record<string, any>>>;
  }): Promise<void> {
    const input = new DatabaseWriteInputStream({
      kind: "start",
      table,
      on,
      namespace: null,
    }, chunks);
    await this.drainWriteStream("merge", input);
  }

  public async sql({ query, tables, params }: {
    query: string;
    tables: TableRef[];
    params?: Record<string, any>;
  }): Promise<Array<Record<string, any>>> {
    const rows: Array<Record<string, any>> = [];
    for await (const chunk of this.sqlStream({ query, tables, params })) {
      rows.push(...chunk);
    }
    return rows;
  }

  public async *sqlStream({ query, tables, params }: {
    query: string;
    tables: TableRef[];
    params?: Record<string, any>;
  }): AsyncIterable<Array<Record<string, any>>> {
    yield* this.streamRows("sql", {
      kind: "start",
      query,
      tables,
      params_json: params == null ? null : JSON.stringify(encodeLegacyValue(params)),
    });
  }

  public async search({ table, text, vector, where, limit, select }: {
    table: string;
    text?: string;
    vector?: number[];
    where?: string | Record<string, any>;
    limit?: number;
    select?: string[];
  }): Promise<Array<Record<string, any>>> {
    const rows: Array<Record<string, any>> = [];
    for await (const chunk of this.searchStream({ table, text, vector, where, limit, select })) {
      rows.push(...chunk);
    }
    return rows;
  }

  public async *searchStream({ table, text, vector, where, limit, select }: {
    table: string;
    text?: string;
    vector?: number[];
    where?: string | Record<string, any>;
    limit?: number;
    select?: string[];
  }): AsyncIterable<Array<Record<string, any>>> {
    yield* this.streamRows("search", {
      kind: "start",
      table,
      text: text ?? null,
      vector: vector ?? null,
      text_columns: null,
      where: buildWhereClause(where),
      offset: null,
      limit: limit ?? null,
      select: select ?? null,
      namespace: null,
    });
  }

  public async optimize(table: string): Promise<void> {
    await this.room.invoke({ toolkit: "database", tool: "optimize", input: { table, namespace: null } });
  }

  public async createVectorIndex({ table, column, replace = false }: {
    table: string;
    column: string;
    replace?: boolean;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "create_vector_index",
      input: { table, column, replace, namespace: null },
    });
  }

  public async createScalarIndex({ table, column, replace = false }: {
    table: string;
    column: string;
    replace?: boolean;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "create_scalar_index",
      input: { table, column, replace, namespace: null },
    });
  }

  public async createFullTextSearchIndex({ table, column, replace = false }: {
    table: string;
    column: string;
    replace?: boolean;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "create_full_text_search_index",
      input: { table, column, replace, namespace: null },
    });
  }

  public async listIndexes({ table }: { table: string }): Promise<Array<Record<string, any>>> {
    const response = await this.invoke("list_indexes", { table, namespace: null });
    if (!(response instanceof JsonContent)) {
      throw this._unexpectedResponseError("list_indexes");
    }
    if (!Array.isArray(response.json.indexes)) {
      throw this._unexpectedResponseError("list_indexes");
    }
    return response.json.indexes as Array<Record<string, any>>;
  }
}
