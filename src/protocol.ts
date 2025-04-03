import WebSocket, { MessageEvent } from "isomorphic-ws";

import { mergeUint8Arrays, decoder, encoder, blobToArrayBuffer } from "./utils";
import { Completer } from "./completer";

export type UpdateCallback = (update: Uint8Array, origin?: any) => void;

class ProtocolMessage {
    public id: number;
    public type: string;
    public data: Uint8Array;
    public sent: Completer;

    constructor({id, type, data}: {
        id: number,
        type: string,
        data: Uint8Array,
    }) {
        this.id = id;
        this.type = type;
        this.data = data;

        this.sent = new Completer()
    }
}

export interface ProtocolChannel {
    start(
        onDataReceived: (data: Uint8Array) => void,
        {onDone, onError}: {
          onDone?: () => void,
          onError?: (error: any) => void,
        }
    ): void;

    dispose(): void;
    sendData(data: Uint8Array): Promise<void>;
}

export class StreamProtocolChannel implements ProtocolChannel {
    public input: ProtocolMessageStream<Uint8Array>;
    public output: ProtocolMessageStream<Uint8Array>;
    public started: boolean = false;

    private _iterator: AsyncGenerator<Uint8Array, any, any> | null = null;

    constructor({input, output}: {
        input: ProtocolMessageStream<Uint8Array>,
        output: ProtocolMessageStream<Uint8Array>
    }) {
        this.input = input;
        this.output = output;
    }

    start(onDataReceived: (data: Uint8Array) => void, { onDone, onError }: {
      onDone?: () => void;
      onError?: (error: any) => void;
    }): void {
        if (this.started) {
            throw new Error("Already started");
        }
        this.started = true;

        (async () => {
          this._iterator?.return(null);

          try {
            this._iterator = this.input.stream();

            for await (const message of this._iterator) {
              if (message) {
                onDataReceived(message);
              }
            }
          } catch (error) {
            if (onError) {
              onError(error);
            }
          } finally {
            if (onDone) {
              onDone();
            }
          }
        })();
    }

    dispose() {
        this._iterator?.return(null);
        this._iterator = null;

        this.input.close();
    }

    async sendData(data: Uint8Array) {
        this.output.add(data);
    }
}

export class WebSocketProtocolChannel implements ProtocolChannel {
    public url: string;
    public jwt: string;
    public webSocket: WebSocket | null = null;
    public onDataReceived?: (data: Uint8Array) => void;
    private _opened: Completer = new Completer();

    constructor({url, jwt}: {
        url: string,
        jwt: string
    }) {
        this.url = url;
        this.jwt = jwt;
    }

    public start(onDataReceived: (data: Uint8Array) => void, {
      onDone, onError }: { onDone?: () => void, onError?: (error: any) => void }): void {
        if (typeof(onDataReceived) != "function") {
            throw new Error("onDataReceived must be a function")
        }

        const url = new URL(this.url);
        url.searchParams.set("token", this.jwt);

        this.onDataReceived = onDataReceived;

        this.webSocket = new WebSocket(url.toString());
        this.webSocket.addEventListener("open", this._onOpen);
        this.webSocket.addEventListener("message", this._onData);

        if (onDone) {
            this.webSocket.addEventListener("close", onDone);
        }

        if (onError) {
            this.webSocket.addEventListener("error", onError);
        }
    }

    private _onOpen = (): void => this._opened.resolve();
    private _onData = (event: MessageEvent): void => {
        const data = event.data;

        if (data instanceof Blob) {
            blobToArrayBuffer(data).then((buffer) => {
                if (this.onDataReceived) {
                    this.onDataReceived(new Uint8Array(buffer));
                }
            });
        } else if (typeof(data) == "string") {
            if (this.onDataReceived) {
                this.onDataReceived(new Uint8Array(encoder.encode(data)));
            }
        } else if (data instanceof ArrayBuffer || data instanceof Buffer) {
            if (this.onDataReceived) {
                this.onDataReceived(new Uint8Array(data));
            }
        }
    }

    public dispose(): void {
        this.webSocket?.close();
        this.webSocket?.removeAllListeners();
        this.webSocket = null;
    }

    /**
     * @param {Uint8Array} data - the data to send
     */
    public async sendData(data: Uint8Array): Promise<void> {
        await this._opened.fut;

        this.webSocket?.send(data);
    }
}

export class ProtocolMessageStream<T> {
    private _messages: T[] = [];
    private _messageAdded: Completer = new Completer<void>();
    private _closed: boolean = false;

    async add(message: T) {
        this._messages.push(message); 

        if (!this._messageAdded.completed) {
            this._messageAdded.resolve();
        }
    }

    close() {
        if (!this._messageAdded.completed) {
            this._closed = true;
            this._messageAdded.complete();
        }
    }

    async *stream(): AsyncGenerator<T> {
        while (!this._closed) {
            await this._messageAdded.fut;

            this._messageAdded = new Completer();

            while (this._messages.length > 0 && !this._closed) {
                const msg = this._messages.shift();
                if (msg) {
                    yield msg;
                }
            }
        }
    }
}

export type MessageHandler = (
    protocol: Protocol,
    messageId: number,
    type: string,
    data?: Uint8Array) => Promise<void> | void;

export class Protocol {
    public channel: ProtocolChannel;
    public handlers: { [type: string]: MessageHandler } = {};

    private _id: number = 0;
    private _send: ProtocolMessageStream<ProtocolMessage> = new ProtocolMessageStream();

    private _recvPacketId: number = 0;
    private _recvState: string = "ready";
    private _recvPacketTotal: number = 0;
    private _recvMessageId: number = -1;
    private _recvType: string = "";
    private _recvPackets: Uint8Array[] = [];
    private _iterator: AsyncGenerator<ProtocolMessage, any, any> | null = null;

    /**
     * @param {ProtocolChannel} params.channel - the protocol channel to use
     */ 
    constructor({channel} : {
        channel: ProtocolChannel;
    }) {
        this.channel = channel;
    }

    /**
     * @param {string} type - the type of message to handle
     * @param {Function} handler - the message handler
     */ 
    addHandler(type: string, handler: MessageHandler) {
        this.handlers[type] = handler;
    }

    /**
     * @param {string} type - the type of message to handle
     */ 
    removeHandler(type: string) {
        delete this.handlers[type];
    }

    /**
     * @param {number} messageId - the id of the message
     * @param {string} type - the type of the message
     * @param {Uint8Array?} data - the data for the message
     */ 
    async handleMessage(messageId: number, type: string, data?: Uint8Array) {
        console.log(this.handlers, Object.keys(this.handlers));

        const handler = this.handlers[type] ?? this.handlers["*"];

        await handler(this, messageId, type, data);    
    }

    /**
     * @returns {number} the next message id
     */ 
    getNextMessageId(): number {
        return this._id++;
    }

    /**
     * @param {string} type - the type of the message
     * @param {Uint8Array} data - the data for the message
     * @param {number?} id - the id of the message
     */ 
    async send(type: string, data: Uint8Array, id?: number): Promise<void> {
        const msg = new ProtocolMessage({ id: id ?? this.getNextMessageId(), type: type, data: data });

        this._send.add(msg);

        await msg.sent.fut;
    }

    /**
     * @param {Object} object - the type of the message
     */
    async sendJson(object: any): Promise<void> {
        return await this.send("application/json", encoder.encode(JSON.stringify(object)));
    }

    start(onMessage = null) {
        if (onMessage != null) {
            this.addHandler("*", onMessage);
        }
        this.channel.start(this.onDataReceived.bind(this), {});

        // used for closing the iterator
        this._iterator?.return(null);

        (async () => {
            this._iterator = this._send.stream();

            for await (const message of this._iterator) {
                if (message) {
                    console.log(`message recv on protocol ${message.id} ${message.type}`);

                    const packets = Math.ceil((message.data.length / 1024));

                    const header = new Uint8Array(4*4);
                    const dataView = new DataView(header.buffer);
                    dataView.setUint32(0, (message.id  & 0x000fffff00000000) / Math.pow(2, 32), false);
                    dataView.setUint32(4,  message.id & 0xffffffff, false);
                    dataView.setUint32(8, 0, false);
                    dataView.setUint32(12, packets, false);

                    const headerPacket = mergeUint8Arrays(header, encoder.encode(message.type));

                    await this.channel.sendData(headerPacket);

                    for (var i = 0; i < packets; i++) {
                        const packetHeader = new Uint8Array(3*4);
                        const dataView = new DataView(packetHeader.buffer);
                        dataView.setUint32(0, (message.id  & 0x000fffff00000000) / Math.pow(2, 32), false);
                        dataView.setUint32(4, message.id & 0xffffffff, false);
                        dataView.setUint32(8, i+1, false);
                        const packet = mergeUint8Arrays(
                            packetHeader,
                            message.data.subarray(i * 1024, Math.min((i + 1) * 1024, message.data.length))
                        );

                        await this.channel.sendData(packet);
                    }
                    message.sent.resolve();
                    console.log(`message sent on protocol ${message.id} ${message.type}`);
                }
            }

            console.log("protocol done");
        })();
    }

    dispose() {  
        this.channel.dispose();
        this._iterator?.return(null);
        this._iterator = null;
    }

    onDataReceived(dataPacket: Uint8Array) {
        const dataView = new DataView(dataPacket.buffer);

        const messageId = dataView.getUint32(4, false) + dataView.getUint32(0, false) * Math.pow(2, 32);
        const packet =  dataView.getUint32(8, false); 

        if (packet != this._recvPacketId) {
            this._recvState = "error";
            console.log(dataPacket);
            console.log(`received out of order packet got ${packet} expected ${this._recvPacketId}, total ${this._recvPacketTotal} message ID: ${messageId}`);
        }

        if (packet == 0) {
            if (this._recvState == "ready" || this._recvState == "error") {
                this._recvPacketTotal = dataView.getUint32(12, false);
                this._recvMessageId = messageId;
                this._recvType = decoder.decode(dataPacket.subarray(16));
                console.log(`recieved packet ${this._recvType}`);

                if (this._recvPacketTotal == 0) {
                    try {
                        const merged = mergeUint8Arrays(...this._recvPackets);
                        this._recvPackets.length = 0;
                        this.handleMessage(messageId, this._recvType, merged);

                    } finally {
                        console.log("expecting packet reset to 0");
                        this._recvState = "ready";
                        this._recvPacketId = 0;
                        this._recvType = "";
                        this._recvMessageId = -1;
                    }
                } else {
                    this._recvPacketId += 1;
                    console.log(`expecting packet ${this._recvPacketId}`);
                    this._recvState = "processing";
                }
            } else {
                this._recvState = "error";
                this._recvPacketId = 0;
                console.log("received packet 0 in invalid state");
            }
        } else if (this._recvState != "processing") {
            this._recvState = "error";
            this._recvPacketId = 0;
            console.log("received datapacket in invalid state");
        } else {
            if (messageId != this._recvMessageId) {
                this._recvState = "error";
                this._recvPacketId = 0;
                console.log("received packet from incorrect message");
            }

            this._recvPackets.push(dataPacket.subarray(12));

            if (this._recvPacketTotal == this._recvPacketId) {
                try {
                    const merged = mergeUint8Arrays(...this._recvPackets);
                    this._recvPackets.length = 0;
                    this.handleMessage(messageId, this._recvType, merged);
                } finally {
                    this._recvState = "ready";
                    this._recvPacketId = 0;
                    this._recvType = "";
                    this._recvMessageId = -1;
                }
            } else {
                this._recvPacketId += 1;
            }
        }
    }
}

export class WebSocketClientProtocol extends Protocol {
    constructor({url, token}: {
        url: string,
        token: string
    }) {
        const channel = new WebSocketProtocolChannel({url, jwt: token});

        super({channel});
    }
}
