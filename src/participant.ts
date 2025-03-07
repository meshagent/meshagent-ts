// participant.ts
import { RoomClient } from "./room-client";
import { encoder } from "./utils";

/**
 * An abstract base class for participants.
 */
export abstract class Participant {
  public readonly id: string;

  protected readonly client: RoomClient;
  protected _attributes: Record<string, any> = {};
  protected _connections: string[] = [];

  constructor(client: RoomClient, id: string) {
    this.client = client;
    this.id = id;
  }

  /**
   * A read-only array of connection IDs (or something similar).
   */
  get connections(): ReadonlyArray<string> {
    return this._connections;
  }

  /**
   * Retrieves an attribute value by name.
   */
  getAttribute(name: string): any {
    return this._attributes[name];
  }
}

/**
 * A remote participant that has a specific role.
 */
export class RemoteParticipant extends Participant {
  public readonly role: string;

  constructor(client: RoomClient, id: string, role: string) {
    super(client, id);
    this.role = role;
  }
}

/**
 * A local participant, allowing attribute changes that trigger a protocol call.
 */
export class LocalParticipant extends Participant {
  constructor(client: RoomClient, id: string) {
    super(client, id);
  }

  /**
   * Sets an attribute locally, then sends an update over the protocol.
   */
  async setAttribute(name: string, value: any): Promise<void> {
    this._attributes[name] = value;

    try {
      const payload = encoder.encode(JSON.stringify({ [name]: value }));

      await this.client.protocol.send("set_attributes", payload);

    } catch (err) {
      console.warn("Unable to send attribute changes", err);
    }
  }
}

