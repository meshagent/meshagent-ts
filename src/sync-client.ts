import { EventEmitter } from "./event-emitter";
import { RoomClient } from "./room-client";
import { Protocol } from "./protocol";
import { MeshSchema } from "./schema";
import { MeshDocument, RoomServerException } from "./room-server-client";
import { BinaryContent, Content, ControlContent, ErrorContent } from "./response";
import { decoder, encoder, RefCount, unpackMessage } from "./utils";
import { unregisterDocument, applyBackendChanges } from "./runtime";
import { Completer } from "./completer";

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
  schema: Record<string, any>;
};

type SyncOpenOutputChunkHeaders = {
  kind: "state" | "sync";
  path: string;
};

function parseSyncOpenStateChunkHeaders(headers: Record<string, any>): SyncOpenStateChunkHeaders {
  if (
    headers["kind"] !== "state" ||
    typeof headers["path"] !== "string" ||
    typeof headers["schema"] !== "object" ||
    headers["schema"] == null
  ) {
    throw new RoomServerException("unexpected return type from sync.open");
  }
  return {
    kind: "state",
    path: headers["path"],
    schema: headers["schema"] as Record<string, any>,
  };
}

function parseSyncOpenOutputChunkHeaders(headers: Record<string, any>): SyncOpenOutputChunkHeaders {
  const kind = headers["kind"];
  if (
    (kind !== "state" && kind !== "sync") ||
    typeof headers["path"] !== "string"
  ) {
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
      schemaJson: Record<string, any> | null;
      schemaPath: string | null;
      initialJson: Record<string, any> | null;
    },
  ) {}

  private _enqueueChunk(chunk: BinaryContent | symbol): void {
    const waiter = this._inputWaiters.shift();
    if (waiter) {
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
    this._enqueueChunk(new BinaryContent({
      data,
      headers: { kind: "sync" },
    }));
  }

  public async wait(): Promise<void> {
    await this._task;
  }
}

export interface SyncClientEvent {
  type: string;
  doc?: MeshDocument;
  status?: unknown;
}

export class SyncClient extends EventEmitter<SyncClientEvent> {
  private readonly client: RoomClient;
  private _connectingDocuments: Record<string, Promise<RefCount<MeshDocument>>> = {};
  private _connectedDocuments: Record<string, RefCount<MeshDocument>> = {};
  private _documentStreams: Record<string, SyncOpenStreamState> = {};

  constructor({room}: {room: RoomClient}) {
    super();
    this.client = room;
    this.client.protocol.addHandler("room.status", this._handleStatus.bind(this));
  }

  private _unexpectedResponseError(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from sync.${operation}`);
  }

  private async _invoke(operation: string, input: Record<string, any> | Content) {
    return await this.client.invoke({
      toolkit: "sync",
      tool: operation,
      input,
    });
  }

  public start({onDone, onError}: {
    onDone?: () => void;
    onError?: (error: Error) => void;
  } = {}): void {
    this.client.protocol.start({onDone, onError});
  }

  public override dispose(): void {
    super.dispose();
    for (const streamState of Object.values(this._documentStreams)) {
      streamState.closeInputStream();
    }
    this._documentStreams = {};
    for (const rc of Object.values(this._connectedDocuments)) {
      unregisterDocument(rc.ref.id);
    }
    this._connectedDocuments = {};
    this._connectingDocuments = {};
  }

  private _applySyncPayload(rc: RefCount<MeshDocument>, payload: Uint8Array): void {
    const doc = rc.ref;
    if (payload.length > 0) {
      const base64 = decoder.decode(payload);
      applyBackendChanges(doc.id, base64);
    }

    this.emit("synced", { type: "sync", doc });

    if (!doc.isSynchronized) {
      doc.setSynchronizedComplete();
    }
  }

  private async _handleStatus(
    _protocol: Protocol,
    _messageId: number,
    _type: string,
    bytes?: Uint8Array,
  ): Promise<void> {
    if (!bytes) {
      return;
    }
    const [header] = unpackMessage(bytes);
    this.emit("status", { type: "status", status: header.status });
  }

  public async create(path: string, json?: Record<string, any>): Promise<void> {
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
      initialJson?: Record<string, any>;
      schema?: MeshSchema;
    } = {},
  ): Promise<MeshDocument> {
    path = normalizeSyncPath(path);
    const pending = this._connectingDocuments[path];
    if (pending) {
      await pending;
    }

    const connected = this._connectedDocuments[path];
    if (connected) {
      connected.count++;
      return connected.ref;
    }

    const connecting = new Completer<RefCount<MeshDocument>>();
    this._connectingDocuments[path] = connecting.fut;

    let streamState: SyncOpenStreamState | undefined;
    let iterator: AsyncIterator<Content> | undefined;
    try {
      streamState = new SyncOpenStreamState({
        path,
        create,
        vector: null,
        schemaJson: schema == null ? null : schema.toJson(),
        schemaPath: null,
        initialJson: initialJson ?? null,
      });

      const responseStream = await this.client.invokeStream({
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

      const stateHeaders = parseSyncOpenStateChunkHeaders(firstChunk.headers);
      if (normalizeSyncPath(stateHeaders.path) !== path) {
        throw new RoomServerException("sync.open stream returned a mismatched path");
      }

      const doc = new MeshDocument({
        schema: MeshSchema.fromJson(stateHeaders.schema),
        sendChangesToBackend: (base64: string) => {
          try {
            streamState?.queueSync(encoder.encode(base64));
          } catch {
          }
        },
      });
      const rc = new RefCount<MeshDocument>(doc);
      this._connectedDocuments[path] = rc;
      this._documentStreams[path] = streamState;
      this._applySyncPayload(rc, firstChunk.data);
      streamState.attachTask(this._consumeOpenStream({
        path,
        rc,
        iterator,
        streamState,
      }));

      this.emit("connected", { type: "connect", doc });
      connecting.complete(rc);
      await doc.synchronized;
      return doc;
    } catch (error) {
      streamState?.closeInputStream();
      if (iterator) {
        await iterator.return?.();
      }
      connecting.completeError(error);
      throw error;
    } finally {
      delete this._connectingDocuments[path];
    }
  }

  public async close(path: string): Promise<void> {
    path = normalizeSyncPath(path);
    const rc = this._connectedDocuments[path];
    if (!rc) {
      throw new RoomServerException(`Not connected to ${path}`);
    }

    const doc = rc.ref;
    rc.count--;
    if (rc.count === 0) {
      delete this._connectedDocuments[path];
      const streamState = this._documentStreams[path];
      delete this._documentStreams[path];
      if (streamState) {
        streamState.closeInputStream();
        try {
          await streamState.wait();
        } finally {
          unregisterDocument(doc.id);
        }
      } else {
        unregisterDocument(doc.id);
      }
    }

    this.emit("closed", { type: "close", doc });
  }

  public async sync(path: string, data: Uint8Array): Promise<void> {
    path = normalizeSyncPath(path);
    if (!this._connectedDocuments[path]) {
      throw new RoomServerException("attempted to sync to a document that is not connected");
    }
    const streamState = this._documentStreams[path];
    if (!streamState) {
      throw new RoomServerException("attempted to sync to a document that is not connected");
    }
    streamState.queueSync(data);
  }

  private async _consumeOpenStream(params: {
    path: string;
    rc: RefCount<MeshDocument>;
    iterator: AsyncIterator<Content>;
    streamState: SyncOpenStreamState;
  }): Promise<void> {
    try {
      while (true) {
        const next = await params.iterator.next();
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

        const headers = parseSyncOpenOutputChunkHeaders(chunk.headers);
        if (normalizeSyncPath(headers.path) !== params.path) {
          throw new RoomServerException("sync.open stream returned a mismatched path");
        }

        this._applySyncPayload(params.rc, chunk.data);
      }
    } finally {
      params.streamState.closeInputStream();
      await params.iterator.return?.();
    }
  }
}
