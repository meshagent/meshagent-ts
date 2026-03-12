import { RoomClient } from "./room-client";
import { Content, EmptyContent, JsonContent } from "./response";
import { RoomServerException } from "./room-server-client";


export class Queue {
  public name: string;
  public size: number;

  constructor({ name, size }: {
      name: string;
      size: number;
  }) {
    this.name = name;
    this.size = size;
  }
}

// --- QueuesClient class ---
export class QueuesClient {
  private client: RoomClient;

  constructor({room}: {room: RoomClient}) {
    this.client = room;
  }

  private _unexpectedResponseError(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from queues.${operation}`);
  }

  private async _invoke(operation: string, arguments_: Record<string, any>): Promise<Content> {
    return await this.client.invoke({
      toolkit: "queues",
      tool: operation,
      arguments: arguments_,
    });
  }

  /**
   * Returns a list of queues from the server.
   */
  public async list(): Promise<Queue[]> {
    const response = await this._invoke("list", {});
    if (!(response instanceof JsonContent)) {
      throw this._unexpectedResponseError("list");
    }
    const queues = response.json["queues"] as Array<Record<string, any>>;

    return queues.map((q) => new Queue({ name: q["name"], size: q["size"] }));
  }

  /**
   * Opens a queue with a given name.
   */
  public async open(name: string): Promise<void> {
    const response = await this._invoke("open", { name });
    if (!(response instanceof EmptyContent)) {
      throw this._unexpectedResponseError("open");
    }
  }

  /**
   * Drains a queue with a given name.
   */
  public async drain(name: string): Promise<void> {
    const response = await this._invoke("drain", { name });
    if (!(response instanceof EmptyContent)) {
      throw this._unexpectedResponseError("drain");
    }
  }

  /**
   * Closes a queue with a given name.
   */
  public async close(name: string): Promise<void> {
    const response = await this._invoke("close", { name });
    if (!(response instanceof EmptyContent)) {
      throw this._unexpectedResponseError("close");
    }
  }

  /**
   * Sends a message to a queue, optionally creating the queue if it doesn't exist.
   */
  public async send(name: string, message: Record<string, any>, { create = true } : { create?: boolean }): Promise<void> {
    const response = await this._invoke("send", { name, create, message });
    if (!(response instanceof EmptyContent)) {
      throw this._unexpectedResponseError("send");
    }
  }

  /**
   * Receives a message from a queue. Returns null if the response is EmptyContent, or the JSON if it's a JsonContent.
   */
  public async receive(name: string, { create = true, wait = true } : { create?: boolean, wait?: boolean }): Promise<Record<string, any> | null> {
    const response = await this._invoke("receive", {
      name,
      create,
      wait,
    });

    if (response instanceof EmptyContent) {
      return null;
    }

    if (response instanceof JsonContent) {
      return response.json;
    }

    throw this._unexpectedResponseError("receive");
  }
}
