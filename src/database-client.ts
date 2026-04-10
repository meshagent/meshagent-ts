import { DataType } from "./data-types";
import { RoomClient } from "./room-client";
import { RoomServerException } from "./room-server-client";
import { Content, ControlContent, ErrorContent, JsonContent } from "./response";

export type CreateMode = "create" | "overwrite" | "create_if_not_exists";

export interface TableRef {
  name: string;
  namespace?: string[];
  alias?: string;
  branch?: string;
  version?: number;
}

export interface TableVersion {
  version: number;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface TableIndex {
  name: string;
  columns: string[];
  type: string;
}

export interface TableBranch {
  name: string;
  parentBranch: string | null;
  parentVersion: number | null;
  createdAt: Date | null;
  manifestSize: number | null;
}

export abstract class DatabaseValueEncoder {
  public abstract encodeDatabaseValue(): unknown;
}

export class DatabaseExpression extends DatabaseValueEncoder {
  public readonly expression: string;

  public constructor(expression: string) {
    super();
    const normalized = expression.trim();
    if (normalized === "") {
      throw new TypeError("database expression must not be empty");
    }
    this.expression = normalized;
  }

  public encodeDatabaseValue(): Record<string, string> {
    return {
      expression: this.expression,
    };
  }

  public toString(): string {
    return this.expression;
  }
}

export class DatabaseDate extends DatabaseValueEncoder {
  public readonly value: string;

  public constructor(value: string) {
    super();
    const normalized = value.trim();
    const parsed = new Date(`${normalized}T00:00:00Z`);
    if (!ISO_DATE_REGEX.test(normalized) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
      throw new TypeError("invalid database date format");
    }
    this.value = normalized;
  }

  public encodeDatabaseValue(): Record<string, string> {
    return {
      date: this.value,
    };
  }

  public toString(): string {
    return this.value;
  }
}

export type DatabaseJsonScalarValue = null | boolean | number | string;
export type DatabaseJsonValue =
  | DatabaseJsonScalarValue
  | DatabaseJsonValue[]
  | { [key: string]: DatabaseJsonValue };

export class DatabaseStruct extends DatabaseValueEncoder {
  public readonly fields: Record<string, DatabaseValue>;

  public constructor(fields: Record<string, DatabaseValue>) {
    super();
    this.fields = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => {
        if (typeof key !== "string") {
          throw new TypeError("database struct keys must be strings");
        }
        return [key, value];
      }),
    );
  }

  public toJson(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(this.fields).map(([key, value]) => [key, encodeRecordValue(value)]),
    );
  }

  public encodeDatabaseValue(): Record<string, Record<string, unknown>> {
    return {
      struct: this.toJson(),
    };
  }
}

export class DatabaseJson extends DatabaseValueEncoder {
  public readonly value: DatabaseJsonValue;

  public constructor(value: DatabaseJsonValue) {
    super();
    this.value = normalizeDatabaseJsonValue(value);
  }

  public toJson(): DatabaseJsonValue {
    return this.value;
  }

  public encodeDatabaseValue(): Record<string, DatabaseJsonValue> {
    return {
      json: this.value,
    };
  }
}

export type DatabaseScalarValue = null | boolean | number | string | Uint8Array | DatabaseUuid | Date;
export type DatabaseValue =
  | DatabaseScalarValue
  | DatabaseValueEncoder
  | DatabaseValue[];
export type DatabaseRecord = Record<string, DatabaseValue>;
export type DatabaseRows = DatabaseRecord[];
export type DatabaseRowChunks = AsyncIterable<DatabaseRows> | Iterable<DatabaseRows>;
export type DatabaseWhere = string | Record<string, DatabaseValue>;

type DatabaseRoomInvoker = Pick<RoomClient, "invoke" | "invokeStream">;

type RowChunkJson = {
  kind: "rows";
  rows: Array<{
    columns: Array<{
      name: string;
      value: unknown;
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

const UUID_HEX_REGEX = /^[0-9a-f]{32}$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function normalizeUuidHex(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/-/g, "");
  if (!UUID_HEX_REGEX.test(normalized)) {
    throw new RoomServerException("invalid uuid format");
  }
  return normalized;
}

function formatUuidHex(value: string): string {
  return (
    `${value.substring(0, 8)}-` +
    `${value.substring(8, 12)}-` +
    `${value.substring(12, 16)}-` +
    `${value.substring(16, 20)}-` +
    `${value.substring(20)}`
  );
}

export class DatabaseUuid {
  public readonly value: string;

  public constructor(value: string) {
    this.value = formatUuidHex(normalizeUuidHex(value));
  }

  public toString(): string {
    return this.value;
  }
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (
    Object.getPrototypeOf(value) === Object.prototype
    || Object.getPrototypeOf(value) === null
  );
}

function normalizeDatabaseJsonValue(value: unknown): DatabaseJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDatabaseJsonValue(item));
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDatabaseJsonValue(item)]),
    );
  }
  throw new TypeError("database json values must be valid JSON");
}

function metadataEntries(metadata?: Record<string, unknown>): Array<{ key: string; value: string }> | null {
  if (metadata == null) {
    return null;
  }
  return Object.entries(metadata).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
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

function encodeRecordValue(value: unknown): unknown {
  if (value instanceof DatabaseValueEncoder) {
    return value.encodeDatabaseValue();
  }
  if (value instanceof DatabaseUuid) {
    return {
      uuid: value.toString(),
    };
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
    throw new RoomServerException("database object values must use DatabaseStruct or DatabaseJson");
  }
  return value;
}

function databaseSqlLiteral(value: unknown): string {
  if (value instanceof DatabaseUuid) {
    return `X'${normalizeUuidHex(value.toString())}'`;
  }
  if (value instanceof DatabaseDate) {
    return JSON.stringify(value.toString());
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString().replace("+00:00", "Z"));
  }
  if (value instanceof DatabaseJson) {
    return JSON.stringify(JSON.stringify(value.toJson()));
  }
  if (value instanceof DatabaseStruct) {
    const fields = Object.entries(value.fields).map(([key, fieldValue]) => (
      `${JSON.stringify(key)}, ${databaseSqlLiteral(fieldValue)}`
    ));
    return `named_struct(${fields.join(", ")})`;
  }
  return JSON.stringify(encodeRecordValue(value));
}

function decodeRecordValue(value: unknown): DatabaseValue {
  if (Array.isArray(value)) {
    throw new RoomServerException("database list values must use a {'list': [...]} wrapper");
  }
  if (!isRecord(value)) {
    return value as DatabaseScalarValue;
  }

  const entries = Object.entries(value);
  if (entries.length !== 1) {
    throw new RoomServerException("database object values must use a single-key type wrapper");
  }

  const [wrapper, payload] = entries[0];
  switch (wrapper) {
    case "binary":
      if (typeof payload !== "string") {
        throw new RoomServerException("database binary values must be base64 strings");
      }
      return base64ToBytes(payload);
    case "uuid":
      if (typeof payload !== "string") {
        throw new RoomServerException("database uuid values must be strings");
      }
      return new DatabaseUuid(payload);
    case "expression":
      if (typeof payload !== "string") {
        throw new RoomServerException("database expression values must be strings");
      }
      return new DatabaseExpression(payload);
    case "date":
      if (typeof payload !== "string") {
        throw new RoomServerException("database date values must be strings");
      }
      return new DatabaseDate(payload);
    case "timestamp":
      if (typeof payload !== "string") {
        throw new RoomServerException("database timestamp values must be strings");
      }
      {
        const parsed = new Date(payload);
        if (Number.isNaN(parsed.getTime())) {
          throw new RoomServerException("database timestamp value is not valid");
        }
        return parsed;
      }
    case "list":
      if (!Array.isArray(payload)) {
        throw new RoomServerException("database list values must be arrays");
      }
      return payload.map((item) => decodeRecordValue(item));
    case "struct":
      if (!isRecord(payload)) {
        throw new RoomServerException("database struct values must be objects");
      }
      return new DatabaseStruct(
        Object.fromEntries(
          Object.entries(payload).map(([key, item]) => [key, decodeRecordValue(item)]),
        ) as DatabaseRecord,
      );
    case "json":
      return new DatabaseJson(normalizeDatabaseJsonValue(payload));
    default:
      throw new RoomServerException(`unsupported database value wrapper '${wrapper}'`);
  }
}

function encodeDatabaseRecord(record: DatabaseRecord): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, encodeRecordValue(value)]),
  );
}

function rowsChunk(records: DatabaseRows): RowChunkJson {
  return {
    kind: "rows",
    rows: records.map((record) => ({
      columns: Object.entries(record).map(([name, value]) => ({
        name,
        value: encodeRecordValue(value),
      })),
    })),
  };
}

function recordsFromRowsChunk(payload: unknown, operation: string): DatabaseRows {
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
      try {
        return [column.name, decodeRecordValue(column.value)];
      } catch {
        throw new RoomServerException(`unexpected return type from database.${operation}`);
      }
    })) as DatabaseRecord;
  });
}

function rowChunkList(records: DatabaseRows, rowsPerChunk = 128): DatabaseRows[] {
  if (rowsPerChunk <= 0) {
    throw new RoomServerException("rowsPerChunk must be greater than zero");
  }
  const chunks: DatabaseRows[] = [];
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

function buildWhereClause(where?: DatabaseWhere): string | null {
  if (where != null && typeof where === "object" && !Array.isArray(where)) {
    return Object.entries(where)
      .map(([key, value]) => `${key} = ${databaseSqlLiteral(value)}`)
      .join(" AND ");
  }
  if (typeof where === "string") {
    return where;
  }
  return null;
}

function normalizeTableRefs(tables: Array<TableRef | string>): TableRef[] {
  return tables.map((table) => typeof table === "string" ? { name: table } : table);
}

function tableIndexFromJson(value: unknown): TableIndex {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.type !== "string" || !Array.isArray(value.columns)) {
    throw new RoomServerException("unexpected return type from database.list_indexes");
  }
  return {
    name: value.name,
    type: value.type,
    columns: value.columns.map((column) => {
      if (typeof column !== "string") {
        throw new RoomServerException("unexpected return type from database.list_indexes");
      }
      return column;
    }),
  };
}

function tableVersionFromJson(value: unknown): TableVersion {
  if (!isRecord(value) || typeof value.metadata_json !== "string" || typeof value.timestamp !== "string" || typeof value.version !== "number") {
    throw new RoomServerException("unexpected return type from database.list_versions");
  }
  const timestamp = new Date(value.timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new RoomServerException("unexpected return type from database.list_versions");
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(value.metadata_json);
  } catch (_) {
    throw new RoomServerException("unexpected return type from database.list_versions");
  }
  if (!isRecord(metadata)) {
    throw new RoomServerException("unexpected return type from database.list_versions");
  }

  return {
    version: value.version,
    timestamp,
    metadata,
  };
}

function tableBranchFromJson(value: unknown): TableBranch {
  if (!isRecord(value) || typeof value.name !== "string") {
    throw new RoomServerException("unexpected return type from database.list_branches");
  }

  if (value.parent_branch != null && typeof value.parent_branch !== "string") {
    throw new RoomServerException("unexpected return type from database.list_branches");
  }
  if (
    value.parent_version != null
    && (typeof value.parent_version !== "number" || !Number.isInteger(value.parent_version))
  ) {
    throw new RoomServerException("unexpected return type from database.list_branches");
  }
  if (
    value.manifest_size != null
    && (typeof value.manifest_size !== "number" || !Number.isInteger(value.manifest_size))
  ) {
    throw new RoomServerException("unexpected return type from database.list_branches");
  }

  let createdAt: Date | null = null;
  if (value.created_at != null) {
    if (typeof value.created_at !== "string") {
      throw new RoomServerException("unexpected return type from database.list_branches");
    }
    createdAt = new Date(value.created_at);
    if (Number.isNaN(createdAt.getTime())) {
      throw new RoomServerException("unexpected return type from database.list_branches");
    }
  }

  return {
    name: value.name,
    parentBranch: value.parent_branch ?? null,
    parentVersion: value.parent_version ?? null,
    createdAt,
    manifestSize: value.manifest_size ?? null,
  };
}

class DatabaseWriteInputStream {
  private readonly source: AsyncIterator<DatabaseRows>;
  private readonly pulls: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly start: Record<string, unknown>,
    chunks: DatabaseRowChunks,
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

  constructor(private readonly start: Record<string, unknown>) {}

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
  private room: DatabaseRoomInvoker;

  constructor({room}: {room: DatabaseRoomInvoker}) {
    this.room = room;
  }

  private _unexpectedResponseError(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from database.${operation}`);
  }

  private async invoke(operation: string, input: Record<string, unknown>): Promise<JsonContent | null> {
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

  private async *streamRows(operation: string, start: Record<string, unknown>): AsyncIterable<DatabaseRows> {
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

  public async listTables({ namespace, branch }: {
    namespace?: string[];
    branch?: string;
  } = {}): Promise<string[]> {
    const response = await this.invoke("list_tables", {
      namespace: namespace ?? null,
      branch: branch ?? null,
    });
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
    namespace,
    branch,
    metadata,
  }: {
    name: string;
    data?: DatabaseRowChunks;
    schema?: Record<string, DataType>;
    mode?: CreateMode;
    namespace?: string[];
    branch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const input = new DatabaseWriteInputStream(
      {
        kind: "start",
        name,
        fields: schemaEntries(schema),
        mode,
        namespace: namespace ?? null,
        branch: branch ?? null,
        metadata: metadataEntries(metadata),
      },
      data ?? [],
    );
    await this.drainWriteStream("create_table", input);
  }

  public async createTableWithSchema({ name, schema, data, mode = "create", namespace, branch, metadata }: {
    name: string;
    schema?: Record<string, DataType>;
    data?: DatabaseRows;
    mode?: CreateMode;
    namespace?: string[];
    branch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    return this.createTable({
      name,
      schema,
      data: data == null ? undefined : rowChunkList(data),
      mode,
      namespace,
      branch,
      metadata,
    });
  }

  public async createTableFromData({ name, data, mode = "create", namespace, branch, metadata }: {
    name: string;
    data?: DatabaseRows;
    mode?: CreateMode;
    namespace?: string[];
    branch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    return this.createTable({
      name,
      data: data == null ? undefined : rowChunkList(data),
      mode,
      namespace,
      branch,
      metadata,
    });
  }

  public async createTableFromDataStream({ name, chunks, schema, mode = "create", namespace, branch, metadata }: {
    name: string;
    chunks: DatabaseRowChunks;
    schema?: Record<string, DataType>;
    mode?: CreateMode;
    namespace?: string[];
    branch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    return this.createTable({ name, data: chunks, schema, mode, namespace, branch, metadata });
  }

  public async dropTable({ name, ignoreMissing = false, namespace, branch }: {
    name: string;
    ignoreMissing?: boolean;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "drop_table",
      input: {
        name,
        ignore_missing: ignoreMissing,
        namespace: namespace ?? null,
        branch: branch ?? null,
      },
    });
  }

  public async dropIndex({ table, name, namespace, branch }: {
    table: string;
    name: string;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "drop_index",
      input: { table, name, namespace: namespace ?? null, branch: branch ?? null },
    });
  }

  public async addColumns({ table, newColumns, namespace, branch }: {
    table: string;
    newColumns: Record<string, string | DataType>;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "add_columns",
      input: {
        table,
        columns: Object.entries(newColumns).map(([name, value]) => (
          value instanceof DataType
            ? { name, value_sql: null, data_type: toolkitDataTypeJson(value) }
            : { name, value_sql: value, data_type: null }
        )),
        namespace: namespace ?? null,
        branch: branch ?? null,
      },
    });
  }

  public async dropColumns({ table, columns, namespace, branch }: {
    table: string;
    columns: string[];
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "drop_columns",
      input: { table, columns, namespace: namespace ?? null, branch: branch ?? null },
    });
  }

  public async insert({ table, records, namespace, branch }: {
    table: string;
    records: DatabaseRows;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.insertStream({ table, chunks: rowChunkList(records), namespace, branch });
  }

  public async insertStream({ table, chunks, namespace, branch }: {
    table: string;
    chunks: DatabaseRowChunks;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    const input = new DatabaseWriteInputStream({
      kind: "start",
      table,
      namespace: namespace ?? null,
      branch: branch ?? null,
    }, chunks);
    await this.drainWriteStream("insert", input);
  }

  public async update({ table, where, values, namespace, branch }: {
    table: string;
    where: string;
    values: DatabaseRecord;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "update",
      input: {
        table,
        where,
        values: Object.entries(values).map(([column, value]) => ({ column, value_json: JSON.stringify(encodeRecordValue(value)) })),
        namespace: namespace ?? null,
        branch: branch ?? null,
      },
    });
  }

  public async delete({ table, where, namespace, branch }: {
    table: string;
    where: string;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "delete",
      input: { table, where, namespace: namespace ?? null, branch: branch ?? null },
    });
  }

  public async merge({ table, on, records, namespace, branch }: {
    table: string;
    on: string;
    records: DatabaseRows;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.mergeStream({ table, on, chunks: rowChunkList(records), namespace, branch });
  }

  public async mergeStream({ table, on, chunks, namespace, branch }: {
    table: string;
    on: string;
    chunks: DatabaseRowChunks;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    const input = new DatabaseWriteInputStream({
      kind: "start",
      table,
      on,
      namespace: namespace ?? null,
      branch: branch ?? null,
    }, chunks);
    await this.drainWriteStream("merge", input);
  }

  public async sql({ query, tables, params }: {
    query: string;
    tables: Array<TableRef | string>;
    params?: DatabaseRecord;
  }): Promise<DatabaseRows> {
    const rows: DatabaseRows = [];
    for await (const chunk of this.sqlStream({ query, tables, params })) {
      rows.push(...chunk);
    }
    return rows;
  }

  public async *sqlStream({ query, tables, params }: {
    query: string;
    tables: Array<TableRef | string>;
    params?: DatabaseRecord;
  }): AsyncIterable<DatabaseRows> {
    yield* this.streamRows("sql", {
      kind: "start",
      query,
      tables: normalizeTableRefs(tables),
      params_json: params == null ? null : JSON.stringify(encodeDatabaseRecord(params)),
    });
  }

  public async search({ table, text, vector, where, offset, limit, select, namespace, branch, version }: {
    table: string;
    text?: string;
    vector?: number[];
    where?: DatabaseWhere;
    offset?: number;
    limit?: number;
    select?: string[];
    namespace?: string[];
    branch?: string;
    version?: number;
  }): Promise<DatabaseRows> {
    const rows: DatabaseRows = [];
    for await (const chunk of this.searchStream({
      table,
      text,
      vector,
      where,
      offset,
      limit,
      select,
      namespace,
      branch,
      version,
    })) {
      rows.push(...chunk);
    }
    return rows;
  }

  public async *searchStream({ table, text, vector, where, offset, limit, select, namespace, branch, version }: {
    table: string;
    text?: string;
    vector?: number[];
    where?: DatabaseWhere;
    offset?: number;
    limit?: number;
    select?: string[];
    namespace?: string[];
    branch?: string;
    version?: number;
  }): AsyncIterable<DatabaseRows> {
    yield* this.streamRows("search", {
      kind: "start",
      table,
      text: text ?? null,
      vector: vector ?? null,
      text_columns: null,
      where: buildWhereClause(where),
      offset: offset ?? null,
      limit: limit ?? null,
      select: select ?? null,
      namespace: namespace ?? null,
      branch: branch ?? null,
      version: version ?? null,
    });
  }

  public async count({ table, text, vector, where, namespace, branch, version }: {
    table: string;
    text?: string;
    vector?: number[];
    where?: DatabaseWhere;
    namespace?: string[];
    branch?: string;
    version?: number;
  }): Promise<number> {
    const response = await this.invoke("count", {
      table,
      text: text ?? null,
      vector: vector ?? null,
      text_columns: null,
      where: buildWhereClause(where),
      namespace: namespace ?? null,
      branch: branch ?? null,
      version: version ?? null,
    });
    if (!(response instanceof JsonContent) || typeof response.json.count !== "number" || !Number.isInteger(response.json.count)) {
      throw this._unexpectedResponseError("count");
    }
    return response.json.count;
  }

  public async inspect({ table, namespace, branch, version }: {
    table: string;
    namespace?: string[];
    branch?: string;
    version?: number;
  }): Promise<Record<string, DataType>> {
    const response = await this.invoke("inspect", {
      table,
      namespace: namespace ?? null,
      branch: branch ?? null,
      version: version ?? null,
    });
    if (!(response instanceof JsonContent) || !Array.isArray(response.json.fields)) {
      throw this._unexpectedResponseError("inspect");
    }
    return Object.fromEntries(response.json.fields.map((field) => {
      if (!isRecord(field) || typeof field.name !== "string") {
        throw this._unexpectedResponseError("inspect");
      }
      return [field.name, DataType.fromJson(publicDataTypeJson(field.data_type))];
    }));
  }

  public async optimize(table: string): Promise<void>;
  public async optimize(params: { table: string; namespace?: string[]; branch?: string }): Promise<void>;
  public async optimize(tableOrParams: string | { table: string; namespace?: string[]; branch?: string }): Promise<void> {
    const table = typeof tableOrParams === "string" ? tableOrParams : tableOrParams.table;
    const namespace = typeof tableOrParams === "string" ? undefined : tableOrParams.namespace;
    const branch = typeof tableOrParams === "string" ? undefined : tableOrParams.branch;
    await this.room.invoke({
      toolkit: "database",
      tool: "optimize",
      input: { table, namespace: namespace ?? null, branch: branch ?? null },
    });
  }

  public async restore({ table, version, namespace, branch }: {
    table: string;
    version: number;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "restore",
      input: { table, version, namespace: namespace ?? null, branch: branch ?? null },
    });
  }

  public async listVersions({ table, namespace, branch }: {
    table: string;
    namespace?: string[];
    branch?: string;
  }): Promise<TableVersion[]> {
    const response = await this.invoke("list_versions", {
      table,
      namespace: namespace ?? null,
      branch: branch ?? null,
    });
    if (!(response instanceof JsonContent) || !Array.isArray(response.json.versions)) {
      throw this._unexpectedResponseError("list_versions");
    }
    return response.json.versions.map((version) => tableVersionFromJson(version));
  }

  public async createVectorIndex({ table, column, replace = false, namespace, branch }: {
    table: string;
    column: string;
    replace?: boolean;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "create_vector_index",
      input: { table, column, replace, namespace: namespace ?? null, branch: branch ?? null },
    });
  }

  public async createScalarIndex({ table, column, replace = false, namespace, branch }: {
    table: string;
    column: string;
    replace?: boolean;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "create_scalar_index",
      input: { table, column, replace, namespace: namespace ?? null, branch: branch ?? null },
    });
  }

  public async createFullTextSearchIndex({ table, column, replace = false, namespace, branch }: {
    table: string;
    column: string;
    replace?: boolean;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "create_full_text_search_index",
      input: { table, column, replace, namespace: namespace ?? null, branch: branch ?? null },
    });
  }

  public async listIndexes({ table, namespace, branch, version }: {
    table: string;
    namespace?: string[];
    branch?: string;
    version?: number;
  }): Promise<TableIndex[]> {
    const response = await this.invoke("list_indexes", {
      table,
      namespace: namespace ?? null,
      branch: branch ?? null,
      version: version ?? null,
    });
    if (!(response instanceof JsonContent) || !Array.isArray(response.json.indexes)) {
      throw this._unexpectedResponseError("list_indexes");
    }
    return response.json.indexes.map((index) => tableIndexFromJson(index));
  }

  public async listBranches({ namespace }: {
    namespace?: string[];
  } = {}): Promise<TableBranch[]> {
    const response = await this.invoke("list_branches", {
      namespace: namespace ?? null,
    });
    if (!(response instanceof JsonContent) || !Array.isArray(response.json.branches)) {
      throw this._unexpectedResponseError("list_branches");
    }
    return response.json.branches.map((branch) => tableBranchFromJson(branch));
  }

  public async createBranch({ branch, fromBranch, namespace }: {
    branch: string;
    fromBranch?: string;
    namespace?: string[];
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "create_branch",
      input: {
        branch,
        from_branch: fromBranch ?? null,
        namespace: namespace ?? null,
      },
    });
  }

  public async deleteBranch({ branch, namespace }: {
    branch: string;
    namespace?: string[];
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "database",
      tool: "delete_branch",
      input: { branch, namespace: namespace ?? null },
    });
  }
}
