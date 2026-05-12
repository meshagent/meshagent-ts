import { v4 as uuidv4 } from "uuid";

import { Completer } from "./completer";
import type { ContainerMountSpec } from "./meshagent-client";
import { BinaryContent, ControlContent, ErrorContent, JsonContent, type Content } from "./response";
import { RoomClient } from "./room-client";
import { RoomServerException } from "./room-server-client";
import { StreamController } from "./stream-controller";

export interface DockerSecret {
  username: string;
  password: string;
  registry?: string | null;
  email?: string;
}

export interface ContainerImage {
  id: string;
  preferredRef?: string | null;
  references: string[];
  labels: Record<string, string>;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  targetMediaType?: string | null;
}

export interface ContainerImageDescriptor {
  digest: string;
  mediaType?: string | null;
  size?: number;
  annotations: Record<string, string>;
}

export interface ContainerImageManifest {
  descriptor: ContainerImageDescriptor;
  platformOs?: string | null;
  platformArchitecture?: string | null;
  platformVariant?: string | null;
}

export interface ContainerImageInspection {
  image: ContainerImage;
  target: ContainerImageDescriptor;
  selectedManifest?: ContainerImageDescriptor | null;
  manifests: ContainerImageManifest[];
  config?: ContainerImageDescriptor | null;
  layers: ContainerImageDescriptor[];
  contentSize?: number;
}

export interface ImportedImage {
  resolvedRef: string;
  refs: string[];
}

export type BuildJobStatus = "queued" | "running" | "failed" | "cancelled" | "succeeded";

export interface BuildJob {
  id: string;
  tag: string;
  status: BuildJobStatus;
  exitCode?: number;
}

export interface ContainerParticipantInfo {
  id: string;
  name: string;
}

export interface RoomContainer {
  id: string;
  image: string;
  name?: string;
  ports: number[];
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

export interface BuildLogsSession {
  stream: AsyncIterable<string>;
  result: Promise<number | null>;
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

function toCredentials(values: DockerSecret[]): Array<{ registry: string | null; username: string; password: string }> {
  return values.map((entry) => ({
    registry: entry.registry ?? null,
    username: entry.username,
    password: entry.password,
  }));
}

function toMountList(values: ContainerMountSpec[]): ContainerMountSpec[] {
  return values.map((entry) => entry);
}

function readStringField(data: Record<string, unknown>, field: string, operation: string): string {
  const value = data[field];
  if (typeof value !== "string") {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  return value;
}

function readIntegerField(data: Record<string, unknown>, field: string, operation: string): number {
  const value = data[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  return value;
}

function readOptionalIntegerField(data: Record<string, unknown>, field: string, operation: string): number | undefined {
  const value = data[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  return value;
}

function readOptionalStringField(data: Record<string, unknown>, field: string, operation: string): string | undefined {
  const value = data[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  return value;
}

function parseTimestampField(data: Record<string, unknown>, field: string, operation: string): Date | undefined {
  const value = data[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  return timestamp;
}

function decodeUtf8(data: Uint8Array, operation: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new RoomServerException(`containers.${operation} returned invalid UTF-8 data`);
  }
}

function decodeJsonStatus(data: Uint8Array, operation: string): number {
  const text = decodeUtf8(data, operation);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RoomServerException(`containers.${operation} returned an invalid status payload`);
  }
  if (!isRecord(parsed)) {
    throw new RoomServerException(`containers.${operation} returned an invalid status payload`);
  }
  const status = parsed["status"];
  if (typeof status !== "number" || !Number.isInteger(status)) {
    throw new RoomServerException(`containers.${operation} returned an invalid status payload`);
  }
  return status;
}

function normalizeImageLabels(labelsRaw: unknown, operation: string): Record<string, string> {
  if (Array.isArray(labelsRaw)) {
    const labels: Record<string, string> = {};
    for (const entry of labelsRaw) {
      if (!isRecord(entry)) {
        throw new RoomServerException(`unexpected return type from containers.${operation}`);
      }
      const key = entry["key"];
      const value = entry["value"];
      if (typeof key !== "string" || typeof value !== "string") {
        throw new RoomServerException(`unexpected return type from containers.${operation}`);
      }
      labels[key] = value;
    }
    return labels;
  }
  if (isRecord(labelsRaw)) {
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(labelsRaw)) {
      if (typeof value !== "string") {
        throw new RoomServerException(`unexpected return type from containers.${operation}`);
      }
      labels[key] = value;
    }
    return labels;
  }
  if (labelsRaw === undefined || labelsRaw === null) {
    return {};
  }
  throw new RoomServerException(`unexpected return type from containers.${operation}`);
}

function normalizeImageReferences(entry: Record<string, unknown>, operation: string): string[] {
  const referencesRaw = entry["references"];
  if (Array.isArray(referencesRaw)) {
    const references = referencesRaw.filter((item): item is string => typeof item === "string");
    if (references.length !== referencesRaw.length) {
      throw new RoomServerException(`unexpected return type from containers.${operation}`);
    }
    return references;
  }
  const tagsRaw = entry["tags"];
  if (Array.isArray(tagsRaw)) {
    const references = tagsRaw.filter((item): item is string => typeof item === "string");
    if (references.length !== tagsRaw.length) {
      throw new RoomServerException(`unexpected return type from containers.${operation}`);
    }
    return references;
  }
  if (referencesRaw === undefined || referencesRaw === null) {
    return [];
  }
  throw new RoomServerException(`unexpected return type from containers.${operation}`);
}

function parseContainerImage(entry: Record<string, unknown>, operation: string): ContainerImage {
  const references = normalizeImageReferences(entry, operation);
  const preferredRef = readOptionalStringField(entry, "preferred_ref", operation) ?? references[0];
  return {
    id: readStringField(entry, "id", operation),
    preferredRef,
    references,
    labels: normalizeImageLabels(entry["labels"], operation),
    createdAt: parseTimestampField(entry, "created_at", operation),
    updatedAt: parseTimestampField(entry, "updated_at", operation),
    targetMediaType: readOptionalStringField(entry, "target_media_type", operation),
  };
}

function parseContainerImageDescriptor(
  entry: Record<string, unknown>,
  operation: string,
): ContainerImageDescriptor {
  return {
    digest: readStringField(entry, "digest", operation),
    mediaType: readOptionalStringField(entry, "media_type", operation),
    size: readOptionalIntegerField(entry, "size", operation),
    annotations: normalizeImageLabels(entry["annotations"], operation),
  };
}

function parseOptionalContainerImageDescriptor(
  value: unknown,
  operation: string,
): ContainerImageDescriptor | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  return parseContainerImageDescriptor(value, operation);
}

function parseContainerImageManifest(
  entry: Record<string, unknown>,
  operation: string,
): ContainerImageManifest {
  const descriptorRaw = entry["descriptor"];
  if (!isRecord(descriptorRaw)) {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  return {
    descriptor: parseContainerImageDescriptor(descriptorRaw, operation),
    platformOs: readOptionalStringField(entry, "platform_os", operation),
    platformArchitecture: readOptionalStringField(entry, "platform_architecture", operation),
    platformVariant: readOptionalStringField(entry, "platform_variant", operation),
  };
}

function parseContainerImageInspection(
  entry: Record<string, unknown>,
  operation: string,
): ContainerImageInspection {
  const imageRaw = entry["image"];
  const targetRaw = entry["target"];
  const manifestsRaw = entry["manifests"];
  const layersRaw = entry["layers"];
  if (!isRecord(imageRaw) || !isRecord(targetRaw) || !Array.isArray(manifestsRaw) || !Array.isArray(layersRaw)) {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  return {
    image: parseContainerImage(imageRaw, operation),
    target: parseContainerImageDescriptor(targetRaw, operation),
    selectedManifest: parseOptionalContainerImageDescriptor(entry["selected_manifest"], operation),
    manifests: manifestsRaw.map((manifest) => {
      if (!isRecord(manifest)) {
        throw new RoomServerException(`unexpected return type from containers.${operation}`);
      }
      return parseContainerImageManifest(manifest, operation);
    }),
    config: parseOptionalContainerImageDescriptor(entry["config"], operation),
    layers: layersRaw.map((layer) => {
      if (!isRecord(layer)) {
        throw new RoomServerException(`unexpected return type from containers.${operation}`);
      }
      return parseContainerImageDescriptor(layer, operation);
    }),
    contentSize: readOptionalIntegerField(entry, "content_size", operation),
  };
}

function parseImportedImage(data: Record<string, unknown>, operation: string): ImportedImage {
  const resolvedRef = data["resolved_ref"];
  const refsRaw = data["refs"];
  if (typeof resolvedRef !== "string" || !Array.isArray(refsRaw) || refsRaw.some((entry) => typeof entry !== "string")) {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  return {
    resolvedRef,
    refs: refsRaw as string[],
  };
}

function parseBuildJob(data: Record<string, unknown>, operation: string): BuildJob {
  const id = readStringField(data, "id", operation);
  const tag = readStringField(data, "tag", operation);
  const status = readStringField(data, "status", operation);
  if (!["queued", "running", "failed", "cancelled", "succeeded"].includes(status)) {
    throw new RoomServerException(`unexpected return type from containers.${operation}`);
  }
  return {
    id,
    tag,
    status: status as BuildJobStatus,
    exitCode: readOptionalIntegerField(data, "exit_code", operation),
  };
}

async function* buildInputStream(params: {
  tags?: string[];
  /** @deprecated Use tags instead. */
  tag?: string;
  mountPath: string;
  contextPath: string;
  chunks: AsyncIterable<Uint8Array>;
  dockerfilePath?: string;
  optimizeImage?: boolean;
  private?: boolean;
  credentials?: DockerSecret[];
  builderName?: string;
  size?: number;
}): AsyncIterable<Content> {
  const tags = params.tags ?? (params.tag === undefined ? [] : [params.tag]);
  if (tags.length === 0) {
    throw new RoomServerException("containers.build requires at least one tag");
  }
  yield new BinaryContent({
    data: new Uint8Array(0),
    headers: {
      kind: "start",
      tags,
      mount_path: params.mountPath,
      context_path: params.contextPath,
      dockerfile_path: params.dockerfilePath ?? null,
      optimize_image: params.optimizeImage ?? true,
      private: params.private ?? false,
      credentials: toCredentials(params.credentials ?? []),
      builder_name: params.builderName ?? null,
      size: params.size ?? null,
    },
  });

  for await (const chunk of params.chunks) {
    yield new BinaryContent({
      data: new Uint8Array(chunk),
      headers: { kind: "data" },
    });
  }
}

export class ExecSession {
  public readonly command: string;
  public readonly result: Promise<number>;
  public readonly previousOutput: Uint8Array[] = [];
  public readonly previousError: Uint8Array[] = [];
  public readonly output: AsyncIterable<Uint8Array>;
  public readonly stderr: AsyncIterable<Uint8Array>;

  private readonly requestId: string;
  private readonly containerId: string;
  private readonly tty?: boolean;
  private readonly resultCompleter = new Completer<number>();
  private readonly outputController = new StreamController<Uint8Array>();
  private readonly errorController = new StreamController<Uint8Array>();
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
    this.stderr = this.errorController.stream;
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
    this.errorController.close();
  }

  public closeError(error: unknown): void {
    if (!this.resultCompleter.completed) {
      this.resultCompleter.completeError(error);
    }
    this.closed = true;
    this.closeInputStream();
    this.outputController.close();
    this.errorController.close();
  }

  public addOutput(data: Uint8Array): void {
    this.previousOutput.push(data);
    this.outputController.add(data);
  }

  public addError(data: Uint8Array): void {
    this.previousError.push(data);
    this.errorController.add(data);
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
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
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
      images.push(parseContainerImage(entry, "list_images"));
    }
    return images;
  }

  public async inspectImage(params: { imageId: string }): Promise<ContainerImageInspection> {
    const output = await this.invoke("inspect_image", {
      image_id: params.imageId,
    });
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("inspect_image");
    }
    return parseContainerImageInspection(output.json, "inspect_image");
  }

  public async deleteImage(params: { image: string }): Promise<void> {
    await this.invoke("delete_image", {
      image: params.image,
    });
  }

  public async pullImage(params: { tag: string; credentials?: DockerSecret[] }): Promise<void> {
    await this.invoke("pull_image", {
      tag: params.tag,
      credentials: toCredentials(params.credentials ?? []),
    });
  }

  public async pushImage(params: {
    tag: string;
    credentials?: DockerSecret[];
    private?: boolean;
  }): Promise<string> {
    const output = await this.invoke("push_image", {
      tag: params.tag,
      credentials: toCredentials(params.credentials ?? []),
      private: params.private ?? false,
    });
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("push_image");
    }
    return readStringField(output.json, "container_id", "push_image");
  }

  public async load(params: { archivePath: string }): Promise<ImportedImage> {
    const output = await this.invoke("load", {
      archive_path: params.archivePath,
    });
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("load");
    }
    return parseImportedImage(output.json, "load");
  }

  public async loadImage(params: {
    mounts: ContainerMountSpec[];
    archivePath: string;
    private?: boolean;
  }): Promise<string> {
    const output = await this.invoke("load_image", {
      mounts: toMountList(params.mounts),
      archive_path: params.archivePath,
      private: params.private ?? false,
    });
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("load_image");
    }
    return readStringField(output.json, "container_id", "load_image");
  }

  public async saveImage(params: {
    tag: string;
    mounts: ContainerMountSpec[];
    archivePath: string;
    private?: boolean;
  }): Promise<string> {
    const output = await this.invoke("save_image", {
      tag: params.tag,
      mounts: toMountList(params.mounts),
      archive_path: params.archivePath,
      private: params.private ?? false,
    });
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("save_image");
    }
    return readStringField(output.json, "container_id", "save_image");
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

  public async build(params: {
    tags?: string[];
    /** @deprecated Use tags instead. */
    tag?: string;
    mountPath: string;
    contextPath: string;
    chunks: AsyncIterable<Uint8Array>;
    dockerfilePath?: string;
    optimizeImage?: boolean;
    private?: boolean;
    credentials?: DockerSecret[];
    builderName?: string;
    size?: number;
  }): Promise<string> {
    const output = await this.room.invokeWithStreamInput({
      toolkit: "containers",
      tool: "build",
      input: buildInputStream(params),
    });
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("build");
    }
    return readStringField(output.json, "build_id", "build");
  }

  public async listBuilds(): Promise<BuildJob[]> {
    const output = await this.invoke("list_builds", {});
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("list_builds");
    }
    const buildsRaw = output.json["builds"];
    if (!Array.isArray(buildsRaw)) {
      throw this.unexpectedResponseError("list_builds");
    }
    return buildsRaw.map((entry) => {
      if (!isRecord(entry)) {
        throw this.unexpectedResponseError("list_builds");
      }
      return parseBuildJob(entry, "list_builds");
    });
  }

  public async cancelBuild(params: { buildId: string }): Promise<void> {
    await this.invoke("cancel_build", {
      build_id: params.buildId,
    });
  }

  public async deleteBuild(params: { buildId: string }): Promise<void> {
    await this.invoke("delete_build", {
      build_id: params.buildId,
    });
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
          if (chunk instanceof ControlContent) {
            if (chunk.method === "close") {
              break;
            }
            throw this.unexpectedResponseError("exec");
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
          if (channel === 2) {
            session.addError(chunk.data);
            continue;
          }
          if (channel === 3) {
            session.close(decodeJsonStatus(chunk.data, "exec"));
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
      force: params.force ?? false,
    });
  }

  public async waitForExit(params: { containerId: string }): Promise<number> {
    const output = await this.invoke("wait_for_exit", {
      container_id: params.containerId,
    });
    if (!(output instanceof JsonContent) || !isRecord(output.json)) {
      throw this.unexpectedResponseError("wait_for_exit");
    }
    return readIntegerField(output.json, "exit_code", "wait_for_exit");
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
        for await (const chunk of stream) {
          if (chunk instanceof ErrorContent) {
            throw new RoomServerException(chunk.text, chunk.code);
          }
          if (chunk instanceof ControlContent) {
            if (chunk.method === "close") {
              closeInputStream();
              streamController.close();
              if (!result.completed) {
                result.complete();
              }
              return;
            }
            throw this.unexpectedResponseError("logs");
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
          streamController.add(decodeUtf8(chunk.data, "logs"));
        }
        closeInputStream();
        streamController.close();
        if (!result.completed) {
          result.complete();
        }
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

  public getBuildLogs(params: { buildId: string; follow?: boolean }): BuildLogsSession {
    const requestId = uuidv4();
    const closeInput = new Completer<void>();
    const streamController = new StreamController<string>();
    const result = new Completer<number | null>();
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
          build_id: params.buildId,
          follow: params.follow ?? true,
        },
      });
      await closeInput.fut;
    };

    this.room
      .invokeStream({
        toolkit: "containers",
        tool: "get_build_logs",
        input: inputStream(),
      })
      .then(async (stream) => {
        for await (const chunk of stream) {
          if (chunk instanceof ErrorContent) {
            throw new RoomServerException(chunk.text, chunk.code);
          }
          if (chunk instanceof ControlContent) {
            if (chunk.method === "close") {
              closeInputStream();
              streamController.close();
              if (!result.completed) {
                result.complete(null);
              }
              return;
            }
            throw this.unexpectedResponseError("get_build_logs");
          }
          if (!(chunk instanceof BinaryContent)) {
            throw this.unexpectedResponseError("get_build_logs");
          }
          const channel = chunk.headers["channel"];
          if (typeof channel !== "number") {
            throw new RoomServerException("containers.get_build_logs returned a chunk without a valid channel");
          }
          if (channel === 1) {
            streamController.add(decodeUtf8(chunk.data, "get_build_logs"));
            continue;
          }
          if (channel === 3) {
            closeInputStream();
            streamController.close();
            if (!result.completed) {
              result.complete(decodeJsonStatus(chunk.data, "get_build_logs"));
            }
            return;
          }
        }
        closeInputStream();
        streamController.close();
        if (!result.completed) {
          result.complete(null);
        }
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
      const portsRaw = entry["ports"];
      const serviceIdRaw = entry["service_id"];
      if (!Array.isArray(portsRaw) || !portsRaw.every((port) => typeof port === "number" && Number.isInteger(port))) {
        throw this.unexpectedResponseError("list");
      }
      items.push({
        id,
        image,
        name: typeof nameRaw === "string" ? nameRaw : undefined,
        ports: portsRaw,
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
