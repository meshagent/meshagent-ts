import { RoomClient } from "./room-client";
import { EmptyResponse, JsonResponse } from "./response";


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

  /**
   * Returns a list of queues from the server.
   */
  public async list(): Promise<Queue[]> {
    const response = (await this.client.sendRequest("queues.list", {})) as JsonResponse;
    const queues = response.json["queues"] as Array<Record<string, any>>;

    return queues.map((q) => new Queue({ name: q["name"], size: q["size"] }));
  }

  /**
   * Opens a queue with a given name.
   */
  public async open(name: string): Promise<void> {
    await this.client.sendRequest("queues.open", { name });
  }

  /**
   * Drains a queue with a given name.
   */
  public async drain(name: string): Promise<void> {
    await this.client.sendRequest("queues.drain", { name });
  }

  /**
   * Closes a queue with a given name.
   */
  public async close(name: string): Promise<void> {
    await this.client.sendRequest("queues.close", { name });
  }

  /**
   * Sends a message to a queue, optionally creating the queue if it doesn't exist.
   */
  public async send(name: string, message: Record<string, any>, create: boolean = true): Promise<void> {
    await this.client.sendRequest("queues.send", {
      name,
      create,
      message,
    });
  }

  /**
   * Receives a message from a queue. Returns null if the response is EmptyResponse, or the JSON if it's a JsonResponse.
   */
  public async receive(name: string, create: boolean = true, wait: boolean = true): Promise<Record<string, any> | null> {
    const response = await this.client.sendRequest("queues.receive", {
      name,
      create,
      wait,
    });

    if (response instanceof EmptyResponse) {
      return null;

    } else {
      // If not empty, assume it's a JsonResponse
      return (response as JsonResponse).json;
    }
  }
}
