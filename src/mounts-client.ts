import { JsonContent } from "./response.js";
import type { RoomClient } from "./room-client.js";
import { RoomServerException } from "./room-server-client.js";

export interface MountedVolumeConsumer {
  kind: "room" | "container";
  containerId?: string;
}

export interface MountedVolume {
  id: string;
  name: string;
  required: boolean;
  description: string;
  metadata: Record<string, unknown>;
  annotations: Record<string, string>;
  storageClass: "standard" | "juice" | "zerofs";
  maxSizeMb?: number;
  consumers: MountedVolumeConsumer[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMountedVolume(value: unknown): MountedVolume {
  if (!isRecord(value)
    || typeof value["id"] !== "string"
    || typeof value["name"] !== "string"
    || typeof value["required"] !== "boolean") {
    throw new RoomServerException("unexpected return type from mounts.list");
  }
  const metadata = isRecord(value["metadata"]) ? value["metadata"] : {};
  const rawAnnotations = isRecord(value["annotations"]) ? value["annotations"] : {};
  const annotations: Record<string, string> = {};
  for (const [key, item] of Object.entries(rawAnnotations)) {
    if (typeof item === "string") {
      annotations[key] = item;
    }
  }
  const rawConsumers = value["consumers"] ?? [];
  if (!Array.isArray(rawConsumers)) {
    throw new RoomServerException("unexpected return type from mounts.list");
  }
  const consumers = rawConsumers.map((consumer): MountedVolumeConsumer => {
    if (!isRecord(consumer)
      || (consumer["kind"] !== "room" && consumer["kind"] !== "container")
      || (consumer["kind"] === "container" && typeof consumer["container_id"] !== "string")
      || (consumer["kind"] === "room" && consumer["container_id"] !== undefined)) {
      throw new RoomServerException("unexpected return type from mounts.list");
    }
    return {
      kind: consumer["kind"],
      containerId: typeof consumer["container_id"] === "string"
        ? consumer["container_id"]
        : undefined,
    };
  });
  const storageClass = value["storage_class"] ?? "standard";
  if (storageClass !== "standard" && storageClass !== "juice" && storageClass !== "zerofs") {
    throw new RoomServerException("unexpected return type from mounts.list");
  }
  const maxSizeMb = value["max_size_mb"];
  if (maxSizeMb !== undefined && (typeof maxSizeMb !== "number" || !Number.isInteger(maxSizeMb) || maxSizeMb <= 0)) {
    throw new RoomServerException("unexpected return type from mounts.list");
  }
  return {
    id: value["id"],
    name: value["name"],
    required: value["required"],
    description: typeof value["description"] === "string" ? value["description"] : "",
    metadata,
    annotations,
    storageClass,
    maxSizeMb,
    consumers,
  };
}

export class MountsClient {
  constructor(private readonly room: RoomClient) {}

  public async list(): Promise<MountedVolume[]> {
    const response = await this.room.invokeContent({
      toolkit: "mounts",
      tool: "list",
      input: {},
    });
    if (!(response instanceof JsonContent)) {
      throw new RoomServerException("unexpected return type from mounts.list");
    }
    const volumes = response.json["volumes"];
    if (!Array.isArray(volumes)) {
      throw new RoomServerException("unexpected return type from mounts.list");
    }
    return volumes.map(parseMountedVolume);
  }
}
