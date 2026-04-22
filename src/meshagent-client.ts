import { meshagentBaseUrl } from "./helpers";
import { RoomException } from "./requirement";
import { ApiScope } from "./participant-token";
import { decoder, encoder } from "./utils";

export type ProjectRole = "member" | "admin" | "developer";

export interface RoomShare {
    id: string;
    projectId: string;
    settings: Record<string, unknown>;
}

export interface RoomConnectionInfo {
    jwt: string;
    roomName: string;
    projectId: string;
    roomUrl: string;
}

export interface RoomSession {
    id: string;
    roomId?: string | null;
    roomName: string;
    createdAt: Date;
    isActive: boolean;
    participants?: Record<string, number>;
}

export interface RoomInfo {
    id: string;
    name: string;
    metadata: Record<string, unknown>;
    annotations: Record<string, string>;
}

export interface ProjectRoomGrant {
    room: RoomInfo;
    userId: string;
    permissions: ApiScope;
}

export interface ProjectRoomGrantCount {
    room: RoomInfo;
    count: number;
}

export interface ProjectUserGrantCount {
    userId: string;
    count: number;
    firstName?: string | null;
    lastName?: string | null;
    email: string;
}

export interface EnvironmentVariable {
    name: string;
    value: string;
}

export interface RoomStorageMountSpec {
    path: string;
    subpath?: string | null;
    read_only?: boolean;
}

export interface ProjectStorageMountSpec {
    path: string;
    subpath?: string | null;
    read_only?: boolean;
}

export interface EmptyDirMountSpec {
    path: string;
    read_only?: boolean;
}

export interface ConfigMountSpec {
    path?: string | null;
}

export interface ContainerMountSpec {
    room?: RoomStorageMountSpec[];
    project?: ProjectStorageMountSpec[];
    empty_dirs?: EmptyDirMountSpec[];
    configs?: ConfigMountSpec[];
}

export interface ServiceApiKeySpec {
    role: "admin";
    name: string;
    auto_provision?: boolean | null;
}

export interface PromptTemplate {
    name: string;
    description?: string | null;
    prompt: string;
    annotations?: Record<string, string> | null;
}

export interface ChannelSpec {
    annotations?: Record<string, string> | null;
}

export interface EmailChannel extends ChannelSpec {
    address: string;
    private?: boolean | null;
}

export interface QueueChannel extends ChannelSpec {
    queue: string;
    threading_mode?: "default-new" | null;
    message_schema?: Record<string, unknown> | null;
}

export interface MessagingChannel extends ChannelSpec {
    protocol?: string | null;
    prompts?: PromptTemplate[] | null;
}

export interface ToolkitChannel extends ChannelSpec {
    name: string;
}

export interface ChannelsSpec {
    email?: EmailChannel[] | null;
    messaging?: MessagingChannel[] | null;
    queue?: QueueChannel[] | null;
    toolkit?: ToolkitChannel[] | null;
}

export interface EmailSpec {
    address: string;
    public?: boolean | null;
}

export interface AgentTextContent {
    type: "text";
    text: string;
}

export interface AgentFileContent {
    type: "file";
    url: string;
}

export type AgentInputContent = AgentTextContent | AgentFileContent;

export interface HeartbeatSpec {
    queue: string;
    thread_id?: string | null;
    prompt?: AgentInputContent[] | null;
    minutes: number;
}

export interface AgentSpec {
    name: string;
    description?: string | null;
    annotations?: Record<string, string> | null;
    channels?: ChannelsSpec | null;
    email?: EmailSpec | null;
    heartbeat?: HeartbeatSpec | null;
}

export interface ServiceMetadata {
    name: string;
    description?: string | null;
    repo?: string | null;
    icon?: string | null;
    annotations?: Record<string, string> | null;
}

export interface ContainerSpec {
    command?: string | null;
    working_dir?: string | null;
    image: string;
    environment?: EnvironmentVariable[] | null;
    secrets?: string[];
    pull_secret?: string | null;
    storage?: ContainerMountSpec;
}

export interface ExternalServiceSpec {
    url: string;
}

export interface MeshagentEndpointSpec {
    identity: string;
    api?: ApiScope;
}

export interface AllowedMcpToolFilter {
    tool_names?: string[] | null;
    read_only?: boolean | null;
}

export interface OAuthClientConfig {
    client_id: string;
    client_secret?: string | null;
    authorization_endpoint: string;
    token_endpoint: string;
    no_pkce?: boolean | null;
    scopes?: string[] | null;
}

export interface MCPEndpointSpec {
    label: string;
    description?: string | null;
    allowed_tools?: AllowedMcpToolFilter[] | null;
    headers?: Record<string, string> | null;
    require_approval?: "always" | "never" | null;
    oauth?: OAuthClientConfig | null;
    openai_connector_id?: string | null;
}

export interface EndpointSpec {
    path: string;
    meshagent?: MeshagentEndpointSpec;
    mcp?: MCPEndpointSpec;
}

export interface PortSpec {
    num: "*" | number;
    type?: "http" | "tcp" | null;
    endpoints?: EndpointSpec[];
    liveness?: string | null;
}

export interface ServiceSpec {
    version: "v1";
    kind: "Service";
    id?: string | null;
    metadata: ServiceMetadata;
    agents?: AgentSpec[] | null;
    ports?: PortSpec[];
    container?: ContainerSpec | null;
    external?: ExternalServiceSpec | null;
}

function pruneUndefinedValues(value: unknown): unknown {
    if (Array.isArray(value)) {
        const prunedItems = value
            .map((item) => pruneUndefinedValues(item))
            .filter((item) => item !== undefined);
        return prunedItems;
    }

    if (value === null || value === undefined) {
        return value === undefined ? undefined : null;
    }

    if (typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
            if (entryValue === undefined) {
                continue;
            }
            result[key] = pruneUndefinedValues(entryValue);
        }
        return result;
    }

    return value;
}

function serializeServiceSpec(service: ServiceSpec): Record<string, unknown> {
    const agents = service.agents?.map((agent) => ({
        ...agent,
        channels: agent.channels == null
            ? agent.channels
            : {
                ...agent.channels,
                messaging: agent.channels.messaging?.map((channel) => ({
                    ...channel,
                    protocol: channel.protocol ?? "meshagent.agent-message.v1",
                })),
            },
    }));

    return pruneUndefinedValues({
        ...service,
        agents,
    }) as Record<string, unknown>;
}

export interface Mailbox {
    address: string;
    room: string;
    roomId?: string;
    queue: string;
}

export interface ProjectRepository {
    id: string;
    projectId: string;
    name: string;
    description: string;
    annotations: Record<string, string>;
    createdAt: Date;
}

export interface Balance {
    balance: number;
    autoRechargeThreshold?: number | null;
    autoRechargeAmount?: number | null;
    lastRecharge?: Date | null;
}

export interface Transaction {
    id: string;
    amount: number;
    reference?: string | null;
    referenceType?: string | null;
    description: string;
    createdAt: Date;
}

export interface OAuthClient {
    clientId: string;
    clientSecret: string;
    grantTypes: string[];
    responseTypes: string[];
    redirectUris: string[];
    scope: string;
    projectId: string;
    metadata: Record<string, string>;
}

export interface BaseSecret {
    id?: string;
    name: string;
    type: "docker" | "keys";
}

export interface PullSecret extends BaseSecret {
    type: "docker";
    server: string;
    username: string;
    password: string;
    email?: string;
}

export interface KeysSecret extends BaseSecret {
    type: "keys";
    data: Record<string, string>;
}

export type SecretLike = PullSecret | KeysSecret;

export interface ManagedSecretInfo {
    id: string;
    type: string;
    name: string;
    delegatedTo?: string | null;
}

export interface ManagedSecret extends ManagedSecretInfo {
    dataBase64: string;
    data: Uint8Array;
}

export interface ConnectorRef {
    openaiConnectorId?: string | null;
    serverUrl?: string | null;
    clientSecretId?: string | null;
}

export interface ExternalOAuthClientRegistration {
    id: string;
    delegatedTo: string;
    connector?: ConnectorRef | null;
    oauth?: OAuthClientConfig | null;
    clientId: string;
    clientSecret?: string | null;
}

type RequestBody = string | Uint8Array | ArrayBuffer | null | undefined;

interface RequestOptions {
    method?: string;
    query?: Record<string, string | number | boolean | undefined | null>;
    json?: Record<string, unknown> | Array<unknown> | null;
    body?: RequestBody;
    headers?: Record<string, string>;
    action: string;
    responseType?: "json" | "text" | "arrayBuffer" | "void";
}

const globalScope = globalThis as typeof globalThis & {
    Buffer?: {
        from(data: Uint8Array | string, encoding?: string): { toString(encoding: string): string };
    };
    btoa?: (data: string) => string;
    atob?: (data: string) => string;
};

function bytesToBase64(bytes: Uint8Array): string {
    if (globalScope.Buffer) {
        return globalScope.Buffer.from(bytes).toString("base64");
    }

    if (!globalScope.btoa) {
        throw new Error("base64 encoding is not available in this runtime");
    }

    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return globalScope.btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    if (globalScope.Buffer) {
        return Uint8Array.from(globalScope.Buffer.from(base64, "base64") as unknown as ArrayLike<number>);
    }

    if (!globalScope.atob) {
        throw new Error("base64 decoding is not available in this runtime");
    }

    const binary = globalScope.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function toFetchBody(body: RequestBody): string | ArrayBuffer | undefined {
    if (body == null) {
        return undefined;
    }

    if (typeof body === "string" || body instanceof ArrayBuffer) {
        return body;
    }

    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return copy.buffer;
}

function normalizeBinary(data: Uint8Array | ArrayBuffer | Buffer): Uint8Array {
    if (data instanceof Uint8Array) {
        return data;
    }
    return new Uint8Array(data);
}

export class Meshagent {
    private readonly baseUrl: string;
    private readonly token?: string;

    constructor({ baseUrl, token }: { baseUrl?: string; token?: string } = {}) {
        const resolvedBaseUrl = meshagentBaseUrl(baseUrl).replace(/\/+$/, "");
        this.baseUrl = resolvedBaseUrl || "https://api.meshagent.com";
        const envToken = typeof process !== "undefined" ? process.env?.MESHAGENT_API_KEY : undefined;
        this.token = token ?? envToken ?? undefined;
    }

    private buildUrl(path: string, query?: RequestOptions["query"]): string {
        const url = new URL(path, this.baseUrl);
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                if (value === undefined || value === null) {
                    continue;
                }
                url.searchParams.set(key, String(value));
            }
        }
        return url.toString();
    }

    private async request<T = unknown>(path: string, options: RequestOptions): Promise<T> {
        const { method = "GET", query, json, body, headers, action, responseType = "json" } = options;
        const url = this.buildUrl(path, query);

        const finalHeaders: Record<string, string> = {};
        if (this.token) {
            finalHeaders["Authorization"] = `Bearer ${this.token}`;
        }

        if (headers) {
            for (const [key, value] of Object.entries(headers)) {
                finalHeaders[key] = value;
            }
        }

        let requestBody: RequestBody = undefined;
        if (json !== undefined && json !== null) {
            requestBody = JSON.stringify(json);
            finalHeaders["Content-Type"] = "application/json";
        } else if (body !== undefined && body !== null) {
            if (body instanceof ArrayBuffer) {
                requestBody = new Uint8Array(body);
            } else {
                requestBody = body;
            }
        }

        const response = await fetch(url, {
            method,
            headers: finalHeaders,
            body: toFetchBody(requestBody),
        });

        if (!response.ok) {
            let message: string;
            try {
                message = await response.text();
            } catch {
                message = "<unable to read body>";
            }
            throw new RoomException(`Failed to ${action}. Status code: ${response.status}, body: ${message}`);
        }

        switch (responseType) {
            case "json":
                if (response.status === 204) {
                    return {} as T;
                }
                return (await response.json()) as T;
            case "text":
                return (await response.text()) as T;
            case "arrayBuffer":
                return new Uint8Array(await response.arrayBuffer()) as unknown as T;
            case "void":
            default:
                return undefined as T;
        }
    }

    private parseRoomShare(data: any): RoomShare {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid room share payload: expected object");
        }
        const { id, project_id: projectId, projectId: projectIdAlt, settings } = data as any;
        if (typeof id !== "string") {
            throw new RoomException("Invalid room share payload: missing id");
        }
        const finalProjectId = typeof projectIdAlt === "string" ? projectIdAlt : typeof projectId === "string" ? projectId : undefined;
        if (!finalProjectId) {
            throw new RoomException("Invalid room share payload: missing project id");
        }
        return {
            id,
            projectId: finalProjectId,
            settings: (settings && typeof settings === "object") ? settings as Record<string, unknown> : {},
        };
    }

    private parseRoomSession(data: any): RoomSession {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid room session payload");
        }
        const { id, room_id: roomIdRaw, roomId, room_name: roomNameRaw, roomName, created_at: createdRaw, createdAt, is_active: isActiveRaw, isActive, participants } = data as any;
        if (typeof id !== "string") {
            throw new RoomException("Invalid room session payload: missing id");
        }
        const roomNameValue = typeof roomName === "string" ? roomName : roomNameRaw;
        if (typeof roomNameValue !== "string") {
            throw new RoomException("Invalid room session payload: missing room name");
        }
        const created = typeof createdAt === "string" ? createdAt : createdRaw;
        if (typeof created !== "string") {
            throw new RoomException("Invalid room session payload: missing created_at");
        }
        const isActiveValue = typeof isActive === "boolean" ? isActive : isActiveRaw;
        if (typeof isActiveValue !== "boolean") {
            throw new RoomException("Invalid room session payload: missing is_active");
        }
        return {
            id,
            roomId: typeof roomId === "string" ? roomId : typeof roomIdRaw === "string" ? roomIdRaw : undefined,
            roomName: roomNameValue,
            createdAt: new Date(created),
            isActive: isActiveValue,
            participants: participants && typeof participants === "object" ? participants as Record<string, number> : undefined,
        };
    }

    private parseRoom(data: any): RoomInfo {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid room payload");
        }
        const { id, name, metadata, annotations } = data as any;
        if (typeof id !== "string" || typeof name !== "string") {
            throw new RoomException("Invalid room payload: missing id or name");
        }
        return {
            id,
            name,
            metadata: metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {},
            annotations: annotations && typeof annotations === "object" ? annotations as Record<string, string> : {},
        };
    }

    private parseProjectRepository(data: any): ProjectRepository {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid repository payload");
        }

        const {
            id,
            project_id: projectIdRaw,
            projectId,
            name,
            description,
            annotations,
            created_at: createdAtRaw,
            createdAt,
        } = data as any;
        const projectIdValue =
            typeof projectId === "string"
                ? projectId
                : typeof projectIdRaw === "string"
                  ? projectIdRaw
                  : undefined;
        const createdAtValue =
            typeof createdAt === "string"
                ? createdAt
                : typeof createdAtRaw === "string"
                  ? createdAtRaw
                  : undefined;

        if (typeof id !== "string" || typeof projectIdValue !== "string" || typeof name !== "string" || typeof createdAtValue !== "string") {
            throw new RoomException("Invalid repository payload: missing required fields");
        }

        return {
            id,
            projectId: projectIdValue,
            name,
            description: typeof description === "string" ? description : "",
            annotations: annotations && typeof annotations === "object" ? annotations as Record<string, string> : {},
            createdAt: new Date(createdAtValue),
        };
    }

    private parseProjectRoomGrant(data: any): ProjectRoomGrant {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid room grant payload");
        }
        const roomData = (data as any).room;
        const room = this.parseRoom(roomData);
        const userId = (data as any).user_id ?? (data as any).userId;
        if (typeof userId !== "string") {
            throw new RoomException("Invalid room grant payload: missing user_id");
        }
        const permissionsRaw = (data as any).permissions;
        const permissions = permissionsRaw && typeof permissionsRaw === "object" ? ApiScope.fromJSON(permissionsRaw) : new ApiScope();
        return { room, userId, permissions };
    }

    private parseProjectRoomGrantCount(data: any): ProjectRoomGrantCount {
        const roomData = (data && typeof data === "object") ? ((data as any).room ?? { id: (data as any).room_id, name: (data as any).room_name, metadata: (data as any).metadata ?? {} }) : undefined;
        if (!roomData) {
            throw new RoomException("Invalid room grant count payload: missing room");
        }
        const room = this.parseRoom(roomData);
        const count = (data as any).count;
        if (typeof count !== "number") {
            throw new RoomException("Invalid room grant count payload: missing count");
        }
        return { room, count };
    }

    private parseProjectUserGrantCount(data: any): ProjectUserGrantCount {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid room grant user count payload");
        }
        const { user_id: userIdRaw, userId, count, first_name: firstNameRaw, firstName, last_name: lastNameRaw, lastName, email } = data as any;
        const userIdValue = typeof userId === "string" ? userId : userIdRaw;
        if (typeof userIdValue !== "string") {
            throw new RoomException("Invalid room grant user count payload: missing user_id");
        }
        if (typeof count !== "number") {
            throw new RoomException("Invalid room grant user count payload: missing count");
        }
        if (typeof email !== "string") {
            throw new RoomException("Invalid room grant user count payload: missing email");
        }
        return {
            userId: userIdValue,
            count,
            firstName: typeof firstName === "string" ? firstName : firstNameRaw,
            lastName: typeof lastName === "string" ? lastName : lastNameRaw,
            email,
        };
    }

    private parseBalance(data: any): Balance {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid balance payload");
        }
        const balanceValue = (data as any).balance;
        if (typeof balanceValue !== "number") {
            throw new RoomException("Invalid balance payload: missing balance");
        }
        const threshold = (data as any).auto_recharge_threshold ?? (data as any).autoRechargeThreshold;
        const amount = (data as any).auto_recharge_amount ?? (data as any).autoRechargeAmount;
        const lastRechargeRaw = (data as any).last_recharge ?? (data as any).lastRecharge;
        return {
            balance: balanceValue,
            autoRechargeThreshold: typeof threshold === "number" ? threshold : null,
            autoRechargeAmount: typeof amount === "number" ? amount : null,
            lastRecharge: typeof lastRechargeRaw === "string" ? new Date(lastRechargeRaw) : null,
        };
    }

    private parseTransaction(data: any): Transaction {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid transaction payload");
        }
        const { id, amount, reference, referenceType, reference_type: referenceTypeRaw, description, created_at: createdAtRaw, createdAt } = data as any;
        if (typeof id !== "string" || typeof amount !== "number" || typeof description !== "string") {
            throw new RoomException("Invalid transaction payload: missing fields");
        }
        const createdValue = typeof createdAt === "string" ? createdAt : createdAtRaw;
        if (typeof createdValue !== "string") {
            throw new RoomException("Invalid transaction payload: missing created_at");
        }
        const referenceTypeValue = typeof referenceType === "string" ? referenceType : referenceTypeRaw;
        return {
            id,
            amount,
            reference: typeof reference === "string" ? reference : null,
            referenceType: typeof referenceTypeValue === "string" ? referenceTypeValue : null,
            description,
            createdAt: new Date(createdValue),
        };
    }

    private parseSecret(data: any): SecretLike {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid secret payload");
        }
        const type = (data as any).type;
        if (type === "docker") {
            const server = (data as any).server;
            const username = (data as any).username;
            const password = (data as any).password;
            if (typeof server !== "string" || typeof username !== "string" || typeof password !== "string") {
                throw new RoomException("Invalid docker secret payload");
            }
            return {
                id: typeof (data as any).id === "string" ? (data as any).id : undefined,
                name: (data as any).name,
                type: "docker",
                server,
                username,
                password,
                email: typeof (data as any).email === "string" ? (data as any).email : undefined,
            };
        }
        if (type === "keys") {
            const record = (data as any).data;
            if (!record || typeof record !== "object") {
                throw new RoomException("Invalid keys secret payload");
            }
            return {
                id: typeof (data as any).id === "string" ? (data as any).id : undefined,
                name: (data as any).name,
                type: "keys",
                data: record as Record<string, string>,
            };
        }
        throw new RoomException(`Unknown secret type: ${type}`);
    }

    private parseManagedSecretInfo(data: any): ManagedSecretInfo {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid managed secret payload");
        }

        const { id, type, name, delegated_to: delegatedToRaw, delegatedTo } = data as any;
        if (typeof id !== "string" || typeof type !== "string" || typeof name !== "string") {
            throw new RoomException("Invalid managed secret payload: missing id, type, or name");
        }

        const delegatedToValue = typeof delegatedTo === "string"
            ? delegatedTo
            : typeof delegatedToRaw === "string"
                ? delegatedToRaw
                : null;

        return {
            id,
            type,
            name,
            delegatedTo: delegatedToValue,
        };
    }

    private parseManagedSecret(data: any): ManagedSecret {
        const secret = this.parseManagedSecretInfo(data);
        const dataBase64 = (data as any).data_base64 ?? (data as any).dataBase64;
        if (typeof dataBase64 !== "string") {
            throw new RoomException("Invalid managed secret payload: missing data_base64");
        }

        return {
            ...secret,
            dataBase64,
            data: base64ToBytes(dataBase64),
        };
    }

    private parseSecretPayload(secret: ManagedSecretInfo, rawData: Uint8Array): SecretLike {
        let payload: unknown;
        try {
            payload = JSON.parse(decoder.decode(rawData));
        } catch {
            throw new RoomException(`Invalid secret payload for ${secret.id}`);
        }

        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw new RoomException(`Invalid secret payload for ${secret.id}`);
        }

        if (secret.type === "docker") {
            const { server, username, password, email } = payload as Record<string, unknown>;
            if (typeof server !== "string" || typeof username !== "string" || typeof password !== "string") {
                throw new RoomException(`Invalid secret payload for ${secret.id}`);
            }
            return {
                id: secret.id,
                name: secret.name,
                type: "docker",
                server,
                username,
                password,
                email: typeof email === "string" ? email : "none@example.com",
            };
        }

        const entries = Object.entries(payload as Record<string, unknown>);
        if (entries.some(([, value]) => typeof value !== "string")) {
            throw new RoomException(`Invalid secret payload for ${secret.id}`);
        }

        return {
            id: secret.id,
            name: secret.name,
            type: "keys",
            data: Object.fromEntries(entries as Array<[string, string]>),
        };
    }

    private toSecretPayload(secret: SecretLike): { name: string; type: string; data: Record<string, string> } {
        if (secret.type === "docker") {
            return {
                name: secret.name,
                type: secret.type,
                data: {
                    server: secret.server,
                    username: secret.username,
                    password: secret.password,
                    email: secret.email ?? "none@example.com",
                },
            };
        }
        return {
            name: secret.name,
            type: secret.type,
            data: { ...secret.data },
        };
    }

    private parseConnectorRef(data: any): ConnectorRef | null {
        if (data == null) {
            return null;
        }

        if (typeof data !== "object") {
            throw new RoomException("Invalid connector payload");
        }

        const {
            openai_connector_id: openaiConnectorIdRaw,
            openaiConnectorId,
            server_url: serverUrlRaw,
            serverUrl,
            client_secret_id: clientSecretIdRaw,
            clientSecretId,
        } = data as any;

        return {
            openaiConnectorId: typeof openaiConnectorId === "string"
                ? openaiConnectorId
                : typeof openaiConnectorIdRaw === "string"
                    ? openaiConnectorIdRaw
                    : null,
            serverUrl: typeof serverUrl === "string"
                ? serverUrl
                : typeof serverUrlRaw === "string"
                    ? serverUrlRaw
                    : null,
            clientSecretId: typeof clientSecretId === "string"
                ? clientSecretId
                : typeof clientSecretIdRaw === "string"
                    ? clientSecretIdRaw
                    : null,
        };
    }

    private serializeConnectorRef(connector?: ConnectorRef | null): Record<string, string> | null {
        if (connector == null) {
            return null;
        }

        const payload: Record<string, string> = {};
        if (connector.openaiConnectorId) {
            payload.openai_connector_id = connector.openaiConnectorId;
        }
        if (connector.serverUrl) {
            payload.server_url = connector.serverUrl;
        }
        if (connector.clientSecretId) {
            payload.client_secret_id = connector.clientSecretId;
        }
        return payload;
    }

    private parseExternalOAuthClientRegistration(data: any): ExternalOAuthClientRegistration {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid external oauth registration payload");
        }

        const {
            id,
            delegated_to: delegatedToRaw,
            delegatedTo,
            connector,
            oauth,
            client_id: clientIdRaw,
            clientId,
            client_secret: clientSecretRaw,
            clientSecret,
        } = data as any;

        const delegatedToValue = typeof delegatedTo === "string" ? delegatedTo : delegatedToRaw;
        const clientIdValue = typeof clientId === "string" ? clientId : clientIdRaw;
        const clientSecretValue = typeof clientSecret === "string" ? clientSecret : clientSecretRaw;

        if (typeof id !== "string" || typeof delegatedToValue !== "string" || typeof clientIdValue !== "string") {
            throw new RoomException("Invalid external oauth registration payload: missing fields");
        }

        return {
            id,
            delegatedTo: delegatedToValue,
            connector: this.parseConnectorRef(connector),
            oauth: oauth && typeof oauth === "object" ? oauth as OAuthClientConfig : null,
            clientId: clientIdValue,
            clientSecret: typeof clientSecretValue === "string" ? clientSecretValue : null,
        };
    }

    private parseOAuthClient(data: any): OAuthClient {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid OAuth client payload");
        }
        const { client_id: clientIdRaw, clientId, client_secret: clientSecretRaw, clientSecret, grant_types: grantTypesRaw, grantTypes, response_types: responseTypesRaw, responseTypes, redirect_uris: redirectUrisRaw, redirectUris, scope, project_id: projectIdRaw, projectId, metadata } = data as any;
        const clientIdValue = typeof clientId === "string" ? clientId : clientIdRaw;
        const clientSecretValue = typeof clientSecret === "string" ? clientSecret : clientSecretRaw;
        const grantTypesValue = Array.isArray(grantTypes) ? grantTypes : grantTypesRaw;
        const responseTypesValue = Array.isArray(responseTypes) ? responseTypes : responseTypesRaw;
        const redirectUrisValue = Array.isArray(redirectUris) ? redirectUris : redirectUrisRaw;
        const projectIdValue = typeof projectId === "string" ? projectId : projectIdRaw;
        if (
            typeof clientIdValue !== "string" ||
            typeof clientSecretValue !== "string" ||
            !Array.isArray(grantTypesValue) ||
            !Array.isArray(responseTypesValue) ||
            !Array.isArray(redirectUrisValue) ||
            typeof scope !== "string" ||
            typeof projectIdValue !== "string"
        ) {
            throw new RoomException("Invalid OAuth client payload: missing required fields");
        }
        return {
            clientId: clientIdValue,
            clientSecret: clientSecretValue,
            grantTypes: grantTypesValue.map(String),
            responseTypes: responseTypesValue.map(String),
            redirectUris: redirectUrisValue.map(String),
            scope,
            projectId: projectIdValue,
            metadata: metadata && typeof metadata === "object" ? metadata as Record<string, string> : {},
        };
    }

    private parseRoomConnectionInfo(data: any): RoomConnectionInfo {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid room connection payload");
        }
        const { jwt, room_name: roomNameRaw, roomName, project_id: projectIdRaw, projectId, room_url: roomUrlRaw, roomUrl } = data as any;
        const roomNameValue = typeof roomName === "string" ? roomName : roomNameRaw;
        const projectIdValue = typeof projectId === "string" ? projectId : projectIdRaw;
        const roomUrlValue = typeof roomUrl === "string" ? roomUrl : roomUrlRaw;
        if (typeof jwt !== "string" || typeof roomNameValue !== "string" || typeof projectIdValue !== "string" || typeof roomUrlValue !== "string") {
            throw new RoomException("Invalid room connection payload: missing fields");
        }
        return { jwt, roomName: roomNameValue, projectId: projectIdValue, roomUrl: roomUrlValue };
    }

    private encodePathComponent(value: string): string {
        return encodeURIComponent(value);
    }

    // Storage -----------------------------------------------------------------

    async upload({ projectId, path, data }: { projectId: string; path: string; data: ArrayBuffer | Uint8Array | Buffer }): Promise<void> {
        let body: RequestBody = data;
        if (data instanceof ArrayBuffer) {
            body = new Uint8Array(data);
        }
        await this.request(`/projects/${projectId}/storage/upload`, {
            method: "POST",
            query: { path },
            body,
            headers: { "Content-Type": "application/octet-stream" },
            action: "upload file",
            responseType: "void",
        });
    }

    async download({ projectId, path }: { projectId: string; path: string }): Promise<Uint8Array> {
        return await this.request<Uint8Array>(`/projects/${projectId}/storage/download`, {
            method: "GET",
            query: { path },
            action: "download file",
            responseType: "arrayBuffer",
        });
    }

    // Shares ------------------------------------------------------------------

    async getProjectRole(projectId: string): Promise<ProjectRole> {
        const payload = await this.request<{ role: ProjectRole }>(`/accounts/projects/${projectId}/role`, {
            action: "fetch project role",
        });
        const role = payload?.role;
        if (role !== "member" && role !== "admin" && role !== "developer") {
            throw new RoomException("Invalid role payload");
        }
        return role;
    }

    async createShare(projectId: string, settings?: Record<string, unknown>): Promise<{ id: string }> {
        return await this.request(`/accounts/projects/${projectId}/shares`, {
            method: "POST",
            json: { settings: settings ?? {} },
            action: "create share",
        });
    }

    async deleteShare(projectId: string, shareId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/shares/${shareId}`, {
            method: "DELETE",
            action: "delete share",
            responseType: "void",
        });
    }

    async updateShare(projectId: string, shareId: string, settings?: Record<string, unknown>): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/shares/${shareId}`, {
            method: "PUT",
            json: { settings: settings ?? {} },
            action: "update share",
            responseType: "void",
        });
    }

    async listShares(projectId: string): Promise<RoomShare[]> {
        const data = await this.request<{ shares: any[] }>(`/accounts/projects/${projectId}/shares`, {
            action: "list shares",
        });
        const shares = Array.isArray(data?.shares) ? data.shares : [];
        return shares.map((item) => this.parseRoomShare(item));
    }

    // Projects & users --------------------------------------------------------

    async createProject(name: string, settings?: Record<string, unknown>): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects`, {
            method: "POST",
            json: { name, settings },
            action: "create project",
        });
    }

    async addUserToProject(
        projectId: string,
        userId: string,
        options: { isAdmin?: boolean; isDeveloper?: boolean; canCreateRooms?: boolean } = {},
    ): Promise<Record<string, unknown>> {
        const { isAdmin, isDeveloper, canCreateRooms } = options;
        return await this.request(`/accounts/projects/${projectId}/users`, {
            method: "POST",
            json: {
                project_id: projectId,
                user_id: userId,
                ...(isAdmin !== undefined ? { is_admin: isAdmin } : {}),
                ...(isDeveloper !== undefined ? { is_developer: isDeveloper } : {}),
                ...(canCreateRooms !== undefined
                    ? { can_create_rooms: canCreateRooms }
                    : {}),
            },
            action: "add user to project",
        });
    }

    async removeUserFromProject(projectId: string, userId: string): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects/${projectId}/users/${userId}`, {
            method: "DELETE",
            action: "remove user from project",
        });
    }

    async updateProjectSettings(projectId: string, settings: Record<string, unknown>): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects/${projectId}/settings`, {
            method: "PUT",
            json: settings,
            action: "update project settings",
        });
    }

    async getUsersInProject(projectId: string): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects/${projectId}/users`, {
            action: "fetch project users",
        });
    }

    async getUserProfile(userId: string): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/profiles/${userId}`, {
            action: "fetch user profile",
        });
    }

    async updateUserProfile(userId: string, firstName: string, lastName: string): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/profiles/${userId}`, {
            method: "PUT",
            json: { first_name: firstName, last_name: lastName },
            action: "update user profile",
        });
    }

    async listProjects(): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects`, {
            action: "list projects",
        });
    }

    async getProject(projectId: string): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects/${projectId}`, {
            action: "get project",
        });
    }

    // API keys ----------------------------------------------------------------

    async createApiKey(projectId: string, name: string, description: string): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects/${projectId}/api-keys`, {
            method: "POST",
            json: { name, description },
            action: "create api key",
        });
    }

    async deleteApiKey(projectId: string, id: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/api-keys/${id}`, {
            method: "DELETE",
            action: "delete api key",
            responseType: "void",
        });
    }

    async listApiKeys(projectId: string): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects/${projectId}/api-keys`, {
            action: "list api keys",
        });
    }

    // Billing -----------------------------------------------------------------

    async getPricing(): Promise<Record<string, unknown>> {
        return await this.request(`/pricing`, {
            action: "fetch pricing data",
        });
    }

    async getStatus(projectId: string): Promise<boolean> {
        const data = await this.request<Record<string, unknown>>(`/accounts/projects/${projectId}/status`, {
            action: "fetch project status",
        });
        const enabled = data?.["enabled"];
        if (typeof enabled !== "boolean") {
            throw new RoomException("Invalid status payload: expected boolean 'enabled'");
        }
        return enabled;
    }

    async getBalance(projectId: string): Promise<Balance> {
        const data = await this.request(`/accounts/projects/${projectId}/balance`, {
            action: "fetch balance",
        });
        return this.parseBalance(data);
    }

    async getRecentTransactions(projectId: string): Promise<Transaction[]> {
        const data = await this.request<{ transactions?: any[] }>(`/accounts/projects/${projectId}/transactions`, {
            action: "fetch transactions",
        });
        const list = Array.isArray(data?.transactions) ? data.transactions : [];
        return list.map((item) => this.parseTransaction(item));
    }

    async setAutoRecharge({ projectId, enabled, amount, threshold }: { projectId: string; enabled: boolean; amount: number; threshold: number }): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/recharge`, {
            method: "POST",
            json: { enabled, amount, threshold },
            action: "update auto recharge settings",
            responseType: "void",
        });
    }

    async getCheckoutUrl(projectId: string, { successUrl, cancelUrl }: { successUrl: string; cancelUrl: string }): Promise<string> {
        const data = await this.request<Record<string, unknown>>(`/accounts/projects/${projectId}/subscription`, {
            method: "POST",
            json: { success_url: successUrl, cancel_url: cancelUrl },
            action: "create subscription checkout",
        });
        const url = data?.["checkout_url"];
        if (typeof url !== "string") {
            throw new RoomException("Invalid subscription payload: expected 'checkout_url' string");
        }
        return url;
    }

    async getCreditsCheckoutUrl(projectId: string, { successUrl, cancelUrl, quantity }: { successUrl: string; cancelUrl: string; quantity: number }): Promise<string> {
        const data = await this.request<Record<string, unknown>>(`/accounts/projects/${projectId}/credits`, {
            method: "POST",
            json: { success_url: successUrl, cancel_url: cancelUrl, quantity },
            action: "create credits checkout",
        });
        const url = data?.["checkout_url"];
        if (typeof url !== "string") {
            throw new RoomException("Invalid credits payload: expected 'checkout_url' string");
        }
        return url;
    }

    async getSubscription(projectId: string): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects/${projectId}/subscription`, {
            action: "fetch subscription",
        });
    }

    async getUsage(
        projectId: string,
        options: { start?: Date; end?: Date; interval?: string; report?: string; users?: string[]; room?: string; provider?: string; model?: string; usageType?: string } = {},
    ): Promise<Record<string, unknown>[]> {
        const { start, end, interval, report, users, room, provider, model, usageType } = options;
        const data = await this.request<Record<string, any>>(`/accounts/projects/${projectId}/usage`, {
            query: {
                start: start ? start.toISOString() : undefined,
                end: end ? end.toISOString() : undefined,
                interval,
                report,
                users: users && users.length > 0 ? users.join(",") : undefined,
                room: room && room.trim().length > 0 ? room.trim() : undefined,
                provider: provider && provider.trim().length > 0 ? provider.trim() : undefined,
                model: model && model.trim().length > 0 ? model.trim() : undefined,
                usage_type: usageType && usageType.trim().length > 0 ? usageType.trim() : undefined,
            },
            action: "retrieve usage",
        });
        const usage = data?.["usage"];
        if (!Array.isArray(usage)) {
            throw new RoomException("Invalid usage payload: expected 'usage' to be a list");
        }
        return usage.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
    }

    // Sessions ----------------------------------------------------------------

    async getSession(projectId: string, sessionId: string): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects/${projectId}/sessions/${sessionId}`, {
            action: "fetch session",
        });
    }

    async listActiveSessions(projectId: string): Promise<RoomSession[]> {
        const data = await this.request<{ sessions?: any[] }>(`/accounts/projects/${projectId}/sessions/active`, {
            action: "list active sessions",
        });
        const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
        return sessions.map((item) => this.parseRoomSession(item));
    }

    async listRecentSessions(projectId: string): Promise<RoomSession[]> {
        const data = await this.request<{ sessions?: any[] }>(`/accounts/projects/${projectId}/sessions`, {
            action: "list sessions",
        });
        const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
        return sessions.map((item) => this.parseRoomSession(item));
    }

    async listSessionEvents(projectId: string, sessionId: string): Promise<Record<string, unknown>[]> {
        const data = await this.request<Record<string, unknown>>(`/accounts/projects/${projectId}/sessions/${sessionId}/events`, {
            action: "list session events",
        });
        const events = data?.["events"];
        return Array.isArray(events) ? events as Record<string, unknown>[] : [];
    }

    async terminateSession(projectId: string, sessionId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/sessions/${sessionId}/terminate`, {
            method: "POST",
            action: "terminate session",
            responseType: "void",
        });
    }

    async listSessionSpans(projectId: string, sessionId: string): Promise<Record<string, unknown>[]> {
        const data = await this.request<Record<string, unknown>>(`/accounts/projects/${projectId}/sessions/${sessionId}/spans`, {
            action: "list session spans",
        });
        const spans = data?.["spans"];
        return Array.isArray(spans) ? spans as Record<string, unknown>[] : [];
    }

    async listSessionMetrics(projectId: string, sessionId: string): Promise<Record<string, unknown>[]> {
        const data = await this.request<Record<string, unknown>>(`/accounts/projects/${projectId}/sessions/${sessionId}/metrics`, {
            action: "list session metrics",
        });
        const metrics = data?.["metrics"];
        return Array.isArray(metrics) ? metrics as Record<string, unknown>[] : [];
    }

    // Webhooks ----------------------------------------------------------------

    async createWebhook(projectId: string, params: { name: string; url: string; events: string[]; description?: string; action?: string; payload?: Record<string, unknown> | null }): Promise<Record<string, unknown>> {
        const { name, url, events, description = "", action: webhookAction = "", payload = null } = params;
        return await this.request(`/accounts/projects/${projectId}/webhooks`, {
            method: "POST",
            json: { name, description, url, events, action: webhookAction, payload },
            action: "create webhook",
        });
    }

    async updateWebhook(projectId: string, webhookId: string, params: { name: string; url: string; events: string[]; description?: string; action?: string | null; payload?: Record<string, unknown> | null }): Promise<Record<string, unknown>> {
        const { name, url, events, description = "", action: webhookAction = null, payload = null } = params;
        return await this.request(`/accounts/projects/${projectId}/webhooks/${webhookId}`, {
            method: "PUT",
            json: { name, description, url, events, action: webhookAction, payload },
            action: "update webhook",
        });
    }

    async listWebhooks(projectId: string): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects/${projectId}/webhooks`, {
            action: "list webhooks",
        });
    }

    async deleteWebhook(projectId: string, webhookId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/webhooks/${webhookId}`, {
            method: "DELETE",
            action: "delete webhook",
            responseType: "void",
        });
    }

    // Mailboxes ---------------------------------------------------------------

    async createMailbox(params: { projectId: string; address: string; room: string; queue: string, isPublic: boolean }): Promise<void> {
        const { projectId, address, room, queue, isPublic } = params;
        await this.request(`/accounts/projects/${projectId}/mailboxes`, {
            method: "POST",
            json: { address, room, queue, "public":isPublic },
            action: "create mailbox",
            responseType: "void",
        });
    }

    async updateMailbox(params: { projectId: string; address: string; room: string; queue: string, isPublic: boolean }): Promise<void> {
        const { projectId, address, room, queue, isPublic } = params;
        await this.request(`/accounts/projects/${projectId}/mailboxes/${address}`, {
            method: "PUT",
            json: { room, queue, "public" : isPublic },
            action: "update mailbox",
            responseType: "void",
        });
    }

    async listMailboxes(projectId: string): Promise<Mailbox[]> {
        const data = await this.request<{ mailboxes?: any[] }>(`/accounts/projects/${projectId}/mailboxes`, {
            action: "list mailboxes",
        });
        const mailboxes = Array.isArray(data?.mailboxes) ? data.mailboxes : [];
        return mailboxes.map((item) => {
            if (!item || typeof item !== "object") {
                throw new RoomException("Invalid mailbox payload");
            }
            const { address, room, room_id, queue } = item as any;
            if (typeof address !== "string" || typeof room !== "string" || typeof queue !== "string") {
                throw new RoomException("Invalid mailbox payload: missing fields");
            }
            if (room_id !== undefined && typeof room_id !== "string") {
                throw new RoomException("Invalid mailbox payload: invalid room_id");
            }
            return { address, room, roomId: room_id, queue };
        });
    }

    async deleteMailbox(projectId: string, address: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/mailboxes/${address}`, {
            method: "DELETE",
            action: "delete mailbox",
            responseType: "void",
        });
    }

    // Repositories ------------------------------------------------------------

    async createRepository(params: {
        projectId: string;
        name: string;
        description?: string;
        annotations?: Record<string, string>;
    }): Promise<ProjectRepository> {
        const { projectId, name, description = "", annotations = {} } = params;
        const data = await this.request<Record<string, unknown>>(
            `/accounts/projects/${projectId}/repositories`,
            {
                method: "POST",
                json: { name, description, annotations },
                action: "create repository",
            },
        );
        return this.parseProjectRepository(data);
    }

    async updateRepository(params: {
        projectId: string;
        repositoryId: string;
        name: string;
        description?: string;
        annotations?: Record<string, string>;
    }): Promise<ProjectRepository> {
        const { projectId, repositoryId, name, description = "", annotations = {} } =
            params;
        const data = await this.request<Record<string, unknown>>(
            `/accounts/projects/${projectId}/repositories/${repositoryId}`,
            {
                method: "PUT",
                json: { name, description, annotations },
                action: "update repository",
            },
        );
        return this.parseProjectRepository(data);
    }

    async getRepository(
        projectId: string,
        repositoryId: string,
    ): Promise<ProjectRepository> {
        const data = await this.request<Record<string, unknown>>(
            `/accounts/projects/${projectId}/repositories/${repositoryId}`,
            {
                action: "fetch repository",
            },
        );
        return this.parseProjectRepository(data);
    }

    async listRepositories(projectId: string): Promise<ProjectRepository[]> {
        const data = await this.request<{ repositories?: unknown[] }>(
            `/accounts/projects/${projectId}/repositories`,
            {
                action: "list repositories",
            },
        );
        const repositories = Array.isArray(data?.repositories) ? data.repositories : [];
        return repositories.map((item) => this.parseProjectRepository(item));
    }

    async deleteRepository(projectId: string, repositoryId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/repositories/${repositoryId}`, {
            method: "DELETE",
            action: "delete repository",
            responseType: "void",
        });
    }

    // Services ----------------------------------------------------------------

    async createService(projectId: string, service: ServiceSpec): Promise<string> {
        const data = await this.request<{ id?: unknown }>(`/accounts/projects/${projectId}/services`, {
            method: "POST",
            json: serializeServiceSpec(service),
            action: "create service",
        });
        if (!data || typeof data !== "object" || typeof data.id !== "string") {
            throw new RoomException("Invalid create service response payload");
        }
        return data.id;
    }

    async createRoomService(projectId: string, roomName: string, service: ServiceSpec): Promise<string> {
        const data = await this.request<{ id?: unknown }>(
            `/accounts/projects/${projectId}/rooms/${roomName}/services`,
            {
                method: "POST",
                json: serializeServiceSpec(service),
                action: "create room service",
            },
        );
        if (!data || typeof data !== "object" || typeof data.id !== "string") {
            throw new RoomException("Invalid create room service response payload");
        }
        return data.id;
    }

    async updateRoomService(projectId: string, roomName: string, serviceId: string, service: ServiceSpec): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/rooms/${roomName}/services/${serviceId}`, {
            method: "PUT",
            json: serializeServiceSpec(service),
            action: "update room service",
            responseType: "void",
        });
    }

    async getRoomService(projectId: string, roomName: string, serviceId: string): Promise<ServiceSpec> {
        const data = await this.request(`/accounts/projects/${projectId}/rooms/${roomName}/services/${serviceId}`, {
            action: "fetch room service",
        });
        return data as ServiceSpec;
    }

    async listRoomServices(projectId: string, roomName: string): Promise<ServiceSpec[]> {
        const data = await this.request<{ services?: any[] }>(
            `/accounts/projects/${projectId}/rooms/${roomName}/services`,
            {
                action: "list room services",
            },
        );
        const services = Array.isArray(data?.services) ? data.services : [];
        return services as ServiceSpec[];
    }

    async deleteRoomService(projectId: string, roomName: string, serviceId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/rooms/${roomName}/services/${serviceId}`, {
            method: "DELETE",
            action: "delete room service",
            responseType: "void",
        });
    }

    async updateService(projectId: string, serviceId: string, service: ServiceSpec): Promise<void> {
        if (!service.id) {
            throw new RoomException("Service id must be set to update a service");
        }
        await this.request(`/accounts/projects/${projectId}/services/${serviceId}`, {
            method: "PUT",
            json: serializeServiceSpec(service),
            action: "update service",
            responseType: "void",
        });
    }

    async getService(projectId: string, serviceId: string): Promise<ServiceSpec> {
        const data = await this.request(`/accounts/projects/${projectId}/services/${serviceId}`, {
            action: "fetch service",
        });
        return data as ServiceSpec;
    }

    async listServices(projectId: string): Promise<ServiceSpec[]> {
        const data = await this.request<{ services?: any[] }>(`/accounts/projects/${projectId}/services`, {
            action: "list services",
        });
        const services = Array.isArray(data?.services) ? data.services : [];
        return services as ServiceSpec[];
    }

    async deleteService(projectId: string, serviceId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/services/${serviceId}`, {
            method: "DELETE",
            action: "delete service",
            responseType: "void",
        });
    }

    // Secrets -----------------------------------------------------------------

    async createProjectSecret(params: {
        projectId: string;
        name: string;
        type: string;
        data: Uint8Array | ArrayBuffer | Buffer;
    }): Promise<string> {
        const { projectId, name, type, data } = params;
        const payload = await this.request<{ id?: unknown }>(`/accounts/projects/${projectId}/secrets`, {
            method: "POST",
            json: {
                name,
                type,
                data_base64: bytesToBase64(normalizeBinary(data)),
            },
            action: "create project secret",
        });
        if (!payload || typeof payload !== "object" || typeof payload.id !== "string") {
            throw new RoomException("Invalid create project secret response payload");
        }
        return payload.id;
    }

    async updateProjectSecret(params: {
        projectId: string;
        secretId: string;
        name: string;
        type: string;
        data: Uint8Array | ArrayBuffer | Buffer;
    }): Promise<void> {
        const { projectId, secretId, name, type, data } = params;
        await this.request(`/accounts/projects/${projectId}/secrets/${secretId}`, {
            method: "PUT",
            json: {
                name,
                type,
                data_base64: bytesToBase64(normalizeBinary(data)),
            },
            action: "update project secret",
            responseType: "void",
        });
    }

    async getProjectSecret(projectId: string, secretId: string): Promise<ManagedSecret> {
        const data = await this.request(`/accounts/projects/${projectId}/secrets/${secretId}`, {
            action: "fetch project secret",
        });
        return this.parseManagedSecret(data);
    }

    async listProjectSecrets(projectId: string): Promise<ManagedSecretInfo[]> {
        const data = await this.request<{ secrets?: unknown[] }>(`/accounts/projects/${projectId}/secrets`, {
            action: "list project secrets",
        });
        const secrets = Array.isArray(data?.secrets) ? data.secrets : [];
        return secrets.map((item) => this.parseManagedSecretInfo(item));
    }

    async deleteProjectSecret(projectId: string, secretId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/secrets/${secretId}`, {
            method: "DELETE",
            action: "delete project secret",
            responseType: "void",
        });
    }

    async createRoomSecret(params: {
        projectId: string;
        roomName: string;
        data: Uint8Array | ArrayBuffer | Buffer;
        secretId?: string;
        name?: string;
        type?: string;
        delegatedTo?: string;
        forIdentity?: string;
    }): Promise<string> {
        const { projectId, roomName, data, secretId, name, type, delegatedTo, forIdentity } = params;
        const payload = await this.request<{ id?: unknown }>(
            `/accounts/projects/${projectId}/rooms/${roomName}/secrets`,
            {
                method: "POST",
                json: {
                    data_base64: bytesToBase64(normalizeBinary(data)),
                    secret_id: secretId,
                    name,
                    type,
                    delegated_to: delegatedTo,
                    for_identity: forIdentity,
                },
                action: "create room secret",
            },
        );
        if (!payload || typeof payload !== "object" || typeof payload.id !== "string") {
            throw new RoomException("Invalid create room secret response payload");
        }
        return payload.id;
    }

    async updateRoomSecret(params: {
        projectId: string;
        roomName: string;
        secretId: string;
        data: Uint8Array | ArrayBuffer | Buffer;
        name?: string;
        type?: string;
        delegatedTo?: string;
        forIdentity?: string;
    }): Promise<void> {
        const { projectId, roomName, secretId, data, name, type, delegatedTo, forIdentity } = params;
        await this.request(`/accounts/projects/${projectId}/rooms/${roomName}/secrets/${secretId}`, {
            method: "PUT",
            json: {
                data_base64: bytesToBase64(normalizeBinary(data)),
                name,
                type,
                delegated_to: delegatedTo,
                for_identity: forIdentity,
            },
            action: "update room secret",
            responseType: "void",
        });
    }

    async getRoomSecret(params: {
        projectId: string;
        roomName: string;
        secretId: string;
        delegatedTo?: string;
        forIdentity?: string;
    }): Promise<ManagedSecret> {
        const { projectId, roomName, secretId, delegatedTo, forIdentity } = params;
        const data = await this.request(`/accounts/projects/${projectId}/rooms/${roomName}/secrets/${secretId}`, {
            query: {
                delegated_to: delegatedTo,
                for_identity: forIdentity,
            },
            action: "fetch room secret",
        });
        return this.parseManagedSecret(data);
    }

    async listRoomSecrets(params: {
        projectId: string;
        roomName: string;
        forIdentity?: string;
    }): Promise<ManagedSecretInfo[]> {
        const { projectId, roomName, forIdentity } = params;
        const data = await this.request<{ secrets?: unknown[] }>(
            `/accounts/projects/${projectId}/rooms/${roomName}/secrets`,
            {
                query: {
                    for_identity: forIdentity,
                },
                action: "list room secrets",
            },
        );
        const secrets = Array.isArray(data?.secrets) ? data.secrets : [];
        return secrets.map((item) => this.parseManagedSecretInfo(item));
    }

    async deleteRoomSecret(params: {
        projectId: string;
        roomName: string;
        secretId: string;
        delegatedTo?: string;
        forIdentity?: string;
    }): Promise<void> {
        const { projectId, roomName, secretId, delegatedTo, forIdentity } = params;
        await this.request(`/accounts/projects/${projectId}/rooms/${roomName}/secrets/${secretId}`, {
            method: "DELETE",
            query: {
                delegated_to: delegatedTo,
                for_identity: forIdentity,
            },
            action: "delete room secret",
            responseType: "void",
        });
    }

    async createSecret(projectId: string, secret: SecretLike): Promise<void> {
        await this.createProjectSecret({
            projectId,
            name: secret.name,
            type: secret.type,
            data: encoder.encode(JSON.stringify(this.toSecretPayload(secret).data)),
        });
    }

    async updateSecret(projectId: string, secret: SecretLike): Promise<void> {
        if (!secret.id) {
            throw new RoomException("Secret id is required to update a secret");
        }
        await this.updateProjectSecret({
            projectId,
            secretId: secret.id,
            name: secret.name,
            type: secret.type,
            data: encoder.encode(JSON.stringify(this.toSecretPayload(secret).data)),
        });
    }

    async deleteSecret(projectId: string, secretId: string): Promise<void> {
        await this.deleteProjectSecret(projectId, secretId);
    }

    async listSecrets(projectId: string): Promise<SecretLike[]> {
        const secretInfos = await this.listProjectSecrets(projectId);
        const secrets = await Promise.all(
            secretInfos.map(async (secretInfo) => {
                const secret = await this.getProjectSecret(projectId, secretInfo.id);
                return this.parseSecretPayload(secret, secret.data);
            }),
        );
        return secrets;
    }

    async createProjectExternalOAuthRegistration(params: {
        projectId: string;
        oauth: OAuthClientConfig;
        clientId: string;
        clientSecret?: string | null;
        delegatedTo?: string | null;
        connector?: ConnectorRef | null;
    }): Promise<string> {
        const { projectId, oauth, clientId, clientSecret, delegatedTo, connector } = params;
        const payload = await this.request<{ id?: unknown }>(`/accounts/projects/${projectId}/external-oauth`, {
            method: "POST",
            json: {
                oauth,
                client_id: clientId,
                client_secret: clientSecret,
                delegated_to: delegatedTo,
                connector: this.serializeConnectorRef(connector),
            },
            action: "create project external oauth registration",
        });
        if (!payload || typeof payload !== "object" || typeof payload.id !== "string") {
            throw new RoomException("Invalid create project external oauth registration response payload");
        }
        return payload.id;
    }

    async updateProjectExternalOAuthRegistration(params: {
        projectId: string;
        registrationId: string;
        oauth: OAuthClientConfig;
        clientId: string;
        clientSecret?: string | null;
        delegatedTo?: string | null;
        connector?: ConnectorRef | null;
    }): Promise<void> {
        const { projectId, registrationId, oauth, clientId, clientSecret, delegatedTo, connector } = params;
        await this.request(`/accounts/projects/${projectId}/external-oauth/${registrationId}`, {
            method: "PUT",
            json: {
                oauth,
                client_id: clientId,
                client_secret: clientSecret,
                delegated_to: delegatedTo,
                connector: this.serializeConnectorRef(connector),
            },
            action: "update project external oauth registration",
            responseType: "void",
        });
    }

    async listProjectExternalOAuthRegistrations(params: {
        projectId: string;
        delegatedTo?: string | null;
    }): Promise<ExternalOAuthClientRegistration[]> {
        const { projectId, delegatedTo } = params;
        const data = await this.request<{ registrations?: unknown[] }>(`/accounts/projects/${projectId}/external-oauth`, {
            query: {
                delegated_to: delegatedTo,
            },
            action: "list project external oauth registrations",
        });
        const registrations = Array.isArray(data?.registrations) ? data.registrations : [];
        return registrations.map((item) => this.parseExternalOAuthClientRegistration(item));
    }

    async deleteProjectExternalOAuthRegistration(params: {
        projectId: string;
        registrationId: string;
        delegatedTo?: string | null;
    }): Promise<void> {
        const { projectId, registrationId, delegatedTo } = params;
        await this.request(`/accounts/projects/${projectId}/external-oauth/${registrationId}`, {
            method: "DELETE",
            query: {
                delegated_to: delegatedTo,
            },
            action: "delete project external oauth registration",
            responseType: "void",
        });
    }

    async createRoomExternalOAuthRegistration(params: {
        projectId: string;
        roomName: string;
        oauth: OAuthClientConfig;
        clientId: string;
        clientSecret?: string | null;
        delegatedTo?: string | null;
        connector?: ConnectorRef | null;
    }): Promise<string> {
        const { projectId, roomName, oauth, clientId, clientSecret, delegatedTo, connector } = params;
        const payload = await this.request<{ id?: unknown }>(`/accounts/projects/${projectId}/rooms/${roomName}/external-oauth`, {
            method: "POST",
            json: {
                oauth,
                client_id: clientId,
                client_secret: clientSecret,
                delegated_to: delegatedTo,
                connector: this.serializeConnectorRef(connector),
            },
            action: "create room external oauth registration",
        });
        if (!payload || typeof payload !== "object" || typeof payload.id !== "string") {
            throw new RoomException("Invalid create room external oauth registration response payload");
        }
        return payload.id;
    }

    async updateRoomExternalOAuthRegistration(params: {
        projectId: string;
        roomName: string;
        registrationId: string;
        oauth: OAuthClientConfig;
        clientId: string;
        clientSecret?: string | null;
        delegatedTo?: string | null;
        connector?: ConnectorRef | null;
    }): Promise<void> {
        const { projectId, roomName, registrationId, oauth, clientId, clientSecret, delegatedTo, connector } = params;
        await this.request(`/accounts/projects/${projectId}/rooms/${roomName}/external-oauth/${registrationId}`, {
            method: "PUT",
            json: {
                oauth,
                client_id: clientId,
                client_secret: clientSecret,
                delegated_to: delegatedTo,
                connector: this.serializeConnectorRef(connector),
            },
            action: "update room external oauth registration",
            responseType: "void",
        });
    }

    async listRoomExternalOAuthRegistrations(params: {
        projectId: string;
        roomName: string;
        delegatedTo?: string | null;
    }): Promise<ExternalOAuthClientRegistration[]> {
        const { projectId, roomName, delegatedTo } = params;
        const data = await this.request<{ registrations?: unknown[] }>(
            `/accounts/projects/${projectId}/rooms/${roomName}/external-oauth`,
            {
                query: {
                    delegated_to: delegatedTo,
                },
                action: "list room external oauth registrations",
            },
        );
        const registrations = Array.isArray(data?.registrations) ? data.registrations : [];
        return registrations.map((item) => this.parseExternalOAuthClientRegistration(item));
    }

    async deleteRoomExternalOAuthRegistration(params: {
        projectId: string;
        roomName: string;
        registrationId: string;
        delegatedTo?: string | null;
    }): Promise<void> {
        const { projectId, roomName, registrationId, delegatedTo } = params;
        await this.request(`/accounts/projects/${projectId}/rooms/${roomName}/external-oauth/${registrationId}`, {
            method: "DELETE",
            query: {
                delegated_to: delegatedTo,
            },
            action: "delete room external oauth registration",
            responseType: "void",
        });
    }

    // Rooms -------------------------------------------------------------------

    async createRoom(params: { projectId: string; name: string; ifNotExists?: boolean; metadata?: Record<string, unknown>; annotations?: Record<string, string>; permissions?: Record<string, ApiScope> }): Promise<RoomInfo> {
        const { projectId, name, ifNotExists = false, metadata, annotations, permissions } = params;
        const payload: Record<string, unknown> = {
            name,
            if_not_exists: Boolean(ifNotExists),
            metadata,
            annotations,
        };
        if (permissions) {
            const serialized: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(permissions)) {
                serialized[key] = value instanceof ApiScope ? value.toJSON() : value;
            }
            payload["permissions"] = serialized;
        }
        const data = await this.request(`/accounts/projects/${projectId}/rooms`, {
            method: "POST",
            json: payload,
            action: "create room",
        });
        return this.parseRoom(data);
    }

    async getRoom(projectId: string, name: string): Promise<RoomInfo> {
        const data = await this.request(`/accounts/projects/${projectId}/rooms/${name}`, {
            action: "fetch room",
        });
        return this.parseRoom(data);
    }

    async updateRoom(
        projectId: string,
        roomId: string,
        name: string,
        options: { metadata?: Record<string, unknown>; annotations?: Record<string, string> } = {},
    ): Promise<void> {
        const payload: Record<string, unknown> = { name };
        if (options.metadata !== undefined) {
            payload["metadata"] = options.metadata;
        }
        if (options.annotations !== undefined) {
            payload["annotations"] = options.annotations;
        }
        await this.request(`/accounts/projects/${projectId}/rooms/${roomId}`, {
            method: "PUT",
            json: payload,
            action: "update room",
            responseType: "void",
        });
    }

    async deleteRoom(projectId: string, roomId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/rooms/${roomId}`, {
            method: "DELETE",
            action: "delete room",
            responseType: "void",
        });
    }

    async connectRoom(projectId: string, room: string): Promise<RoomConnectionInfo> {
        const data = await this.request(`/accounts/projects/${projectId}/rooms/${room}/connect`, {
            method: "POST",
            json: {},
            action: "connect room",
        });
        return this.parseRoomConnectionInfo(data);
    }

    async createRoomGrant(params: { projectId: string; roomId: string; userId: string; permissions: ApiScope }): Promise<void> {
        const { projectId, roomId, userId, permissions } = params;
        await this.request(`/accounts/projects/${projectId}/room-grants`, {
            method: "POST",
            json: {
                room_id: roomId,
                user_id: userId,
                permissions: permissions.toJSON(),
            },
            action: "create room grant",
            responseType: "void",
        });
    }

    async createRoomGrantByEmail(params: { projectId: string; roomId: string; email: string; permissions: ApiScope }): Promise<void> {
        const { projectId, roomId, email, permissions } = params;
        await this.request(`/accounts/projects/${projectId}/room-grants`, {
            method: "POST",
            json: {
                room_id: roomId,
                email,
                permissions: permissions.toJSON(),
            },
            action: "create room grant",
            responseType: "void",
        });
    }

    async updateRoomGrant(params: { projectId: string; roomId: string; userId: string; permissions: ApiScope; grantId?: string }): Promise<void> {
        const { projectId, roomId, userId, permissions, grantId } = params;
        const gid = grantId ?? "unused";
        await this.request(`/accounts/projects/${projectId}/room-grants/${gid}`, {
            method: "PUT",
            json: {
                room_id: roomId,
                user_id: userId,
                permissions: permissions.toJSON(),
            },
            action: "update room grant",
            responseType: "void",
        });
    }

    async deleteRoomGrant(projectId: string, roomId: string, userId: string): Promise<void> {
        const room = this.encodePathComponent(roomId);
        const user = this.encodePathComponent(userId);
        await this.request(`/accounts/projects/${projectId}/room-grants/${room}/${user}`, {
            method: "DELETE",
            action: "delete room grant",
            responseType: "void",
        });
    }

    async getRoomGrant(projectId: string, roomId: string, userId: string): Promise<ProjectRoomGrant> {
        const room = this.encodePathComponent(roomId);
        const user = this.encodePathComponent(userId);
        const data = await this.request(`/accounts/projects/${projectId}/room-grants/${room}/${user}`, {
            action: "fetch room grant",
        });
        return this.parseProjectRoomGrant(data);
    }

    async listRooms(projectId: string, options: { limit?: number; offset?: number; orderBy?: string } = {}): Promise<RoomInfo[]> {
        const { limit = 50, offset = 0, orderBy = "room_name" } = options;
        const data = await this.request<{ rooms?: any[] }>(`/accounts/projects/${projectId}/rooms`, {
            query: { limit, offset, order_by: orderBy },
            action: "list rooms",
        });
        const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
        return rooms.map((item) => this.parseRoom(item));
    }

    async listRoomGrants(projectId: string, options: { limit?: number; offset?: number; orderBy?: string } = {}): Promise<ProjectRoomGrant[]> {
        const { limit = 50, offset = 0, orderBy = "room_name" } = options;
        const data = await this.request<{ room_grants?: any[] }>(`/accounts/projects/${projectId}/room-grants`, {
            query: { limit, offset, order_by: orderBy },
            action: "list room grants",
        });
        const grants = Array.isArray(data?.room_grants) ? data.room_grants : [];
        return grants.map((item) => this.parseProjectRoomGrant(item));
    }

    async listRoomGrantsByUser(projectId: string, userId: string, options: { limit?: number; offset?: number } = {}): Promise<ProjectRoomGrant[]> {
        const { limit = 50, offset = 0 } = options;
        const encodedUser = this.encodePathComponent(userId);
        const data = await this.request<{ room_grants?: any[] }>(`/accounts/projects/${projectId}/room-grants/by-user/${encodedUser}`, {
            query: { limit, offset },
            action: "list room grants by user",
        });
        const grants = Array.isArray(data?.room_grants) ? data.room_grants : [];
        return grants.map((item) => this.parseProjectRoomGrant(item));
    }

    async listRoomGrantsByRoom(projectId: string, roomId: string, options: { limit?: number; offset?: number } = {}): Promise<ProjectRoomGrant[]> {
        const { limit = 50, offset = 0 } = options;
        const encodedRoom = this.encodePathComponent(roomId);
        const data = await this.request<{ room_grants?: any[] }>(`/accounts/projects/${projectId}/room-grants/by-room/${encodedRoom}`, {
            query: { limit, offset },
            action: "list room grants by room",
        });
        const grants = Array.isArray(data?.room_grants) ? data.room_grants : [];
        return grants.map((item) => this.parseProjectRoomGrant(item));
    }

    async listUniqueRoomsWithGrants(projectId: string, options: { limit?: number; offset?: number } = {}): Promise<ProjectRoomGrantCount[]> {
        const { limit = 50, offset = 0 } = options;
        const data = await this.request<{ rooms?: any[] }>(`/accounts/projects/${projectId}/room-grants/by-room`, {
            query: { limit, offset },
            action: "list unique rooms with grants",
        });
        const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
        return rooms.map((item) => this.parseProjectRoomGrantCount(item));
    }

    async listUniqueUsersWithGrants(projectId: string, options: { limit?: number; offset?: number } = {}): Promise<ProjectUserGrantCount[]> {
        const { limit = 50, offset = 0 } = options;
        const data = await this.request<{ users?: any[] }>(`/accounts/projects/${projectId}/room-grants/by-user`, {
            query: { limit, offset },
            action: "list unique users with grants",
        });
        const users = Array.isArray(data?.users) ? data.users : [];
        return users.map((item) => this.parseProjectUserGrantCount(item));
    }

    // OAuth Clients -----------------------------------------------------------

    async createOAuthClient(projectId: string, params: { grantTypes: string[]; responseTypes: string[]; redirectUris: string[]; scope: string; metadata?: Record<string, any> }): Promise<OAuthClient> {
        const { grantTypes, responseTypes, redirectUris, scope, metadata = {} } = params;
        const data = await this.request(`/accounts/projects/${projectId}/oauth/clients`, {
            method: "POST",
            json: { grant_types: grantTypes, response_types: responseTypes, redirect_uris: redirectUris, scope, metadata },
            action: "create oauth client",
        });
        return this.parseOAuthClient(data);
    }

    async updateOAuthClient(projectId: string, clientId: string, params: { grantTypes?: string[]; responseTypes?: string[]; redirectUris?: string[]; scope?: string; metadata?: Record<string, any> }): Promise<Record<string, unknown>> {
        const body: Record<string, unknown> = {};
        if (params.grantTypes !== undefined) body["grant_types"] = params.grantTypes;
        if (params.responseTypes !== undefined) body["response_types"] = params.responseTypes;
        if (params.redirectUris !== undefined) body["redirect_uris"] = params.redirectUris;
        if (params.scope !== undefined) body["scope"] = params.scope;
        if (params.metadata !== undefined) body["metadata"] = params.metadata;
        return await this.request(`/accounts/projects/${projectId}/oauth/clients/${clientId}`, {
            method: "PUT",
            json: body,
            action: "update oauth client",
        });
    }

    async listOAuthClients(projectId: string): Promise<OAuthClient[]> {
        const data = await this.request<{ clients?: any[] }>(`/accounts/projects/${projectId}/oauth/clients`, {
            action: "list oauth clients",
        });
        const clients = Array.isArray(data?.clients) ? data.clients : [];
        return clients.map((item) => this.parseOAuthClient(item));
    }

    async getOAuthClient(projectId: string, clientId: string): Promise<OAuthClient> {
        const data = await this.request(`/accounts/projects/${projectId}/oauth/clients/${clientId}`, {
            action: "fetch oauth client",
        });
        return this.parseOAuthClient(data);
    }

    async deleteOAuthClient(projectId: string, clientId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/oauth/clients/${clientId}`, {
            method: "DELETE",
            action: "delete oauth client",
            responseType: "void",
        });
    }
}
