import { Completer } from "./completer.js";
import { EventEmitter } from "./event-emitter.js";
import { MeshSchema } from "./schema.js";
import { BinaryContent, ControlContent, ErrorContent, type Content } from "./response.js";
import { RoomClient } from "./room-client.js";
import { MeshDocument, RoomServerException } from "./room-server-client.js";
import { applyBackendChanges, unregisterDocument } from "./runtime.js";
import { decoder, encoder, RefCount } from "./utils.js";

function normalizeSyncPath(path: string): string {
  let normalized = path;
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  while (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }
  if (normalized === ".") {
    return "";
  }
  return normalized;
}

type SyncOpenStateChunkHeaders = {
  kind: "state";
  path: string;
  schema: Record<string, unknown>;
};

type SyncOpenOutputChunkHeaders = {
  kind: "state" | "sync";
  path: string;
};

type SyncOpenDocumentConfig = {
  create: boolean;
  schemaJson: Record<string, unknown> | null;
  schemaPath: string | null;
};

function parseSyncOpenStateChunkHeaders(headers: Record<string, unknown>): SyncOpenStateChunkHeaders {
  if (
    headers["kind"] !== "state" ||
    typeof headers["path"] !== "string" ||
    typeof headers["schema"] !== "object" ||
    headers["schema"] == null ||
    Array.isArray(headers["schema"])
  ) {
    throw new RoomServerException("unexpected return type from sync.open");
  }
  return {
    kind: "state",
    path: headers["path"],
    schema: headers["schema"] as Record<string, unknown>,
  };
}

function parseSyncOpenOutputChunkHeaders(headers: Record<string, unknown>): SyncOpenOutputChunkHeaders {
  const kind = headers["kind"];
  if ((kind !== "state" && kind !== "sync") || typeof headers["path"] !== "string") {
    throw new RoomServerException("unexpected return type from sync.open");
  }
  return {
    kind,
    path: headers["path"],
  };
}

class SyncOpenStreamState {
  private static readonly INPUT_STREAM_CLOSE = Symbol("sync-open-input-close");

  private readonly _inputQueue: Array<BinaryContent | symbol> = [];
  private readonly _inputWaiters: Array<(chunk: BinaryContent | symbol) => void> = [];
  private _inputClosed = false;
  private _task?: Promise<void>;
  private _error?: unknown;

  constructor(
    private readonly params: {
      path: string;
      create: boolean;
      vector: string | null;
      schemaJson: Record<string, unknown> | null;
      schemaPath: string | null;
      initialJson: Record<string, unknown> | null;
    },
  ) {}

  private _enqueueChunk(chunk: BinaryContent | symbol): void {
    const waiter = this._inputWaiters.shift();
    if (waiter != null) {
      waiter(chunk);
      return;
    }
    this._inputQueue.push(chunk);
  }

  private _nextChunk(): Promise<BinaryContent | symbol> {
    const queued = this._inputQueue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      this._inputWaiters.push(resolve);
    });
  }

  public async *inputStream(): AsyncGenerator<Content> {
    yield new BinaryContent({
      data: new Uint8Array(),
      headers: {
        kind: "start",
        path: this.params.path,
        create: this.params.create,
        vector: this.params.vector,
        schema: this.params.schemaJson,
        schema_path: this.params.schemaPath,
        initial_json: this.params.initialJson,
      },
    });

    while (true) {
      const chunk = await this._nextChunk();
      if (chunk === SyncOpenStreamState.INPUT_STREAM_CLOSE) {
        return;
      }
      yield chunk as BinaryContent;
    }
  }

  public attachTask(task: Promise<void>): void {
    this._task = task
      .catch((error: unknown) => {
        this._error = error;
        throw error;
      })
      .finally(() => {
        this.closeInputStream();
      });
    void this._task.catch(() => undefined);
  }

  public closeInputStream(): void {
    if (this._inputClosed) {
      return;
    }
    this._inputClosed = true;
    this._enqueueChunk(SyncOpenStreamState.INPUT_STREAM_CLOSE);
  }

  public queueSync(data: Uint8Array): void {
    if (this._error instanceof Error) {
      throw this._error;
    }
    if (this._error !== undefined) {
      throw new RoomServerException(`sync stream failed: ${String(this._error)}`);
    }
    if (this._inputClosed) {
      throw new RoomServerException("attempted to sync to a document that is not connected");
    }
    this._enqueueChunk(
      new BinaryContent({
        data,
        headers: { kind: "sync" },
      }),
    );
  }

  public async wait(): Promise<void> {
    await this._task;
  }
}

type SyncOpenResult = {
  streamState: SyncOpenStreamState;
  iterator: AsyncIterator<Content>;
  stateHeaders: SyncOpenStateChunkHeaders;
  firstChunk: BinaryContent;
};

export interface SyncClientEvent {
  type: string;
  doc?: MeshDocument;
}

export class SyncClient extends EventEmitter<SyncClientEvent> {
  private readonly room: RoomClient;
  private readonly _connectingDocuments: Record<string, Promise<RefCount<MeshDocument>>> = {};
  private readonly _closingDocuments: Record<string, Promise<void>> = {};
  private readonly _connectedDocuments: Record<string, RefCount<MeshDocument>> = {};
  private readonly _documentStreams: Record<string, SyncOpenStreamState> = {};
  private readonly _documentConfigs: Record<string, SyncOpenDocumentConfig> = {};
  private _started = false;

  constructor({ room }: { room: RoomClient }) {
    super();
    this.room = room;
  }

  public start(): void {
    if (this._started) {
      throw new RoomServerException("client already started");
    }
    this._started = true;
  }

  public override dispose(): void {
    super.dispose();
    for (const streamState of Object.values(this._documentStreams)) {
      streamState.closeInputStream();
    }
    for (const doc of Object.values(this._connectedDocuments)) {
      unregisterDocument(doc.ref.id);
    }
    Object.keys(this._documentStreams).forEach((key) => delete this._documentStreams[key]);
    Object.keys(this._documentConfigs).forEach((key) => delete this._documentConfigs[key]);
    Object.keys(this._connectedDocuments).forEach((key) => delete this._connectedDocuments[key]);
    Object.keys(this._connectingDocuments).forEach((key) => delete this._connectingDocuments[key]);
    Object.keys(this._closingDocuments).forEach((key) => delete this._closingDocuments[key]);
    this._started = false;
  }

  private _unexpectedResponseError(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from sync.${operation}`);
  }

  private async _invoke(operation: string, input: Record<string, unknown> | Content): Promise<Content> {
    return await this.room.invoke({
      toolkit: "sync",
      tool: operation,
      input,
    });
  }

  private _applySyncPayload(rc: RefCount<MeshDocument>, payload: Uint8Array): void {
    if (payload.length > 0) {
      applyBackendChanges(rc.ref.id, decoder.decode(payload));
    }
    if (!rc.ref.isSynchronized) {
      rc.ref.setSynchronizedComplete();
    }
  }

  public async create(path: string, json?: Record<string, unknown>): Promise<void> {
    const normalizedPath = normalizeSyncPath(path);
    await this._invoke("create", {
      path: normalizedPath,
      json: json ?? null,
      schema: null,
      schema_path: null,
    });
  }

  public async open(
    path: string,
    {
      create = true,
      initialJson,
      schema,
    }: {
      create?: boolean;
      initialJson?: Record<string, unknown>;
      schema?: MeshSchema;
    } = {},
  ): Promise<MeshDocument> {
    const normalizedPath = normalizeSyncPath(path);
    const closing = this._closingDocuments[normalizedPath];
    if (closing != null) {
      await closing;
    }

    const pending = this._connectingDocuments[normalizedPath];
    if (pending != null) {
      await pending;
    }

    const connected = this._connectedDocuments[normalizedPath];
    if (connected != null) {
      connected.count += 1;
      return connected.ref;
    }

    const connecting = new Completer<RefCount<MeshDocument>>();
    this._connectingDocuments[normalizedPath] = connecting.fut;

    try {
      const config: SyncOpenDocumentConfig = {
        create,
        schemaJson: schema?.toJson() ?? null,
        schemaPath: null,
      };
      const openResult = await this._openStream({
        path: normalizedPath,
        config,
        vector: null,
        initialJson: initialJson ?? null,
      });
      const resolvedSchema = MeshSchema.fromJson(openResult.stateHeaders.schema as Record<string, any>);
      const doc = new MeshDocument({
        schema: resolvedSchema,
        sendChangesToBackend: (base64: string) => {
          const currentStream = this._documentStreams[normalizedPath];
          if (currentStream == null) {
            return;
          }
          try {
            currentStream.queueSync(encoder.encode(base64));
          } catch {
          }
        },
      });
      const rc = new RefCount<MeshDocument>(doc);
      this._connectedDocuments[normalizedPath] = rc;
      this._documentConfigs[normalizedPath] = config;
      this._documentStreams[normalizedPath] = openResult.streamState;
      this._applySyncPayload(rc, openResult.firstChunk.data);
      this._attachStreamConsumer({
        path: normalizedPath,
        doc: rc,
        streamState: openResult.streamState,
        iterator: openResult.iterator,
      });

      this.emit("connected", { type: "connect", doc });
      connecting.complete(rc);
      await doc.synchronized;
      return doc;
    } catch (error) {
      connecting.completeError(error);
      throw error;
    } finally {
      delete this._connectingDocuments[normalizedPath];
    }
  }

  public async close(path: string): Promise<void> {
    const normalizedPath = normalizeSyncPath(path);
    const rc = this._connectedDocuments[normalizedPath];
    if (rc == null) {
      throw new RoomServerException(`Not connected to ${normalizedPath}`);
    }

    rc.count -= 1;
    if (rc.count === 0) {
      delete this._connectedDocuments[normalizedPath];
      delete this._documentConfigs[normalizedPath];
      const streamState = this._documentStreams[normalizedPath];
      delete this._documentStreams[normalizedPath];

      const closeFuture = (async () => {
        if (streamState != null) {
          streamState.closeInputStream();
          try {
            await streamState.wait();
          } finally {
            unregisterDocument(rc.ref.id);
          }
        } else {
          unregisterDocument(rc.ref.id);
        }
      })();

      this._closingDocuments[normalizedPath] = closeFuture;
      try {
        await closeFuture;
      } finally {
        if (this._closingDocuments[normalizedPath] === closeFuture) {
          delete this._closingDocuments[normalizedPath];
        }
      }
    }

    this.emit("closed", { type: "close", doc: rc.ref });
  }

  public async sync(path: string, data: Uint8Array): Promise<void> {
    const normalizedPath = normalizeSyncPath(path);
    if (this._connectedDocuments[normalizedPath] == null) {
      throw new RoomServerException("attempted to sync to a document that is not connected");
    }
    const streamState = this._documentStreams[normalizedPath];
    if (streamState == null) {
      throw new RoomServerException("attempted to sync to a document that is not connected");
    }
    streamState.queueSync(data);
  }

  private async _consumeOpenStream({
    path,
    rc,
    iterator,
    streamState,
  }: {
    path: string;
    rc: RefCount<MeshDocument>;
    iterator: AsyncIterator<Content>;
    streamState: SyncOpenStreamState;
  }): Promise<void> {
    try {
      while (true) {
        const next = await iterator.next();
        if (next.done || next.value === undefined) {
          return;
        }

        const chunk = next.value;
        if (chunk instanceof ErrorContent) {
          throw new RoomServerException(chunk.text, chunk.code);
        }
        if (chunk instanceof ControlContent) {
          if (chunk.method === "close") {
            return;
          }
          throw this._unexpectedResponseError("open");
        }
        if (!(chunk instanceof BinaryContent)) {
          throw this._unexpectedResponseError("open");
        }

        const headers = parseSyncOpenOutputChunkHeaders(chunk.headers as Record<string, unknown>);
        if (normalizeSyncPath(headers.path) !== path) {
          throw new RoomServerException("sync.open stream returned a mismatched path");
        }

        this._applySyncPayload(rc, chunk.data);
      }
    } finally {
      streamState.closeInputStream();
      await iterator.return?.();
    }
  }

  private async _openStream({
    path,
    config,
    vector,
    initialJson,
  }: {
    path: string;
    config: SyncOpenDocumentConfig;
    vector: string | null;
    initialJson: Record<string, unknown> | null;
  }): Promise<SyncOpenResult> {
    const streamState = new SyncOpenStreamState({
      path,
      create: config.create,
      vector,
      schemaJson: config.schemaJson,
      schemaPath: config.schemaPath,
      initialJson,
    });

    let iterator: AsyncIterator<Content> | undefined;
    try {
      const responseStream = await this.room.invokeStream({
        toolkit: "sync",
        tool: "open",
        input: streamState.inputStream(),
      });

      iterator = responseStream[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done || first.value === undefined) {
        throw new RoomServerException(
          "sync.open stream closed before the initial document state was returned",
        );
      }

      const firstChunk = first.value;
      if (firstChunk instanceof ErrorContent) {
        throw new RoomServerException(firstChunk.text, firstChunk.code);
      }
      if (!(firstChunk instanceof BinaryContent)) {
        throw this._unexpectedResponseError("open");
      }

      const stateHeaders = parseSyncOpenStateChunkHeaders(firstChunk.headers as Record<string, unknown>);
      if (normalizeSyncPath(stateHeaders.path) !== path) {
        throw new RoomServerException("sync.open stream returned a mismatched path");
      }

      return {
        streamState,
        iterator,
        stateHeaders,
        firstChunk,
      };
    } catch (error) {
      streamState.closeInputStream();
      if (iterator != null) {
        await iterator.return?.();
      }
      throw error;
    }
  }

  private _attachStreamConsumer({
    path,
    doc,
    streamState,
    iterator,
  }: {
    path: string;
    doc: RefCount<MeshDocument>;
    streamState: SyncOpenStreamState;
    iterator: AsyncIterator<Content>;
  }): void {
    streamState.attachTask(
      this._consumeOpenStream({
        path,
        rc: doc,
        iterator,
        streamState,
      }),
    );
  }

  public async _onRoomDisconnect(): Promise<void> {
    const openStreams = Object.values(this._documentStreams);
    Object.keys(this._documentStreams).forEach((key) => delete this._documentStreams[key]);
    for (const streamState of openStreams) {
      streamState.closeInputStream();
    }
  }

  public async _onRoomReconnect(): Promise<void> {
    for (const [path, ref] of Object.entries(this._connectedDocuments)) {
      const config = this._documentConfigs[path];
      if (config == null) {
        continue;
      }

      const openResult = await this._openStream({
        path,
        config,
        vector: ref.ref.getStateVector(),
        initialJson: null,
      });
      this._documentStreams[path] = openResult.streamState;
      this._applySyncPayload(ref, openResult.firstChunk.data);
      this._attachStreamConsumer({
        path,
        doc: ref,
        streamState: openResult.streamState,
        iterator: openResult.iterator,
      });
    }
  }
}
