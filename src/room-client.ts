import { Completer } from "./completer";
import { DatasetsClient } from "./datasets-client";
import { DeveloperClient } from "./developer-client";
import { EventEmitter, type EventHandler, type EventName } from "./event-emitter";
import { MessagingClient } from "./messaging-client";
import { MemoryClient } from "./memory-client";
import { LocalParticipant } from "./participant";
import {
  Protocol,
  ProtocolCloseException,
  ProtocolCloseKind,
  ProtocolHandshakeException,
  ProtocolReconnectUnsupportedException,
  WebSocketClientProtocol,
  type MessageHandler,
  type ProtocolFactory,
} from "./protocol";
import { QueuesClient } from "./queues-client";
import { BinaryContent, ControlContent, EmptyContent, ErrorContent, FileContent, JsonContent, LinkContent, TextContent, unpackContent } from "./response";
import type { Content } from "./response";
import { RoomEvent, RoomStatusEvent } from "./room-event";
import { RoomServerException } from "./room-server-client";
import { SecretsClient, type OAuthTokenRequestHandler, type SecretRequestHandler } from "./secrets-client";
import { ServicesClient } from "./services-client";
import { StorageClient } from "./storage-client";
import { StreamController } from "./stream-controller";
import { SyncClient } from "./sync-client";
import { splitMessageHeader, splitMessagePayload, packMessage, unpackMessage } from "./utils";
import { AgentsClient, ToolkitDescription } from "./agent-client";
import { ContainersClient } from "./containers-client";

interface RequestHeader {
  [key: string]: unknown;
}

class ProtocolStartupFailure extends Error {
  public readonly kind: ProtocolCloseKind;
  public readonly reason: string | null;

  constructor({ kind, reason }: { kind: ProtocolCloseKind; reason: string | null }) {
    super(reason ?? kind);
    this.name = "ProtocolStartupFailure";
    this.kind = kind;
    this.reason = reason;
  }
}

type ProtocolConnectAttempt = (params: {
  protocol: Protocol;
  remaining: number | null;
}) => Promise<void>;

interface ProtocolRetryResult {
  connected: boolean;
  closeKind?: ProtocolCloseKind | null;
  closeReason?: string | null;
}

class RoomClientTerminalState {
  public readonly requestMessage: string;
  public readonly toolCallMessage: string;
  public readonly messageSendMessage: string;

  constructor({
    requestMessage,
    toolCallMessage,
    messageSendMessage,
  }: {
    requestMessage: string;
    toolCallMessage: string;
    messageSendMessage: string;
  }) {
    this.requestMessage = requestMessage;
    this.toolCallMessage = toolCallMessage;
    this.messageSendMessage = messageSendMessage;
  }

  public requestError(): RoomServerException {
    return new RoomServerException(this.requestMessage);
  }

  public toolCallError(): RoomServerException {
    return new RoomServerException(this.toolCallMessage);
  }

  public messageSendError(): RoomServerException {
    return new RoomServerException(this.messageSendMessage);
  }
}

class RoomConnectionStatusException extends RoomServerException {
  public readonly statusCode: number;

  constructor({
    statusCode,
    statusText,
  }: {
    statusCode: number;
    statusText?: string;
  }) {
    const normalizedStatusText = statusText?.trim();
    super(
      normalizedStatusText == null || normalizedStatusText.length === 0
        ? `websocket connect failed with status ${statusCode}`
        : `websocket connect failed with status ${statusCode}: ${normalizedStatusText}`,
    );
    this.name = "RoomConnectionStatusException";
    this.statusCode = statusCode;
  }
}

function normalizeCloseReason(reason: string | null | undefined): string | null {
  if (reason == null) {
    return null;
  }
  const normalized = reason.trim();
  return normalized.length === 0 ? null : normalized;
}

function wrapRoomConnectionError(error: unknown): RoomServerException {
  if (error instanceof RoomServerException) {
    return error;
  }
  if (error instanceof ProtocolHandshakeException) {
    return new RoomConnectionStatusException({
      statusCode: error.statusCode,
      statusText: error.statusText,
    });
  }
  if (error instanceof ProtocolCloseException) {
    return new RoomServerException(
      normalizeCloseReason(error.reason) ?? `room connection closed with status ${error.closeCode}`,
    );
  }
  return new RoomServerException(`room connection error: ${String(error)}`);
}

function nonRetryableConnectFailureReason(error: unknown): string | null {
  if (
    error instanceof RoomConnectionStatusException
    && (error.statusCode === 403 || error.statusCode === 404)
  ) {
    return error.message;
  }
  return null;
}

function roomClosedBeforeReadyError(protocol: Protocol): RoomServerException {
  return new RoomServerException(
    normalizeCloseReason(protocol.closeReason) ?? "room connection closed before request completed",
  );
}

function getEnvironmentValue(name: string): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }

  return process.env?.[name];
}

function websocketRoomUrlFromEnvironment(roomName: string): string {
  const configuredBaseUrl = getEnvironmentValue("MESHAGENT_ROOM_URL")
    ?? getEnvironmentValue("MESHAGENT_API_URL")
    ?? "wss://api.meshagent.com";

  let baseUrl = configuredBaseUrl;
  if (baseUrl.startsWith("https:")) {
    baseUrl = `wss:${baseUrl.slice("https:".length)}`;
  } else if (baseUrl.startsWith("http:")) {
    baseUrl = `ws:${baseUrl.slice("http:".length)}`;
  }

  return `${baseUrl}/rooms/${roomName}`;
}

function createProtocolFactoryFromEnvironment(): ProtocolFactory {
  const roomName = getEnvironmentValue("MESHAGENT_ROOM");
  const token = getEnvironmentValue("MESHAGENT_TOKEN");

  if (roomName == null || roomName.trim().length === 0 || token == null || token.trim().length === 0) {
    throw new Error(
      "protocolFactory must be configured or MESHAGENT_ROOM and MESHAGENT_TOKEN must be set in the environment",
    );
  }

  return WebSocketClientProtocol.createFactory({
    url: websocketRoomUrlFromEnvironment(roomName),
    token,
  });
}

export class RoomProtocolProxy {
  private readonly _room: RoomClient;
  private readonly _handlers = new Map<string, MessageHandler>();

  constructor({ room }: { room: RoomClient }) {
    this._room = room;
  }

  public _bind(protocol: Protocol): void {
    for (const [type, handler] of this._handlers.entries()) {
      if (protocol.getHandler(type) === handler) {
        continue;
      }
      protocol.addHandler(type, handler);
    }
  }

  public _unbind(protocol: Protocol): void {
    for (const [type, handler] of this._handlers.entries()) {
      const current = protocol.getHandler(type);
      if (current === handler) {
        protocol.removeHandler(type, handler);
      }
    }
  }

  public addHandler(type: string, handler: MessageHandler): void {
    if (this._handlers.has(type)) {
      throw new Error(`already registered handler for ${type}`);
    }
    this._handlers.set(type, handler);
    this._bind(this._room._protocolInstance);
  }

  public removeHandler(type: string, handler: MessageHandler): void {
    const registered = this._handlers.get(type);
    if (registered !== handler) {
      throw new Error(`handler mismatch for ${type}`);
    }
    this._handlers.delete(type);
    if (this._room._protocolInstance.getHandler(type) === handler) {
      this._room._protocolInstance.removeHandler(type, handler);
    }
  }

  public getHandler(type: string): MessageHandler | undefined {
    return this._handlers.get(type);
  }

  public async send(type: string, data: Uint8Array, { id }: { id?: number } = {}): Promise<void> {
    if (this._room._entered && !this._room.isConnected && !this._room._allowDisconnectedRequests) {
      throw this._room._disconnectedError({ baseMessage: "room connection is disconnected" });
    }
    await this._room._protocolInstance.send(type, data, id);
  }

  public sendNowait(type: string, data: Uint8Array, { id }: { id?: number } = {}): number {
    if (this._room._entered && !this._room.isConnected && !this._room._allowDisconnectedRequests) {
      throw this._room._disconnectedError({ baseMessage: "room connection is disconnected" });
    }
    return this._room._protocolInstance.sendNowait(type, data, { id });
  }

  public getNextMessageId(): number {
    if (this._room._entered && !this._room.isConnected && !this._room._allowDisconnectedRequests) {
      throw this._room._disconnectedError({ baseMessage: "room connection is disconnected" });
    }
    return this._room._protocolInstance.getNextMessageId();
  }

  public get done(): Promise<unknown> {
    return this._room.waitForClose();
  }

  public async waitForClose(): Promise<void> {
    await this._room.waitForClose();
  }

  public get closeKind(): ProtocolCloseKind | null {
    return this._room.closeKind;
  }

  public get closeReason(): string | null {
    return this._room.closeReason;
  }

  public get isOpen(): boolean {
    return this._room._protocolInstance.isOpen;
  }

  public get isClosed(): boolean {
    return this._room.isClosed;
  }

  public get token(): string | null {
    return this._room._protocolInstance.token;
  }

  public get url(): string | null {
    return this._room._protocolInstance.url;
  }
}

export class RoomClient {
  public readonly protocol: RoomProtocolProxy;

  public readonly sync: SyncClient;
  public readonly storage: StorageClient;
  public readonly developer: DeveloperClient;
  public readonly messaging: MessagingClient;
  public readonly queues: QueuesClient;
  public readonly datasets: DatasetsClient;
  public readonly agents: AgentsClient;
  public readonly secrets: SecretsClient;
  public readonly containers: ContainersClient;
  public readonly memory: MemoryClient;
  public readonly services: ServicesClient;

  public _protocolInstance: Protocol;
  public _entered = false;
  public _allowDisconnectedRequests = false;

  private readonly _protocolFactory: ProtocolFactory;
  private readonly _reconnectTimeout: number | null;
  private readonly _eventsController = new StreamController<RoomEvent>();
  private readonly _eventEmitter = new EventEmitter<RoomEvent>();
  private readonly _pendingRequests = new Map<number, Completer<Content>>();
  private readonly _toolCallStreams = new Map<string, StreamController<Content>>();
  private readonly _ignoredResponseLabels = new Map<number, string>();
  private readonly _ready = new Completer<void>();
  private readonly _roomClosed = new Completer<void>();

  private _connectionReady = new Completer<void>();
  private _localParticipantReady = new Completer<void>();
  private _connected = false;
  private _closing = false;
  private _localParticipant: LocalParticipant | null = null;
  private _lifecycleTask: Promise<void> | null = null;
  private _terminalState: RoomClientTerminalState | null = null;
  private _closeKind: ProtocolCloseKind | null = null;
  private _closeReason: string | null = null;
  private _doneHandler?: () => void;
  private _errorHandler?: (error: unknown) => void;
  private _terminalCallbacksInvoked = false;
  private _roomName: string | null = null;
  private _roomUrl: string | null = null;
  private _sessionId: string | null = null;

  private static readonly RECONNECT_RETRY_INTERVAL_MS = 1000;

  private readonly _handleRoomReadyBound = this._handleRoomReady.bind(this);
  private readonly _handleRoomStatusBound = this._handleRoomStatus.bind(this);
  private readonly _handleParticipantBound = this._handleParticipant.bind(this);
  private readonly _handleResponseBound = this._handleResponse.bind(this);
  private readonly _handleToolCallResponseChunkBound = this._handleToolCallResponseChunk.bind(this);

  constructor({
    protocolFactory = null,
    reconnectTimeout = null,
    oauthTokenRequestHandler,
    secretRequestHandler,
  }: {
    protocolFactory?: ProtocolFactory | null;
    reconnectTimeout?: number | null;
    oauthTokenRequestHandler?: OAuthTokenRequestHandler;
    secretRequestHandler?: SecretRequestHandler;
  } = {}) {
    if (reconnectTimeout != null && reconnectTimeout < 0) {
      throw new Error("reconnectTimeout must be null or non-negative");
    }

    this._protocolFactory = protocolFactory ?? createProtocolFactoryFromEnvironment();
    this._reconnectTimeout = reconnectTimeout;
    this._protocolInstance = this._protocolFactory();
    this.protocol = new RoomProtocolProxy({ room: this });

    this.protocol.addHandler("room_ready", this._handleRoomReadyBound);
    this.protocol.addHandler("room.status", this._handleRoomStatusBound);
    this.protocol.addHandler("connected", this._handleParticipantBound);
    this.protocol.addHandler("__response__", this._handleResponseBound);
    this.protocol.addHandler("room.tool_call_response_chunk", this._handleToolCallResponseChunkBound);

    this.sync = new SyncClient({ room: this });
    this.storage = new StorageClient({ room: this });
    this.developer = new DeveloperClient({ room: this });
    this.messaging = new MessagingClient({ room: this });
    this.queues = new QueuesClient({ room: this });
    this.datasets = new DatasetsClient({ room: this });
    this.agents = new AgentsClient({ room: this });
    this.secrets = new SecretsClient({
      room: this,
      oauthTokenRequestHandler,
      secretRequestHandler,
    });
    this.containers = new ContainersClient({ room: this });
    this.memory = new MemoryClient({ room: this });
    this.services = new ServicesClient({ room: this });
  }

  public get localParticipant(): LocalParticipant | null {
    return this._localParticipant;
  }

  public get ready(): Promise<void> {
    return this._ready.fut;
  }

  public get isConnected(): boolean {
    return this._connected;
  }

  public get isClosed(): boolean {
    return this._closing || this._terminalState != null || this._roomClosed.completed;
  }

  public get isClosing(): boolean {
    return this._closing;
  }

  public get closeKind(): ProtocolCloseKind | null {
    return this._closeKind ?? this._protocolInstance.closeKind;
  }

  public get closeReason(): string | null {
    return this._closeReason ?? normalizeCloseReason(this._protocolInstance.closeReason);
  }

  public get roomName(): string | null {
    return this._roomName;
  }

  public get roomUrl(): string | null {
    return this._roomUrl;
  }

  public get sessionId(): string | null {
    return this._sessionId;
  }

  public isActiveProtocol(protocol: Protocol): boolean {
    return protocol === this._protocolInstance;
  }

  public on(eventName: EventName, callback: EventHandler<RoomEvent>): void {
    this._eventEmitter.on(eventName, callback);
  }

  public off(eventName: EventName, callback: EventHandler<RoomEvent>): void {
    this._eventEmitter.off(eventName, callback);
  }

  public emit(event: RoomEvent): void {
    this._eventsController.add(event);
    this._eventEmitter.emit(event.name, event);
  }

  public listen({abortSignal}: {abortSignal?: AbortSignal} = {}): AsyncIterable<RoomEvent> {
    if (abortSignal === undefined || abortSignal === null) {
      return this._eventsController.stream;
    }

    const source = this._eventsController.stream;
    return {
      [Symbol.asyncIterator](): AsyncIterator<RoomEvent> {
        const eventIterator = source[Symbol.asyncIterator]();
        let abortReject: ((reason: unknown) => void) | null = null;
        let cleanedUp = false;

        const abortError = (): unknown => {
          if (abortSignal.reason != null) {
            return abortSignal.reason;
          }
          const error = new Error("Aborted");
          error.name = "AbortError";
          return error;
        };

        const cleanup = async (): Promise<void> => {
          if (cleanedUp) {
            return;
          }
          cleanedUp = true;
          abortSignal.removeEventListener("abort", onAbort);
          await eventIterator.return?.();
        };

        const onAbort = (): void => {
          const reject = abortReject;
          abortReject = null;
          reject?.(abortError());
          void cleanup();
        };

        abortSignal.addEventListener("abort", onAbort, { once: true });

        return {
          async next(): Promise<IteratorResult<RoomEvent>> {
            if (abortSignal.aborted) {
              await cleanup();
              return Promise.reject(abortError());
            }

            const abortPromise = new Promise<never>((_, reject) => {
              abortReject = reject;
            });

            try {
              const result = await Promise.race([eventIterator.next(), abortPromise]);
              if (result.done) {
                await cleanup();
              }
              return result;
            } catch (error) {
              await cleanup();
              throw error;
            } finally {
              abortReject = null;
            }
          },
          async return(): Promise<IteratorResult<RoomEvent>> {
            await cleanup();
            return { done: true, value: undefined as any };
          },
          async throw(e?: unknown): Promise<IteratorResult<RoomEvent>> {
            await cleanup();
            return Promise.reject(e);
          },
        };
      },
    };
  }

  public async waitForClose(): Promise<void> {
    await this._roomClosed.fut;
  }

  public async waitUntilConnected(): Promise<void> {
    while (!this._connected) {
      this._raiseIfTerminal();
      if (this._roomClosed.completed) {
        this._raiseIfTerminal();
        throw this._disconnectedError({
          baseMessage: "room connection closed before reconnect completed",
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  public async _waitUntilConnectedForMessages(): Promise<void> {
    while (!this._connected) {
      this._raiseIfTerminalForMessages();
      if (this._roomClosed.completed) {
        this._raiseIfTerminalForMessages();
        throw this._messageDisconnectedError({
          baseMessage: "room connection closed before message send completed",
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private _markConnected(): void {
    this._connected = true;
    this._closeKind = null;
    this._closeReason = null;
  }

  private _markDisconnected({
    reason,
    kind,
  }: {
    reason: string | null;
    kind: ProtocolCloseKind | null;
  }): void {
    this._connected = false;
    this._closeKind = kind;
    this._closeReason = normalizeCloseReason(reason);
    this._ignoredResponseLabels.clear();
  }

  private _completeRoomClosed(): void {
    if (!this._roomClosed.completed) {
      this._roomClosed.complete();
    }
  }

  private _invokeTerminalCallbacks({
    useErrorCallback,
    error,
  }: {
    useErrorCallback: boolean;
    error?: unknown;
  }): void {
    if (this._terminalCallbacksInvoked) {
      return;
    }
    this._terminalCallbacksInvoked = true;
    if (useErrorCallback) {
      this._errorHandler?.(error);
      return;
    }
    this._doneHandler?.();
  }

  private _formatClosedMessage({
    baseMessage,
    protocol,
    closeReason,
  }: {
    baseMessage: string;
    protocol?: Protocol;
    closeReason?: string | null;
  }): string {
    const normalized =
      normalizeCloseReason(closeReason) ??
      normalizeCloseReason((protocol ?? this._protocolInstance).closeReason);
    if (normalized == null) {
      return baseMessage;
    }
    return `${baseMessage}: ${normalized}`;
  }

  private _connectionFailureReason(error: unknown): string | null {
    if (error instanceof RoomServerException) {
      return normalizeCloseReason(error.message);
    }
    return normalizeCloseReason(String(error));
  }

  private _protocolTerminalState({ protocol }: { protocol?: Protocol } = {}): RoomClientTerminalState {
    return new RoomClientTerminalState({
      requestMessage: this._formatClosedMessage({
        baseMessage: "room connection closed before request completed",
        protocol,
      }),
      toolCallMessage: this._formatClosedMessage({
        baseMessage: "room connection closed before tool call completed",
        protocol,
      }),
      messageSendMessage: this._formatClosedMessage({
        baseMessage: "room connection closed before message send completed",
        protocol,
      }),
    });
  }

  private _clientClosedTerminalState(): RoomClientTerminalState {
    return new RoomClientTerminalState({
      requestMessage: "room client was closed before request completed",
      toolCallMessage: "room client was closed before tool call completed",
      messageSendMessage: "room client was closed before message send completed",
    });
  }

  private _unexpectedCloseTerminalState({
    closeReason,
  }: {
    closeReason: string | null;
  }): RoomClientTerminalState {
    return new RoomClientTerminalState({
      requestMessage: this._formatClosedMessage({
        baseMessage: "room connection unexpectedly closed before request completed",
        closeReason,
      }),
      toolCallMessage: this._formatClosedMessage({
        baseMessage: "room connection unexpectedly closed before tool call completed",
        closeReason,
      }),
      messageSendMessage: this._formatClosedMessage({
        baseMessage: "room connection unexpectedly closed before message send completed",
        closeReason,
      }),
    });
  }

  private _setStartupTerminalState({
    closeKind,
    closeReason,
    protocol,
  }: {
    closeKind: ProtocolCloseKind;
    closeReason: string | null;
    protocol?: Protocol;
  }): void {
    const normalizedCloseReason = normalizeCloseReason(closeReason);
    this._closeKind = closeKind;
    this._closeReason = normalizedCloseReason;
    if (closeKind === ProtocolCloseKind.ERROR) {
      this._setTerminalState({
        state: this._unexpectedCloseTerminalState({ closeReason: normalizedCloseReason }),
      });
    } else if (closeKind === ProtocolCloseKind.CLIENT) {
      this._setTerminalState({ state: this._clientClosedTerminalState() });
    } else {
      this._setTerminalState({ state: this._protocolTerminalState({ protocol }) });
    }
    if (!this._ready.completed) {
      this._ready.completeError(
        this._startupException({
          closeKind,
          closeReason: normalizedCloseReason,
          protocol,
        }),
      );
    }
    this._completeRoomClosed();
  }

  private _setTerminalState({ state }: { state: RoomClientTerminalState }): RoomClientTerminalState {
    if (this._terminalState == null) {
      this._terminalState = state;
    }
    return this._terminalState;
  }

  public _raiseIfTerminal(): void {
    if (this._terminalState != null) {
      throw this._terminalState.requestError();
    }
  }

  public _raiseIfTerminalForMessages(): void {
    if (this._terminalState != null) {
      throw this._terminalState.messageSendError();
    }
  }

  public _disconnectedError({ baseMessage }: { baseMessage: string }): RoomServerException {
    return new RoomServerException(
      this._formatClosedMessage({
        baseMessage,
      }),
    );
  }

  public _messageDisconnectedError({
    baseMessage,
  }: {
    baseMessage: string;
  }): RoomServerException {
    return new RoomServerException(
      this._formatClosedMessage({
        baseMessage,
      }),
    );
  }

  private _startupException({
    closeKind,
    closeReason,
    protocol,
  }: {
    closeKind: ProtocolCloseKind;
    closeReason: string | null;
    protocol?: Protocol;
  }): RoomServerException {
    const baseMessage =
      closeKind === ProtocolCloseKind.ERROR
        ? "room connection unexpectedly closed before the room became ready"
        : closeKind === ProtocolCloseKind.CLIENT
          ? "room client was closed before the room became ready"
          : "room connection closed before the room became ready";
    return new RoomServerException(
      this._formatClosedMessage({
        baseMessage,
        protocol,
        closeReason,
      }),
    );
  }

  private _finalizeInitialStartupRetryFailure({
    retryResult,
  }: {
    retryResult: ProtocolRetryResult;
  }): never {
    const closeKind = retryResult.closeKind ?? null;
    if (closeKind == null) {
      throw new Error("initial startup retry failure requires a close kind");
    }
    this._setStartupTerminalState({
      closeKind,
      closeReason: retryResult.closeReason ?? null,
      protocol: this._protocolInstance,
    });
    throw this._startupException({
      closeKind,
      closeReason: retryResult.closeReason ?? null,
      protocol: this._protocolInstance,
    });
  }

  public _coerceMessageSendError(error: RoomServerException): RoomServerException {
    if (this._terminalState == null) {
      return error;
    }
    if (
      error.message === this._terminalState.requestMessage ||
      error.message === this._terminalState.toolCallMessage
    ) {
      return this._terminalState.messageSendError();
    }
    return error;
  }

  public _messageStopError(): RoomServerException {
    if (this._closing && this._terminalState != null) {
      return this._terminalState.messageSendError();
    }
    return new RoomServerException("Cannot send messages because messaging has been stopped");
  }

  private _failPendingRequests(error: RoomServerException): void {
    if (this._pendingRequests.size === 0) {
      return;
    }
    const pending = [...this._pendingRequests.values()];
    this._pendingRequests.clear();
    for (const request of pending) {
      if (!request.completed) {
        request.completeError(error);
      }
    }
  }

  private async _failToolCallStreams({
    error,
  }: {
    error: RoomServerException;
  }): Promise<void> {
    if (this._toolCallStreams.size === 0) {
      return;
    }
    const streams = [...this._toolCallStreams.values()];
    this._toolCallStreams.clear();
    for (const stream of streams) {
      stream.add(new ErrorContent({ text: error.message }));
      stream.close();
    }
  }

  private async _failPendingWork({
    state,
  }: {
    state: RoomClientTerminalState;
  }): Promise<void> {
    this._failPendingRequests(state.requestError());
    await this._failToolCallStreams({ error: state.toolCallError() });
  }

  private async _openProtocol({ initial }: { initial: boolean }): Promise<void> {
    const protocol = this._protocolInstance;
    this._connectionReady = new Completer<void>();
    this._localParticipantReady = new Completer<void>();

    protocol.start({
      onDone: () => {
        const error = roomClosedBeforeReadyError(protocol);
        if (!this._connectionReady.completed) {
          this._connectionReady.completeError(error);
        }
        if (!this._localParticipantReady.completed) {
          this._localParticipantReady.completeError(error);
        }
        if (!initial && !this._ready.completed) {
          this._ready.completeError(error);
        }
      },
      onError: (error: unknown) => {
        const wrapped = wrapRoomConnectionError(error);
        if (!this._connectionReady.completed) {
          this._connectionReady.completeError(wrapped);
        }
        if (!this._localParticipantReady.completed) {
          this._localParticipantReady.completeError(wrapped);
        }
        if (!initial && !this._ready.completed) {
          this._ready.completeError(wrapped);
        }
      },
    });

    try {
      await Promise.all([this._connectionReady.fut, this._localParticipantReady.fut]);
    } catch (error) {
      const kind = protocol.closeKind ?? ProtocolCloseKind.ERROR;
      if (!initial && kind !== ProtocolCloseKind.ERROR) {
        throw new ProtocolStartupFailure({
          kind,
          reason: normalizeCloseReason(protocol.closeReason),
        });
      }
      throw error;
    }
  }

  public async start({
    onDone,
    onError,
  }: {
    onDone?: () => void;
    onError?: (error: unknown) => void;
  } = {}): Promise<void> {
    if (this._entered) {
      throw new RoomServerException("room client already started");
    }

    this._doneHandler = onDone;
    this._errorHandler = onError;

    try {
      try {
        await this._openProtocol({ initial: true });
      } catch (error) {
        if (error instanceof ProtocolStartupFailure) {
          if (error.kind !== ProtocolCloseKind.ERROR || this._reconnectTimeout === 0) {
            this._setStartupTerminalState({
              closeKind: error.kind,
              closeReason: error.reason,
              protocol: this._protocolInstance,
            });
            throw this._startupException({
              closeKind: error.kind,
              closeReason: error.reason,
              protocol: this._protocolInstance,
            });
          }

          await this._closeProtocol(this._protocolInstance);
          const retryResult = await this._retryProtocolConnection({
            disconnectReason: error.reason,
            protocolFactoryFailureLogMessage:
              "unable to create replacement room protocol during initial startup",
            attemptFailureLogMessage: "room startup attempt failed",
            attempt: this._attemptInitialProtocolStartup.bind(this),
          });
          if (!retryResult.connected) {
            this._finalizeInitialStartupRetryFailure({ retryResult });
          }
        } else {
          const nonRetryableCloseReason = nonRetryableConnectFailureReason(error);
          if (nonRetryableCloseReason != null) {
            this._finalizeInitialStartupRetryFailure({
              retryResult: {
                connected: false,
                closeKind: ProtocolCloseKind.ERROR,
                closeReason: nonRetryableCloseReason,
              },
            });
          }

          const closeKind = this._protocolInstance.closeKind;
          const protocolCloseReason = normalizeCloseReason(this._protocolInstance.closeReason);
          if (closeKind != null && closeKind !== ProtocolCloseKind.ERROR) {
            this._setStartupTerminalState({
              closeKind,
              closeReason: protocolCloseReason,
              protocol: this._protocolInstance,
            });
            throw this._startupException({
              closeKind,
              closeReason: protocolCloseReason,
              protocol: this._protocolInstance,
            });
          }

          const closeReason = this._connectionFailureReason(error);
          if (this._reconnectTimeout === 0) {
            this._setStartupTerminalState({
              closeKind: ProtocolCloseKind.ERROR,
              closeReason,
              protocol: this._protocolInstance,
            });
            throw this._startupException({
              closeKind: ProtocolCloseKind.ERROR,
              closeReason,
              protocol: this._protocolInstance,
            });
          }

          console.debug("room startup attempt failed", error);
          await this._closeProtocol(this._protocolInstance);
          const retryResult = await this._retryProtocolConnection({
            disconnectReason: closeReason,
            protocolFactoryFailureLogMessage:
              "unable to create replacement room protocol during initial startup",
            attemptFailureLogMessage: "room startup attempt failed",
            attempt: this._attemptInitialProtocolStartup.bind(this),
          });
          if (!retryResult.connected) {
            this._finalizeInitialStartupRetryFailure({ retryResult });
          }
        }
      }
      this.sync.start();
      this.messaging.start();
      this._entered = true;
      this._markConnected();
      this.messaging._onRoomReconnect();
      this._lifecycleTask = this._connectionLifecycle();
    } catch (error) {
      this.sync.dispose();
      void this.messaging.stop();
      this._protocolInstance.dispose();
      throw error;
    }

    await this.ready;
  }

  private async _completeReconnect(): Promise<void> {
    await this._openProtocol({ initial: false });
    this._allowDisconnectedRequests = true;
    try {
      this._resendLocalAttributesNowait();
      await this.sync._onRoomReconnect();
      this.messaging._onRoomReconnect();
      this._markConnected();
    } finally {
      this._allowDisconnectedRequests = false;
    }
  }

  private _replaceProtocol(nextProtocol: Protocol): void {
    const currentProtocol = this._protocolInstance;
    this.protocol._unbind(currentProtocol);
    this._protocolInstance = nextProtocol;
    this.protocol._bind(nextProtocol);
  }

  private _remainingReconnectTimeout(deadline: number | null): number | null {
    if (deadline == null) {
      return null;
    }
    const remaining = deadline - Date.now();
    return remaining <= 0 ? 0 : remaining;
  }

  private async _attemptInitialProtocolStartup({
    protocol,
    remaining,
  }: {
    protocol: Protocol;
    remaining: number | null;
  }): Promise<void> {
    void protocol;
    if (remaining == null) {
      await this._openProtocol({ initial: false });
      return;
    }

    await Promise.race([
      this._openProtocol({ initial: false }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("timeout")), remaining);
      }),
    ]);
  }

  private async _attemptReconnect({
    protocol,
    remaining,
  }: {
    protocol: Protocol;
    remaining: number | null;
  }): Promise<void> {
    try {
      if (remaining == null) {
        await this._completeReconnect();
      } else {
        await Promise.race([
          this._completeReconnect(),
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error("timeout")), remaining);
          }),
        ]);
      }
    } catch (error) {
      if (error instanceof ProtocolStartupFailure) {
        throw error;
      }
      if (error instanceof Error && error.message === "timeout") {
        this._allowDisconnectedRequests = false;
        await this.sync._onRoomDisconnect();
        this.messaging._onRoomDisconnect({ reason: normalizeCloseReason(protocol.closeReason) });
        throw error;
      }
      this._allowDisconnectedRequests = false;
      await this.sync._onRoomDisconnect();
      this.messaging._onRoomDisconnect({ reason: normalizeCloseReason(protocol.closeReason) });
      throw error;
    }
  }

  private _formatDuration(milliseconds: number): string {
    if (milliseconds % 1000 === 0) {
      return `${milliseconds / 1000}s`;
    }
    return `${milliseconds / 1000}s`;
  }

  private _reconnectTimeoutReason({
    disconnectReason,
  }: {
    disconnectReason: string | null;
  }): string {
    if (this._reconnectTimeout == null) {
      throw new Error("reconnect timeout reason requires a configured timeout");
    }
    const timeoutDisplay = this._formatDuration(this._reconnectTimeout);
    if (disconnectReason == null) {
      return `room reconnect timed out after ${timeoutDisplay}`;
    }
    return `room reconnect timed out after ${timeoutDisplay} (${disconnectReason})`;
  }

  private _timedOutRetryResult({
    disconnectReason,
  }: {
    disconnectReason: string | null;
  }): ProtocolRetryResult {
    if (this._reconnectTimeout == null) {
      throw new Error("timed out retry result requires a configured timeout");
    }

    return {
      connected: false,
      closeKind: ProtocolCloseKind.ERROR,
      closeReason: this._reconnectTimeoutReason({ disconnectReason }),
    };
  }

  private async _closeAfterUnexpectedDisconnect({
    closeReason,
  }: {
    closeReason: string | null;
  }): Promise<void> {
    const normalized = normalizeCloseReason(closeReason);
    const state = this._unexpectedCloseTerminalState({ closeReason: normalized });
    this._closeKind = ProtocolCloseKind.ERROR;
    this._closeReason = normalized;
    this._setTerminalState({ state });
    this._completeRoomClosed();
    this._invokeTerminalCallbacks({
      useErrorCallback: true,
      error: state.requestError(),
    });
  }

  private async _closeProtocol(protocol: Protocol): Promise<void> {
    protocol.dispose();
    await protocol.waitForClose();
  }

  private async _retryProtocolConnection({
    disconnectReason,
    protocolFactoryFailureLogMessage,
    attemptFailureLogMessage,
    attempt,
  }: {
    disconnectReason: string | null;
    protocolFactoryFailureLogMessage: string;
    attemptFailureLogMessage: string;
    attempt: ProtocolConnectAttempt;
  }): Promise<ProtocolRetryResult> {
    let failureReason = normalizeCloseReason(disconnectReason);

    const recordFailureReason = (reason: string | null): void => {
      const normalizedReason = normalizeCloseReason(reason);
      if (failureReason == null && normalizedReason != null) {
        failureReason = normalizedReason;
      }
    };

    const deadline =
      this._reconnectTimeout == null ? null : Date.now() + this._reconnectTimeout;
    let firstAttempt = true;

    while (!this._closing) {
      if (firstAttempt) {
        firstAttempt = false;
        if (this._reconnectTimeout == null) {
          await new Promise((resolve) =>
            setTimeout(resolve, RoomClient.RECONNECT_RETRY_INTERVAL_MS),
          );
        }
      } else {
        const remaining = this._remainingReconnectTimeout(deadline);
        if (remaining != null && remaining === 0) {
          return this._timedOutRetryResult({ disconnectReason: failureReason });
        }

        const delay =
          remaining == null
            ? RoomClient.RECONNECT_RETRY_INTERVAL_MS
            : Math.min(remaining, RoomClient.RECONNECT_RETRY_INTERVAL_MS);
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      const remaining = this._remainingReconnectTimeout(deadline);
      if (remaining != null && remaining === 0) {
        return this._timedOutRetryResult({ disconnectReason: failureReason });
      }

      let nextProtocol: Protocol;
      try {
        nextProtocol = this._protocolFactory();
      } catch (error) {
        if (error instanceof ProtocolReconnectUnsupportedException) {
          return {
            connected: false,
            closeKind: ProtocolCloseKind.ERROR,
            closeReason: failureReason,
          };
        }
        recordFailureReason(String(error));
        console.debug(protocolFactoryFailureLogMessage, error);
        continue;
      }

      this._replaceProtocol(nextProtocol);
      try {
        await attempt({ protocol: nextProtocol, remaining });
      } catch (error) {
        if (error instanceof Error && error.message === "timeout") {
          recordFailureReason(normalizeCloseReason(nextProtocol.closeReason));
          await this._closeProtocol(nextProtocol);
          return this._timedOutRetryResult({ disconnectReason: failureReason });
        }
        if (error instanceof ProtocolStartupFailure) {
          recordFailureReason(error.reason);
          await this._closeProtocol(nextProtocol);
          if (error.kind !== ProtocolCloseKind.ERROR) {
            return {
              connected: false,
              closeKind: error.kind,
              closeReason: error.reason,
            };
          }
          continue;
        }

        const nonRetryableCloseReason = nonRetryableConnectFailureReason(error);
        if (nonRetryableCloseReason != null) {
          await this._closeProtocol(nextProtocol);
          return {
            connected: false,
            closeKind: ProtocolCloseKind.ERROR,
            closeReason: nonRetryableCloseReason,
          };
        }

        recordFailureReason(this._connectionFailureReason(error));
        console.debug(attemptFailureLogMessage, error);
        await this._closeProtocol(nextProtocol);
        continue;
      }

      return { connected: true };
    }

    return {
      connected: false,
      closeKind: ProtocolCloseKind.CLIENT,
      closeReason: this.closeReason,
    };
  }

  private async _reconnect({
    disconnectReason,
  }: {
    disconnectReason: string | null;
  }): Promise<boolean> {
    const retryResult = await this._retryProtocolConnection({
      disconnectReason,
      protocolFactoryFailureLogMessage: "unable to create replacement room protocol",
      attemptFailureLogMessage: "room reconnect attempt failed",
      attempt: this._attemptReconnect.bind(this),
    });
    if (retryResult.connected) {
      this._emitStatus({
        status: "reconnected",
        message: "room connection restored",
      });
      return true;
    }

    const closeKind = retryResult.closeKind ?? null;
    if (closeKind === ProtocolCloseKind.ERROR) {
      const closeReason = retryResult.closeReason ?? null;
      if (closeReason != null && closeReason.startsWith("room reconnect timed out after")) {
        console.warn(`${closeReason}; closing room client`);
      }
      await this._closeAfterUnexpectedDisconnect({ closeReason });
      return false;
    }

    if (closeKind == null) {
      throw new Error("reconnect failure requires a close kind");
    }

    const state = this._protocolTerminalState({ protocol: this._protocolInstance });
    this._setTerminalState({ state });
    this._closeKind = closeKind;
    this._closeReason = normalizeCloseReason(retryResult.closeReason ?? null);
    this._completeRoomClosed();
    this._invokeTerminalCallbacks({ useErrorCallback: false });
    return false;
  }

  private async _connectionLifecycle(): Promise<void> {
    while (true) {
      const protocol = this._protocolInstance;
      await protocol.done;
      const closeKind = protocol.closeKind ?? ProtocolCloseKind.ERROR;
      const closeReason = normalizeCloseReason(protocol.closeReason);
      const state = this._protocolTerminalState({ protocol });

      if (this._closing) {
        this._completeRoomClosed();
        return;
      }

      if (closeKind !== ProtocolCloseKind.ERROR) {
        this._setTerminalState({ state });
      }

      this._markDisconnected({ reason: closeReason, kind: closeKind });
      this._emitStatus({
        status: "disconnected",
        message: closeReason ?? "room connection lost",
      });
      await this.sync._onRoomDisconnect();
      this.messaging._onRoomDisconnect({ reason: closeReason });
      await this._failPendingWork({ state });
      await this._closeProtocol(protocol);

      if (closeKind === ProtocolCloseKind.ERROR) {
        if (this._reconnectTimeout === 0) {
          if (closeReason == null) {
            console.warn("room connection lost; automatic reconnect disabled");
          } else {
            console.warn(`room connection lost (${closeReason}); automatic reconnect disabled`);
          }
          await this._closeAfterUnexpectedDisconnect({ closeReason });
          return;
        }

        if (closeReason == null) {
          console.warn("room connection lost; automatically attempting to reconnect");
        } else {
          console.warn(`room connection lost (${closeReason}); automatically attempting to reconnect`);
        }
        if (await this._reconnect({ disconnectReason: closeReason })) {
          continue;
        }
        return;
      }

      this._closeKind = closeKind;
      this._closeReason = closeReason;
      this._completeRoomClosed();
      this._invokeTerminalCallbacks({ useErrorCallback: false });
      return;
    }
  }

  public dispose(): void {
    this._closing = true;
    this._markDisconnected({
      reason: this.closeReason,
      kind: this.closeKind ?? ProtocolCloseKind.CLIENT,
    });
    const closingState = this._clientClosedTerminalState();
    this._setTerminalState({ state: closingState });
    this._failPendingRequests(closingState.requestError());
    void this._failToolCallStreams({ error: closingState.toolCallError() });
    this.sync.dispose();
    void this.messaging.stop();
    this._protocolInstance.dispose();
    this._entered = false;
    this._closeKind = ProtocolCloseKind.CLIENT;
    this._completeRoomClosed();
    this._invokeTerminalCallbacks({ useErrorCallback: false });
    this._localParticipant = null;
  }

  public _sendProtocolNowait({
    type,
    data,
    label,
    messageId,
    expectResponse = false,
  }: {
    type: string;
    data: Uint8Array;
    label: string;
    messageId?: number;
    expectResponse?: boolean;
  }): number | null {
    try {
      this._raiseIfTerminal();
    } catch (error) {
      console.debug(`skipping ${label} because the room is closed`, error);
      return null;
    }

    if (this._entered && !this._connected && !this._allowDisconnectedRequests) {
      console.debug(`skipping ${label} while room is disconnected`);
      return null;
    }

    const protocol = this._protocolInstance;
    const resolvedMessageId = messageId ?? protocol.getNextMessageId();
    if (expectResponse) {
      this._ignoredResponseLabels.set(resolvedMessageId, label);
    }

    try {
      protocol.sendNowait(type, data, { id: resolvedMessageId });
    } catch (error) {
      this._ignoredResponseLabels.delete(resolvedMessageId);
      if (this.isClosed) {
        console.debug(`skipping ${label} because the room is closed`, error);
      } else {
        console.warn(`unable to queue ${label}`, error);
      }
      return null;
    }

    return resolvedMessageId;
  }

  public _sendRoomRequestNowait(
    type: string,
    request: Record<string, unknown>,
    {
      data,
      label,
      expectResponse = false,
    }: {
      data?: Uint8Array;
      label: string;
      expectResponse?: boolean;
    },
  ): number | null {
    return this._sendProtocolNowait({
      type,
      data: packMessage(request, data),
      label,
      expectResponse,
    });
  }

  public invokeNowait({
    toolkit,
    tool,
    input,
    participantId,
    onBehalfOfId,
    callerContext,
  }: {
    toolkit: string;
    tool: string;
    input?: Content;
    participantId?: string;
    onBehalfOfId?: string;
    callerContext?: Record<string, unknown>;
  }): void {
    const resolvedInput = input ?? new EmptyContent();
    const packedInput = unpackMessage(resolvedInput.pack());
    const request: Record<string, unknown> = {
      toolkit,
      tool,
      participant_id: participantId,
      on_behalf_of_id: onBehalfOfId,
      caller_context: callerContext,
      tool_call_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      arguments: packedInput[0],
    };

    this._sendRoomRequestNowait("room.invoke_tool", request, {
      data: packedInput[1].length > 0 ? packedInput[1] : undefined,
      label: `${toolkit}.${tool}`,
      expectResponse: true,
    });
  }

  public _sendLocalAttributesNowait(attributes: Record<string, unknown>): void {
    this._sendProtocolNowait({
      type: "set_attributes",
      data: packMessage(attributes),
      label: "local participant attribute update",
    });
  }

  public _resendLocalAttributesNowait(): void {
    const localParticipant = this._localParticipant;
    if (localParticipant == null) {
      return;
    }
    const attributes = localParticipant._attributesSnapshot();
    if (Object.keys(attributes).length === 0) {
      return;
    }
    this._sendLocalAttributesNowait(attributes);
  }

  public async sendRequest(
    type: string,
    request: RequestHeader,
    data?: Uint8Array,
  ): Promise<Content> {
    this._raiseIfTerminal();
    if (this._entered && !this._connected && !this._allowDisconnectedRequests) {
      throw this._disconnectedError({ baseMessage: "room connection is disconnected" });
    }

    const requestId = this._protocolInstance.getNextMessageId();
    const completer = new Completer<Content>();
    this._pendingRequests.set(requestId, completer);

    try {
      await this._protocolInstance.send(type, packMessage(request, data), requestId);
      return await completer.fut;
    } catch (error) {
      this._pendingRequests.delete(requestId);
      throw error;
    }
  }

  public async call(params: {
    name: string;
    url: string;
    arguments: Record<string, unknown>;
  }): Promise<void> {
    await this.sendRequest("room.call", params);
  }

  public async listToolkits(params?: {
    participantId?: string;
    participantName?: string;
    timeout?: number;
  }): Promise<ToolkitDescription[]> {
    const request: Record<string, unknown> = {};
    if (params?.participantId != null) {
      request["participant_id"] = params.participantId;
    }
    if (params?.participantName != null) {
      request["participant_name"] = params.participantName;
    }
    if (params?.timeout !== undefined) {
      request["timeout"] = params.timeout;
    }

    const result = await this.sendRequest("room.list_toolkits", request);
    if (!(result instanceof JsonContent)) {
      throw new RoomServerException("unexpected return type from room.list_toolkits");
    }

    const tools = result.json["tools"];
    if (typeof tools !== "object" || tools === null || Array.isArray(tools)) {
      throw new RoomServerException("unexpected return type from room.list_toolkits");
    }

    const toolkits: ToolkitDescription[] = [];
    for (const [name, data] of Object.entries(tools as Record<string, unknown>)) {
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new RoomServerException("unexpected toolkit description from room.list_toolkits");
      }
      toolkits.push(ToolkitDescription.fromJson(data as Record<string, any>, { name }));
    }

    return toolkits;
  }

  public async invoke(params: {
    toolkit: string;
    tool: string;
    arguments?: Record<string, unknown>;
    input?: Record<string, unknown> | Content;
    participantId?: string;
    onBehalfOfId?: string;
    callerContext?: Record<string, unknown>;
  }): Promise<Content> {
    const input = params.input ?? params.arguments ?? new EmptyContent();
    const request: Record<string, unknown> = {
      toolkit: params.toolkit,
      tool: params.tool,
    };

    let requestData: Uint8Array | undefined;
    if (
      input instanceof BinaryContent ||
      input instanceof EmptyContent ||
      input instanceof ErrorContent ||
      input instanceof FileContent ||
      input instanceof JsonContent ||
      input instanceof LinkContent ||
      input instanceof TextContent
    ) {
      const packed = input.pack();
      request["arguments"] = JSON.parse(splitMessageHeader(packed));
      const payload = splitMessagePayload(packed);
      if (payload.length > 0) {
        requestData = payload;
      }
    } else if (typeof input === "object" && input !== null && !Array.isArray(input)) {
      request["arguments"] = {
        type: "json",
        json: input,
      };
    } else {
      throw new RoomServerException("invoke input must be a content value or JSON object");
    }

    if (params.participantId != null) {
      request["participant_id"] = params.participantId;
    }
    if (params.onBehalfOfId != null) {
      request["on_behalf_of_id"] = params.onBehalfOfId;
    }
    if (params.callerContext != null) {
      request["caller_context"] = params.callerContext;
    }

    return await this.sendRequest("room.invoke_tool", request, requestData);
  }

  public async invokeWithStreamInput(params: {
    toolkit: string;
    tool: string;
    input: AsyncIterable<Content>;
    participantId?: string;
    onBehalfOfId?: string;
    callerContext?: Record<string, unknown>;
  }): Promise<Content> {
    const toolCallId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const request: Record<string, unknown> = {
      toolkit: params.toolkit,
      tool: params.tool,
      tool_call_id: toolCallId,
      arguments: { type: "control", method: "open" },
    };
    if (params.participantId != null) {
      request["participant_id"] = params.participantId;
    }
    if (params.onBehalfOfId != null) {
      request["on_behalf_of_id"] = params.onBehalfOfId;
    }
    if (params.callerContext != null) {
      request["caller_context"] = params.callerContext;
    }

    const requestTask = this._streamInvokeToolRequestChunks(toolCallId, params.input);
    try {
      const response = await this.sendRequest("room.invoke_tool", request);
      await requestTask;
      if (response instanceof ControlContent && response.method === "open") {
        throw new RoomServerException(`unexpected return type from ${params.toolkit}.${params.tool}`);
      }
      return response;
    } catch (error) {
      await Promise.resolve(requestTask).catch(() => undefined);
      throw error;
    }
  }

  public async invokeStream(params: {
    toolkit: string;
    tool: string;
    input: AsyncIterable<Content>;
    participantId?: string;
    onBehalfOfId?: string;
    callerContext?: Record<string, unknown>;
  }): Promise<AsyncIterable<Content>> {
    const toolCallId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const controller = new StreamController<Content>();
    const responseIterator = controller.stream[Symbol.asyncIterator]();
    this._toolCallStreams.set(toolCallId, controller);

    const request: Record<string, unknown> = {
      toolkit: params.toolkit,
      tool: params.tool,
      tool_call_id: toolCallId,
      arguments: { type: "control", method: "open" },
    };
    if (params.participantId != null) {
      request["participant_id"] = params.participantId;
    }
    if (params.onBehalfOfId != null) {
      request["on_behalf_of_id"] = params.onBehalfOfId;
    }
    if (params.callerContext != null) {
      request["caller_context"] = params.callerContext;
    }

    const requestTask = this._streamInvokeToolRequestChunks(toolCallId, params.input);
    void requestTask.catch((error: unknown) => {
      const stream = this._toolCallStreams.get(toolCallId);
      if (stream == null) {
        return;
      }
      stream.add(new ErrorContent({ text: `request stream failed: ${String(error)}` }));
      stream.close();
      this._toolCallStreams.delete(toolCallId);
    });

    const response = await this.sendRequest("room.invoke_tool", request);
    if (!(response instanceof ControlContent) || response.method !== "open") {
      this._toolCallStreams.delete(toolCallId);
      controller.close();
      throw new RoomServerException(`unexpected return type from ${params.toolkit}.${params.tool}`);
    }

    return {
      [Symbol.asyncIterator](): AsyncIterator<Content> {
        return responseIterator;
      },
    };
  }

  private async _sendToolCallRequestChunk(toolCallId: string, chunk: Content): Promise<void> {
    const packed = chunk.pack();
    const request: Record<string, unknown> = {
      tool_call_id: toolCallId,
      chunk: JSON.parse(splitMessageHeader(packed)),
    };
    const payload = splitMessagePayload(packed);
    await this.sendRequest(
      "room.tool_call_request_chunk",
      request,
      payload.length > 0 ? payload : undefined,
    );
  }

  private async _streamInvokeToolRequestChunks(
    toolCallId: string,
    input: AsyncIterable<Content>,
  ): Promise<void> {
    await Promise.resolve();
    try {
      for await (const item of input) {
        await this._sendToolCallRequestChunk(toolCallId, item);
      }
    } finally {
      await this._sendToolCallRequestChunk(
        toolCallId,
        new ControlContent({ method: "close" }),
      );
    }
  }

  private _decodeToolCallContent(params: {
    header: Record<string, unknown>;
    payload: Uint8Array;
  }): Content {
    const chunk = params.header["chunk"];
    if (typeof chunk === "object" && chunk !== null && !Array.isArray(chunk)) {
      const chunkMap = chunk as Record<string, any>;
      if (typeof chunkMap["type"] === "string") {
        return unpackContent(
          packMessage(chunkMap, params.payload.length > 0 ? params.payload : undefined),
        );
      }
      return new JsonContent({ json: chunkMap });
    }

    return new JsonContent({ json: { chunk } });
  }

  private async _handleToolCallResponseChunk(
    protocol: Protocol,
    _messageId: number,
    _type: string,
    data: Uint8Array,
  ): Promise<void> {
    if (!this.isActiveProtocol(protocol)) {
      return;
    }

    const [header, payload] = unpackMessage(data);
    const toolCallId = header["tool_call_id"];
    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      return;
    }

    const stream = this._toolCallStreams.get(toolCallId);
    if (stream == null) {
      return;
    }

    const content = this._decodeToolCallContent({ header, payload });
    stream.add(content);

    if (content instanceof ControlContent && content.method === "close") {
      stream.close();
      this._toolCallStreams.delete(toolCallId);
    }
  }

  private async _handleResponse(
    protocol: Protocol,
    messageId: number,
    _type: string,
    data: Uint8Array,
  ): Promise<void> {
    if (!this.isActiveProtocol(protocol)) {
      return;
    }

    const response = unpackContent(data);
    const pending = this._pendingRequests.get(messageId);
    if (pending != null) {
      this._pendingRequests.delete(messageId);
      if (response instanceof ErrorContent) {
        pending.completeError(new RoomServerException(response.text, response.code));
      } else {
        pending.complete(response);
      }
      return;
    }

    const ignoredLabel = this._ignoredResponseLabels.get(messageId);
    if (ignoredLabel != null) {
      this._ignoredResponseLabels.delete(messageId);
      if (response instanceof ErrorContent) {
        console.warn(`one-way room request failed for ${ignoredLabel}: ${response.text}`);
      }
    }
  }

  private async _handleRoomStatus(
    protocol: Protocol,
    _messageId: number,
    _type: string,
    data: Uint8Array,
  ): Promise<void> {
    if (!this.isActiveProtocol(protocol)) {
      return;
    }
    const [payload] = unpackMessage(data);
    this.emit(RoomStatusEvent.fromJson(payload));
  }

  private async _handleRoomReady(
    protocol: Protocol,
    _messageId: number,
    _type: string,
    data: Uint8Array,
  ): Promise<void> {
    if (!this.isActiveProtocol(protocol)) {
      return;
    }
    const [message] = unpackMessage(data);
    this._roomName = typeof message["room_name"] === "string" ? message["room_name"] : null;
    this._roomUrl = typeof message["room_url"] === "string" ? message["room_url"] : null;
    this._sessionId = typeof message["session_id"] === "string" ? message["session_id"] : null;
    if (!this._ready.completed) {
      this._ready.complete();
    }
    if (!this._connectionReady.completed) {
      this._connectionReady.complete();
    }
  }

  private _onParticipantInit(
    participantId: string,
    attributes: Record<string, unknown>,
  ): void {
    if (this._localParticipant == null) {
      this._localParticipant = new LocalParticipant(this, participantId);
      this._localParticipant._setAttributes(attributes);
    } else {
      const merged = { ...attributes, ...this._localParticipant._attributesSnapshot() };
      this._localParticipant._replaceIdentity({
        participantId,
        attributes: merged,
      });
    }

    if (!this._localParticipantReady.completed) {
      this._localParticipantReady.complete();
    }
  }

  private async _handleParticipant(
    protocol: Protocol,
    _messageId: number,
    _type: string,
    data: Uint8Array,
  ): Promise<void> {
    if (!this.isActiveProtocol(protocol)) {
      return;
    }
    const [message] = unpackMessage(data);
    switch (message["type"]) {
      case "init": {
        const participantId = message["participantId"];
        const attributes = message["attributes"];
        if (
          typeof participantId === "string" &&
          typeof attributes === "object" &&
          attributes !== null &&
          !Array.isArray(attributes)
        ) {
          this._onParticipantInit(participantId, attributes as Record<string, unknown>);
        }
        break;
      }
      default:
        break;
    }
  }

  private _emitStatus({
    status,
    message,
  }: {
    status: string;
    message: string;
  }): void {
    this.emit(new RoomStatusEvent({ status, message }));
  }
}
