import { EmptyContent, JsonContent } from "./response";
import { RoomClient } from "./room-client";
import { RoomServerException } from "./room-server-client";

export class MemoryClient {
  private readonly room: RoomClient;

  constructor({ room }: { room: RoomClient }) {
    this.room = room;
  }

  private unexpectedResponse(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from memory.${operation}`);
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

  public async list(params?: { namespace?: string[] | null }): Promise<string[]> {
    const response = await this.invoke("list", {
      namespace: params?.namespace ?? null,
    });

    if (!(response instanceof JsonContent)) {
      throw this.unexpectedResponse("list");
    }

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
}
