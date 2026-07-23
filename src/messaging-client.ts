import { Completer } from "./completer.js";
import { EventEmitter } from "./event-emitter.js";
import { Participant, RemoteParticipant } from "./participant.js";
import { Protocol } from "./protocol.js";
import { BinaryContent, Content, JsonContent } from "./response.js";
import { RoomClient } from "./room-client.js";
import { RoomMessage, RoomMessageEvent } from "./room-event.js";
import { RoomServerException } from "./room-server-client.js";
import { splitMessageHeader, splitMessagePayload } from "./utils.js";

const globalScope = globalThis as typeof globalThis & {
  Buffer?: {
    from(data: Uint8Array | string, encoding?: string): Uint8Array & {
      toString(encoding: string): string;
    };
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

function base64ToBytes(value: string): Uint8Array {
  if (globalScope.Buffer != null) {
    return new Uint8Array(globalScope.Buffer.from(value, "base64") as unknown as Uint8Array);
  }
  const atob = (globalThis as typeof globalThis & { atob?: (data: string) => string }).atob;
  if (atob == null) {
    throw new Error("base64 decoding is not available in this runtime");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

type MessagePayload = Record<string, unknown>;

export type MessagingStreamEvent =
  | { kind: "message"; message: RoomMessage }
  | { kind: "client_disconnected"; streamId: string; participantId: string }
  | { kind: "closed"; streamId: string; reason: string; message?: string };

interface MessagingStreamInputItem {
  content: Content;
  sent?: Completer<void>;
}

class MessagingStreamInput {
  private readonly items: MessagingStreamInputItem[] = [];
  private signal: Completer<void> | null = null;
  private active: MessagingStreamInputItem | null = null;
  private closed = false;
  private error: unknown = null;

  public enqueue(content: Content, { wait = false }: { wait?: boolean } = {}): Promise<void> {
    if (this.closed) {
      return Promise.reject(this.error ?? new RoomServerException("the messaging stream is closed"));
    }
    const sent = wait ? new Completer<void>() : undefined;
    this.items.push({ content, sent });
    this.signal?.resolve();
    this.signal = null;
    return sent?.fut ?? Promise.resolve();
  }

  public close(error: unknown = new RoomServerException("the messaging stream is closed")): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.error = error;
    this.active?.sent?.reject(error);
    this.active = null;
    for (const item of this.items.splice(0)) {
      item.sent?.reject(error);
    }
    this.signal?.resolve();
    this.signal = null;
  }

  public fail(error: unknown): void {
    this.close(error);
  }

  public async *stream(): AsyncIterable<Content> {
    try {
      while (true) {
        while (this.items.length === 0 && !this.closed) {
          this.signal ??= new Completer<void>();
          await this.signal.fut;
        }
        const item = this.items.shift();
        if (item == null) {
          return;
        }
        this.active = item;
        yield item.content;
        item.sent?.resolve();
        this.active = null;
      }
    } finally {
      if (this.active != null && this.closed) {
        this.active.sent?.reject(this.error ?? new RoomServerException("the messaging stream is closed"));
        this.active = null;
      }
    }
  }
}

export class MessagingStream implements AsyncIterable<MessagingStreamEvent> {
  public readonly streamId: string;
  public readonly remoteParticipantId: string;
  private readonly input: MessagingStreamInput;
  private readonly output: AsyncIterator<Content>;
  private readonly inputDone: Promise<void>;
  private readonly onClosed: () => void;
  private readonly events: MessagingStreamEvent[] = [];
  private eventSignal: Completer<void> | null = null;
  private _closed = false;

  constructor({
    streamId,
    remoteParticipantId,
    input,
    output,
    inputClosed,
    onClosed,
  }: {
    streamId: string;
    remoteParticipantId: string;
    input: MessagingStreamInput;
    output: AsyncIterator<Content>;
    inputClosed?: Promise<void>;
    onClosed: () => void;
  }) {
    this.streamId = streamId;
    this.remoteParticipantId = remoteParticipantId;
    this.input = input;
    this.output = output;
    this.inputDone = Promise.resolve(inputClosed).catch((error: unknown) => {
      this.input.fail(error);
    });
    this.onClosed = onClosed;
    void this.consumeOutput();
  }

  public get closed(): boolean {
    return this._closed;
  }

  private push(event: MessagingStreamEvent): void {
    if (this._closed) {
      return;
    }
    this.events.push(event);
    this.eventSignal?.resolve();
    this.eventSignal = null;
  }

  private finish(): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this.input.close();
    this.eventSignal?.resolve();
    this.eventSignal = null;
    void this.inputDone.finally(this.onClosed);
  }

  private async consumeOutput(): Promise<void> {
    try {
      while (true) {
        const next = await this.output.next();
        if (next.done) {
          return;
        }
        if (!(next.value instanceof JsonContent)) {
          throw new RoomServerException("unexpected chunk from messaging.stream");
        }
        const value = next.value.json;
        const kind = value["kind"];
        if (kind === "message") {
          const type = value["type"];
          const message = value["message"];
          if (typeof type !== "string" || typeof message !== "object" || message == null || Array.isArray(message)) {
            throw new RoomServerException("invalid message chunk from messaging.stream");
          }
          const encodedAttachment = value["attachment_base64"];
          this.push({
            kind: "message",
            message: new RoomMessage({
              fromParticipantId: this.remoteParticipantId,
              type,
              message: message as MessagePayload,
              attachment: typeof encodedAttachment === "string" && encodedAttachment !== ""
                ? base64ToBytes(encodedAttachment)
                : undefined,
            }),
          });
        } else if (kind === "client_disconnected" && typeof value["participant_id"] === "string") {
          this.push({
            kind,
            streamId: this.streamId,
            participantId: value["participant_id"],
          });
          return;
        } else if (kind === "closed") {
          this.push({
            kind,
            streamId: this.streamId,
            reason: typeof value["reason"] === "string" ? value["reason"] : "closed",
            message: typeof value["message"] === "string" ? value["message"] : undefined,
          });
          return;
        }
      }
    } catch (error) {
      this.input.fail(error);
      this.push({
        kind: "closed",
        streamId: this.streamId,
        reason: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.finish();
    }
  }

  private content({
    type,
    message,
    attachment,
  }: {
    type: string;
    message: MessagePayload;
    attachment?: Uint8Array;
  }): JsonContent {
    return new JsonContent({
      json: {
        type,
        message_json: JSON.stringify(message),
        ...(attachment == null ? {} : { attachment_base64: bytesToBase64(attachment) }),
      },
    });
  }

  public sendMessageNowait(params: {
    type: string;
    message: MessagePayload;
    attachment?: Uint8Array;
  }): void {
    if (this._closed) {
      throw new RoomServerException("the messaging stream is closed");
    }
    void this.input.enqueue(this.content(params));
  }

  public async sendMessage(params: {
    type: string;
    message: MessagePayload;
    attachment?: Uint8Array;
  }): Promise<void> {
    await this.input.enqueue(this.content(params), { wait: true });
  }

  public async close(): Promise<void> {
    if (this._closed) {
      await this.inputDone;
      return;
    }
    this.input.close();
    try {
      await this.inputDone;
    } finally {
      await this.output.return?.();
      this.finish();
    }
  }

  public clientDisconnected(participantId: string): void {
    if (this._closed) {
      return;
    }
    this.push({
      kind: "client_disconnected",
      streamId: this.streamId,
      participantId,
    });
    this.finish();
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<MessagingStreamEvent> {
    while (true) {
      while (this.events.length === 0 && !this._closed) {
        this.eventSignal ??= new Completer<void>();
        await this.eventSignal.fut;
      }
      const event = this.events.shift();
      if (event == null) {
        return;
      }
      yield event;
    }
  }
}

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
  private readonly _sendOperations = new Set<Promise<void>>();
  private readonly _streams = new Set<MessagingStream>();
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
    afterSend,
  }: {
    operation: string;
    input: Record<string, unknown>;
    afterSend?: () => void;
  }): Promise<void> {
    await this.client.invokeContent({
      toolkit: "messaging",
      tool: operation,
      input: new JsonContent({ json: input }),
      afterSend,
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
    await Promise.all(this._sendOperations);
    await Promise.all([...this._streams].map(async (stream) => stream.close()));

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
    for (const stream of [...this._streams]) {
      stream.clientDisconnected(this.client.localParticipant?.id ?? stream.remoteParticipantId);
    }
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

      // Preserve queue-order dispatch without making the next message wait for
      // this request's round trip.
      const dispatched = new Completer<void>();
      const operation = this._sendQueuedMessage({
        message,
        resolvedTo,
        afterSend: () => dispatched.resolve(),
      });
      this._sendOperations.add(operation);
      void operation.then(
        () => {
          this._sendOperations.delete(operation);
          if (!dispatched.completed) dispatched.resolve();
        },
        () => {
          this._sendOperations.delete(operation);
          if (!dispatched.completed) dispatched.resolve();
        },
      );
      await dispatched.fut;
    }
  }

  private async _sendQueuedMessage({
    message,
    resolvedTo,
    afterSend,
  }: {
    message: QueuedRoomMessage;
    resolvedTo: Participant;
    afterSend: () => void;
  }): Promise<void> {
    try {
      await this._invoke({
        operation: "send",
        input: this._messageInput({
          toParticipantId: resolvedTo.id,
          type: message.type,
          message: message.message,
          attachment: message.attachment,
        }),
        afterSend,
      });
      if (message.completer != null && !message.completer.completed) {
        message.completer.complete();
      }
    } catch (error) {
      if (error instanceof RoomServerException) {
        const wrapped = this.client._coerceMessageSendError(error);
        if (wrapped.message === "the participant was not found") {
          this._markParticipantOffline(message.to);
        }
        this._dropQueuedMessage({ message, error: wrapped });
        return;
      }

      if (message.completer != null && !message.completer.completed) {
        message.completer.completeError(error);
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

  public async stream({
    to,
    type,
    message,
    attachment,
  }: {
    to: Participant;
    type: string;
    message: MessagePayload;
    attachment?: Uint8Array;
  }): Promise<MessagingStream> {
    const input = new MessagingStreamInput();
    void input.enqueue(new JsonContent({
      json: {
        to_participant_id: to.id,
        type,
        message_json: JSON.stringify(message),
        ...(attachment == null ? {} : { attachment_base64: bytesToBase64(attachment) }),
      },
    }));
    const outputResult = await this.client.invokeToolCall({
      toolkit: "messaging",
      tool: "stream",
      input: input.stream(),
      streamInput: true,
    });
    if (outputResult.kind !== "stream") {
      input.close();
      throw new RoomServerException("unexpected return type from messaging.stream");
    }
    const outputIterable = outputResult.stream;
    const output = outputIterable[Symbol.asyncIterator]();
    const accepted = await output.next();
    if (
      accepted.done
      || !(accepted.value instanceof JsonContent)
      || accepted.value.json["kind"] !== "accepted"
      || typeof accepted.value.json["stream_id"] !== "string"
    ) {
      input.close();
      await output.return?.();
      throw new RoomServerException("messaging.stream did not acknowledge acceptance");
    }
    let stream: MessagingStream;
    stream = new MessagingStream({
      streamId: accepted.value.json["stream_id"],
      remoteParticipantId: to.id,
      input,
      output,
      inputClosed: outputResult.inputClosed,
      onClosed: () => this._streams.delete(stream),
    });
    this._streams.add(stream);
    return stream;
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
    for (const stream of [...this._streams]) {
      stream.clientDisconnected(this.client.localParticipant?.id ?? stream.remoteParticipantId);
    }
    this._clearCurrentConnectionState();
    this.client.protocol.removeHandler("messaging.send", this._messageHandler);
    super.dispose();
  }
}
