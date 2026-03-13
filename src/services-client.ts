import { ServiceSpec } from "./meshagent-client";
import { JsonContent, EmptyContent } from "./response";
import { RoomClient } from "./room-client";
import { RoomServerException } from "./room-server-client";

export interface ServiceRuntimeState {
  serviceId: string;
  state: string;
  containerId?: string;
  restartScheduledAt?: number;
  startedAt?: number;
  restartCount: number;
  lastExitCode?: number;
  lastExitAt?: number;
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

function parseServiceRuntimeState(value: unknown): ServiceRuntimeState {
  if (!isRecord(value) || typeof value["service_id"] !== "string") {
    throw new RoomServerException("unexpected return type from services.list");
  }

  const state = value["state"];
  const containerId = value["container_id"];

  return {
    serviceId: value["service_id"],
    state: typeof state === "string" ? state : "unknown",
    containerId: typeof containerId === "string" ? containerId : undefined,
    restartScheduledAt: toOptionalNumber(value["restart_scheduled_at"]),
    startedAt: toOptionalNumber(value["started_at"]),
    restartCount: toOptionalInteger(value["restart_count"]) ?? 0,
    lastExitCode: toOptionalInteger(value["last_exit_code"]),
    lastExitAt: toOptionalNumber(value["last_exit_at"]),
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

  public async list(): Promise<ServiceSpec[]> {
    return (await this.listWithState()).services;
  }

  public async listWithState(): Promise<ListServicesResult> {
    const response = await this.room.invoke({
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
    const response = await this.room.invoke({
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
