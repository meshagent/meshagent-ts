import { v4 as uuidv4 } from "uuid";

import { Completer } from "./completer";
import { ContainerMountSpec } from "./meshagent-client";
import { Content, BinaryContent, ControlContent, ErrorContent, JsonContent } from "./response";
import { RoomClient } from "./room-client";
import { RoomServerException } from "./room-server-client";
import { StreamController } from "./stream-controller";

export interface DockerSecret {
  username: string;
  password: string;
  registry: string;
  email?: string;
}

export interface ContainerImage {
  id: string;
  tags: string[];
  size?: number;
  labels: Record<string, unknown>;
}

export interface ContainerParticipantInfo {
  id: string;
  name: string;
}

export interface RoomContainer {
  id: string;
  image: string;
  name?: string;
  startedBy: ContainerParticipantInfo;
  state: string;
  private: boolean;
  serviceId?: string;
}

export interface ContainerLogsSession {
  stream: AsyncIterable<string>;
  result: Promise<void>;
  cancel(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringMapList(values: Record<string, string>): Array<{ key: string; value: string }> {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

function toPortPairs(values: Record<number, number> | Record<string, number>): Array<{ container_port: number; host_port: number }> {
  return Object.entries(values).map(([containerPort, hostPort]) => ({
    container_port: Number(containerPort),
    host_port: hostPort,
  }));
}

function toCredentials(values: DockerSecret[]): Array<{ registry: string; username: string; password: string }> {
  return values.map((entry) => ({
    registry: entry.registry,
    username: entry.username,
    password: entry.password,
  }));
}

function readStringField(data: Record<string, unknown>, field: string, operation: string): string {
  const value = data[field];
  if (typeof value !== "string") {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  return value;
}

function decodeJsonStatus(data: Uint8Array): number {
  const text = new TextDecoder().decode(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RoomServerException("containers.exec returned an invalid status payload");
  }
  if (!isRecord(parsed)) {
    throw new RoomServerException("containers.exec returned an invalid status payload");
  }
  const status = parsed["status"];
  if (typeof status !== "number" || !Number.isInteger(status)) {
    throw new RoomServerException("containers.exec returned an invalid status payload");
  }
  return status;
}

export class ExecSession {
  public readonly command: string;
  public readonly result: Promise<number>;
  public readonly previousOutput: Uint8Array[] = [];
  public readonly output: AsyncIterable<Uint8Array>;

  private readonly requestId: string;
  private readonly containerId: string;
  private readonly tty?: boolean;
  private readonly resultCompleter = new Completer<number>();
  private readonly outputController = new StreamController<Uint8Array>();
  private readonly queuedInput: Content[] = [];
  private inputClosed = false;
  private closed = false;
  private inputWaiter: Completer<void> | null = null;
  private lastResizeWidth?: number;
  private lastResizeHeight?: number;

  constructor(params: {
    requestId: string;
    command: string;
    containerId: string;
    tty?: boolean;
  }) {
    this.requestId = params.requestId;
    this.command = params.command;
    this.containerId = params.containerId;
    this.tty = params.tty;
    this.result = this.resultCompleter.fut;
    this.output = this.outputController.stream;
  }

  public async *inputStream(): AsyncIterable<Content> {
    yield new BinaryContent({
      data: new Uint8Array(0),
      headers: {
        kind: "start",
        request_id: this.requestId,
        container_id: this.containerId,
        command: this.command,
        tty: this.tty,
      },
    });
    while (true) {
      while (this.queuedInput.length > 0) {
        const chunk = this.queuedInput.shift();
        if (chunk) {
          yield chunk;
        }
      }
      if (this.inputClosed) {
        return;
      }
      this.inputWaiter = new Completer<void>();
      await this.inputWaiter.fut;
      this.inputWaiter = null;
    }
  }

  public async write(data: Uint8Array): Promise<void> {
    this.queueInput({ channel: 1, data });
  }

  public async resize(params: { width: number; height: number }): Promise<void> {
    if (this.lastResizeWidth === params.width && this.lastResizeHeight === params.height) {
      return;
    }
    this.lastResizeWidth = params.width;
    this.lastResizeHeight = params.height;
    this.queueInput({ channel: 4, width: params.width, height: params.height });
  }

  public async stop(): Promise<void> {
    this.closeInputStream();
  }

  public async kill(): Promise<void> {
    if (this.inputClosed) {
      return;
    }
    this.queueInput({ channel: 5 });
  }

  public close(status: number): void {
    if (!this.resultCompleter.completed) {
      this.resultCompleter.complete(status);
    }
    this.closed = true;
    this.closeInputStream();
    this.outputController.close();
  }

  public closeError(error: unknown): void {
    if (!this.resultCompleter.completed) {
      this.resultCompleter.completeError(error);
    }
    this.closed = true;
    this.closeInputStream();
    this.outputController.close();
  }

  public addOutput(data: Uint8Array): void {
    this.previousOutput.push(data);
    this.outputController.add(data);
  }

  public get isClosed(): boolean {
    return this.closed;
  }

  private queueInput(params: {
    channel: number;
    data?: Uint8Array;
    width?: number;
    height?: number;
  }): void {
    if (this.inputClosed) {
      throw new RoomServerException("container exec session is already closed");
    }
    this.queuedInput.push(new BinaryContent({
      data: params.data ?? new Uint8Array(0),
      headers: {
        kind: "input",
        channel: params.channel,
        width: params.width,
        height: params.height,
      },
    }));
    this.inputWaiter?.complete();
  }

  private closeInputStream(): void {
    if (this.inputClosed) {
      return;
    }
    this.inputClosed = true;
    this.inputWaiter?.complete();
  }
}

export class ContainersClient {
  private readonly room: RoomClient;

  constructor({ room }: { room: RoomClient }) {
    this.room = room;
  }

  private unexpectedResponseError(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from containers.${operation}`);
  }

  private async invoke(operation: string, input: Record<string, unknown>): Promise<Content> {
    return await this.room.invoke({
      toolkit: "containers",
      tool: operation,
      input,
    });
  }

  public async listImages(): Promise<ContainerImage[]> {
    const output = await this.invoke("list_images", {});
    if (!(output instanceof JsonContent)) {
      throw this.unexpectedResponseError("list_images");
    }
    const imagesRaw = output.json["images"];
    if (!Array.isArray(imagesRaw)) {
      throw this.unexpectedResponseError("list_images");
    }
    const images: ContainerImage[] = [];
    for (const entry of imagesRaw) {
      if (!isRecord(entry)) {
        throw this.unexpectedResponseError("list_images");
      }
      const id = entry["id"];
      const tags = entry["tags"];
      const labelsRaw = entry["labels"];
      if (typeof id !== "string" || !Array.isArray(tags)) {
        throw this.unexpectedResponseError("list_images");
      }
      const normalizedTags = tags.filter((tag): tag is string => typeof tag === "string");
      const size = entry["size"];
      images.push({
        id,
        tags: normalizedTags,
        size: typeof size === "number" ? size : undefined,
        labels: isRecord(labelsRaw) ? labelsRaw : {},
      });
    }
    return images;
  }

  public async pullImage(params: { tag: string; credentials?: DockerSecret[] }): Promise<void> {
    await this.invoke("pull_image", {
      tag: params.tag,
      credentials: toCredentials(params.credentials ?? []),
    });
  }

  public async run(params: {
    image: string;
    command?: string;
    workingDir?: string;
    env?: Record<string, string>;
    mountPath?: string;
    mountSubpath?: string;
    role?: string;
    participantName?: string;
    ports?: Record<number, number> | Record<string, number>;
    credentials?: DockerSecret[];
    name?: string;
    mounts?: ContainerMountSpec;
    writableRootFs?: boolean;
    private?: boolean;
  }): Promise<string> {
    const output = await this.invoke("run", {
      image: params.image,
      command: params.command,
      working_dir: params.workingDir,
      env: toStringMapList(params.env ?? {}),
      mount_path: params.mountPath,
      mount_subpath: params.mountSubpath,
      role: params.role,
      participant_name: params.participantName,
      ports: toPortPairs(params.ports ?? {}),
      credentials: toCredentials(params.credentials ?? []),
      name: params.name,
      mounts: params.mounts,
      writable_root_fs: params.writableRootFs,
      private: params.private,
    });
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("run");
    }
    return readStringField(output.json, "container_id", "run");
  }

  public async runService(params: { serviceId: string; env?: Record<string, string> }): Promise<string> {
    const output = await this.invoke("run_service", {
      service_id: params.serviceId,
      env: toStringMapList(params.env ?? {}),
    });
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("run_service");
    }
    return readStringField(output.json, "container_id", "run_service");
  }

  public exec(params: { containerId: string; command: string; tty?: boolean }): ExecSession {
    const requestId = uuidv4();
    const session = new ExecSession({
      requestId,
      command: params.command,
      containerId: params.containerId,
      tty: params.tty,
    });

    this.room
      .invokeStream({
        toolkit: "containers",
        tool: "exec",
        input: session.inputStream(),
      })
      .then(async (stream) => {
        for await (const chunk of stream) {
          if (chunk instanceof ErrorContent) {
            throw new RoomServerException(chunk.text, chunk.code);
          }
          if (!(chunk instanceof BinaryContent)) {
            throw this.unexpectedResponseError("exec");
          }
          const channel = chunk.headers["channel"];
          if (typeof channel !== "number") {
            throw new RoomServerException("containers.exec returned a chunk without a valid channel");
          }
          if (channel === 1) {
            session.addOutput(chunk.data);
            continue;
          }
          if (channel === 3) {
            session.close(decodeJsonStatus(chunk.data));
            return;
          }
        }
        throw new RoomServerException("containers.exec stream closed before a status was returned");
      })
      .catch((error: unknown) => {
        session.closeError(error);
      });

    return session;
  }

  public async stop(params: { containerId: string; force?: boolean }): Promise<void> {
    await this.invoke("stop_container", {
      container_id: params.containerId,
      force: params.force ?? true,
    });
  }

  public async waitForExit(params: { containerId: string }): Promise<number> {
    const output = await this.invoke("wait_for_exit", {
      container_id: params.containerId,
    });
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("wait_for_exit");
    }
    const exitCode = output.json["exit_code"];
    if (typeof exitCode !== "number" || !Number.isInteger(exitCode)) {
      throw this.unexpectedResponseError("wait_for_exit");
    }
    return exitCode;
  }

  public async deleteContainer(params: { containerId: string }): Promise<void> {
    await this.invoke("delete_container", {
      container_id: params.containerId,
    });
  }

  public logs(params: { containerId: string; follow?: boolean }): ContainerLogsSession {
    const requestId = uuidv4();
    const closeInput = new Completer<void>();
    const streamController = new StreamController<string>();
    const result = new Completer<void>();
    let inputClosed = false;

    const closeInputStream = (): void => {
      if (inputClosed) {
        return;
      }
      inputClosed = true;
      if (!closeInput.completed) {
        closeInput.complete();
      }
    };

    const inputStream = async function* (): AsyncIterable<Content> {
      yield new BinaryContent({
        data: new Uint8Array(0),
        headers: {
          kind: "start",
          request_id: requestId,
          container_id: params.containerId,
          follow: params.follow ?? false,
        },
      });
      await closeInput.fut;
    };

    this.room
      .invokeStream({
        toolkit: "containers",
        tool: "logs",
        input: inputStream(),
      })
      .then(async (stream) => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) {
          if (chunk instanceof ErrorContent) {
            throw new RoomServerException(chunk.text, chunk.code);
          }
          if (chunk instanceof ControlContent) {
            continue;
          }
          if (!(chunk instanceof BinaryContent)) {
            throw this.unexpectedResponseError("logs");
          }
          const channel = chunk.headers["channel"];
          if (typeof channel !== "number") {
            throw new RoomServerException("containers.logs returned a chunk without a valid channel");
          }
          if (channel !== 1) {
            continue;
          }
          streamController.add(decoder.decode(chunk.data));
        }
        closeInputStream();
        streamController.close();
        result.complete();
      })
      .catch((error: unknown) => {
        closeInputStream();
        streamController.close();
        if (!result.completed) {
          result.completeError(error);
        }
      });

    const outputStream: AsyncIterable<string> = {
      [Symbol.asyncIterator](): AsyncIterator<string> {
        const it = streamController.stream[Symbol.asyncIterator]();
        return {
          async next(): Promise<IteratorResult<string>> {
            return await it.next();
          },
          async return(value?: string): Promise<IteratorResult<string>> {
            closeInputStream();
            return await it.return?.(value) ?? { done: true, value };
          },
          async throw(e?: unknown): Promise<IteratorResult<string>> {
            closeInputStream();
            if (it.throw) {
              return await it.throw(e);
            }
            throw e;
          },
        };
      },
    };

    return {
      stream: outputStream,
      result: result.fut,
      cancel: async (): Promise<void> => {
        closeInputStream();
        await result.fut.catch(() => undefined);
      },
    };
  }

  public async list(params?: { all?: boolean }): Promise<RoomContainer[]> {
    const output = await this.invoke("list_containers", {
      all: params?.all,
    });
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("list");
    }
    const containersRaw = output.json["containers"];
    if (!Array.isArray(containersRaw)) {
      throw this.unexpectedResponseError("list");
    }
    const items: RoomContainer[] = [];
    for (const entry of containersRaw) {
      if (!isRecord(entry)) {
        throw this.unexpectedResponseError("list");
      }
      const startedByRaw = entry["started_by"];
      if (!isRecord(startedByRaw)) {
        throw this.unexpectedResponseError("list");
      }
      const id = entry["id"];
      const image = entry["image"];
      const state = entry["state"];
      const privateFlag = entry["private"];
      const startedById = startedByRaw["id"];
      const startedByName = startedByRaw["name"];
      if (
        typeof id !== "string" ||
        typeof image !== "string" ||
        typeof state !== "string" ||
        typeof privateFlag !== "boolean" ||
        typeof startedById !== "string" ||
        typeof startedByName !== "string"
      ) {
        throw this.unexpectedResponseError("list");
      }
      const nameRaw = entry["name"];
      const serviceIdRaw = entry["service_id"];
      items.push({
        id,
        image,
        name: typeof nameRaw === "string" ? nameRaw : undefined,
        startedBy: {
          id: startedById,
          name: startedByName,
        },
        state,
        private: privateFlag,
        serviceId: typeof serviceIdRaw === "string" ? serviceIdRaw : undefined,
      });
    }
    return items;
  }
}
