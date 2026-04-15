// room_events.ts

/**
 * An abstract base class for room events.
 */
export abstract class RoomEvent {
    abstract get name(): string;
    abstract get description(): string;
}

export class RoomStatusEvent extends RoomEvent {
    public readonly status: string;
    public readonly message: string;

    constructor({ status, message }: { status: string; message: string }) {
        super();
        this.status = status;
        this.message = message;
    }

    get name(): string {
        return this.status;
    }

    get description(): string {
        return this.message;
    }

    static fromJson(json: Record<string, unknown>): RoomStatusEvent {
        return new RoomStatusEvent({
            status: String(json["status"]),
            message: String(json["message"]),
        });
    }
}

/**
 * A basic RoomMessage class containing message details and optional attachment.
 */
export class RoomMessage {
    public fromParticipantId: string;
    public type: string;
    public message: Record<string, any>;
    public local: boolean;
    public attachment?: Uint8Array;

    constructor({fromParticipantId, type, message, local = false, attachment}: {
        fromParticipantId: string;
        type: string;
        message: Record<string, any>;
        local?: boolean;
        attachment?: Uint8Array;
    }) {
        this.fromParticipantId = fromParticipantId;
        this.type = type;
        this.message = message;
        this.local = local;
        this.attachment = attachment;
    }
}

/**
 * A RoomMessageEvent, which extends RoomEvent and holds a RoomMessage.
 */
export class RoomMessageEvent extends RoomEvent {
    public message: RoomMessage;

    constructor({ message }: { message: RoomMessage }) {
        super();
        this.message = message;
    }

    get name(): string {
        return this.message.type;
    }

    get description(): string {
        return `a message was received ${JSON.stringify(this.message.message)}`;
    }
}

/**
 * A FileCreatedEvent, indicating a new file at a certain path.
 */
export class FileCreatedEvent extends RoomEvent {
    public path: string;

    constructor({ path }: { path: string }) {
        super();

        this.path = path;
    }

    get name(): string {
        return "file created";
    }

    get description(): string {
        return `a file was created at the path ${this.path}`;
    }
}

/**
 * A FileDeletedEvent, indicating a file was deleted.
 */
export class FileDeletedEvent extends RoomEvent {
    public path: string;
    public participantId: string;

    constructor({ path, participantId }: { path: string; participantId: string }) {
        super();
        this.path = path;
        this.participantId = participantId;
    }

    get name(): string {
        return "file deleted";
    }

    get description(): string {
        return `a file was deleted at the path ${this.path}`;
    }
}

/**
 * A FileUpdatedEvent, indicating a file was updated at a path.
 */
export class FileUpdatedEvent extends RoomEvent {
    public path: string;
    public participantId: string;

    constructor({ path, participantId }: { path: string; participantId: string }) {
        super();
        this.path = path;
        this.participantId = participantId;
    }

    get name(): string {
        return "file updated";
    }

    get description(): string {
        return `a file was updated at the path ${this.path}`;
    }
}

/**
 * A FileMovedEvent, indicating a file or folder was moved.
 */
export class FileMovedEvent extends RoomEvent {
    public sourcePath: string;
    public destinationPath: string;
    public participantId: string;

    constructor({
        sourcePath,
        destinationPath,
        participantId,
    }: {
        sourcePath: string;
        destinationPath: string;
        participantId: string;
    }) {
        super();
        this.sourcePath = sourcePath;
        this.destinationPath = destinationPath;
        this.participantId = participantId;
    }

    get name(): string {
        return "file moved";
    }

    get description(): string {
        return `a file was moved from ${this.sourcePath} to ${this.destinationPath}`;
    }
}

/**
 * A RoomLogEvent for developer or system logs.
 */
export class RoomLogEvent extends RoomEvent {
    public type: string;
    public data: Record<string, any>;

    constructor({ type, data }: { type: string; data: Record<string, any> }) {
        super();
        this.type = type;
        this.data = data;
    }

    get name(): string {
        return this.type;
    }

    get description(): string {
        return JSON.stringify(this.data);
    }
}
