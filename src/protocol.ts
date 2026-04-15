import type { ClientRequest, IncomingMessage } from "http";
import WebSocket, { type MessageEvent } from "isomorphic-ws";

import { Completer } from "./completer";
import { decoder, encoder, mergeUint8Arrays, unpackMessage } from "./utils";

class ProtocolMessage {
  public readonly id: number;
  public readonly type: string;
  public readonly data: Uint8Array;
  public readonly sent: Completer<void>;

  constructor({ id, type, data }: { id: number; type: string; data: Uint8Array }) {
    this.id = id;
    this.type = type;
    this.data = data;
    this.sent = new Completer<void>();
  }
}

export enum ProtocolCloseKind {
  CLIENT = "client",
  SERVER = "server",
  ERROR = "error",
}

export class ProtocolReconnectUnsupportedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolReconnectUnsupportedException";
  }
}

export class ProtocolCloseException extends Error {
  public readonly closeCode: number;
  public readonly reason?: string;

  constructor({ closeCode, reason }: { closeCode: number; reason?: string }) {
    super(reason == null || reason.trim().length === 0 ? `connection closed with status ${closeCode}` : reason);
    this.name = "ProtocolCloseException";
    this.closeCode = closeCode;
    this.reason = reason;
  }
}

export class ProtocolHandshakeException extends Error {
  public readonly statusCode: number;
  public readonly statusText?: string;

  constructor({ statusCode, statusText }: { statusCode: number; statusText?: string }) {
    const normalizedStatusText = statusText?.trim();
    super(
      normalizedStatusText == null || normalizedStatusText.length === 0
        ? `websocket connect failed with status ${statusCode}`
        : `websocket connect failed with status ${statusCode}: ${normalizedStatusText}`,
    );
    this.name = "ProtocolHandshakeException";
    this.statusCode = statusCode;
    this.statusText = normalizedStatusText;
  }
}

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && process.release?.name === "node";
}

export interface ProtocolChannel {
  start(
    onDataReceived: (data: Uint8Array) => void,
    params: {
      onDone?: () => void;
      onError?: (error: unknown) => void;
    },
  ): void;

  dispose(): void;
  sendData(data: Uint8Array): Promise<void>;
}

export class StreamProtocolChannel implements ProtocolChannel {
  public readonly input: ProtocolMessageStream<Uint8Array>;
  public readonly output: ProtocolMessageStream<Uint8Array>;
  public started = false;

  private _iterator: AsyncGenerator<Uint8Array, void, void> | null = null;

  constructor({
    input,
    output,
  }: {
    input: ProtocolMessageStream<Uint8Array>;
    output: ProtocolMessageStream<Uint8Array>;
  }) {
    this.input = input;
    this.output = output;
  }

  public start(
    onDataReceived: (data: Uint8Array) => void,
    { onDone, onError }: { onDone?: () => void; onError?: (error: unknown) => void },
  ): void {
    if (this.started) {
      throw new Error("Already started");
    }
    this.started = true;

    (async () => {
      this._iterator?.return(undefined);

      try {
        this._iterator = this.input.stream();
        for await (const message of this._iterator) {
          onDataReceived(message);
        }
        onDone?.();
      } catch (error) {
        onError?.(error);
      }
    })().catch((error: unknown) => {
      onError?.(error);
    });
  }

  public dispose(): void {
    this.started = false;
    this._iterator?.return(undefined);
    this._iterator = null;
    this.input.close();
  }

  public async sendData(data: Uint8Array): Promise<void> {
    this.output.add(data);
  }
}

export class WebSocketProtocolChannel implements ProtocolChannel {
  public readonly url: string;
  public readonly jwt: string;
  public webSocket: WebSocket | null = null;

  private _opened = new Completer<void>();
  private _finished = false;
  private _onDataReceived?: (data: Uint8Array) => void;
  private _doneHandler?: () => void;
  private _errorHandler?: (error: unknown) => void;
  private readonly _onUnexpectedResponse = (
    _request: ClientRequest,
    response: IncomingMessage,
  ): void => {
    const statusCode = response.statusCode;
    if (statusCode == null) {
      this._finish("error", new Error("websocket connect failed"));
      return;
    }
    this._finish(
      "error",
      new ProtocolHandshakeException({
        statusCode,
        statusText: response.statusMessage,
      }),
    );
  };

  constructor({ url, jwt }: { url: string; jwt: string }) {
    this.url = url;
    this.jwt = jwt;
  }

  public start(
    onDataReceived: (data: Uint8Array) => void,
    { onDone, onError }: { onDone?: () => void; onError?: (error: unknown) => void },
  ): void {
    const url = new URL(this.url);
    url.searchParams.set("token", this.jwt);

    this._opened = new Completer<void>();
    this._finished = false;
    this._onDataReceived = onDataReceived;
    this._doneHandler = onDone;
    this._errorHandler = onError;

    const socket = new WebSocket(url.toString());
    this.webSocket = socket;
    if (isNodeRuntime()) {
      socket.on("unexpected-response", this._onUnexpectedResponse);
    }
    socket.addEventListener("open", this._onOpen);
    socket.addEventListener("message", this._onMessage);
    socket.addEventListener("close", this._onClose);
    socket.addEventListener("error", this._onError);
  }

  private _finish(kind: "done" | "error", error?: unknown): void {
    if (this._finished) {
      return;
    }
    this._finished = true;
    if (kind === "done") {
      this._doneHandler?.();
      return;
    }
    this._errorHandler?.(error);
  }

  private _onOpen = (): void => {
    if (!this._opened.completed) {
      this._opened.complete();
    }
  };

  private _onMessage = (event: MessageEvent): void => {
    const data = event.data;

    if (data instanceof Blob) {
      void data.arrayBuffer().then((buffer) => {
        this._onDataReceived?.(new Uint8Array(buffer));
      });
      return;
    }

    if (typeof data === "string") {
      this._onDataReceived?.(encoder.encode(data));
      return;
    }

    if (data instanceof ArrayBuffer) {
      this._onDataReceived?.(new Uint8Array(data));
      return;
    }

    if (data instanceof Uint8Array) {
      this._onDataReceived?.(data);
      return;
    }

    if (ArrayBuffer.isView(data)) {
      this._onDataReceived?.(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
  };

  private _onClose = (event: { code: number; reason: string | Buffer }): void => {
    if (event.code === 1000) {
      this._finish("done");
      return;
    }

    const reason = typeof event.reason === "string" ? event.reason : event.reason.toString();
    this._finish("error", new ProtocolCloseException({ closeCode: event.code, reason }));
  };

  private _onError = (event: unknown): void => {
    this._finish("error", event instanceof Error ? event : new Error("websocket error"));
  };

  public dispose(): void {
    const socket = this.webSocket;
    this.webSocket = null;
    this._onDataReceived = undefined;
    if (socket == null) {
      return;
    }

    socket.removeEventListener("open", this._onOpen);
    socket.removeEventListener("message", this._onMessage);
    socket.removeEventListener("close", this._onClose);
    socket.removeEventListener("error", this._onError);
    if (isNodeRuntime()) {
      socket.off("unexpected-response", this._onUnexpectedResponse);
    }

    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      socket.close(1000);
    }
  }

  public async sendData(data: Uint8Array): Promise<void> {
    await this._opened.fut;
    const socket = this.webSocket;
    if (socket == null) {
      throw new Error("websocket is closed");
    }
    socket.send(data);
  }
}

export class ProtocolMessageStream<T> {
  private _messages: T[] = [];
  private _messageAdded = new Completer<void>();
  private _closed = false;

  public add(message: T): void {
    this._messages.push(message);
    if (!this._messageAdded.completed) {
      this._messageAdded.complete();
    }
  }

  public close(): void {
    this._closed = true;
    if (!this._messageAdded.completed) {
      this._messageAdded.complete();
    }
  }

  public async *stream(): AsyncGenerator<T, void, void> {
    while (!this._closed) {
      await this._messageAdded.fut;
      this._messageAdded = new Completer<void>();

      while (this._messages.length > 0 && !this._closed) {
        const message = this._messages.shift();
        if (message !== undefined) {
          yield message;
        }
      }
    }
  }
}

export type MessageHandler = (
  protocol: Protocol,
  messageId: number,
  type: string,
  data: Uint8Array,
) => Promise<void> | void;

export type ProtocolFactory = () => Protocol;

export class Protocol<T extends ProtocolChannel = ProtocolChannel> {
  public readonly channel: T;
  public readonly handlers: Record<string, MessageHandler> = {};

  private _id = 0;
  private _send = new ProtocolMessageStream<ProtocolMessage>();
  private _done = new Completer<unknown>();

  private _sendError: unknown;
  private _sendLoop: Promise<void> | null = null;
  private _open = false;
  private _closed = false;
  private _closeKind: ProtocolCloseKind | null = null;
  private _closeReason: string | null = null;

  private _recvPacketId = 0;
  private _recvState = "ready";
  private _recvPacketTotal = 0;
  private _recvMessageId = -1;
  private _recvType = "";
  private _recvPackets: Uint8Array[] = [];

  constructor({ channel }: { channel: T }) {
    this.channel = channel;
  }

  public get url(): string | null {
    return null;
  }

  public get token(): string | null {
    return null;
  }

  public get isOpen(): boolean {
    return this._open;
  }

  public get isClosed(): boolean {
    return this._closed;
  }

  public get closeKind(): ProtocolCloseKind | null {
    return this._closeKind;
  }

  public get closeReason(): string | null {
    return this._closeReason;
  }

  public get done(): Promise<unknown> {
    return this._done.fut;
  }

  public async waitForClose(): Promise<void> {
    await this.done;
  }

  public static createFactory<
    TProtocol extends Protocol,
    TArgs extends unknown[],
  >(
    this: new (...args: TArgs) => TProtocol,
    ...args: TArgs
  ): ProtocolFactory {
    const ProtocolCtor = this;

    if ((ProtocolCtor as unknown) === (Protocol as unknown)) {
      let used = false;
      return () => {
        if (used) {
          throw new ProtocolReconnectUnsupportedException(
            "protocolFactory was not configured for reconnecting this protocol",
          );
        }
        used = true;
        return new ProtocolCtor(...args);
      };
    }

    return () => new ProtocolCtor(...args);
  }

  private _setCloseState({
    kind,
    reason,
  }: {
    kind: ProtocolCloseKind;
    reason?: string | null;
  }): void {
    if (this._closeKind == null) {
      this._closeKind = kind;
    }
    if (this._closeReason == null && reason != null && reason.trim().length > 0) {
      this._closeReason = reason.trim();
    }
  }

  public addHandler(type: string, handler: MessageHandler): void {
    if (this.handlers[type] !== undefined) {
      throw new Error(`already registered handler for ${type}`);
    }
    this.handlers[type] = handler;
  }

  public removeHandler(type: string, handler: MessageHandler): void {
    const current = this.handlers[type];
    if (current !== handler) {
      throw new Error(`handler mismatch for ${type}`);
    }
    delete this.handlers[type];
  }

  public getHandler(type: string): MessageHandler | undefined {
    return this.handlers[type];
  }

  public async handleMessage(messageId: number, type: string, data: Uint8Array): Promise<void> {
    const handler = this.handlers[type] ?? this.handlers["*"];
    if (handler == null) {
      const unpacked = unpackMessage(data);
      console.warn(`No handler for message type ${type}; data:`, unpacked);
      return;
    }
    await handler(this, messageId, type, data);
  }

  public getNextMessageId(): number {
    return this._id++;
  }

  public sendNowait(type: string, data: Uint8Array, { id }: { id?: number } = {}): number {
    if (this._sendError != null) {
      throw this._sendError;
    }
    if (this._closed) {
      throw new Error("protocol is closed");
    }
    const message = new ProtocolMessage({ id: id ?? this.getNextMessageId(), type, data });
    this._send.add(message);
    return message.id;
  }

  public async send(type: string, data: Uint8Array, id?: number): Promise<void> {
    const message = new ProtocolMessage({ id: id ?? this.getNextMessageId(), type, data });
    if (this._sendError != null) {
      throw this._sendError;
    }
    if (this._closed) {
      throw new Error("protocol is closed");
    }
    this._send.add(message);
    await message.sent.fut;
  }

  public async sendJson(object: unknown): Promise<void> {
    await this.send("application/json", encoder.encode(JSON.stringify(object)));
  }

  public start({
    onMessage,
    onDone,
    onError,
  }: {
    onMessage?: MessageHandler;
    onDone?: () => void;
    onError?: (error: unknown) => void;
  } = {}): void {
    if (this._sendLoop != null) {
      throw new Error("protocol already started");
    }
    if (onMessage != null) {
      this.addHandler("*", onMessage);
    }
    this._open = true;
    this.channel.start(this.onDataReceived.bind(this), {
      onDone: () => {
        this._setCloseState({ kind: ProtocolCloseKind.SERVER });
        this._shutdown();
        if (!this._done.completed) {
          this._done.complete(null);
        }
        onDone?.();
      },
      onError: (error: unknown) => {
        this._setCloseState({
          kind: ProtocolCloseKind.ERROR,
          reason: error instanceof Error ? error.message : String(error),
        });
        this._shutdown();
        if (!this._done.completed) {
          this._done.complete(error);
        }
        onError?.(error);
      },
    });
    this._sendLoop = this._runSendLoop(onError);
  }

  public close(): void {
    this._setCloseState({ kind: ProtocolCloseKind.CLIENT });
    this._shutdown();
    this.channel.dispose();
    if (!this._done.completed) {
      this._done.complete(null);
    }
  }

  public dispose(): void {
    this.close();
  }

  private _shutdown(): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this._open = false;
    this._send.close();
  }

  private async _runSendLoop(onError?: (error: unknown) => void): Promise<void> {
    for await (const message of this._send.stream()) {
      try {
        const packets = Math.ceil(message.data.length / 1024);

        const header = new Uint8Array(16);
        const headerView = new DataView(header.buffer);
        headerView.setUint32(0, Math.floor(message.id / 2 ** 32), false);
        headerView.setUint32(4, message.id & 0xffffffff, false);
        headerView.setUint32(8, 0, false);
        headerView.setUint32(12, packets, false);

        await this.channel.sendData(mergeUint8Arrays(header, encoder.encode(message.type)));

        for (let i = 0; i < packets; i += 1) {
          const packetHeader = new Uint8Array(12);
          const packetHeaderView = new DataView(packetHeader.buffer);
          packetHeaderView.setUint32(0, Math.floor(message.id / 2 ** 32), false);
          packetHeaderView.setUint32(4, message.id & 0xffffffff, false);
          packetHeaderView.setUint32(8, i + 1, false);

          await this.channel.sendData(
            mergeUint8Arrays(
              packetHeader,
              message.data.subarray(i * 1024, Math.min((i + 1) * 1024, message.data.length)),
            ),
          );
        }

        if (!message.sent.completed) {
          message.sent.complete();
        }
      } catch (error) {
        this._sendError = error;
        this._setCloseState({
          kind: ProtocolCloseKind.ERROR,
          reason: error instanceof Error ? error.message : String(error),
        });
        if (!message.sent.completed) {
          message.sent.completeError(error);
        }
        this._shutdown();
        if (!this._done.completed) {
          this._done.complete(error);
        }
        onError?.(error);
        return;
      }
    }
  }

  public onDataReceived(dataPacket: Uint8Array): void {
    const dataView = new DataView(dataPacket.buffer, dataPacket.byteOffset, dataPacket.byteLength);
    const messageId = dataView.getUint32(4, false) + dataView.getUint32(0, false) * 2 ** 32;
    const packet = dataView.getUint32(8, false);

    if (packet !== this._recvPacketId) {
      this._recvState = "error";
    }

    if (packet === 0) {
      if (this._recvState === "ready" || this._recvState === "error") {
        this._recvPacketTotal = dataView.getUint32(12, false);
        this._recvMessageId = messageId;
        this._recvType = decoder.decode(dataPacket.subarray(16));

        if (this._recvPacketTotal === 0) {
          try {
            const merged = mergeUint8Arrays(...this._recvPackets);
            this._recvPackets.length = 0;
            this._dispatchMessage({ messageId, type: this._recvType, data: merged });
          } finally {
            this._recvState = "ready";
            this._recvPacketId = 0;
            this._recvType = "";
            this._recvMessageId = -1;
          }
        } else {
          this._recvPacketId += 1;
          this._recvState = "processing";
        }
      } else {
        this._recvState = "error";
        this._recvPacketId = 0;
      }
      return;
    }

    if (this._recvState !== "processing") {
      this._recvState = "error";
      this._recvPacketId = 0;
      return;
    }

    if (messageId !== this._recvMessageId) {
      this._recvState = "error";
      this._recvPacketId = 0;
    }

    this._recvPackets.push(dataPacket.subarray(12));

    if (this._recvPacketTotal === this._recvPacketId) {
      try {
        const merged = mergeUint8Arrays(...this._recvPackets);
        this._recvPackets.length = 0;
        this._dispatchMessage({ messageId, type: this._recvType, data: merged });
      } finally {
        this._recvState = "ready";
        this._recvPacketId = 0;
        this._recvType = "";
        this._recvMessageId = -1;
      }
      return;
    }

    this._recvPacketId += 1;
  }

  private _dispatchMessage({
    messageId,
    type,
    data,
  }: {
    messageId: number;
    type: string;
    data: Uint8Array;
  }): void {
    void this.handleMessage(messageId, type, data).catch((error: unknown) => {
      console.error("unhandled protocol message handler error", error);
    });
  }
}

export class WebSocketClientProtocol extends Protocol<WebSocketProtocolChannel> {
  private readonly _url: string;
  private readonly _token: string;

  constructor({ url, token }: { url: string; token: string }) {
    super({
      channel: new WebSocketProtocolChannel({ url, jwt: token }),
    });
    this._url = url;
    this._token = token;
  }

  public override get url(): string {
    return this._url;
  }

  public override get token(): string {
    return this._token;
  }
}
