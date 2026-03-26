import { EmptyContent, JsonContent } from "./response";
import { RoomClient } from "./room-client";
import { RoomServerException } from "./room-server-client";

export type MemoryIngestStrategy = "heuristic" | "llm";

export interface MemoryEntityRecord {
  entityId?: string | null;
  name: string;
  entityType?: string | null;
  context?: string | null;
  confidence?: number | null;
  createdAt?: string | null;
  validAt?: string | null;
  metadata?: Record<string, string> | null;
}

export interface MemoryRelationshipRecord {
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType?: string;
  description?: string | null;
  confidence?: number | null;
  createdAt?: string | null;
  validAt?: string | null;
  expiredAt?: string | null;
  invalidAt?: string | null;
  sourceEntityName?: string | null;
  targetEntityName?: string | null;
  metadata?: Record<string, string> | null;
}

export interface MemoryDatasetSummary {
  name: string;
  rows: number;
  columns: string[];
}

export interface MemoryDetails {
  name: string;
  namespace?: string[] | null;
  path: string;
  datasets: MemoryDatasetSummary[];
}

export interface MemoryIngestStats {
  entities: number;
  relationships: number;
  sources: number;
}

export interface MemoryIngestResult {
  name: string;
  stats: MemoryIngestStats;
  entityIds: string[];
}

export interface MemoryRecallRelationship {
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  description?: string | null;
  createdAt?: string | null;
  validAt?: string | null;
  expiredAt?: string | null;
  invalidAt?: string | null;
}

export interface MemoryRecallItem {
  entityId: string;
  name: string;
  entityType: string;
  context?: string | null;
  confidence?: number | null;
  createdAt?: string | null;
  validAt?: string | null;
  score: number;
  relationships: MemoryRecallRelationship[];
}

export interface MemoryRecallResult {
  name: string;
  query: string;
  items: MemoryRecallItem[];
}

export interface MemoryDeleteEntitiesResult {
  name: string;
  deletedEntities: number;
  deletedRelationships: number;
}

export interface MemoryRelationshipSelector {
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType?: string | null;
}

export interface MemoryDeleteRelationshipsResult {
  name: string;
  deletedRelationships: number;
}

export interface MemoryOptimizeDatasetStats {
  dataset: string;
  fragmentsAdded: number;
  fragmentsRemoved: number;
  filesAdded: number;
  filesRemoved: number;
  oldVersionsRemoved: number;
  bytesRemoved: number;
}

export interface MemoryOptimizeResult {
  name: string;
  datasets: MemoryOptimizeDatasetStats[];
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

function unexpectedResponse(operation: string): RoomServerException {
  return new RoomServerException(`unexpected return type from memory.${operation}`);
}

function requireString(value: unknown, operation: string): string {
  if (typeof value !== "string") {
    throw unexpectedResponse(operation);
  }
  return value;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toOptionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function toStringArray(value: unknown, operation: string): string[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw unexpectedResponse(operation);
  }
  return [...value];
}

function toStringMap(value: unknown, operation: string): Record<string, string> | undefined {
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  const metadata: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") {
      throw unexpectedResponse(operation);
    }
    metadata[key] = entryValue;
  }
  return metadata;
}

function encodeMemoryRecordValue(value: unknown): unknown {
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
    return value.map((item) => encodeMemoryRecordValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, encodeMemoryRecordValue(entryValue)]));
  }
  return value;
}

function decodeRowsValue(value: unknown, operation: string): unknown {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw unexpectedResponse(operation);
  }

  switch (value.type as TypedValue["type"]) {
    case "null":
      return null;
    case "bool":
      if (typeof value.value !== "boolean") {
        throw unexpectedResponse(operation);
      }
      return value.value;
    case "int":
      if (typeof value.value !== "number") {
        throw unexpectedResponse(operation);
      }
      return Math.trunc(value.value);
    case "float":
      if (typeof value.value !== "number") {
        throw unexpectedResponse(operation);
      }
      return value.value;
    case "text":
    case "date":
    case "timestamp":
      if (typeof value.value !== "string") {
        throw unexpectedResponse(operation);
      }
      return value.value;
    case "binary":
      if (typeof value.data !== "string") {
        throw unexpectedResponse(operation);
      }
      return base64ToBytes(value.data);
    case "list":
      if (!Array.isArray(value.items)) {
        throw unexpectedResponse(operation);
      }
      return value.items.map((item) => decodeRowsValue(item, operation));
    case "struct":
      if (!Array.isArray(value.fields)) {
        throw unexpectedResponse(operation);
      }
      return Object.fromEntries(value.fields.map((field) => {
        if (!isRecord(field) || typeof field.name !== "string") {
          throw unexpectedResponse(operation);
        }
        return [field.name, decodeRowsValue(field.value, operation)];
      }));
  }
}

function recordsFromRowsChunk(value: unknown, operation: string): Array<Record<string, unknown>> {
  if (!isRecord(value) || value.kind !== "rows" || !Array.isArray(value.rows)) {
    throw unexpectedResponse(operation);
  }

  return value.rows.map((row) => {
    if (!isRecord(row) || !Array.isArray(row.columns)) {
      throw unexpectedResponse(operation);
    }
    return Object.fromEntries(row.columns.map((column) => {
      if (!isRecord(column) || typeof column.name !== "string") {
        throw unexpectedResponse(operation);
      }
      return [column.name, decodeRowsValue(column.value, operation)];
    }));
  });
}

function parseMemoryEntityRecord(value: unknown, operation: string): MemoryEntityRecord {
  if (!isRecord(value) || typeof value.name !== "string") {
    throw unexpectedResponse(operation);
  }
  return {
    entityId: typeof value.entity_id === "string" ? value.entity_id : null,
    name: value.name,
    entityType: typeof value.entity_type === "string" ? value.entity_type : null,
    context: typeof value.context === "string" ? value.context : null,
    confidence: toOptionalNumber(value.confidence) ?? null,
    createdAt: typeof value.created_at === "string" ? value.created_at : null,
    validAt: typeof value.valid_at === "string" ? value.valid_at : null,
    metadata: toStringMap(value.metadata, operation) ?? null,
  };
}

function memoryEntityRecordJson(record: MemoryEntityRecord): Record<string, unknown> {
  return {
    entity_id: record.entityId ?? null,
    name: record.name,
    entity_type: record.entityType ?? null,
    context: record.context ?? null,
    confidence: record.confidence ?? null,
    created_at: record.createdAt ?? null,
    valid_at: record.validAt ?? null,
    metadata: record.metadata ?? null,
  };
}

function parseMemoryRelationshipRecord(value: unknown, operation: string): MemoryRelationshipRecord {
  if (!isRecord(value) || typeof value.source_entity_id !== "string" || typeof value.target_entity_id !== "string") {
    throw unexpectedResponse(operation);
  }
  return {
    sourceEntityId: value.source_entity_id,
    targetEntityId: value.target_entity_id,
    relationshipType: typeof value.relationship_type === "string" && value.relationship_type.length > 0 ? value.relationship_type : "RELATED_TO",
    description: typeof value.description === "string" ? value.description : null,
    confidence: toOptionalNumber(value.confidence) ?? null,
    createdAt: typeof value.created_at === "string" ? value.created_at : null,
    validAt: typeof value.valid_at === "string" ? value.valid_at : null,
    expiredAt: typeof value.expired_at === "string" ? value.expired_at : null,
    invalidAt: typeof value.invalid_at === "string" ? value.invalid_at : null,
    sourceEntityName: typeof value.source_entity_name === "string" ? value.source_entity_name : null,
    targetEntityName: typeof value.target_entity_name === "string" ? value.target_entity_name : null,
    metadata: toStringMap(value.metadata, operation) ?? null,
  };
}

function memoryRelationshipRecordJson(record: MemoryRelationshipRecord): Record<string, unknown> {
  return {
    source_entity_id: record.sourceEntityId,
    target_entity_id: record.targetEntityId,
    relationship_type: record.relationshipType ?? "RELATED_TO",
    description: record.description ?? null,
    confidence: record.confidence ?? null,
    created_at: record.createdAt ?? null,
    valid_at: record.validAt ?? null,
    expired_at: record.expiredAt ?? null,
    invalid_at: record.invalidAt ?? null,
    source_entity_name: record.sourceEntityName ?? null,
    target_entity_name: record.targetEntityName ?? null,
    metadata: record.metadata ?? null,
  };
}

function parseMemoryDatasetSummary(value: unknown, operation: string): MemoryDatasetSummary {
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  return {
    name: requireString(value.name, operation),
    rows: toOptionalInteger(value.rows) ?? 0,
    columns: toStringArray(value.columns, operation) ?? [],
  };
}

function parseMemoryDetails(value: unknown, operation: string): MemoryDetails {
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  const datasets = value.datasets;
  if (datasets != null && !Array.isArray(datasets)) {
    throw unexpectedResponse(operation);
  }

  return {
    name: requireString(value.name, operation),
    namespace: toStringArray(value.namespace, operation) ?? null,
    path: requireString(value.path, operation),
    datasets: (datasets ?? []).map((entry) => parseMemoryDatasetSummary(entry, operation)),
  };
}

function parseMemoryIngestStats(value: unknown, operation: string): MemoryIngestStats {
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  return {
    entities: toOptionalInteger(value.entities) ?? 0,
    relationships: toOptionalInteger(value.relationships) ?? 0,
    sources: toOptionalInteger(value.sources) ?? 0,
  };
}

function parseMemoryIngestResult(value: unknown, operation: string): MemoryIngestResult {
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  return {
    name: requireString(value.name, operation),
    stats: parseMemoryIngestStats(value.stats, operation),
    entityIds: toStringArray(value.entity_ids, operation) ?? [],
  };
}

function parseMemoryRecallRelationship(value: unknown, operation: string): MemoryRecallRelationship {
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  return {
    sourceEntityId: requireString(value.source_entity_id, operation),
    targetEntityId: requireString(value.target_entity_id, operation),
    relationshipType: requireString(value.relationship_type, operation),
    description: typeof value.description === "string" ? value.description : null,
    createdAt: typeof value.created_at === "string" ? value.created_at : null,
    validAt: typeof value.valid_at === "string" ? value.valid_at : null,
    expiredAt: typeof value.expired_at === "string" ? value.expired_at : null,
    invalidAt: typeof value.invalid_at === "string" ? value.invalid_at : null,
  };
}

function parseMemoryRecallItem(value: unknown, operation: string): MemoryRecallItem {
  if (!isRecord(value) || typeof value.score !== "number") {
    throw unexpectedResponse(operation);
  }
  const relationships = value.relationships;
  if (relationships != null && !Array.isArray(relationships)) {
    throw unexpectedResponse(operation);
  }

  return {
    entityId: requireString(value.entity_id, operation),
    name: requireString(value.name, operation),
    entityType: requireString(value.entity_type, operation),
    context: typeof value.context === "string" ? value.context : null,
    confidence: toOptionalNumber(value.confidence) ?? null,
    createdAt: typeof value.created_at === "string" ? value.created_at : null,
    validAt: typeof value.valid_at === "string" ? value.valid_at : null,
    score: value.score,
    relationships: (relationships ?? []).map((entry) => parseMemoryRecallRelationship(entry, operation)),
  };
}

function parseMemoryRecallResult(value: unknown, operation: string): MemoryRecallResult {
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  const items = value.items;
  if (items != null && !Array.isArray(items)) {
    throw unexpectedResponse(operation);
  }

  return {
    name: requireString(value.name, operation),
    query: requireString(value.query, operation),
    items: (items ?? []).map((entry) => parseMemoryRecallItem(entry, operation)),
  };
}

function parseDeleteEntitiesResult(value: unknown, operation: string): MemoryDeleteEntitiesResult {
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  return {
    name: requireString(value.name, operation),
    deletedEntities: toOptionalInteger(value.deleted_entities) ?? 0,
    deletedRelationships: toOptionalInteger(value.deleted_relationships) ?? 0,
  };
}

function parseRelationshipSelector(value: unknown, operation: string): MemoryRelationshipSelector {
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  return {
    sourceEntityId: requireString(value.source_entity_id, operation),
    targetEntityId: requireString(value.target_entity_id, operation),
    relationshipType: typeof value.relationship_type === "string" ? value.relationship_type : null,
  };
}

function relationshipSelectorJson(selector: MemoryRelationshipSelector): Record<string, unknown> {
  return {
    source_entity_id: selector.sourceEntityId,
    target_entity_id: selector.targetEntityId,
    relationship_type: selector.relationshipType ?? null,
  };
}

function parseDeleteRelationshipsResult(value: unknown, operation: string): MemoryDeleteRelationshipsResult {
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  return {
    name: requireString(value.name, operation),
    deletedRelationships: toOptionalInteger(value.deleted_relationships) ?? 0,
  };
}

function parseOptimizeDatasetStats(value: unknown, operation: string): MemoryOptimizeDatasetStats {
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  return {
    dataset: requireString(value.dataset, operation),
    fragmentsAdded: toOptionalInteger(value.fragments_added) ?? 0,
    fragmentsRemoved: toOptionalInteger(value.fragments_removed) ?? 0,
    filesAdded: toOptionalInteger(value.files_added) ?? 0,
    filesRemoved: toOptionalInteger(value.files_removed) ?? 0,
    oldVersionsRemoved: toOptionalInteger(value.old_versions_removed) ?? 0,
    bytesRemoved: toOptionalInteger(value.bytes_removed) ?? 0,
  };
}

function parseOptimizeResult(value: unknown, operation: string): MemoryOptimizeResult {
  if (!isRecord(value)) {
    throw unexpectedResponse(operation);
  }
  const datasets = value.datasets;
  if (datasets != null && !Array.isArray(datasets)) {
    throw unexpectedResponse(operation);
  }

  return {
    name: requireString(value.name, operation),
    datasets: (datasets ?? []).map((entry) => parseOptimizeDatasetStats(entry, operation)),
  };
}

export class MemoryClient {
  private readonly room: RoomClient;

  constructor({ room }: { room: RoomClient }) {
    this.room = room;
  }

  private unexpectedResponse(operation: string): RoomServerException {
    return unexpectedResponse(operation);
  }

  private async invoke(operation: string, input: Record<string, unknown>): Promise<JsonContent | null> {
    const response = await this.room.invoke({
      toolkit: "memory",
      tool: operation,
      input,
    });

    if (response instanceof JsonContent) {
      return response;
    }
    if (response instanceof EmptyContent) {
      return null;
    }

    throw this.unexpectedResponse(operation);
  }

  private expectJsonResponse(response: JsonContent | null, operation: string): JsonContent {
    if (!(response instanceof JsonContent)) {
      throw this.unexpectedResponse(operation);
    }
    return response;
  }

  public async list(params?: { namespace?: string[] | null }): Promise<string[]> {
    const response = this.expectJsonResponse(await this.invoke("list", {
      namespace: params?.namespace ?? null,
    }), "list");

    const memories = response.json["memories"];
    if (!Array.isArray(memories)) {
      return [];
    }

    return memories.filter((value): value is string => typeof value === "string");
  }

  public async create(params: {
    name: string;
    namespace?: string[] | null;
    overwrite?: boolean;
    ignoreExists?: boolean;
  }): Promise<void> {
    await this.invoke("create", {
      name: params.name,
      namespace: params.namespace ?? null,
      overwrite: params.overwrite ?? false,
      ignore_exists: params.ignoreExists ?? false,
    });
  }

  public async drop(params: {
    name: string;
    namespace?: string[] | null;
    ignoreMissing?: boolean;
  }): Promise<void> {
    await this.invoke("drop", {
      name: params.name,
      namespace: params.namespace ?? null,
      ignore_missing: params.ignoreMissing ?? false,
    });
  }

  public async inspect(params: {
    name: string;
    namespace?: string[] | null;
  }): Promise<MemoryDetails> {
    const response = this.expectJsonResponse(await this.invoke("inspect", {
      name: params.name,
      namespace: params.namespace ?? null,
    }), "inspect");
    return parseMemoryDetails(response.json, "inspect");
  }

  public async query(params: {
    name: string;
    statement: string;
    namespace?: string[] | null;
  }): Promise<Array<Record<string, unknown>>> {
    const response = this.expectJsonResponse(await this.invoke("query", {
      name: params.name,
      namespace: params.namespace ?? null,
      statement: params.statement,
    }), "query");

    const results = response.json["results"];
    if (Array.isArray(results)) {
      return results.map((entry) => {
        if (!isRecord(entry)) {
          throw this.unexpectedResponse("query");
        }
        return { ...entry };
      });
    }

    return recordsFromRowsChunk(response.json, "query");
  }

  public async upsertTable(params: {
    name: string;
    table: string;
    records: Array<Record<string, unknown>>;
    namespace?: string[] | null;
    merge?: boolean;
  }): Promise<void> {
    await this.invoke("upsert_table", {
      name: params.name,
      namespace: params.namespace ?? null,
      table: params.table,
      records_json: JSON.stringify(encodeMemoryRecordValue(params.records)),
      merge: params.merge ?? true,
    });
  }

  public async upsertNodes(params: {
    name: string;
    records: MemoryEntityRecord[];
    namespace?: string[] | null;
    merge?: boolean;
  }): Promise<void> {
    await this.invoke("upsert_nodes", {
      name: params.name,
      namespace: params.namespace ?? null,
      records_json: JSON.stringify(params.records.map((record) => memoryEntityRecordJson(record))),
      merge: params.merge ?? true,
    });
  }

  public async upsertRelationships(params: {
    name: string;
    records: MemoryRelationshipRecord[];
    namespace?: string[] | null;
    merge?: boolean;
  }): Promise<void> {
    await this.invoke("upsert_relationships", {
      name: params.name,
      namespace: params.namespace ?? null,
      records_json: JSON.stringify(params.records.map((record) => memoryRelationshipRecordJson(record))),
      merge: params.merge ?? true,
    });
  }

  public async ingestText(params: {
    name: string;
    text: string;
    namespace?: string[] | null;
    strategy?: MemoryIngestStrategy;
    llmModel?: string | null;
    llmTemperature?: number | null;
  }): Promise<MemoryIngestResult> {
    const response = this.expectJsonResponse(await this.invoke("ingest_text", {
      name: params.name,
      namespace: params.namespace ?? null,
      text: params.text,
      strategy: params.strategy ?? "heuristic",
      llm_model: params.llmModel ?? null,
      llm_temperature: params.llmTemperature ?? null,
    }), "ingest_text");
    return parseMemoryIngestResult(response.json, "ingest_text");
  }

  public async ingestImage(params: {
    name: string;
    caption?: string | null;
    data?: Uint8Array | null;
    mimeType?: string | null;
    source?: string | null;
    annotations?: Record<string, string> | null;
    namespace?: string[] | null;
    strategy?: MemoryIngestStrategy;
    llmModel?: string | null;
    llmTemperature?: number | null;
  }): Promise<MemoryIngestResult> {
    const response = this.expectJsonResponse(await this.invoke("ingest_image", {
      name: params.name,
      namespace: params.namespace ?? null,
      caption: params.caption ?? null,
      data_base64: params.data != null ? bytesToBase64(params.data) : null,
      mime_type: params.mimeType ?? null,
      source: params.source ?? null,
      annotations_json: params.annotations != null ? JSON.stringify(params.annotations) : null,
      strategy: params.strategy ?? "heuristic",
      llm_model: params.llmModel ?? null,
      llm_temperature: params.llmTemperature ?? null,
    }), "ingest_image");
    return parseMemoryIngestResult(response.json, "ingest_image");
  }

  public async ingestFile(params: {
    name: string;
    path?: string | null;
    text?: string | null;
    mimeType?: string | null;
    namespace?: string[] | null;
    strategy?: MemoryIngestStrategy;
    llmModel?: string | null;
    llmTemperature?: number | null;
  }): Promise<MemoryIngestResult> {
    const response = this.expectJsonResponse(await this.invoke("ingest_file", {
      name: params.name,
      namespace: params.namespace ?? null,
      path: params.path ?? null,
      text: params.text ?? null,
      mime_type: params.mimeType ?? null,
      strategy: params.strategy ?? "heuristic",
      llm_model: params.llmModel ?? null,
      llm_temperature: params.llmTemperature ?? null,
    }), "ingest_file");
    return parseMemoryIngestResult(response.json, "ingest_file");
  }

  public async ingestFromTable(params: {
    name: string;
    table: string;
    textColumns?: string[] | null;
    tableNamespace?: string[] | null;
    limit?: number | null;
    namespace?: string[] | null;
    strategy?: MemoryIngestStrategy;
    llmModel?: string | null;
    llmTemperature?: number | null;
  }): Promise<MemoryIngestResult> {
    const response = this.expectJsonResponse(await this.invoke("ingest_from_table", {
      name: params.name,
      namespace: params.namespace ?? null,
      table: params.table,
      text_columns: params.textColumns ?? null,
      table_namespace: params.tableNamespace ?? null,
      limit: params.limit ?? null,
      strategy: params.strategy ?? "heuristic",
      llm_model: params.llmModel ?? null,
      llm_temperature: params.llmTemperature ?? null,
    }), "ingest_from_table");
    return parseMemoryIngestResult(response.json, "ingest_from_table");
  }

  public async ingestFromStorage(params: {
    name: string;
    paths: string[];
    namespace?: string[] | null;
    strategy?: MemoryIngestStrategy;
    llmModel?: string | null;
    llmTemperature?: number | null;
  }): Promise<MemoryIngestResult> {
    const response = this.expectJsonResponse(await this.invoke("ingest_from_storage", {
      name: params.name,
      namespace: params.namespace ?? null,
      paths: params.paths,
      strategy: params.strategy ?? "heuristic",
      llm_model: params.llmModel ?? null,
      llm_temperature: params.llmTemperature ?? null,
    }), "ingest_from_storage");
    return parseMemoryIngestResult(response.json, "ingest_from_storage");
  }

  public async recall(params: {
    name: string;
    query: string;
    namespace?: string[] | null;
    limit?: number;
    includeRelationships?: boolean;
  }): Promise<MemoryRecallResult> {
    const response = this.expectJsonResponse(await this.invoke("recall", {
      name: params.name,
      namespace: params.namespace ?? null,
      query: params.query,
      limit: params.limit ?? 5,
      include_relationships: params.includeRelationships ?? true,
    }), "recall");
    return parseMemoryRecallResult(response.json, "recall");
  }

  public async deleteEntities(params: {
    name: string;
    entityIds: string[];
    namespace?: string[] | null;
  }): Promise<MemoryDeleteEntitiesResult> {
    const response = this.expectJsonResponse(await this.invoke("delete_entities", {
      name: params.name,
      namespace: params.namespace ?? null,
      entity_ids: params.entityIds,
    }), "delete_entities");
    return parseDeleteEntitiesResult(response.json, "delete_entities");
  }

  public async deleteRelationships(params: {
    name: string;
    relationships: MemoryRelationshipSelector[];
    namespace?: string[] | null;
  }): Promise<MemoryDeleteRelationshipsResult> {
    const response = this.expectJsonResponse(await this.invoke("delete_relationships", {
      name: params.name,
      namespace: params.namespace ?? null,
      relationships: params.relationships.map((relationship) => relationshipSelectorJson(relationship)),
    }), "delete_relationships");
    return parseDeleteRelationshipsResult(response.json, "delete_relationships");
  }

  public async optimize(params: {
    name: string;
    namespace?: string[] | null;
    compact?: boolean;
    cleanup?: boolean;
  }): Promise<MemoryOptimizeResult> {
    const response = this.expectJsonResponse(await this.invoke("optimize", {
      name: params.name,
      namespace: params.namespace ?? null,
      compact: params.compact ?? true,
      cleanup: params.cleanup ?? true,
    }), "optimize");
    return parseOptimizeResult(response.json, "optimize");
  }
}
