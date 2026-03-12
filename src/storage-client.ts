// storage_client.ts

import { RoomClient } from "./room-client";
import { Protocol } from "./protocol";
import { FileDeletedEvent, FileUpdatedEvent, RoomEvent } from "./room-event";
import { BinaryContent, Content, ControlContent, ErrorContent, JsonContent, FileContent } from "./response";
import { unpackMessage } from "./utils";
import { EventEmitter } from "./event-emitter";
import { RoomServerException } from "./room-server-client";

export class FileHandle {
  public id: number;

  constructor({id}: {id: number}) {
    this.id = id;
  }
}

class StorageEntry {
    public name: string;
    public isFolder: boolean;
    public size: number | null;

    constructor({name, isFolder, size = null}: {
        name: string;
        isFolder: boolean;
        size?: number | null;
    }) {
        this.name = name;
        this.isFolder = isFolder;
        this.size = size;
    }

    /**
     * Returns the file name without its extension, using a simple regex
     * to remove the last dot and everything after it.
     *
     * e.g. "/some/folder/file.txt" -> "file"
     */
    nameWithoutExtension(): string {
        const segments = this.name
            .replace(/^\/+/, '')
            .replace(/\/+$/, '')
            .split(/\/+/);

        // Strip the extension (if any) from the fileName
        return (segments[segments.length - 1] || "")
            .replace(/\.[^/.]+$/, "");
    }
}

export class StorageClient extends EventEmitter<RoomEvent> {
  private client: RoomClient;

  constructor({room}: {room: RoomClient}) {
    super();

    this.client = room;

    // Add protocol handlers
    this.client.protocol.addHandler("storage.file.deleted", this._handleFileDeleted.bind(this));
    this.client.protocol.addHandler("storage.file.updated", this._handleFileUpdated.bind(this));
  }

  private async _handleFileUpdated(protocol: Protocol, messageId: number, type: string, bytes?: Uint8Array): Promise<void> {
    const [ data, _ ] = unpackMessage(bytes || new Uint8Array());
    const event = new FileUpdatedEvent({ path: data["path"] });
    this.client.emit(event);
    this.emit('file.updated', event);
  }

  private async _handleFileDeleted(protocol: Protocol, messageId: number, type: string, bytes?: Uint8Array): Promise<void> {
    const [ data, _ ] = unpackMessage(bytes || new Uint8Array());
   
    const event = new FileDeletedEvent({ path: data["path"] });
    this.client.emit(event);
    this.emit('file.deleted', event);
  }

  private _unexpectedResponseError(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from storage.${operation}`);
  }

  private async _invoke(
    operation: string,
    input: Record<string, any> | Content,
    callerContext?: Record<string, any>,
  ): Promise<Content> {
    return await this.client.invoke({
      toolkit: "storage",
      tool: operation,
      input,
      callerContext,
    });
  }

  /**
   * Lists files in the given path, returning an array of StorageEntry objects.
   */
  public async list(path: string): Promise<StorageEntry[]> {
    const response = await this._invoke("list", { path });
    if (!(response instanceof JsonContent)) {
      throw this._unexpectedResponseError("list");
    }
    const files = response.json["files"] as Array<Record<string, any>>;
    const entries = files.map((f) => {
      return new StorageEntry({
        name: f["name"],
        isFolder: f["is_folder"],
        size: typeof f["size"] === "number" ? f["size"] : null,
      });
    });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
  }

  /**
   * Deletes a file or folder at the given path.
   */
  public async delete(path: string): Promise<void> {
    await this._invoke("delete", { path, recursive: null });
  }

  /**
   * Checks if a path exists in storage.
   */
  public async exists(path: string): Promise<boolean> {
    const result = await this._invoke("exists", { path });
    if (!(result instanceof JsonContent)) {
      throw this._unexpectedResponseError("exists");
    }

    return result.json["exists"];
  }

  private _defaultUploadName(path: string, name?: string | null): string {
    if (typeof name === "string" && name.length > 0) {
      return name;
    }
    const segments = path.split("/").filter((segment) => segment.length > 0);
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : undefined;
    return lastSegment ?? path;
  }

  public async upload(
    path: string,
    bytes: Uint8Array,
    {
      overwrite = false,
      name,
      mimeType = null,
    }: {
      overwrite?: boolean;
      name?: string | null;
      mimeType?: string | null;
    } = {},
  ): Promise<void> {
    async function* singleChunk(): AsyncIterable<Uint8Array> {
      yield bytes;
    }
    await this.uploadStream(
      path,
      singleChunk(),
      {
        overwrite,
        size: bytes.length,
        name,
        mimeType,
      },
    );
  }

  public async uploadStream(
    path: string,
    chunks: AsyncIterable<Uint8Array>,
    {
      overwrite = false,
      chunkSize = 64 * 1024,
      size = null,
      name,
      mimeType = null,
    }: {
      overwrite?: boolean;
      chunkSize?: number;
      size?: number | null;
      name?: string | null;
      mimeType?: string | null;
    } = {},
  ): Promise<void> {
    const resolvedName = this._defaultUploadName(path, name);
    const input = new _StorageUploadInputStream({
      path,
      overwrite,
      chunks,
      chunkSize,
      size,
      name: resolvedName,
      mimeType,
    });
    const response = await this.client.invokeStream({
      toolkit: "storage",
      tool: "upload",
      input: input.stream(),
    });

    try {
      for await (const chunk of response) {
        if (chunk instanceof ErrorContent) {
          throw new RoomServerException(chunk.text, chunk.code);
        }
        if (chunk instanceof ControlContent) {
          if (chunk.method === "close") {
            return;
          }
          throw this._unexpectedResponseError("upload");
        }
        if (!(chunk instanceof BinaryContent)) {
          throw this._unexpectedResponseError("upload");
        }
        if (chunk.headers["kind"] !== "pull") {
          throw this._unexpectedResponseError("upload");
        }
        input.requestNext();
      }
    } finally {
      input.close();
    }
  }

  /**
   * Downloads a file at the given path, returning a FileContent (which may contain its data).
   */
  public async download(path: string): Promise<FileContent> {
    const stream = await this.downloadStream(path);
    let name: string | null = null;
    let mimeType: string | null = null;
    let expectedSize: number | null = null;
    let bytesReceived = 0;
    const parts: Uint8Array[] = [];

    for await (const chunk of stream) {
      const kind = chunk.headers["kind"];
      if (kind === "start") {
        const chunkName = chunk.headers["name"];
        const chunkMimeType = chunk.headers["mime_type"];
        const chunkSizeValue = chunk.headers["size"];
        if (
          typeof chunkName !== "string" ||
          typeof chunkMimeType !== "string" ||
          typeof chunkSizeValue !== "number" ||
          chunkSizeValue < 0
        ) {
          throw this._unexpectedResponseError("download");
        }
        name = chunkName;
        mimeType = chunkMimeType;
        expectedSize = chunkSizeValue;
        continue;
      }

      if (kind !== "data") {
        throw this._unexpectedResponseError("download");
      }
      parts.push(chunk.data);
      bytesReceived += chunk.data.length;
    }

    if (name == null || mimeType == null || expectedSize == null || bytesReceived !== expectedSize) {
      throw this._unexpectedResponseError("download");
    }

    const totalLength = parts.reduce((sum, chunk) => sum + chunk.length, 0);
    const data = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.length;
    }

    return new FileContent({ data, name, mimeType });
  }

  public async downloadStream(
    path: string,
    {
      chunkSize = 64 * 1024,
    }: {
      chunkSize?: number;
    } = {},
  ): Promise<AsyncIterable<BinaryContent>> {
    const input = new _StorageDownloadInputStream({ path, chunkSize });
    const response = await this.client.invokeStream({
      toolkit: "storage",
      tool: "download",
      input: input.stream(),
    });

    const self = this;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<BinaryContent> {
        let metadataReceived = false;
        let expectedSize: number | null = null;
        let bytesReceived = 0;
        try {
          for await (const chunk of response) {
            if (chunk instanceof ErrorContent) {
              throw new RoomServerException(chunk.text, chunk.code);
            }
            if (chunk instanceof ControlContent) {
              if (chunk.method === "close") {
                if (!metadataReceived || expectedSize == null || bytesReceived !== expectedSize) {
                  throw self._unexpectedResponseError("download");
                }
                return;
              }
              throw self._unexpectedResponseError("download");
            }
            if (!(chunk instanceof BinaryContent)) {
              throw self._unexpectedResponseError("download");
            }

            const kind = chunk.headers["kind"];
            if (kind === "start") {
              if (metadataReceived) {
                throw self._unexpectedResponseError("download");
              }
              const chunkName = chunk.headers["name"];
              const chunkMimeType = chunk.headers["mime_type"];
              const chunkSizeValue = chunk.headers["size"];
              if (
                typeof chunkName !== "string" ||
                typeof chunkMimeType !== "string" ||
                typeof chunkSizeValue !== "number" ||
                chunkSizeValue < 0
              ) {
                throw self._unexpectedResponseError("download");
              }
              metadataReceived = true;
              expectedSize = chunkSizeValue;
              yield chunk;
              if (expectedSize > 0) {
                input.requestNext();
              }
              continue;
            }

            if (kind !== "data" || !metadataReceived || expectedSize == null) {
              throw self._unexpectedResponseError("download");
            }

            bytesReceived += chunk.data.length;
            if (bytesReceived > expectedSize) {
              throw self._unexpectedResponseError("download");
            }
            yield chunk;
            if (bytesReceived < expectedSize) {
              input.requestNext();
            }
          }
        } finally {
          input.close();
        }
      },
    };
  }

  /**
   * Returns a download URL for the file at path.
   */
  public async downloadUrl(path: string): Promise<string> {
    const response = await this._invoke("download_url", { path });
    if (!(response instanceof JsonContent)) {
      throw this._unexpectedResponseError("download_url");
    }

    return response.json["url"];
  }
}

class _StorageDownloadInputStream {
  private readonly path: string;
  private readonly chunkSize: number;
  private closed = false;
  private pendingPulls = 0;
  private waitingResolver: (() => void) | null = null;

  constructor({ path, chunkSize }: { path: string; chunkSize: number }) {
    this.path = path;
    this.chunkSize = chunkSize;
  }

  requestNext(): void {
    if (this.closed) {
      return;
    }
    this.pendingPulls += 1;
    if (this.waitingResolver) {
      const resolver = this.waitingResolver;
      this.waitingResolver = null;
      resolver();
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.waitingResolver) {
      const resolver = this.waitingResolver;
      this.waitingResolver = null;
      resolver();
    }
  }

  async *stream(): AsyncIterable<Content> {
    yield new BinaryContent({
      data: new Uint8Array(0),
      headers: {
        kind: "start",
        path: this.path,
        chunk_size: this.chunkSize,
      },
    });

    while (!this.closed) {
      if (this.pendingPulls === 0) {
        await new Promise<void>((resolve) => {
          this.waitingResolver = resolve;
        });
      }
      if (this.closed) {
        return;
      }
      if (this.pendingPulls === 0) {
        continue;
      }
      this.pendingPulls -= 1;
      yield new BinaryContent({
        data: new Uint8Array(0),
        headers: { kind: "pull" },
      });
    }
  }
}

class _StorageUploadInputStream {
  private readonly path: string;
  private readonly overwrite: boolean;
  private readonly chunkSize: number;
  private readonly size: number | null;
  private readonly name: string;
  private readonly mimeType: string | null;
  private readonly source: AsyncIterator<Uint8Array>;
  private closed = false;
  private pendingPulls = 0;
  private waitingResolver: (() => void) | null = null;
  private pendingChunk: Uint8Array = new Uint8Array(0);
  private pendingOffset = 0;
  private sourceExhausted = false;

  constructor({
    path,
    overwrite,
    chunks,
    chunkSize,
    size,
    name,
    mimeType,
  }: {
    path: string;
    overwrite: boolean;
    chunks: AsyncIterable<Uint8Array>;
    chunkSize: number;
    size: number | null;
    name: string;
    mimeType: string | null;
  }) {
    this.path = path;
    this.overwrite = overwrite;
    this.source = chunks[Symbol.asyncIterator]();
    this.chunkSize = chunkSize;
    this.size = size;
    this.name = name;
    this.mimeType = mimeType;
  }

  requestNext(): void {
    if (this.closed) {
      return;
    }
    this.pendingPulls += 1;
    if (this.waitingResolver) {
      const resolver = this.waitingResolver;
      this.waitingResolver = null;
      resolver();
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.waitingResolver) {
      const resolver = this.waitingResolver;
      this.waitingResolver = null;
      resolver();
    }
  }

  private async nextChunk(): Promise<Uint8Array | null> {
    while (true) {
      if (this.pendingOffset < this.pendingChunk.length) {
        const start = this.pendingOffset;
        const end = Math.min(start + this.chunkSize, this.pendingChunk.length);
        this.pendingOffset = end;
        return this.pendingChunk.slice(start, end);
      }

      if (this.sourceExhausted) {
        return null;
      }

      const next = await this.source.next();
      if (next.done) {
        this.sourceExhausted = true;
        return null;
      }

      if (next.value.length === 0) {
        continue;
      }

      this.pendingChunk = next.value;
      this.pendingOffset = 0;
    }
  }

  async *stream(): AsyncIterable<Content> {
    yield new BinaryContent({
      data: new Uint8Array(0),
      headers: {
        kind: "start",
        path: this.path,
        overwrite: this.overwrite,
        name: this.name,
        mime_type: this.mimeType,
        size: this.size,
      },
    });

    while (!this.closed) {
      if (this.pendingPulls === 0) {
        await new Promise<void>((resolve) => {
          this.waitingResolver = resolve;
        });
      }
      if (this.closed) {
        return;
      }
      if (this.pendingPulls === 0) {
        continue;
      }
      this.pendingPulls -= 1;
      const chunk = await this.nextChunk();
      if (chunk == null) {
        return;
      }
      yield new BinaryContent({
        data: chunk,
        headers: { kind: "data" },
      });
    }
  }
}
