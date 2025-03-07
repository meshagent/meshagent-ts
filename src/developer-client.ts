// developer_client.ts
import { EventEmitter } from "./event-emitter";
import { RoomClient } from "./room-client";
import { Protocol } from "./protocol";
import { packMessage, decoder } from "./utils";
import { RoomLogEvent } from "./room-event";

/**
 * DeveloperClient listens for developer.log events,
 * logs them, and can watch/unwatch developer logs.
 */
export class DeveloperClient extends EventEmitter<RoomLogEvent> {
  private client: RoomClient;

  constructor(client: RoomClient) {
    super();

    this.client = client;
    // Bind to the protocol event
    this.client.protocol.addHandler("developer.log", this._handleDeveloperLog.bind(this));
  }

  /**
   * Handler for "developer.log" messages from the protocol.
   */
  private async _handleDeveloperLog(protocol: Protocol, messageId: number, type: string, bytes?: Uint8Array): Promise<void> {
    // Decode the message
    const rawJson = JSON.parse(decoder.decode(bytes || new Uint8Array()));
    const event = new RoomLogEvent({
        type: rawJson["type"],
        data: rawJson["data"],
    });

    // Trigger an internal event on the RoomClient
    // or do whatever you need with the data
    this.client.emitt(event);

    this.notifyListeners(event);
  }

  /**
   * Sends a developer.log message with specified type and data.
   */
  async log(type: string, data: Record<string, any>): Promise<void> {
    // Pack the message, then send
    const message = packMessage({ type, data }, undefined);

    await this.client.protocol.send("developer.log", message);
  }

  /**
   * Enables (watches) developer messages.
   */
  async enable(): Promise<void> {
    const message = packMessage({}, undefined);

    await this.client.protocol.send("developer.watch", message);
  }

  /**
   * Disables (unwatches) developer messages.
   */
  async disable(): Promise<void> {
    const message = packMessage({}, undefined);

    await this.client.protocol.send("developer.unwatch", message);
  }
}
