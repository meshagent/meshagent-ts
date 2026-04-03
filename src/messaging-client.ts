import { EventEmitter } from "./event-emitter";
import { Completer } from "./completer";
import { RoomClient } from "./room-client";
import { Protocol } from "./protocol";
import { Participant, RemoteParticipant } from "./participant";
import { RoomMessage, RoomMessageEvent } from "./room-event";
import { RoomServerException } from "./room-server-client";
import { splitMessageHeader, splitMessagePayload } from "./utils";

const globalScope = globalThis as typeof globalThis & {
  Buffer?: {
    from(data: Uint8Array): { toString(encoding: string): string };
  };
  btoa?: (data: string) => string;
};

function bytesToBase64(bytes: Uint8Array): string {
  if (globalScope.Buffer) {
    return globalScope.Buffer.from(bytes).toString("base64");
  }

  if (!globalScope.btoa) {
    throw new Error("base64 encoding is not available in this runtime");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalScope.btoa(binary);
}

type MessagePayload = Record<string, unknown>;

interface QueuedRoomMessage {
  to: Participant;
  type: string;
  message: MessagePayload;
  attachment?: Uint8Array;
  dropIfOffline: boolean;
  completer?: Completer<void>;
}


/**
 * The main MessagingClient class, which handles sending messages,
 * managing participant information.
 */
export class MessagingClient extends EventEmitter<RoomMessageEvent> {
  private readonly client: RoomClient;
  private readonly _messageHandler = this._handleMessageSend.bind(this);
  private readonly _participants: Record<string, RemoteParticipant> = {};
  private readonly _messageQueue: QueuedRoomMessage[] = [];
  private _messageQueued: Completer<void> | null = null;
  private _sendTask: Promise<void> | null = null;
  private _messageQueueClosed = false;
  private _enabled = false;

  constructor({room}: {room: RoomClient}) {
    super();

    this.client = room;

    this.client.protocol.addHandler("messaging.send", this._messageHandler);
  }

  private _messageInput(params: {
    type: string;
    message: MessagePayload;
    attachment?: Uint8Array;
    toParticipantId?: string;
  }): Record<string, unknown> {
    const input: Record<string, unknown> = {
      type: params.type,
      message_json: JSON.stringify(params.message),
    };

    if (params.attachment !== undefined) {
      input["attachment_base64"] = bytesToBase64(params.attachment);
    }

    if (params.toParticipantId !== undefined) {
      input["to_participant_id"] = params.toParticipantId;
    }

    return input;
  }

  private _syntheticMessageEvent(params: {
    fromParticipantId: string;
    type: string;
    message: MessagePayload;
  }): RoomMessageEvent {
    return new RoomMessageEvent({
      message: new RoomMessage({
        fromParticipantId: params.fromParticipantId,
        type: params.type,
        message: params.message,
        local: true,
      }),
    });
  }

  private _removeParticipant(participantId: string): RemoteParticipant | undefined {
    const participant = this._participants[participantId];
    if (participant === undefined) {
      return undefined;
    }

    participant._setOnline(false);
    delete this._participants[participantId];

    return participant;
  }

  private _markParticipantOffline(participant: Participant | null): void {
    if (!(participant instanceof RemoteParticipant)) {
      return;
    }

    participant._setOnline(false);
    const current = this._participants[participant.id];
    if (current === undefined) {
      return;
    }

    this._removeParticipant(participant.id);
    this.emit(
      "participant_removed",
      this._syntheticMessageEvent({
        fromParticipantId: participant.id,
        type: "participant.disabled",
        message: { id: participant.id },
      }),
    );
  }

  private _resolveMessageRecipient(to: Participant): Participant | null {
    if (!(to instanceof RemoteParticipant)) {
      return to;
    }

    if (to.online === false) {
      return null;
    }

    return this._participants[to.id] ?? null;
  }

  private _queueMessage(message: QueuedRoomMessage): void {
    if (this._sendTask === null) {
      throw new RoomServerException("Cannot send messages because messaging has not been started");
    }

    this._messageQueue.push(message);
    const waiter = this._messageQueued;
    if (waiter !== null) {
      this._messageQueued = null;
      waiter.complete();
    }
  }

  private _rejectQueuedMessages(error: RoomServerException): void {
    while (this._messageQueue.length > 0) {
      const message = this._messageQueue.shift();
      message?.completer?.completeError(error);
    }
  }

  private _isParticipantNotFound(error: unknown): error is RoomServerException {
    return error instanceof RoomServerException && error.message === "the participant was not found";
  }

  private async _nextQueuedMessage(): Promise<QueuedRoomMessage | null> {
    while (this._messageQueue.length === 0) {
      if (this._messageQueueClosed) {
        return null;
      }
      if (this._messageQueued === null) {
        this._messageQueued = new Completer<void>();
      }
      await this._messageQueued.fut;
    }

    return this._messageQueue.shift() ?? null;
  }

  private async _sendMessages(): Promise<void> {
    while (true) {
      const queued = await this._nextQueuedMessage();
      if (queued === null) {
        return;
      }

      const resolvedTo = this._resolveMessageRecipient(queued.to);
      if (resolvedTo === null) {
        const error = new RoomServerException("the participant was not found");
        if (queued.dropIfOffline) {
          queued.completer?.complete();
        } else {
          queued.completer?.completeError(error);
        }
        continue;
      }

      try {
        await this.client.invoke({
          toolkit: "messaging",
          tool: "send",
          input: this._messageInput({
            toParticipantId: resolvedTo.id,
            type: queued.type,
            message: queued.message,
            attachment: queued.attachment,
          }),
        });
        queued.completer?.complete();
      } catch (error) {
        if (this._isParticipantNotFound(error)) {
          this._markParticipantOffline(queued.to);
          if (queued.dropIfOffline) {
            queued.completer?.complete();
            continue;
          }
        }

        queued.completer?.completeError(error);
      }
    }
  }

  public async start(): Promise<void> {
    if (this._sendTask !== null) {
      return;
    }

    this._messageQueueClosed = false;
    this._sendTask = this._sendMessages();
  }

  public async stop(): Promise<void> {
    if (this._sendTask === null) {
      this._enabled = false;
      return;
    }

    this._messageQueueClosed = true;
    const waiter = this._messageQueued;
    if (waiter !== null) {
      this._messageQueued = null;
      waiter.complete();
    }

    const sendTask = this._sendTask;
    this._sendTask = null;
    await sendTask;
    this._enabled = false;
  }

  /**
   * Sends a message to a given participant, optionally with a binary attachment.
   */
  public async sendMessage({to, type, message, attachment, ignoreOffline = false}: {
    to: Participant;
    type: string;
    message: MessagePayload;
    attachment?: Uint8Array;
    ignoreOffline?: boolean;
  }): Promise<void> {
    const completer = new Completer<void>();
    this._queueMessage({
      to,
      type,
      message,
      attachment,
      dropIfOffline: ignoreOffline,
      completer,
    });
    await completer.fut;
  }

  public sendMessageNowait({to, type, message, attachment}: {
    to: Participant;
    type: string;
    message: MessagePayload;
    attachment?: Uint8Array;
  }): void {
    this._queueMessage({
      to,
      type,
      message,
      attachment,
      dropIfOffline: true,
    });
  }

  /**
   * Enables the messaging subsystem.
   */
  public async enable(): Promise<void> {
    await this.client.invoke({
      toolkit: "messaging",
      tool: "enable",
      input: {},
    });
    this._enabled = true;
  }

  /**
   * Disables the messaging subsystem.
   */
  public async disable(): Promise<void> {
    await this.client.invoke({
      toolkit: "messaging",
      tool: "disable",
      input: {},
    });
    this._enabled = false;
  }

  /**
   * Broadcasts a message to all participants.
   */
  public async broadcastMessage({type, message, attachment}: {
    type: string;
    message: MessagePayload;
    attachment?: Uint8Array;
  }): Promise<void> {
    await this.client.invoke({
      toolkit: "messaging",
      tool: "broadcast",
      input: this._messageInput({ type, message, attachment }),
    });
  }

  /**
   * Returns an iterable of remote participants.
   */
  public get remoteParticipants(): RemoteParticipant[] {
    return Object.values(this._participants);
  }

  public get isEnabled(): boolean {
    return this._enabled;
  }

  public getParticipants(): RemoteParticipant[] {
    return this.remoteParticipants;
  }

  public getParticipant(id: string): RemoteParticipant | null {
    return this._participants[id] ?? null;
  }

  public getParticipantByName(name: string): RemoteParticipant | null {
    for (const participant of this.remoteParticipants) {
      if (participant.getAttribute("name") === name) {
        return participant;
      }
    }

    return null;
  }

  /**
   * Internal handler for "messaging.send" events from the protocol.
   */
  private async _handleMessageSend(protocol: Protocol, messageId: number, type: string, bytes?: Uint8Array): Promise<void> {
    const headerStr = splitMessageHeader(bytes || new Uint8Array());
    const payload = splitMessagePayload(bytes || new Uint8Array());

    const header = JSON.parse(headerStr) as {
      from_participant_id: string;
      type: string;
      message: MessagePayload;
    };
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
    }

    const messageEvent = new RoomMessageEvent({ message });

    // Add to events
    this.client.emit(messageEvent);

    this.emit("message", messageEvent);
  }

  private _onParticipantEnabled(message: RoomMessage): void {
    const data = message.message as {
      id: string;
      role: string;
      attributes?: Record<string, unknown>;
    };
    const p = new RemoteParticipant(this.client, data["id"], data["role"], true);
    p._setAttributes(data["attributes"] ?? {});
    this._participants[data["id"]] = p;
    this.emit("participant_added", { message } as RoomMessageEvent);
  }

  private _onParticipantAttributes(message: RoomMessage): void {
    const part = this._participants[message.fromParticipantId];
    if (!part) {
      return;
    }
    const attrObj = message.message["attributes"] as Record<string, unknown>;
    part._setAttributes(attrObj);

    this.emit("participant_attributes_updated", { message } as RoomMessageEvent);
  }

  private _onParticipantDisabled(message: RoomMessage): void {
    const part = this._removeParticipant(message.message["id"]);

    if (part) {
      this.emit("participant_removed", { message } as RoomMessageEvent);
    }
  }

  private _onMessagingEnabled(message: RoomMessage): void {
    const participants = message.message["participants"] as Array<{
      id: string;
      role: string;
      attributes?: Record<string, unknown>;
    }>;

    for (const data of participants) {
      const rp = new RemoteParticipant(this.client, data["id"], data["role"], true);
      rp._setAttributes(data["attributes"] ?? {});
      this._participants[data["id"]] = rp;
    }

    this._enabled = true;
    this.emit("messaging_enabled", { message } as RoomMessageEvent);
  }

  public override dispose(): void {
    const error = new RoomServerException("messaging client disposed");
    this._messageQueueClosed = true;
    this._enabled = false;
    this._rejectQueuedMessages(error);
    const waiter = this._messageQueued;
    if (waiter !== null) {
      this._messageQueued = null;
      waiter.complete();
    }

    super.dispose();

    this.client.protocol.removeHandler("messaging.send");
  }
}
