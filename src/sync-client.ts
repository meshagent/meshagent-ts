import { EventEmitter } from "./event-emitter";
import { RoomClient } from "./room-client";
import { Protocol } from "./protocol";
import { MeshSchema } from "./schema";
import { StreamController } from "./stream-controller";
import { MeshDocument, RoomServerException } from "./room-server-client";
import { JsonResponse } from "./response";
import { splitMessageHeader, splitMessagePayload, decoder, encoder } from "./utils";
import { unregisterDocument, applyBackendChanges } from "./runtime";
import { Completer } from "./completer";

export interface SyncClientEvent {
    type: string;
    doc: MeshDocument;
};

/**
 * A helper interface for an object queued for sync.
 */
export class QueuedSync {
    constructor(public path: string, public base64: string) { }
}

/**
 * The SyncClient class, translated from your Dart code.
 */
export class SyncClient extends EventEmitter<SyncClientEvent> {
  private client: RoomClient;

  // Map<path, Promise<void>>
  private _connectingDocuments: Record<string, Promise<void>> = {};
  private _changesToSync = new StreamController<QueuedSync>();
  private _connectedDocuments: Record<string, MeshDocument> = {};

  constructor(client: RoomClient) {
    super();

    this.client = client;

    // Add a protocol handler
    this.client.protocol.addHandler("room.sync", this._handleSync.bind(this));
  }

  /**
   * Start listening for changes to sync to the backend.
   */
  public start(): void {
    this.client.protocol.start();

    // mimic Dart's: () async { await for(final msg in _changesToSync.stream) {...}}()
    // We can do an async generator approach:
    (async () => {
      for await (const message of this._changesToSync.stream) {
        console.log(`sending changes to backend ${message.base64}`);
        await this.client.sendRequest(
          "room.sync",
          { path: message.path },
          encoder.encode(message.base64)
        );
      }
    })();
  }

  /**
   * Dispose of this client.
   */
  public override dispose(): void {
    super.dispose();

    this._changesToSync.close();
  }

  private async _handleSync(protocol: Protocol, messageId: number, data: string, bytes?: Uint8Array): Promise<void> {
    console.log("GOT SYNC");
    const headerStr = splitMessageHeader(bytes || new Uint8Array());
    const payload = splitMessagePayload(bytes || new Uint8Array());

    const header = JSON.parse(headerStr);
    const path = header["path"];

    const isConnecting = this._connectingDocuments[path];
    if (isConnecting) {
      // Wait for the doc to finish connecting
      await isConnecting;
    }

    if (this._connectedDocuments[path]) {
      const doc = this._connectedDocuments[path];
      const base64 = decoder.decode(payload);
      console.log(`GOT SYNC ${base64}`);

      applyBackendChanges(doc.id, base64);

      this.notifyListeners({ type: "sync", doc });

      if (!doc.isSynchronized) {
        doc.setSynchronizedComplete();
      }
    } else {
      throw new RoomServerException(
        `received change for a document that is not connected: ${path}`
      );
    }
  }

  async createMeshDocumentWithMeshSchema(path: string, schema: MeshSchema, json?: Record<string, any>): Promise<void> {
    await this.client.sendRequest("room.create", {
      path,
      schema: schema.toJson(),
      json,
    });
  }

  async createMeshDocumentWithFormat(path: string, format: string, json?: Record<string, any>): Promise<void> {
    await this.client.sendRequest("room.create", {
      path,
      format,
      json,
    });
  }

  /**
   * Opens a new doc, returning a MeshDocument. If create=true, the doc
   * may be created server-side if it doesn't exist.
   */
  async open(path: string, create = true): Promise<MeshDocument> {
    const hasConnectingPath = this._connectingDocuments.hasOwnProperty(path);
    const hasConnectedPath = this._connectedDocuments.hasOwnProperty(path);

    if (hasConnectingPath || hasConnectedPath) {
      throw new RoomServerException(`Already connected to ${path}`);
    }

    // "Completer" approach
    const c = new Completer<void>();

    this._connectingDocuments[path] = c.fut

    try {
      // Possibly returns a JSON response with schema
      const result = (await this.client.sendRequest("room.connect", { path, create})) as JsonResponse;

      // parse the schema
      const schema = MeshSchema.fromJson(result.json["schema"]);
      console.log(JSON.stringify(schema.toJson()));

      // create local doc
      const doc = new MeshDocument(
        schema,
        (base64Str: string) => {
          this._changesToSync.add({ path, base64: base64Str });
        },
      );

      this._connectedDocuments[path] = doc;
      this.notifyListeners({ type: "open", doc });

      c.complete();
      return doc;
    } catch (err) {
      c.completeError(err);
      throw err;
    } finally {
      delete this._connectingDocuments[path];
    }
  }

  /**
   * Closes a doc at the given path.
   */
  async close(path: string): Promise<void> {
    await this.client.sendRequest("room.disconnect", { path });

    if (!this._connectedDocuments[path]) {
      throw new RoomServerException(`Not connected to ${path}`);
    }

    const doc = this._connectedDocuments[path];
    delete this._connectedDocuments[path];
    unregisterDocument(doc.id);

    this.notifyListeners({ type: "close", doc });
  }

  /**
   * Immediately sends sync data for a doc at the given path.
   */
  async sync(path: string, data: Uint8Array): Promise<void> {
    await this.client.sendRequest("room.sync", { path }, data);
  }
}
