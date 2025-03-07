// storage_client.ts

import { RoomClient } from "./room-client";
import { Protocol } from "./protocol";
import { FileDeletedEvent, FileUpdatedEvent } from "./room-event";
import { JsonResponse, FileResponse } from "./response";
import { decoder } from "./utils";

export class FileHandle {
  constructor(public id: number) { }
}

class StorageEntry {
    constructor(public name: string, public isFolder: boolean) { }

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

export class StorageClient {
  private client: RoomClient;

  constructor(client: RoomClient) {
    this.client = client;

    // Add protocol handlers
    this.client.protocol.addHandler("storage.file_deleted", this._handleFileDeleted.bind(this));
    this.client.protocol.addHandler("storage.file_updated", this._handleFileUpdated.bind(this));
  }

  private async _handleFileUpdated(protocol: Protocol, messageId: number, type: string, bytes?: Uint8Array): Promise<void> {
    const raw = decoder.decode(bytes || new Uint8Array());
    const data = JSON.parse(raw);

    this.client.emitt(new FileUpdatedEvent({ path: data["path"] }));
  }

  private async _handleFileDeleted(protocol: Protocol, messageId: number, type: string, bytes?: Uint8Array): Promise<void> {
    const raw = decoder.decode(bytes || new Uint8Array());
    const data = JSON.parse(raw);

    this.client.emitt(new FileDeletedEvent({ path: data["path"] }));
  }

  /**
   * Lists files in the given path, returning an array of StorageEntry objects.
   */
  public async list(path: string): Promise<StorageEntry[]> {
    const response = (await this.client.sendRequest("storage.list", { path })) as JsonResponse;
    const files = response.json["files"] as Array<Record<string, any>>;
    const entries = files.map((f) => {
      return {
        name: f["name"],
        isFolder: f["is_folder"],
      } as StorageEntry;
    });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
  }

  /**
   * Deletes a file or folder at the given path.
   */
  public async delete(path: string): Promise<void> {
    await this.client.sendRequest("storage.delete", { path });
    // We ignore or discard the JsonResponse if not needed
  }

  /**
   * Opens a file at a given path, returning a FileHandle.
   */
  public async open(path: string, overwrite: boolean = false): Promise<FileHandle> {
    const response = (await this.client.sendRequest("storage.open", {
      path,
      overwrite,
    })) as JsonResponse;

    return new FileHandle(response.json["handle"]);
  }

  /**
   * Checks if a path exists in storage.
   */
  public async exists(path: string): Promise<boolean> {
    const result = (await this.client.sendRequest("storage.exists", { path })) as JsonResponse;

    return result.json["exists"];
  }

  /**
   * Writes the given bytes to a file handle.
   */
  public async write(handle: FileHandle, bytes: Uint8Array): Promise<void> {
    await this.client.sendRequest("storage.write", { handle: handle.id }, bytes);
  }

  /**
   * Closes the file handle.
   */
  public async close(handle: FileHandle): Promise<void> {
    await this.client.sendRequest("storage.close", { handle: handle.id });
  }

  /**
   * Downloads a file at the given path, returning a FileResponse (which may contain its data).
   */
  public async download(path: string): Promise<FileResponse> {
    const response = (await this.client.sendRequest("storage.download", { path })) as FileResponse;

    return response;
  }

  /**
   * Returns a download URL for the file at path.
   */
  public async downloadUrl(path: string): Promise<string> {
    const response = (await this.client.sendRequest("storage.download_url", { path })) as JsonResponse;

    return response.json["url"];
  }
}

