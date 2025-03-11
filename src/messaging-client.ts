// messaging_client.ts
import { v4 as uuidV4 } from "uuid";

import { EventEmitter } from "./event-emitter";
import { RoomClient } from "./room-client";
import { Protocol } from "./protocol";
import { Participant, RemoteParticipant } from "./participant";
import { RoomMessage, RoomMessageEvent } from "./room-event";
import { splitMessageHeader, splitMessagePayload } from "./utils";
import { StreamController } from "./stream-controller";
import { Completer } from "./completer";

type StreamWriterCompleter = Completer<MessageStreamWriter>; // Stub or actual


/**
 * Represents a chunk of data in a stream, with a header and optional data.
 */
export class MessageStreamChunk {
  public header: Record<string, any>;
  public data?: Uint8Array;

  constructor({header, data}: {
    header: Record<string, any>;
    data?: Uint8Array;
  }) {
    this.header = header;
    this.data = data;
  }
}

/**
 * The main MessagingClient class, which handles sending messages,
 * managing participant information, and stream-based messages.
 */
export class MessagingClient extends EventEmitter<RoomMessageEvent> {
  private client: RoomClient;

  // Maps a streamId to a completer that resolves a MessageStreamWriter
  private _streamWriters: Record<string, StreamWriterCompleter> = {};

  // Maps a streamId to a MessageStreamReader
  private _streamReaders: Record<string, MessageStreamReader> = {};

  // A callback that fires when a stream is accepted
  private _onStreamAcceptCallback?: (reader: MessageStreamReader) => void;

  // Tracks remote participants
  private _participants: Record<string, RemoteParticipant> = {};

  constructor({room}: {room: RoomClient}) {
    super();

    this.client = room;

    // Register handler
    this.client.protocol.addHandler("messaging.send", this._handleMessageSend.bind(this));
  }

  /**
   * Creates a new stream to a participant, returning a MessageStreamWriter when ready.
   */
  public async createStream({to, header}: {
    to: Participant;
    header: Record<string, any>;
  }): Promise<MessageStreamWriter> {
    const streamId = uuidV4();
    const completer = new Completer<MessageStreamWriter>(); // or your concurrency helper

    this._streamWriters[streamId] = completer;

    await this.sendMessage({
      to,
      type: "stream.open",
      message: { stream_id: streamId, header },
    });

    return completer.fut;
  }

  /**
   * Sends a message to a given participant, optionally with a binary attachment.
   */
  public async sendMessage({to, type, message, attachment}: {
    to: Participant;
    type: string;
    message: Record<string, any>;
    attachment?: Uint8Array;
  }): Promise<void> {
    await this.client.sendRequest("messaging.send", {
        to_participant_id: to.id,
        type,
        message,
      }, attachment);
  }

  /**
   * Enables the messaging subsystem, optionally passing a stream accept callback.
   */
  public async enable(onStreamAccept?: (reader: MessageStreamReader) => void): Promise<void> {
    await this.client.sendRequest("messaging.enable", {});

    this._onStreamAcceptCallback = onStreamAccept;
  }

  /**
   * Disables the messaging subsystem.
   */
  public async disable(): Promise<void> {
    await this.client.sendRequest("messaging.disable", {});
  }

  /**
   * Broadcasts a message to all participants.
   */
  public async broadcastMessage({type, message, attachment}: {
    type: string;
    message: Record<string, any>;
    attachment?: Uint8Array;
  }): Promise<void> {
    await this.client.sendRequest("messaging.broadcast", {type, message}, attachment);
  }

  /**
   * Returns an iterable of remote participants.
   */
  public get remoteParticipants(): Iterable<RemoteParticipant> {
    return Object.values(this._participants);
  }

  /**
   * Internal handler for "messaging.send" events from the protocol.
   */
  private async _handleMessageSend(protocol: Protocol, messageId: number, type: string, bytes?: Uint8Array): Promise<void> {
    const headerStr = splitMessageHeader(bytes || new Uint8Array());
    const payload = splitMessagePayload(bytes || new Uint8Array());

    const header = JSON.parse(headerStr);
    const message = new RoomMessage({
      fromParticipantId: header["from_participant_id"],
      type: header["type"],
      message: header["message"],
      attachment: payload, // optional binary data
    });

    switch (message.type) {
      case "messaging.enabled":
        this._onMessagingEnabled(message);
        break;
      case "participant.attributes":
        this._onParticipantAttributes(message);
        break;
      case "participant.enabled":
        this._onParticipantEnabled(message);
        break;
      case "participant.disabled":
        this._onParticipantDisabled(message);
        break;
      case "stream.open":
        this._onStreamOpen(message);
        break;
      case "stream.accept":
        this._onStreamAccept(message);
        break;
      case "stream.reject":
        this._onStreamReject(message);
        break;
      case "stream.chunk":
        this._onStreamChunk(message);
        break;
      case "stream.close":
        this._onStreamClose(message);
        break;
    }

    const messageEvent = { message } as RoomMessageEvent;

    // Add to events
    this.client.emit(messageEvent);

    this.emit("message", messageEvent);
  }

  private _onParticipantEnabled(message: RoomMessage): void {
    const data = message.message;
    const p = new RemoteParticipant(this.client, data["id"], data["role"]);

    // Copy attributes
    for (const [k, v] of Object.entries(data["attributes"] || {})) {
      (p as any)._attributes[k] = v;
    }
    this._participants[data["id"]] = p;
    this.emit("participant_added", { message } as RoomMessageEvent);
  }

  private _onParticipantAttributes(message: RoomMessage): void {
    const part = this._participants[message.fromParticipantId];
    if (!part) return;
    const attrObj = message.message["attributes"] as Record<string, any>;
    for (const [k, v] of Object.entries(attrObj)) {
      (part as any)._attributes[k] = v;
    }

    this.emit("participant_attributes_updated", { message } as RoomMessageEvent);
  }

  private _onParticipantDisabled(message: RoomMessage): void {
    const part = this._participants[message.message["id"]];

    if (part) {
      delete this._participants[message.message["id"]];

      this.emit("participant_removed", { message } as RoomMessageEvent);
    }
  }

  private _onMessagingEnabled(message: RoomMessage): void {
    const participants = message.message["participants"] as Array<any>;

    for (const data of participants) {
      const rp = new RemoteParticipant(this.client, data["id"], data["role"]);

      for (const [k, v] of Object.entries(data["attributes"] || {})) {
        (rp as any)._attributes[k] = v;
      }

      this._participants[data["id"]] = rp;
    }

    this.emit("messaging_enabled", { message } as RoomMessageEvent);
  }

  private _onStreamOpen(message: RoomMessage): void {
    const from = [...this.remoteParticipants]
      .find((x) => x.id === message.fromParticipantId);

    if (!from) return; // or throw an error

    const streamId = message.message["stream_id"];
    const controller = new StreamController<MessageStreamChunk>(); // your streaming logic
    const reader = new MessageStreamReader({
      streamId,
      to: from,
      client: this,
      controller,
    });

    try {
      if (!this._onStreamAcceptCallback) {
        throw new Error("streams are not allowed by this client");
      }
      this._onStreamAcceptCallback(reader);
      // Send "stream.accept"
      this.sendMessage({
        to: from,
        type: "stream.accept",
        message: { stream_id: streamId },
      });
    } catch (e) {
      // Send "stream.reject"
      this.sendMessage({
        to: from,
        type: "stream.reject",
        message: { stream_id: streamId, error: String(e) },
      });
    }

    this._streamReaders[streamId] = reader;
    this.emit("stream_opened", { message } as RoomMessageEvent);
  }

  private _onStreamAccept(message: RoomMessage): void {
    const streamId = message.message["stream_id"];
    const writerCompleter = this._streamWriters[streamId];
    if (!writerCompleter) return;
    const from = [...this.remoteParticipants].find((x) => x.id === message.fromParticipantId);
    if (!from) return; // or throw an error

    writerCompleter.complete(
      new MessageStreamWriter({
        streamId,
        to: from,
        client: this,
      })
    );
  }

  private _onStreamReject(message: RoomMessage): void {
    const streamId = message.message["stream_id"];
    const writerCompleter = this._streamWriters[streamId];
    if (!writerCompleter) return;
    writerCompleter.completeError(new Error("The stream was rejected by the remote client"));
  }

  private _onStreamChunk(message: RoomMessage): void {
    const streamId = message.message["stream_id"];
    const reader = this._streamReaders[streamId];
    if (!reader) return;
    reader._controller.add(
      new MessageStreamChunk({
        header: message.message,
        data: message.attachment,
      })
    );
  }

  private _onStreamClose(message: RoomMessage): void {
    const streamId = message.message["stream_id"];
    const reader = this._streamReaders[streamId];
    if (!reader) return;
    reader._controller.close();
    delete this._streamReaders[streamId];
  }

  public override dispose(): void {
    super.dispose();

    this.client.protocol.removeHandler("messaging.send");
  }
}

/**
 * A MessageStreamWriter that can write chunked data or close the stream.
 */
export class MessageStreamWriter {
  private _streamId: string;
  private _to: Participant;
  private _client: MessagingClient;

  // Private constructor
  constructor({streamId, to, client}: {
    streamId: string;
    to: Participant;
    client: MessagingClient;
  }) {
    this._streamId = streamId;
    this._to = to;
    this._client = client;
  }

  public async write(chunk: MessageStreamChunk): Promise<void> {
    await this._client.sendMessage({
      to: this._to,
      type: "stream.chunk",
      message: { stream_id: this._streamId, header: chunk.header },
      attachment: chunk.data,
    });
  }

  public async close(): Promise<void> {
    await this._client.sendMessage({
      to: this._to,
      type: "stream.close",
      message: { stream_id: this._streamId },
    });
  }
}

/**
 * A MessageStreamReader that receives chunked data from the remote side.
 */
export class MessageStreamReader {
  public _streamId: string;
  public _to: Participant;
  public _client: MessagingClient;
  public _controller: StreamController<MessageStreamChunk>;

  // Private-like constructor
  constructor({streamId, to, client, controller}: {
    streamId: string;
    to: Participant;
    client: MessagingClient;
    controller: StreamController<MessageStreamChunk>;
  }) {
    this._streamId = streamId;
    this._to = to;
    this._client = client;
    this._controller = controller;
  }
}
