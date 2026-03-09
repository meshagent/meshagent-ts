// developer_client.ts
import { EventEmitter } from "./event-emitter";
import { RoomClient } from "./room-client";
import { Protocol } from "./protocol";
import { BinaryContent, Content, ControlContent, ErrorContent } from "./response";
import { unpackMessage } from "./utils";
import { RoomLogEvent } from "./room-event";

/**
 * DeveloperClient emits developer logs and streams them from the room.
 */
export class DeveloperClient extends EventEmitter<RoomLogEvent> {
  private client: RoomClient;

  constructor({room}: {room: RoomClient}) {
    super();

    this.client = room;

    // Bind to the protocol event
    this.client.protocol.addHandler("developer.log", this._handleDeveloperLog.bind(this));
  }

  private _emitDeveloperLog(type: string, data: Record<string, any>): void {
    const event = new RoomLogEvent({ type, data });
    this.client.emit(event);
    this.emit("log", event);
  }

  /**
   * Handler for "developer.log" messages from the protocol.
   */
  private async _handleDeveloperLog(protocol: Protocol, messageId: number, type: string, bytes?: Uint8Array): Promise<void> {
    // Decode the message
    const [ rawJson, _ ] = unpackMessage(bytes || new Uint8Array());
    this._emitDeveloperLog(rawJson["type"], rawJson["data"]);
  }

  /**
   * Sends a developer.log message with specified type and data.
   */
  async log(type: string, data: Record<string, any>): Promise<void> {
    await this.client.invoke({
      toolkit: "developer",
      tool: "log",
      input: { type, data },
    });
  }

  /**
   * Streams developer logs until the consumer stops iterating.
   */
  async *logs(): AsyncIterable<RoomLogEvent> {
    let resolveClosed: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const input = (async function* (): AsyncIterable<Content> {
      await closed;
    })();

    const stream = await this.client.invokeStream({
      toolkit: "developer",
      tool: "logs",
      input,
    });

    try {
      for await (const chunk of stream) {
        if (chunk instanceof ErrorContent) {
          throw new Error(chunk.text);
        }
        if (chunk instanceof ControlContent) {
          if (chunk.method === "close") {
            return;
          }
          throw new Error("unexpected return type from developer.logs");
        }
        if (!(chunk instanceof BinaryContent)) {
          throw new Error("unexpected return type from developer.logs");
        }

        const logType = chunk.headers["type"];
        if (typeof logType !== "string" || logType.length === 0) {
          throw new Error("developer.logs returned a chunk without a valid type");
        }

        const decoded = chunk.data.length === 0
          ? {}
          : JSON.parse(new TextDecoder().decode(chunk.data));
        if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
          throw new Error("developer.logs returned invalid JSON data");
        }

        const event = new RoomLogEvent({ type: logType, data: decoded as Record<string, any> });
        this.client.emit(event);
        this.emit("log", event);
        yield event;
      }
    } finally {
      if (resolveClosed) {
        resolveClosed();
      }
    }
  }
}
