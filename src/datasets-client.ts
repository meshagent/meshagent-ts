import { Schema, Table, tableFromIPC, tableToIPC } from "apache-arrow";
import { RoomClient } from "./room-client";
import { RoomServerException } from "./room-server-client";
import { BinaryContent, ControlContent, EmptyContent, ErrorContent, JsonContent, type Content } from "./response";

export type CreateMode = "create" | "overwrite" | "create_if_not_exists";
const ARROW_IPC_STREAM_MIME_TYPE = "application/vnd.apache.arrow.stream";

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

export interface DatasetSqlQuery {
  kind: "query";
  schema: Schema;
  queryId: string;
}

export interface DatasetSqlStatement {
  kind: "statement";
  rowsAffected: number;
}

export type DatasetSqlExecution = DatasetSqlQuery | DatasetSqlStatement;

export type DatasetSqlCancelStatus = "cancelled" | "cancelling" | "not_cancellable";

export interface DatasetSqlCancelResult {
  status: DatasetSqlCancelStatus;
}

export abstract class DatasetValueEncoder {
  public abstract encodeDatasetValue(): unknown;
}

export class DatasetExpression extends DatasetValueEncoder {
  public readonly expression: string;

  public constructor(expression: string) {
    super();
    const normalized = expression.trim();
    if (normalized === "") {
      throw new TypeError("dataset expression must not be empty");
    }
    this.expression = normalized;
  }

  public encodeDatasetValue(): Record<string, string> {
    return {
      expression: this.expression,
    };
  }

  public toString(): string {
    return this.expression;
  }
}

export class DatasetDate extends DatasetValueEncoder {
  public readonly value: string;

  public constructor(value: string) {
    super();
    const normalized = value.trim();
    const parsed = new Date(`${normalized}T00:00:00Z`);
    if (!ISO_DATE_REGEX.test(normalized) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
      throw new TypeError("invalid dataset date format");
    }
    this.value = normalized;
  }

  public encodeDatasetValue(): Record<string, string> {
    return {
      date: this.value,
    };
  }

  public toString(): string {
    return this.value;
  }
}

export type DatasetJsonScalarValue = null | boolean | number | string;
export type DatasetJsonValue =
  | DatasetJsonScalarValue
  | DatasetJsonValue[]
  | { [key: string]: DatasetJsonValue };

export class DatasetStruct extends DatasetValueEncoder {
  public readonly fields: Record<string, DatasetValue>;

  public constructor(fields: Record<string, DatasetValue>) {
    super();
    this.fields = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => {
        if (typeof key !== "string") {
          throw new TypeError("dataset struct keys must be strings");
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

  public encodeDatasetValue(): Record<string, Record<string, unknown>> {
    return {
      struct: this.toJson(),
    };
  }
}

export class DatasetJson extends DatasetValueEncoder {
  public readonly value: DatasetJsonValue;

  public constructor(value: DatasetJsonValue) {
    super();
    this.value = normalizeDatasetJsonValue(value);
  }

  public toJson(): DatasetJsonValue {
    return this.value;
  }

  public encodeDatasetValue(): Record<string, DatasetJsonValue> {
    return {
      json: this.value,
    };
  }
}

export type DatasetScalarValue = null | boolean | number | string | Uint8Array | DatasetUuid | Date;
export type DatasetValue =
  | DatasetScalarValue
  | DatasetValueEncoder
  | DatasetValue[];
export type DatasetRecord = Record<string, DatasetValue>;
export type DatasetRows = DatasetRecord[];
export type DatasetRowChunks = AsyncIterable<DatasetRows> | Iterable<DatasetRows>;
export type DatasetWhere = string | Record<string, DatasetValue>;

type DatasetRoomInvoker = Pick<RoomClient, "invoke" | "invokeStream">;

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

export class DatasetUuid {
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

function normalizeDatasetJsonValue(value: unknown): DatasetJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDatasetJsonValue(item));
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDatasetJsonValue(item)]),
    );
  }
  throw new TypeError("dataset json values must be valid JSON");
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

function encodeRecordValue(value: unknown): unknown {
  if (value instanceof DatasetValueEncoder) {
    return value.encodeDatasetValue();
  }
  if (value instanceof DatasetUuid) {
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
    throw new RoomServerException("dataset object values must use DatasetStruct or DatasetJson");
  }
  return value;
}

function datasetSqlLiteral(value: unknown): string {
  if (value instanceof DatasetUuid) {
    return `X'${normalizeUuidHex(value.toString())}'`;
  }
  if (value instanceof DatasetDate) {
    return JSON.stringify(value.toString());
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString().replace("+00:00", "Z"));
  }
  if (value instanceof DatasetJson) {
    return JSON.stringify(JSON.stringify(value.toJson()));
  }
  if (value instanceof DatasetStruct) {
    const fields = Object.entries(value.fields).map(([key, fieldValue]) => (
      `${JSON.stringify(key)}, ${datasetSqlLiteral(fieldValue)}`
    ));
    return `named_struct(${fields.join(", ")})`;
  }
  return JSON.stringify(encodeRecordValue(value));
}

function decodeRecordValue(value: unknown): DatasetValue {
  if (Array.isArray(value)) {
    throw new RoomServerException("dataset list values must use a {'list': [...]} wrapper");
  }
  if (!isRecord(value)) {
    return value as DatasetScalarValue;
  }

  const entries = Object.entries(value);
  if (entries.length !== 1) {
    throw new RoomServerException("dataset object values must use a single-key type wrapper");
  }

  const [wrapper, payload] = entries[0];
  switch (wrapper) {
    case "binary":
      if (typeof payload !== "string") {
        throw new RoomServerException("dataset binary values must be base64 strings");
      }
      return base64ToBytes(payload);
    case "uuid":
      if (typeof payload !== "string") {
        throw new RoomServerException("dataset uuid values must be strings");
      }
      return new DatasetUuid(payload);
    case "expression":
      if (typeof payload !== "string") {
        throw new RoomServerException("dataset expression values must be strings");
      }
      return new DatasetExpression(payload);
    case "date":
      if (typeof payload !== "string") {
        throw new RoomServerException("dataset date values must be strings");
      }
      return new DatasetDate(payload);
    case "timestamp":
      if (typeof payload !== "string") {
        throw new RoomServerException("dataset timestamp values must be strings");
      }
      {
        const parsed = new Date(payload);
        if (Number.isNaN(parsed.getTime())) {
          throw new RoomServerException("dataset timestamp value is not valid");
        }
        return parsed;
      }
    case "list":
      if (!Array.isArray(payload)) {
        throw new RoomServerException("dataset list values must be arrays");
      }
      return payload.map((item) => decodeRecordValue(item));
    case "struct":
      if (!isRecord(payload)) {
        throw new RoomServerException("dataset struct values must be objects");
      }
      return new DatasetStruct(
        Object.fromEntries(
          Object.entries(payload).map(([key, item]) => [key, decodeRecordValue(item)]),
        ) as DatasetRecord,
      );
    case "json":
      return new DatasetJson(normalizeDatasetJsonValue(payload));
    default:
      throw new RoomServerException(`unsupported dataset value wrapper '${wrapper}'`);
  }
}

function encodeDatasetRecord(record: DatasetRecord): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, encodeRecordValue(value)]),
  );
}

function rowsChunk(records: DatasetRows): RowChunkJson {
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

function recordsFromRowsChunk(payload: unknown, operation: string): DatasetRows {
  if (!isRecord(payload) || payload.kind !== "rows" || !Array.isArray(payload.rows)) {
    throw new RoomServerException(`unexpected return type from datasets.${operation}`);
  }

  return payload.rows.map((row) => {
    if (!isRecord(row) || !Array.isArray(row.columns)) {
      throw new RoomServerException(`unexpected return type from datasets.${operation}`);
    }
    return Object.fromEntries(row.columns.map((column) => {
      if (!isRecord(column) || typeof column.name !== "string") {
        throw new RoomServerException(`unexpected return type from datasets.${operation}`);
      }
      try {
        return [column.name, decodeRecordValue(column.value)];
      } catch {
        throw new RoomServerException(`unexpected return type from datasets.${operation}`);
      }
    })) as DatasetRecord;
  });
}

function rowChunkList(records: DatasetRows, rowsPerChunk = 128): DatasetRows[] {
  if (rowsPerChunk <= 0) {
    throw new RoomServerException("rowsPerChunk must be greater than zero");
  }
  const chunks: DatasetRows[] = [];
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

function buildWhereClause(where?: DatasetWhere): string | null {
  if (where != null && typeof where === "object" && !Array.isArray(where)) {
    return Object.entries(where)
      .map(([key, value]) => `${key} = ${datasetSqlLiteral(value)}`)
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
    throw new RoomServerException("unexpected return type from datasets.list_indexes");
  }
  return {
    name: value.name,
    type: value.type,
    columns: value.columns.map((column) => {
      if (typeof column !== "string") {
        throw new RoomServerException("unexpected return type from datasets.list_indexes");
      }
      return column;
    }),
  };
}

function tableVersionFromJson(value: unknown): TableVersion {
  if (!isRecord(value) || typeof value.metadata_json !== "string" || typeof value.timestamp !== "string" || typeof value.version !== "number") {
    throw new RoomServerException("unexpected return type from datasets.list_versions");
  }
  const timestamp = new Date(value.timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new RoomServerException("unexpected return type from datasets.list_versions");
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(value.metadata_json);
  } catch (_) {
    throw new RoomServerException("unexpected return type from datasets.list_versions");
  }
  if (!isRecord(metadata)) {
    throw new RoomServerException("unexpected return type from datasets.list_versions");
  }

  return {
    version: value.version,
    timestamp,
    metadata,
  };
}

function tableBranchFromJson(value: unknown): TableBranch {
  if (!isRecord(value) || typeof value.name !== "string") {
    throw new RoomServerException("unexpected return type from datasets.list_branches");
  }

  if (value.parent_branch != null && typeof value.parent_branch !== "string") {
    throw new RoomServerException("unexpected return type from datasets.list_branches");
  }
  if (
    value.parent_version != null
    && (typeof value.parent_version !== "number" || !Number.isInteger(value.parent_version))
  ) {
    throw new RoomServerException("unexpected return type from datasets.list_branches");
  }
  if (
    value.manifest_size != null
    && (typeof value.manifest_size !== "number" || !Number.isInteger(value.manifest_size))
  ) {
    throw new RoomServerException("unexpected return type from datasets.list_branches");
  }

  let createdAt: Date | null = null;
  if (value.created_at != null) {
    if (typeof value.created_at !== "string") {
      throw new RoomServerException("unexpected return type from datasets.list_branches");
    }
    createdAt = new Date(value.created_at);
    if (Number.isNaN(createdAt.getTime())) {
      throw new RoomServerException("unexpected return type from datasets.list_branches");
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

class DatasetWriteInputStream {
  private readonly source: AsyncIterator<DatasetRows>;
  private readonly pulls: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly start: Record<string, unknown>,
    chunks: DatasetRowChunks,
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

type ArrowTableChunks = Iterable<Table> | AsyncIterable<Table>;

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

function schemaFromIPCBytes(data: Uint8Array): Schema {
  return tableFromIPCBytes(data).schema;
}

class DatasetArrowWriteInputStream {
  private readonly source: AsyncIterator<Table>;
  private readonly pulls: Array<() => void> = [];
  private closed = false;

  constructor(
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

class DatasetReadInputStream {
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

class DatasetArrowReadInputStream {
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

export class DatasetsClient {
  private room: DatasetRoomInvoker;

  constructor({room}: {room: DatasetRoomInvoker}) {
    this.room = room;
  }

  private _unexpectedResponseError(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from datasets.${operation}`);
  }

  private async invoke(operation: string, input: Record<string, unknown>): Promise<JsonContent | null> {
    const response = await this.room.invoke({ toolkit: "dataset", tool: operation, input });
    if (response instanceof JsonContent) {
      return response;
    }
    if (response == null) {
      return null;
    }
    return null;
  }

  private async invokeContent(operation: string, input: Content): Promise<Content | null> {
    return await this.room.invoke({ toolkit: "dataset", tool: operation, input });
  }

  private async invokeStream(operation: string, input: AsyncIterable<Content>): Promise<AsyncIterable<Content>> {
    return await this.room.invokeStream({ toolkit: "dataset", tool: operation, input });
  }

  private async drainWriteStream(operation: string, input: DatasetWriteInputStream | DatasetArrowWriteInputStream): Promise<void> {
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
        if (chunk instanceof BinaryContent) {
          if (chunk.headers.kind !== "pull") {
            throw this._unexpectedResponseError(operation);
          }
          input.requestNext();
          continue;
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

  private async *streamRows(operation: string, start: Record<string, unknown>): AsyncIterable<DatasetRows> {
    const input = new DatasetReadInputStream(start);
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

  private async *streamArrow(operation: string, start: Record<string, unknown>): AsyncIterable<Table> {
    const input = new DatasetArrowReadInputStream(start);
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
        if (!(chunk instanceof BinaryContent) || chunk.headers.kind !== "data") {
          throw this._unexpectedResponseError(operation);
        }
        yield tableFromIPCBytes(chunk.data);
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
    data?: ArrowTableChunks;
    schema?: Schema;
    mode?: CreateMode;
    namespace?: string[];
    branch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const input = new DatasetArrowWriteInputStream(
      {
        kind: "start",
        name,
        mode,
        namespace: namespace ?? null,
        branch: branch ?? null,
        metadata: metadataEntries(metadata),
      },
      data ?? [],
      schema,
    );
    await this.drainWriteStream("create_table", input);
  }

  public async createTableWithSchema({ name, schema, data, mode = "create", namespace, branch, metadata }: {
    name: string;
    schema?: Schema;
    data?: Iterable<Table> | Table;
    mode?: CreateMode;
    namespace?: string[];
    branch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    return this.createTable({
      name,
      schema,
      data: data == null ? undefined : data instanceof Table ? [data] : data,
      mode,
      namespace,
      branch,
      metadata,
    });
  }

  public async createTableFromData({ name, data, mode = "create", namespace, branch, metadata }: {
    name: string;
    data?: Iterable<Table> | Table;
    mode?: CreateMode;
    namespace?: string[];
    branch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    return this.createTable({
      name,
      data: data == null ? undefined : data instanceof Table ? [data] : data,
      mode,
      namespace,
      branch,
      metadata,
    });
  }

  public async createTableFromDataStream({ name, chunks, schema, mode = "create", namespace, branch, metadata }: {
    name: string;
    chunks: ArrowTableChunks;
    schema?: Schema;
    mode?: CreateMode;
    namespace?: string[];
    branch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    return this.createTable({ name, data: chunks, schema, mode, namespace, branch, metadata });
  }

  public async createTableFromJsonData({ name, data, mode = "create", namespace, branch, metadata }: {
    name: string;
    data?: DatasetRows;
    mode?: CreateMode;
    namespace?: string[];
    branch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const input = new DatasetWriteInputStream(
      {
        kind: "start",
        name,
        mode,
        namespace: namespace ?? null,
        branch: branch ?? null,
        metadata: metadataEntries(metadata),
      },
      data == null ? [] : rowChunkList(data),
    );
    await this.drainWriteStream("create_table", input);
  }

  public async dropTable({ name, ignoreMissing = false, namespace, branch }: {
    name: string;
    ignoreMissing?: boolean;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "dataset",
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
      toolkit: "dataset",
      tool: "drop_index",
      input: { table, name, namespace: namespace ?? null, branch: branch ?? null },
    });
  }

  public async addColumns({ table, newColumns, namespace, branch }: {
    table: string;
    newColumns: Record<string, string> | Schema;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    if (newColumns instanceof Schema) {
      await this.invokeContent("add_columns", new BinaryContent({
        data: schemaToIPC(newColumns),
        headers: {
          table,
          namespace: namespace ?? null,
          branch: branch ?? null,
          content_type: ARROW_IPC_STREAM_MIME_TYPE,
        },
      }));
      return;
    }
    await this.room.invoke({
      toolkit: "dataset",
      tool: "add_columns",
      input: {
        table,
        columns: Object.entries(newColumns).map(([name, value]) => (
          { name, value_sql: value }
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
      toolkit: "dataset",
      tool: "drop_columns",
      input: { table, columns, namespace: namespace ?? null, branch: branch ?? null },
    });
  }

  public async insert({ table, records, namespace, branch }: {
    table: string;
    records: Table;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.insertStream({ table, chunks: [records], namespace, branch });
  }

  public async insertStream({ table, chunks, namespace, branch }: {
    table: string;
    chunks: ArrowTableChunks;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    const input = new DatasetArrowWriteInputStream({
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
    values: DatasetRecord;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.room.invoke({
      toolkit: "dataset",
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
      toolkit: "dataset",
      tool: "delete",
      input: { table, where, namespace: namespace ?? null, branch: branch ?? null },
    });
  }

  public async merge({ table, on, records, namespace, branch }: {
    table: string;
    on: string;
    records: Table;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    await this.mergeStream({ table, on, chunks: [records], namespace, branch });
  }

  public async mergeStream({ table, on, chunks, namespace, branch }: {
    table: string;
    on: string;
    chunks: ArrowTableChunks;
    namespace?: string[];
    branch?: string;
  }): Promise<void> {
    const input = new DatasetArrowWriteInputStream({
      kind: "start",
      table,
      on,
      namespace: namespace ?? null,
      branch: branch ?? null,
    }, chunks);
    await this.drainWriteStream("merge", input);
  }

  public async sql({ query, tables, params, namespace, branch }: {
    query: string;
    tables?: Array<TableRef | string>;
    params?: Table;
    namespace?: string[];
    branch?: string;
  }): Promise<Table[]> {
    const results: Table[] = [];
    for await (const chunk of this.sqlStream({ query, tables, params, namespace, branch })) {
      results.push(chunk);
    }
    return results;
  }

  public async openSqlQuery({ query, tables, params, namespace, branch }: {
    query: string;
    tables?: Array<TableRef | string>;
    params?: Table;
    namespace?: string[];
    branch?: string;
  }): Promise<DatasetSqlQuery> {
    const response = await this.invokeContent("open_sql_query", new BinaryContent({
      data: params == null ? new Uint8Array() : tableToIPC(params, "stream"),
      headers: {
        query,
        tables: normalizeTableRefs(tables ?? []),
        namespace: namespace ?? null,
        branch: branch ?? null,
      },
    }));
    if (!(response instanceof BinaryContent)) {
      throw this._unexpectedResponseError("open_sql_query");
    }
    const queryId = response.headers.query_id;
    if (typeof queryId !== "string" || queryId === "") {
      throw this._unexpectedResponseError("open_sql_query");
    }
    return {
      schema: schemaFromIPCBytes(response.data),
      kind: "query",
      queryId,
    };
  }

  public async executeSql({ query, tables, params, namespace, branch }: {
    query: string;
    tables?: Array<TableRef | string>;
    params?: Table;
    namespace?: string[];
    branch?: string;
  }): Promise<DatasetSqlExecution> {
    const response = await this.invokeContent("execute_sql", new BinaryContent({
      data: params == null ? new Uint8Array() : tableToIPC(params, "stream"),
      headers: {
        query,
        tables: normalizeTableRefs(tables ?? []),
        namespace: namespace ?? null,
        branch: branch ?? null,
      },
    }));
    if (response instanceof BinaryContent) {
      if (response.headers.kind !== "query") {
        throw this._unexpectedResponseError("execute_sql");
      }
      const queryId = response.headers.query_id;
      if (typeof queryId !== "string" || queryId === "") {
        throw this._unexpectedResponseError("execute_sql");
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
        throw this._unexpectedResponseError("execute_sql");
      }
      return {
        kind: "statement",
        rowsAffected: response.json.rows_affected,
      };
    }
    throw this._unexpectedResponseError("execute_sql");
  }

  public async *sqlStream({ query, tables, params, namespace, branch }: {
    query: string;
    tables?: Array<TableRef | string>;
    params?: Table;
    namespace?: string[];
    branch?: string;
  }): AsyncIterable<Table> {
    const result = await this.executeSql({ query, tables, params, namespace, branch });
    if (result.kind === "statement") {
      throw new RoomServerException(`SQL statement did not return rows; rows_affected=${result.rowsAffected}`);
    }
    const opened = result;
    try {
      yield* this.readSqlQuery({ queryId: opened.queryId });
    } finally {
      await this.closeSqlQuery({ queryId: opened.queryId });
    }
  }

  public async *readSqlQuery({ queryId }: { queryId: string }): AsyncIterable<Table> {
    yield* this.streamArrow("read_sql_query", {
      kind: "start",
      query_id: queryId,
    });
  }

  public async closeSqlQuery({ queryId }: { queryId: string }): Promise<void> {
    const response = await this.room.invoke({ toolkit: "dataset", tool: "close_sql_query", input: { query_id: queryId } });
    if (!(response instanceof EmptyContent)) {
      throw this._unexpectedResponseError("close_sql_query");
    }
  }

  public async cancelSqlQuery({ queryId }: { queryId: string }): Promise<DatasetSqlCancelResult> {
    const response = await this.room.invoke({ toolkit: "dataset", tool: "cancel_sql_query", input: { query_id: queryId } });
    if (!(response instanceof JsonContent)
      || !["cancelled", "cancelling", "not_cancellable"].includes(response.json.status as string)) {
      throw this._unexpectedResponseError("cancel_sql_query");
    }
    return { status: response.json.status as DatasetSqlCancelStatus };
  }

  public async executeSqlStatement({ query, tables, params, namespace, branch }: {
    query: string;
    tables?: Array<TableRef | string>;
    params?: Table;
    namespace?: string[];
    branch?: string;
  }): Promise<number> {
    const response = await this.invokeContent("execute_sql_statement", new BinaryContent({
      data: params == null ? new Uint8Array() : tableToIPC(params, "stream"),
      headers: {
        query,
        tables: normalizeTableRefs(tables ?? []),
        namespace: namespace ?? null,
        branch: branch ?? null,
      },
    }));
    if (!(response instanceof JsonContent)
      || typeof response.json.rows_affected !== "number"
      || !Number.isInteger(response.json.rows_affected)) {
      throw this._unexpectedResponseError("execute_sql_statement");
    }
    return response.json.rows_affected;
  }

  public async search({ table, text, vector, where, offset, limit, select, namespace, branch, version }: {
    table: string;
    text?: string;
    vector?: number[];
    where?: DatasetWhere;
    offset?: number;
    limit?: number;
    select?: string[];
    namespace?: string[];
    branch?: string;
    version?: number;
  }): Promise<Table[]> {
    const results: Table[] = [];
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
      results.push(chunk);
    }
    return results;
  }

  public async *searchStream({ table, text, vector, where, offset, limit, select, namespace, branch, version }: {
    table: string;
    text?: string;
    vector?: number[];
    where?: DatasetWhere;
    offset?: number;
    limit?: number;
    select?: string[];
    namespace?: string[];
    branch?: string;
    version?: number;
  }): AsyncIterable<Table> {
    yield* this.streamArrow("search", {
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
    where?: DatasetWhere;
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
  }): Promise<Schema> {
    const response = await this.room.invoke({
      toolkit: "dataset",
      tool: "inspect",
      input: {
      table,
      namespace: namespace ?? null,
      branch: branch ?? null,
      version: version ?? null,
      },
    });
    if (!(response instanceof BinaryContent)) {
      throw this._unexpectedResponseError("inspect");
    }
    return tableFromIPCBytes(response.data).schema;
  }

  public async optimize(table: string): Promise<void>;
  public async optimize(params: { table: string; namespace?: string[]; branch?: string }): Promise<void>;
  public async optimize(tableOrParams: string | { table: string; namespace?: string[]; branch?: string }): Promise<void> {
    const table = typeof tableOrParams === "string" ? tableOrParams : tableOrParams.table;
    const namespace = typeof tableOrParams === "string" ? undefined : tableOrParams.namespace;
    const branch = typeof tableOrParams === "string" ? undefined : tableOrParams.branch;
    await this.room.invoke({
      toolkit: "dataset",
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
      toolkit: "dataset",
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
      toolkit: "dataset",
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
      toolkit: "dataset",
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
      toolkit: "dataset",
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
      toolkit: "dataset",
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
      toolkit: "dataset",
      tool: "delete_branch",
      input: { branch, namespace: namespace ?? null },
    });
  }
}
