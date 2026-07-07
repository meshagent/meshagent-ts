import type { ServiceSpec } from "./meshagent-client.js";
import { JsonContent, EmptyContent } from "./response.js";
import { RoomClient } from "./room-client.js";
import { RoomServerException } from "./room-server-client.js";

export type ServicePortNum = NonNullable<ServiceSpec["ports"]>[number]["num"];

export interface ServiceRuntimeState {
  serviceId: string;
  state: string;
  containerId?: string;
  restartScheduledAt?: number;
  startedAt?: number;
  restartCount: number;
  lastExitCode?: number;
  lastExitAt?: number;
  lastStartError?: string;
  lastStartErrorAt?: number;
  status: ServiceRuntimeStatus;
  events: ServiceRuntimeEvent[];
}

export interface ServiceRuntimeStatus {
  ports: ServicePortRuntimeState[];
}

export interface ServicePortRuntimeState {
  num: ServicePortNum;
  liveness?: string;
  livenessStatus: "not_configured" | "not_ready" | "ready";
  lastCheckedAt?: number;
  lastError?: string;
}

export interface ServiceRuntimeEvent {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface ListServicesResult {
  services: ServiceSpec[];
  serviceStates: Record<string, ServiceRuntimeState>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toOptionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function parseServiceRuntimeStatus(value: unknown): ServiceRuntimeStatus {
  if (!isRecord(value)) {
    return { ports: [] };
  }
  const portsRaw = value["ports"];
  return {
    ports: Array.isArray(portsRaw) ? portsRaw.map((port) => parseServicePortRuntimeState(port)) : [],
  };
}

function parseServicePortRuntimeState(value: unknown): ServicePortRuntimeState {
  if (!isRecord(value)) {
    throw new RoomServerException("unexpected return type from services.list");
  }
  const num = value["num"];
  if (num !== "*" && typeof num !== "number") {
    throw new RoomServerException("unexpected return type from services.list");
  }
  const liveness = value["liveness"];
  const livenessStatus = value["liveness_status"];
  const lastError = value["last_error"];
  return {
    num,
    liveness: typeof liveness === "string" ? liveness : undefined,
    livenessStatus:
      livenessStatus === "not_ready" || livenessStatus === "ready" ? livenessStatus : "not_configured",
    lastCheckedAt: toOptionalNumber(value["last_checked_at"]),
    lastError: typeof lastError === "string" ? lastError : undefined,
  };
}

function parseServiceRuntimeState(value: unknown): ServiceRuntimeState {
  if (!isRecord(value) || typeof value["service_id"] !== "string") {
    throw new RoomServerException("unexpected return type from services.list");
  }

  const state = value["state"];
  const containerId = value["container_id"];
  const eventsRaw = value["events"];

  return {
    serviceId: value["service_id"],
    state: typeof state === "string" ? state : "unknown",
    containerId: typeof containerId === "string" ? containerId : undefined,
    restartScheduledAt: toOptionalNumber(value["restart_scheduled_at"]),
    startedAt: toOptionalNumber(value["started_at"]),
    restartCount: toOptionalInteger(value["restart_count"]) ?? 0,
    lastExitCode: toOptionalInteger(value["last_exit_code"]),
    lastExitAt: toOptionalNumber(value["last_exit_at"]),
    lastStartError: typeof value["last_start_error"] === "string" ? value["last_start_error"] : undefined,
    lastStartErrorAt: toOptionalNumber(value["last_start_error_at"]),
    status: parseServiceRuntimeStatus(value["status"]),
    events: Array.isArray(eventsRaw) ? eventsRaw.map((event) => parseServiceRuntimeEvent(event)) : [],
  };
}

function parseServiceRuntimeEvent(value: unknown): ServiceRuntimeEvent {
  if (!isRecord(value)) {
    throw new RoomServerException("unexpected return type from services.list");
  }

  return {
    type: typeof value["type"] === "string" ? value["type"] : "Normal",
    reason: typeof value["reason"] === "string" ? value["reason"] : "Unknown",
    message: typeof value["message"] === "string" ? value["message"] : "",
    count: toOptionalInteger(value["count"]) ?? 1,
    firstTimestamp: toOptionalNumber(value["first_timestamp"]) ?? 0,
    lastTimestamp: toOptionalNumber(value["last_timestamp"]) ?? 0,
  };
}

function parseServiceSpecJson(value: unknown): ServiceSpec {
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
      throw new RoomServerException("unexpected return type from services.list");
    }
    return parsed as unknown as ServiceSpec;
  }

  if (!isRecord(value)) {
    throw new RoomServerException("unexpected return type from services.list");
  }

  return value as unknown as ServiceSpec;
}

export class ServicesClient {
  private readonly room: RoomClient;

  constructor({ room }: { room: RoomClient }) {
    this.room = room;
  }

  private unexpectedResponse(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from services.${operation}`);
  }

  public async list(): Promise<ListServicesResult> {
    const response = await this.room.invokeContent({
      toolkit: "services",
      tool: "list",
      input: {},
    });

    if (!(response instanceof JsonContent)) {
      throw this.unexpectedResponse("list");
    }

    const servicesRaw = response.json["services_json"];
    const serviceStatesRaw = response.json["service_states"];

    if (!Array.isArray(servicesRaw) || !Array.isArray(serviceStatesRaw)) {
      throw this.unexpectedResponse("list");
    }

    const serviceStates: Record<string, ServiceRuntimeState> = {};
    for (const item of serviceStatesRaw) {
      const state = parseServiceRuntimeState(item);
      serviceStates[state.serviceId] = state;
    }

    return {
      services: servicesRaw.map((item) => parseServiceSpecJson(item)),
      serviceStates,
    };
  }

  public async restart(params: { serviceId: string }): Promise<void> {
    const response = await this.room.invokeContent({
      toolkit: "services",
      tool: "restart",
      input: {
        service_id: params.serviceId,
      },
    });

    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }

    throw this.unexpectedResponse("restart");
  }
}
