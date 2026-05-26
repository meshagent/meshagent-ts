// participant.ts
import { RoomClient } from "./room-client.js";

/**
 * An abstract base class for participants.
 */
export abstract class Participant {
  public id: string;

  protected readonly client: RoomClient;
  protected _attributes: Record<string, unknown> = {};
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
  getAttribute(name: string): unknown {
    return this._attributes[name];
  }

  public _replaceIdentity({
    participantId,
    attributes,
  }: {
    participantId: string;
    attributes: Record<string, unknown>;
  }): void {
    this.id = participantId;
    this._attributes = { ...attributes };
  }

  public _setAttribute(name: string, value: unknown): void {
    this._attributes[name] = value;
  }

  public _setAttributes(attributes: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(attributes)) {
      this._setAttribute(name, value);
    }
  }

  public _attributesSnapshot(): Record<string, unknown> {
    return { ...this._attributes };
  }
}

/**
 * A remote participant that has a specific role.
 */
export class RemoteParticipant extends Participant {
  public readonly role: string;
  public online?: boolean;

  constructor(client: RoomClient, id: string, role: string, online?: boolean) {
    super(client, id);
    this.role = role;
    this.online = online;
  }

  public _setOnline(online: boolean): void {
    this.online = online;
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
  setAttribute(name: string, value: unknown): void {
    this._setAttribute(name, value);
    this.client._sendLocalAttributesNowait({ [name]: value });
  }
}
