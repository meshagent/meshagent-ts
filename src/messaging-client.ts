import { Completer } from "./completer.js";
import { EventEmitter } from "./event-emitter.js";
import { Participant, RemoteParticipant } from "./participant.js";
import { Protocol } from "./protocol.js";
import { BinaryContent, JsonContent } from "./response.js";
import { RoomClient } from "./room-client.js";
import { RoomMessage, RoomMessageEvent } from "./room-event.js";
import { RoomServerException } from "./room-server-client.js";
import { splitMessageHeader, splitMessagePayload } from "./utils.js";

const globalScope = globalThis as typeof globalThis & {
  Buffer?: {
    from(data: Uint8Array): { toString(encoding: string): string };
  };
  btoa?: (data: string) => string;
};

function bytesToBase64(bytes: Uint8Array): string {
  if (globalScope.Buffer != null) {
    return globalScope.Buffer.from(bytes).toString("base64");
  }

  if (globalScope.btoa == null) {
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

export class MessagingClient extends EventEmitter<RoomMessageEvent> {
  private readonly client: RoomClient;
  private readonly _messageHandler = this._handleMessageSend.bind(this);
  private readonly _participants: Record<string, RemoteParticipant> = {};
  private readonly _messageQueue: QueuedRoomMessage[] = [];
  private _messageQueued: Completer<void> | null = null;
  private _sendTask: Promise<void> | null = null;
  private _messageQueueClosed = false;
  private _desiredEnabled = false;
  private _online = false;
  private _enableInFlight = false;

  constructor({ room }: { room: RoomClient }) {
    super();
    this.client = room;
    this.client.protocol.addHandler("messaging.send", this._messageHandler);
  }

  public get isEnabled(): boolean {
    return this._desiredEnabled;
  }

  public get online(): boolean {
    return this._online;
  }

  public get remoteParticipants(): RemoteParticipant[] {
    return Object.values(this._participants);
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

  private async _invoke({
    operation,
    input,
  }: {
    operation: string;
    input: Record<string, unknown>;
  }): Promise<void> {
    await this.client.invokeContent({
      toolkit: "messaging",
      tool: operation,
      input: new JsonContent({ json: input }),
    });
  }

  private _invokeNowait({
    operation,
    input,
  }: {
    operation: string;
    input: Record<string, unknown>;
  }): void {
    this.client.invokeNowait({
      toolkit: "messaging",
      tool: operation,
      input: new JsonContent({ json: input }),
    });
  }

  public start(): void {
    if (this._sendTask != null) {
      return;
    }

    this._messageQueueClosed = false;
    this._sendTask = this._sendMessages();
    if (this._desiredEnabled && this.client.isConnected) {
      this._enableCurrentConnectionNowait();
    }
  }

  public async stop(): Promise<void> {
    const stoppedError = this.client._messageStopError();

    this._messageQueueClosed = true;
    this._wakeMessageQueue();
    this._drainQueuedMessages({ error: stoppedError });

    const sendTask = this._sendTask;
    this._sendTask = null;
    if (sendTask != null) {
      await sendTask;
    }

    this._desiredEnabled = false;
    this._clearCurrentConnectionState();
  }

  private async _nextQueuedMessage(): Promise<QueuedRoomMessage | null> {
    while (true) {
      if (this._messageQueue.length > 0) {
        return this._messageQueue.shift() ?? null;
      }
      if (this._messageQueueClosed) {
        return null;
      }
      this._messageQueued ??= new Completer<void>();
      await this._messageQueued.fut;
    }
  }

  private _wakeMessageQueue(): void {
    const signal = this._messageQueued;
    this._messageQueued = null;
    if (signal != null && !signal.completed) {
      signal.complete();
    }
  }

  private _queueMessage(message: QueuedRoomMessage): void {
    if (this._messageQueueClosed) {
      throw new RoomServerException("Cannot send messages because messaging has been stopped");
    }
    this._messageQueue.push(message);
    this._wakeMessageQueue();
  }

  private _setOnline(online: boolean): void {
    if (this._online === online) {
      return;
    }
    this._online = online;
  }

  private async _waitUntilOnline(): Promise<void> {
    while (!this._online) {
      if (!this.client.isConnected && !this.client._allowDisconnectedRequests) {
        await this.client._waitUntilConnectedForMessages();
        continue;
      }
      this.client._raiseIfTerminalForMessages();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private _enableCurrentConnectionNowait(): void {
    if (this._online || this._enableInFlight) {
      return;
    }
    this._enableInFlight = true;
    this._invokeNowait({ operation: "enable", input: {} });
  }

  private _clearCurrentConnectionState(): void {
    this._enableInFlight = false;
    this._setOnline(false);
    if (Object.keys(this._participants).length === 0) {
      return;
    }
    for (const participantId of Object.keys(this._participants)) {
      this._removeParticipant(participantId);
    }
  }

  public _onRoomDisconnect({ reason: _reason }: { reason: string | null }): void {
    this._clearCurrentConnectionState();
  }

  public _onRoomReconnect(): void {
    if (this._desiredEnabled) {
      this._enableCurrentConnectionNowait();
    }
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
    if (this._participants[participant.id] !== undefined) {
      this._removeParticipant(participant.id);
    }
  }

  private _resolveMessageRecipient(to: Participant | null): Participant | null {
    if (to == null) {
      return null;
    }
    if (!(to instanceof RemoteParticipant)) {
      return to;
    }
    if (to.online === false) {
      return null;
    }
    return this._participants[to.id] ?? null;
  }

  private _dropQueuedMessage({
    message,
    error,
  }: {
    message: QueuedRoomMessage;
    error: RoomServerException;
  }): void {
    if (message.completer != null && !message.completer.completed) {
      message.completer.completeError(error);
    }
  }

  private _drainQueuedMessages({ error }: { error: RoomServerException }): void {
    while (this._messageQueue.length > 0) {
      const queued = this._messageQueue.shift();
      if (queued != null) {
        this._dropQueuedMessage({ message: queued, error });
      }
    }
  }

  private async _sendMessages(): Promise<void> {
    while (true) {
      const message = await this._nextQueuedMessage();
      if (message == null) {
        return;
      }

      try {
        await this.client._waitUntilConnectedForMessages();
        if (this._desiredEnabled) {
          await this._waitUntilOnline();
        }
      } catch (error) {
        if (error instanceof RoomServerException) {
          this._dropQueuedMessage({ message, error });
          this._drainQueuedMessages({ error });
        } else {
          const wrapped = new RoomServerException(String(error));
          this._dropQueuedMessage({ message, error: wrapped });
          this._drainQueuedMessages({ error: wrapped });
        }
        return;
      }

      const resolvedTo = this._resolveMessageRecipient(message.to);
      if (resolvedTo == null) {
        this._dropQueuedMessage({
          message,
          error: new RoomServerException("the participant was not found"),
        });
        continue;
      }

      try {
        await this._invoke({
          operation: "send",
          input: this._messageInput({
            toParticipantId: resolvedTo.id,
            type: message.type,
            message: message.message,
            attachment: message.attachment,
          }),
        });
        if (message.completer != null && !message.completer.completed) {
          message.completer.complete();
        }
      } catch (error) {
        if (error instanceof RoomServerException) {
          const wrapped = this.client._coerceMessageSendError(error);
          if (wrapped.message === "the participant was not found") {
            this._markParticipantOffline(message.to);
            this._dropQueuedMessage({ message, error: wrapped });
            continue;
          }
          this._dropQueuedMessage({ message, error: wrapped });
          continue;
        }

        if (message.completer != null && !message.completer.completed) {
          message.completer.completeError(error);
        }
      }
    }
  }

  public async sendMessage({
    to,
    type,
    message,
    attachment,
    ignoreOffline = false,
  }: {
    to: Participant;
    type: string;
    message: MessagePayload;
    attachment?: Uint8Array;
    ignoreOffline?: boolean;
  }): Promise<void> {
    if (this._sendTask == null) {
      throw new RoomServerException("Cannot send messages because messaging has not been started");
    }

    const queued: QueuedRoomMessage = {
      to,
      type,
      message,
      attachment,
      dropIfOffline: ignoreOffline,
      completer: ignoreOffline ? undefined : new Completer<void>(),
    };
    this._queueMessage(queued);
    if (queued.completer != null) {
      await queued.completer.fut;
    }
  }

  public sendMessageNowait({
    to,
    type,
    message,
    attachment,
  }: {
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

  public enable(): void {
    this._desiredEnabled = true;
    if (this.client.isConnected) {
      this._enableCurrentConnectionNowait();
    }
  }

  public disable(): void {
    const wasOnline = this._online;
    this._desiredEnabled = false;
    this._clearCurrentConnectionState();
    if (this.client.isConnected && wasOnline) {
      this._invokeNowait({ operation: "disable", input: {} });
    }
  }

  public async broadcastMessage({
    type,
    message,
    attachment,
  }: {
    type: string;
    message: MessagePayload;
    attachment?: Uint8Array;
  }): Promise<void> {
    if (this._sendTask == null) {
      throw new RoomServerException("Cannot send messages because messaging has not been started");
    }

    await this.client._waitUntilConnectedForMessages();
    if (this._desiredEnabled) {
      await this._waitUntilOnline();
    }

    try {
      await this._invoke({
        operation: "broadcast",
        input: this._messageInput({ type, message, attachment }),
      });
    } catch (error) {
      if (error instanceof RoomServerException) {
        throw this.client._coerceMessageSendError(error);
      }
      throw error;
    }
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

  private async _handleMessageSend(
    protocol: Protocol,
    _messageId: number,
    _type: string,
    bytes: Uint8Array,
  ): Promise<void> {
    if (!this.client.isActiveProtocol(protocol)) {
      return;
    }

    const headerStr = splitMessageHeader(bytes);
    const payload = splitMessagePayload(bytes);
    const header = JSON.parse(headerStr) as {
      from_participant_id: string;
      type: string;
      message: MessagePayload;
    };

    const message = new RoomMessage({
      fromParticipantId: header["from_participant_id"],
      type: header["type"],
      message: header["message"],
      attachment: payload.length > 0 ? payload : undefined,
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
      default:
        break;
    }

    const event = new RoomMessageEvent({ message });
    this.client.emit(event);
    this.emit("message", event);
  }

  private _onParticipantEnabled(message: RoomMessage): void {
    const data = message.message as {
      id: string;
      role: string;
      attributes?: Record<string, unknown>;
    };
    const participant = new RemoteParticipant(this.client, data.id, data.role, true);
    participant._setAttributes(data.attributes ?? {});
    this._participants[data.id] = participant;
    this.emit("participant_added", new RoomMessageEvent({ message }));
  }

  private _onParticipantAttributes(message: RoomMessage): void {
    const participant = this._participants[message.fromParticipantId];
    if (participant == null) {
      return;
    }
    participant._setAttributes(message.message["attributes"] as Record<string, unknown>);
    this.emit("participant_attributes_updated", new RoomMessageEvent({ message }));
  }

  private _onParticipantDisabled(message: RoomMessage): void {
    const removed = this._removeParticipant(String(message.message["id"]));
    if (removed != null) {
      this.emit("participant_removed", new RoomMessageEvent({ message }));
    }
  }

  private _onMessagingEnabled(message: RoomMessage): void {
    this._enableInFlight = false;
    for (const participantId of Object.keys(this._participants)) {
      delete this._participants[participantId];
    }

    const participants = message.message["participants"] as Array<{
      id: string;
      role: string;
      attributes?: Record<string, unknown>;
    }>;
    for (const data of participants) {
      const participant = new RemoteParticipant(this.client, data.id, data.role, true);
      participant._setAttributes(data.attributes ?? {});
      this._participants[data.id] = participant;
    }

    this._setOnline(true);
    if (!this._desiredEnabled) {
      this._invokeNowait({ operation: "disable", input: {} });
      this._clearCurrentConnectionState();
      return;
    }

    this.emit("messaging_enabled", new RoomMessageEvent({ message }));
  }

  public override dispose(): void {
    const error = new RoomServerException("messaging client disposed");
    this._messageQueueClosed = true;
    this._wakeMessageQueue();
    this._drainQueuedMessages({ error });
    this._desiredEnabled = false;
    this._clearCurrentConnectionState();
    this.client.protocol.removeHandler("messaging.send", this._messageHandler);
    super.dispose();
  }
}
