import { expect } from "chai";

import { Protocol } from "../protocol";
import { BinaryContent, Content, ControlContent, JsonContent } from "../response";
import { FileDeletedEvent, FileUpdatedEvent, RoomEvent } from "../room-event";
import { StorageClient, StorageEntry } from "../storage-client";
import { packMessage } from "../utils";

type InvokeParams = {
  toolkit: string;
  tool: string;
  input: Record<string, any> | Content;
  callerContext?: Record<string, any>;
};

type InvokeStreamParams = {
  toolkit: string;
  tool: string;
  input: AsyncIterable<Content>;
  callerContext?: Record<string, any>;
};

type StorageEventHandler = (
  protocol: Protocol,
  messageId: number,
  type: string,
  bytes?: Uint8Array,
) => Promise<void>;

class FakeProtocol {
  private handlers = new Map<string, StorageEventHandler>();

  public addHandler(type: string, handler: StorageEventHandler): void {
    this.handlers.set(type, handler);
  }

  public async dispatch(type: string, payload: Record<string, unknown>): Promise<void> {
    const handler = this.handlers.get(type);
    if (handler == null) {
      throw new Error(`no handler registered for ${type}`);
    }
    await handler(this as unknown as Protocol, 0, type, packMessage(payload as Record<string, any>));
  }
}

class FakeStorageRoom {
  public static readonly createdAt = "2025-01-01T00:00:00Z";
  public static readonly updatedAt = "2025-01-02T00:00:00Z";

  public readonly protocol = new FakeProtocol();
  public readonly emittedEvents: RoomEvent[] = [];
  public readonly files = new Map<string, Uint8Array>();
  public lastUploadStartHeaders: Record<string, unknown> | null = null;
  public lastDeleteRecursive: boolean | null | undefined = undefined;

  public emit(event: RoomEvent): void {
    this.emittedEvents.push(event);
  }

  public async invoke(params: InvokeParams): Promise<Content> {
    switch (params.tool) {
      case "exists": {
        const path = (params.input as Record<string, any>)["path"];
        return new JsonContent({ json: { exists: this.files.has(path) } });
      }
      case "stat": {
        const path = (params.input as Record<string, any>)["path"];
        const bytes = this.files.get(path);
        if (bytes == null) {
          return new JsonContent({ json: { exists: false } });
        }
        return new JsonContent({
          json: {
            exists: true,
            name: path.split("/").pop(),
            is_folder: false,
            size: bytes.length,
            created_at: FakeStorageRoom.createdAt,
            updated_at: FakeStorageRoom.updatedAt,
          },
        });
      }
      case "list": {
        const path = (params.input as Record<string, any>)["path"];
        return new JsonContent({
          json: {
            files: this.listEntries(path),
          },
        });
      }
      case "delete": {
        const input = params.input as Record<string, any>;
        this.lastDeleteRecursive = (input["recursive"] as boolean | null | undefined) ?? null;
        this.files.delete(input["path"]);
        return new JsonContent({ json: {} });
      }
      case "download_url": {
        const path = (params.input as Record<string, any>)["path"];
        return new JsonContent({ json: { url: `https://example.test/download/${path}` } });
      }
      default:
        throw new Error(`unsupported invoke tool: ${params.tool}`);
    }
  }

  public async invokeStream(params: InvokeStreamParams): Promise<AsyncIterable<Content>> {
    switch (params.tool) {
      case "upload":
        return this.handleUpload(params.input);
      case "download":
        return this.handleDownload(params.input);
      default:
        throw new Error(`unsupported invokeStream tool: ${params.tool}`);
    }
  }

  private listEntries(path: string): Array<Record<string, unknown>> {
    const prefix = path.length === 0 ? "" : `${path}/`;
    const entries = new Map<string, boolean>();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }
      const remainder = filePath.slice(prefix.length);
      if (remainder.length === 0) {
        continue;
      }
      const slashIndex = remainder.indexOf("/");
      if (slashIndex === -1) {
        entries.set(remainder, false);
      } else {
        entries.set(remainder.slice(0, slashIndex), true);
      }
    }
    return Array.from(entries.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, isFolder]) => {
        const fullPath = prefix.length === 0 ? name : `${prefix}${name}`;
        const bytes = this.files.get(fullPath);
        return {
          name,
          is_folder: isFolder,
          size: bytes?.length ?? null,
          created_at: FakeStorageRoom.createdAt,
          updated_at: FakeStorageRoom.updatedAt,
        };
      });
  }

  private async *handleUpload(input: AsyncIterable<Content>): AsyncIterable<Content> {
    const iterator = input[Symbol.asyncIterator]();
    const start = await iterator.next();
    if (start.done || !(start.value instanceof BinaryContent) || start.value.headers["kind"] !== "start") {
      throw new Error("expected upload start chunk");
    }
    this.lastUploadStartHeaders = { ...start.value.headers };
    const uploadPath = start.value.headers["path"];
    if (typeof uploadPath !== "string") {
      throw new Error("upload start chunk missing path");
    }

    const parts: Uint8Array[] = [];
    while (true) {
      yield new BinaryContent({
        data: new Uint8Array(0),
        headers: { kind: "pull", chunk_size: 128 * 1024 },
      });
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      if (!(next.value instanceof BinaryContent) || next.value.headers["kind"] !== "data") {
        throw new Error("expected upload data chunk");
      }
      parts.push(next.value.data);
    }

    const totalLength = parts.reduce((sum, chunk) => sum + chunk.length, 0);
    const data = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.length;
    }
    this.files.set(uploadPath, data);

    yield new ControlContent({ method: "close" });
  }

  private async *handleDownload(input: AsyncIterable<Content>): AsyncIterable<Content> {
    const iterator = input[Symbol.asyncIterator]();
    const start = await iterator.next();
    if (start.done || !(start.value instanceof BinaryContent) || start.value.headers["kind"] !== "start") {
      throw new Error("expected download start chunk");
    }
    const downloadPath = start.value.headers["path"];
    const chunkSize = start.value.headers["chunk_size"];
    if (typeof downloadPath !== "string" || typeof chunkSize !== "number" || chunkSize <= 0) {
      throw new Error("invalid download start chunk");
    }
    const bytes = this.files.get(downloadPath);
    if (bytes == null) {
      throw new Error(`unknown path ${downloadPath}`);
    }

    yield new BinaryContent({
      data: new Uint8Array(0),
      headers: {
        kind: "start",
        name: downloadPath.split("/").pop() ?? downloadPath,
        mime_type: "application/octet-stream",
        size: bytes.length,
      },
    });

    if (bytes.length === 0) {
      yield new ControlContent({ method: "close" });
      return;
    }

    let offset = 0;
    while (true) {
      const pull = await iterator.next();
      if (pull.done) {
        return;
      }
      if (!(pull.value instanceof BinaryContent) || pull.value.headers["kind"] !== "pull") {
        throw new Error("expected download pull chunk");
      }

      const end = Math.min(offset + chunkSize, bytes.length);
      yield new BinaryContent({
        data: bytes.slice(offset, end),
        headers: { kind: "data" },
      });
      offset = end;
      if (offset >= bytes.length) {
        yield new ControlContent({ method: "close" });
        return;
      }
    }
  }
}

describe("storage_client_unit_test", () => {
  it("parses stat/list metadata and forwards recursive delete", async () => {
    const room = new FakeStorageRoom();
    room.files.set("folder/a.txt", new Uint8Array([1, 2, 3]));
    room.files.set("folder/nested/b.txt", new Uint8Array([4]));
    const client = new StorageClient({ room });

    const stat = await client.stat("folder/a.txt");
    expect(stat).to.be.instanceOf(StorageEntry);
    expect(stat?.name).to.equal("a.txt");
    expect(stat?.size).to.equal(3);
    expect(stat?.createdAt?.toISOString()).to.equal("2025-01-01T00:00:00.000Z");
    expect(stat?.updatedAt?.toISOString()).to.equal("2025-01-02T00:00:00.000Z");
    expect(await client.stat("folder/missing.txt")).to.equal(null);

    const listing = await client.list("folder");
    expect(listing.map((entry) => entry.name)).to.deep.equal(["a.txt", "nested"]);
    expect(listing[0].createdAt?.toISOString()).to.equal("2025-01-01T00:00:00.000Z");
    expect(listing[0].updatedAt?.toISOString()).to.equal("2025-01-02T00:00:00.000Z");

    await client.delete("folder", { recursive: true });
    expect(room.lastDeleteRecursive).to.equal(true);

    await client.delete("folder/a.txt");
    expect(room.lastDeleteRecursive).to.equal(null);
  });

  it("defaults upload name and mime type", async () => {
    const room = new FakeStorageRoom();
    const client = new StorageClient({ room });

    await client.upload("docs/example.txt", new Uint8Array([1, 2, 3]));
    expect(room.lastUploadStartHeaders).to.deep.include({
      kind: "start",
      path: "docs/example.txt",
      overwrite: false,
      name: "example.txt",
      mime_type: "text/plain",
      size: 3,
    });

    await client.upload("docs/blob", new Uint8Array([4]));
    expect(room.lastUploadStartHeaders?.["mime_type"]).to.equal("application/octet-stream");
  });

  it("emits file events with participant ids", async () => {
    const room = new FakeStorageRoom();
    const client = new StorageClient({ room });
    let updatedEvent: FileUpdatedEvent | undefined;
    let deletedEvent: FileDeletedEvent | undefined;

    client.on("file.updated", (event) => {
      updatedEvent = event as FileUpdatedEvent;
    });
    client.on("file.deleted", (event) => {
      deletedEvent = event as FileDeletedEvent;
    });

    await room.protocol.dispatch("storage.file.updated", {
      path: "events/file.txt",
      participant_id: "participant-1",
    });
    await room.protocol.dispatch("storage.file.deleted", {
      path: "events/file.txt",
      participant_id: "participant-1",
    });

    expect(updatedEvent).to.not.equal(undefined);
    expect(deletedEvent).to.not.equal(undefined);
    if (updatedEvent == null || deletedEvent == null) {
      throw new Error("expected storage events to be emitted");
    }
    expect(updatedEvent.path).to.equal("events/file.txt");
    expect(updatedEvent.participantId).to.equal("participant-1");
    expect(deletedEvent.path).to.equal("events/file.txt");
    expect(deletedEvent.participantId).to.equal("participant-1");
    expect(room.emittedEvents).to.have.length(2);
  });
});
