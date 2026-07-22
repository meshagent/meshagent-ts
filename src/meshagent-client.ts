import { meshagentBaseUrl } from "./helpers.js";
import { ForbiddenException, RoomException } from "./requirement.js";
import { ApiScope } from "./participant-token.js";

export type ProjectRole =
    | "member"
    | "admin"
    | "developer"
    | "room_creator"
    | "room_inventory"
    | "room_manager"
    | "session_inventory"
    | "agent_creator"
    | "agent_inventory"
    | "agent_manager"
    | "repository_creator"
    | "repository_inventory"
    | "repository_manager"
    | "feed_creator"
    | "feed_inventory"
    | "feed_manager"
    | "oauth_client_creator"
    | "oauth_client_inventory"
    | "oauth_client_manager"
    | "api_key_creator"
    | "api_key_inventory"
    | "api_key_manager"
    | "service_creator"
    | "service_inventory"
    | "service_manager"
    | "service_account_creator"
    | "service_account_inventory"
    | "service_account_manager"
    | "participant_token_creator"
    | "mailbox_creator"
    | "mailbox_inventory"
    | "mailbox_manager"
    | "route_creator"
    | "route_inventory"
    | "route_manager"
    | "scheduled_task_creator"
    | "scheduled_task_inventory"
    | "scheduled_task_manager"
    | "feed_subscription_creator"
    | "feed_subscription_inventory"
    | "feed_subscription_manager"
    | "llm_logger_creator"
    | "llm_logger_inventory"
    | "llm_logger_manager"
    | "llm_proxy_user"
    | "usage_reporter"
    | "billing_manager"
    | "group_manager";
export type ResourceRole = "viewer" | "operator" | "developer" | "admin";
export type FeedRole = "reader" | "subscriber" | "publisher" | "manager";
export type SecretRole = "use_proxy";
export type AccessRole = ProjectRole | ResourceRole | FeedRole | SecretRole | "list";
export type AccessSubjectType = "user" | "group" | "agent" | "service_account" | "userset";
export type AccessResourceType = "project" | "room" | "agent" | "group" | "repository" | "feed" | "secret";

export interface AccessSubject {
    type: AccessSubjectType;
    id: string;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    objectType?: "project" | null;
    relation?: "member" | "developer" | "agent" | null;
}

export interface AccessResource {
    type: AccessResourceType;
    id: string;
    name?: string | null;
    metadata?: Record<string, unknown> | null;
    annotations?: Record<string, string> | null;
}

export interface RoomConnectionInfo {
    jwt: string;
    roomName: string;
    projectId: string;
    roomUrl: string;
}

export interface AgentConnectionInfo {
    jwt: string;
    agentName: string;
    projectId: string;
    agentUrl: string;
}

export class RoomSession {
    public readonly id: string;
    public readonly roomId?: string | null;
    public readonly roomName: string;
    public readonly createdAt: Date;
    public readonly isActive: boolean;
    public readonly participants?: Record<string, number> | null;
    public readonly kind: string;
    public readonly agentId?: string | null;
    public readonly agentName?: string | null;

    constructor({
        id,
        roomId,
        roomName,
        createdAt,
        isActive,
        participants,
        kind = "room",
        agentId,
        agentName,
    }: {
        id: string;
        roomId?: string | null;
        roomName: string;
        createdAt: Date;
        isActive: boolean;
        participants?: Record<string, number> | null;
        kind?: string;
        agentId?: string | null;
        agentName?: string | null;
    }) {
        this.id = id;
        this.roomId = roomId;
        this.roomName = roomName;
        this.createdAt = createdAt;
        this.isActive = isActive;
        this.participants = participants;
        this.kind = kind;
        this.agentId = agentId;
        this.agentName = agentName;
    }

    public toJson(): Record<string, unknown> {
        return {
            id: this.id,
            room_id: this.roomId ?? null,
            room_name: this.roomName,
            started_at: this.createdAt.toISOString(),
            is_active: this.isActive,
            kind: this.kind,
            ...(this.agentId != null ? { agent_id: this.agentId } : {}),
            ...(this.agentName != null ? { agent_name: this.agentName } : {}),
        };
    }
}

export interface RoomInfo {
    id: string;
    name: string;
    metadata: Record<string, unknown>;
    annotations: Record<string, string>;
}

export interface GroupInfo {
    id: string;
    name: string;
    metadata: Record<string, unknown>;
    annotations: Record<string, string>;
}

export interface ProjectRoomGrant {
    resource: AccessResource;
    subject: AccessSubject;
    directRoles: AccessRole[];
    room: RoomInfo;
    userId: string;
}

export interface AccessTestResult {
    allowed: boolean;
    resource?: AccessResource;
    subject?: AccessSubject;
    relation?: string;
}

export interface EffectiveAccess {
    resource: AccessResource;
    subject: AccessSubject;
    effectiveRoles: string[];
    capabilities: Record<string, boolean>;
}

export interface AccessBindingsPage {
    accessGrants: ProjectRoomGrant[];
}

export interface ResourcePolicyPage {
    resource: AccessResource;
    accessGrants: ProjectRoomGrant[];
    continuationToken?: string | null;
}

export interface ProjectMember {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    directRoles: ProjectRole[];
}

export interface ProjectMembersPage {
    users: ProjectMember[];
    continuationToken?: string | null;
}

export interface GroupsPage {
    groups: GroupInfo[];
    continuationToken?: string | null;
}

export interface ServiceAccountInfo {
    id: string;
    project_id?: string;
    key?: string;
    name: string;
    display_name?: string | null;
    description?: string | null;
    metadata?: Record<string, unknown>;
    annotations?: Record<string, string>;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface ServiceAccountsPage {
    service_accounts: ServiceAccountInfo[];
    continuation_token?: string | null;
}

export interface ApiKeyInfo {
    id: string;
    name: string;
    description?: string | null;
    project_id?: string | null;
    service_account_id?: string | null;
    created_at?: string | null;
    last_used_at?: string | null;
    value?: string | null;
}

export interface ApiKeysPage {
    keys: ApiKeyInfo[];
}

export interface ApiKeysRevocationResult {
    revoked: string[];
}

export interface Secret {
    id: string;
    project_id: string;
    owner_user_id?: string | null;
    owner_service_account_id?: string | null;
    created_by_user_id?: string | null;
    created_by_service_account_id?: string | null;
    type: string;
    name: string;
    http_only: boolean;
    metadata: Record<string, unknown>;
    annotations: Record<string, unknown>;
    current_version_id?: string | null;
    value_base64?: string | null;
    created_at: string;
    updated_at: string;
}

export interface SecretVersion {
    id: string;
    secret_id: string;
    version: number;
    value_sha256?: string | null;
    created_by_user_id?: string | null;
    created_by_service_account_id?: string | null;
    created_at: string;
}

export interface SecretsPage {
    secrets: Secret[];
    continuation_token?: string | null;
}

export interface SecretVersionsPage {
    versions: SecretVersion[];
}

export interface SecretProxyAccessGrant {
    subject: AccessSubject;
    roles: SecretRole[];
}

export interface SecretProxyAccessGrantsPage {
    access_grants: SecretProxyAccessGrant[];
    continuation_token?: string | null;
}

export interface SecretInput {
    projectId?: string;
    name?: string;
    type?: string;
    httpOnly?: boolean;
    metadata?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
}

export interface SecretSearchInput {
    filter?: string;
    name?: string;
    type?: string;
    httpOnly?: boolean;
    metadata?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    pageSize?: number;
    continuationToken?: string;
}

export interface SecretVersionInput {
    value: Uint8Array | ArrayBuffer;
    setCurrent?: boolean;
}

export interface GroupMember {
    subject: AccessSubject;
    directRoles: Array<"member" | "manager">;
}

export interface GroupMembersPage {
    members: GroupMember[];
    continuationToken?: string | null;
}

export interface SecretValue {
    id: string;
}

export interface TokenValue {
    identity: string;
    api?: ApiScope | null;
    role?: "user" | "agent" | "tool" | null;
}

export interface EnvironmentVariable {
    name: string;
    value?: string | null;
    token?: TokenValue | null;
    secret?: SecretValue | null;
}

export interface RoomStorageMountSpec {
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

export interface FileMountSpec {
    path: string;
    read_only?: boolean;
    text?: string | null;
}

export interface ContainerMountSpec {
    room?: RoomStorageMountSpec[];
    empty_dirs?: EmptyDirMountSpec[];
    configs?: ConfigMountSpec[];
    files?: FileMountSpec[];
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

export interface ManagedAgent {
    id: string;
    name: string;
    configuration: Record<string, unknown>;
}

export interface ServiceMetadata {
    name: string;
    description?: string | null;
    repo?: string | null;
    icon?: string | null;
    annotations?: Record<string, string> | null;
}

export interface ServiceRunAs {
    email: string;
    scopes?: string[] | null;
}

export interface ContainerSpec {
    private?: boolean | null;
    template?: "agent" | "none" | null;
    command?: string | null;
    working_dir?: string | null;
    image: string;
    run_as?: ServiceRunAs | null;
    pull_secret?: SecretValue | null;
    environment?: EnvironmentVariable[] | null;
    storage?: ContainerMountSpec;
    on_demand?: boolean | null;
    writable_root_fs?: boolean | null;
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
    use_proxy_secret?: string | null;
}

export interface EndpointSpec {
    path: string;
    meshagent?: MeshagentEndpointSpec;
    mcp?: MCPEndpointSpec;
}

export interface PortSpec {
    num: "*" | number;
    host_port?: number | null;
    type?: "http" | "tcp" | null;
    published?: boolean | null;
    public?: boolean | null;
    endpoints?: EndpointSpec[];
    liveness?: string | null;
    annotations?: Record<string, string>;
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

function applyTemplateValues(value: unknown, values: Record<string, string>): unknown {
    if (typeof value === "string") {
        return Object.entries(values).reduce(
            (current, [key, replacement]) => current.split(`{${key}}`).join(replacement),
            value,
        );
    }
    if (Array.isArray(value)) {
        return value.map((item) => applyTemplateValues(item, values));
    }
    if (value !== null && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            result[key] = applyTemplateValues(entry, values);
        }
        return result;
    }
    return value;
}

function normalizeServiceSpec(service: ServiceSpec): ServiceSpec {
    const storage = service.container?.storage;
    const agents = service.agents?.map((agent) => ({
        ...agent,
        email: agent.email == null
            ? agent.email
            : {
                ...agent.email,
                public: agent.email.public ?? false,
            },
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
    const container = service.container == null
        ? service.container
        : {
            ...service.container,
            storage: storage == null
                ? storage
                : {
                    ...storage,
                    configs: storage.configs?.map((config) => ({
                        ...config,
                        path: config.path ?? "/var/run/meshagent",
                    })),
                    files: storage.files?.map((file) => ({
                        ...file,
                        read_only: file.read_only ?? true,
                    })),
                },
        };
    return { ...service, agents, container };
}

export class ServiceTemplateSpec {
    private readonly template: Record<string, unknown>;

    private constructor(template: Record<string, unknown>) {
        this.template = template;
    }

    public static fromJson(json: Record<string, unknown>): ServiceTemplateSpec {
        return new ServiceTemplateSpec(json);
    }

    public toServiceSpec({ values = {} }: { values?: Record<string, string> } = {}): ServiceSpec {
        const templated = applyTemplateValues(this.template, values) as Record<string, unknown>;
        return normalizeServiceSpec({
            ...templated,
            kind: "Service",
        } as ServiceSpec);
    }
}

export interface RouteMetadata {
    name: string;
    annotations?: Record<string, string>;
}

export interface RouteBackendTarget {
    name: string;
}

export interface RouteBackend {
    room?: RouteBackendTarget | null;
    agent?: RouteBackendTarget | null;
}

export interface RoutePathSpec {
    path?: string;
    pathType?: "prefix" | "exact";
    stripPrefix?: boolean;
    targetPort: string | number;
}

export interface RouteSpec {
    version: "v1";
    kind: "Route";
    metadata: RouteMetadata;
    domain: string;
    backend: RouteBackend;
    paths?: RoutePathSpec[];
}

export interface Route {
    domain: string;
    spec: RouteSpec;
}

export interface RoutesPage {
    routes: Route[];
    total: number;
    continuationToken?: string | null;
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

function validateServiceSpec(service: ServiceSpec): void {
    const container = service.container;
    if (container == null) {
        return;
    }

    if (typeof (container as unknown as Record<string, unknown>).run_as === "string") {
        throw new Error("container.run_as must be an object with an email field");
    }

    const environment = container.environment ?? [];
    const hasSecretEnvironment = environment.some((entry) => entry.secret != null);
    if (hasSecretEnvironment && container.run_as == null) {
        throw new Error("container.run_as is required when using SecretValue");
    }

    for (const entry of environment) {
        const secret = entry.secret;
        if (secret == null) {
            continue;
        }
        const unsupportedFields = Object.keys(secret).filter((key) => key !== "id");
        if (unsupportedFields.length > 0) {
            throw new Error(`unsupported SecretValue fields: ${unsupportedFields.join(", ")}`);
        }
    }

    const pullSecret = container.pull_secret;
    if (pullSecret != null) {
        const unsupportedFields = Object.keys(pullSecret).filter((key) => key !== "id");
        if (unsupportedFields.length > 0) {
            throw new Error(`unsupported SecretValue fields: ${unsupportedFields.join(", ")}`);
        }
    }
}

const defaultServiceRunAsScopes = ["secrets:proxy"];

function normalizeServiceRunAs(runAs: ServiceRunAs | null | undefined): ServiceRunAs | null | undefined {
    if (runAs == null) {
        return runAs;
    }

    const email = runAs.email.trim().toLowerCase();
    if (email.length === 0) {
        throw new Error("container.run_as.email is required");
    }

    const scopes = runAs.scopes == null ? defaultServiceRunAsScopes : runAs.scopes;
    const normalizedScopes: string[] = [];
    for (const scope of scopes) {
        const normalized = scope.trim();
        if (normalized.length === 0 || normalizedScopes.includes(normalized)) {
            continue;
        }
        normalizedScopes.push(normalized);
    }

    return {
        email,
        scopes: normalizedScopes.length === 0 ? [...defaultServiceRunAsScopes] : normalizedScopes,
    };
}

function serializeServiceSpec(service: ServiceSpec): Record<string, unknown> {
    validateServiceSpec(service);

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
    const container = service.container == null
        ? service.container
        : {
            ...service.container,
            run_as: normalizeServiceRunAs(service.container.run_as),
        };

    return pruneUndefinedValues({
        ...service,
        container,
        agents,
    }) as Record<string, unknown>;
}

function serializeCreateServiceSpec(service: ServiceSpec): Record<string, unknown> {
    const payload = serializeServiceSpec(service);
    delete payload.id;
    return payload;
}

export interface Mailbox {
    address: string;
    room: string;
    roomId?: string;
    queue: string;
}

export interface MailboxesPage {
    mailboxes: Mailbox[];
    total: number;
    continuationToken?: string | null;
}

export type FeedVisibility = "public" | "project" | "private";

export interface Feed {
    id: string;
    projectId: string;
    createdAt: Date;
    name: string;
    description: string;
    visibility: FeedVisibility;
    paused: boolean;
    annotations: Record<string, string>;
    messageSchema?: Record<string, unknown> | boolean | null;
}

export interface FeedsPage {
    feeds: Feed[];
    total: number;
    continuationToken?: string | null;
}

export interface FeedSubscription {
    id: string;
    feedId: string;
    projectId: string;
    room: string;
    roomId?: string | null;
    path: string;
    filenameDatetimeFormat?: string | null;
    createdAt: Date;
    annotations: Record<string, string>;
}

export interface LLMLogger {
    id: string;
    projectId: string;
    destinationFeedId: string;
    filterExpression: string;
    paused: boolean;
    createdAt: Date;
    annotations: Record<string, string>;
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
    monthlyBudget?: number | null;
    autoRechargePaused?: boolean;
    autoRechargedThisMonth?: number | null;
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
    official: boolean;
}

export interface OAuthClientsPage {
    clients: OAuthClient[];
    total: number;
}

export interface ConnectorRef {
    openaiConnectorId?: string | null;
    serverUrl?: string | null;
    clientSecretId?: string | null;
}

type RequestBody = string | Uint8Array | ArrayBuffer | null | undefined;
type JsonRequest = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

interface RequestOptions {
    method?: string;
    query?: Record<string, string | number | boolean | undefined | null>;
    json?: JsonRequest;
    body?: RequestBody;
    headers?: Record<string, string>;
    action: string;
    responseType?: "json" | "text" | "arrayBuffer" | "void";
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

function bytesToBase64(value: Uint8Array | ArrayBuffer): string {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("base64");
    }

    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
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
            if (response.status === 403) {
                throw new ForbiddenException(`Failed to ${action}. Status code: ${response.status}, body: ${message}`);
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

    private secretPayload(input: SecretInput): Record<string, unknown> {
        const payload: Record<string, unknown> = {};
        if (input.projectId !== undefined) payload.project_id = input.projectId;
        if (input.name !== undefined) payload.name = input.name;
        if (input.type !== undefined) payload.type = input.type;
        if (input.httpOnly !== undefined) payload.http_only = input.httpOnly;
        if (input.metadata !== undefined) payload.metadata = input.metadata;
        if (input.annotations !== undefined) payload.annotations = input.annotations;
        return payload;
    }

    private secretSearchPayload(input: SecretSearchInput): Record<string, unknown> {
        const payload: Record<string, unknown> = {
            page_size: input.pageSize ?? 100,
        };
        if (input.filter !== undefined) payload.filter = input.filter;
        if (input.name !== undefined) payload.name = input.name;
        if (input.type !== undefined) payload.type = input.type;
        if (input.httpOnly !== undefined) payload.http_only = input.httpOnly;
        if (input.metadata !== undefined) payload.metadata = input.metadata;
        if (input.annotations !== undefined) payload.annotations = input.annotations;
        if (input.continuationToken !== undefined) payload.continuation_token = input.continuationToken;
        return payload;
    }

    private secretVersionPayload(input: SecretVersionInput): Record<string, unknown> {
        return {
            value_base64: bytesToBase64(input.value),
            set_current: input.setCurrent ?? true,
        };
    }

    private parseRoomSession(data: any): RoomSession {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid room session payload");
        }
        const {
            id,
            room_id: roomIdRaw,
            roomId,
            room_name: roomNameRaw,
            roomName,
            created_at: createdRaw,
            createdAt,
            is_active: isActiveRaw,
            isActive,
            participants,
            kind,
            agent_id: agentIdRaw,
            agentId,
            agent_name: agentNameRaw,
            agentName,
        } = data as any;
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
        return new RoomSession({
            id,
            roomId: typeof roomId === "string" ? roomId : typeof roomIdRaw === "string" ? roomIdRaw : undefined,
            roomName: roomNameValue,
            createdAt: new Date(created),
            isActive: isActiveValue,
            participants: participants && typeof participants === "object" ? participants as Record<string, number> : undefined,
            kind: typeof kind === "string" ? kind : undefined,
            agentId: typeof agentId === "string" ? agentId : typeof agentIdRaw === "string" ? agentIdRaw : undefined,
            agentName: typeof agentName === "string" ? agentName : typeof agentNameRaw === "string" ? agentNameRaw : undefined,
        });
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

    private parseGroup(data: any): GroupInfo {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid group payload");
        }
        const { id, name, metadata, annotations } = data as any;
        if (typeof id !== "string" || typeof name !== "string") {
            throw new RoomException("Invalid group payload: missing id or name");
        }
        return {
            id,
            name,
            metadata: metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {},
            annotations: annotations && typeof annotations === "object" ? annotations as Record<string, string> : {},
        };
    }

    private parseRoute(data: any): Route {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid route payload: expected object");
        }
        if (data.spec && typeof data.spec === "object") {
            return { domain: String(data.domain ?? data.spec.domain), spec: data.spec as RouteSpec };
        }
        if (typeof data.domain === "string" && typeof data.room_name === "string") {
            return {
                domain: data.domain,
                spec: {
                    version: "v1",
                    kind: "Route",
                    metadata: { name: data.domain, annotations: data.annotations ?? {} },
                    domain: data.domain,
                    backend: { room: { name: data.room_name } },
                    paths: [{ path: "/", pathType: "prefix", targetPort: data.port }],
                },
            };
        }
        throw new RoomException("Invalid route payload: missing spec");
    }

    private parseFeed(data: any): Feed {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid feed payload");
        }

        const {
            id,
            project_id: projectIdRaw,
            projectId,
            created_at: createdAtRaw,
            createdAt,
            name,
            description,
            visibility,
            paused,
            annotations,
            message_schema: messageSchemaRaw,
            messageSchema,
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
        const visibilityValue =
            visibility === "public" || visibility === "project" || visibility === "private"
                ? visibility
                : undefined;
        const messageSchemaValue =
            typeof messageSchema === "boolean" || (messageSchema && typeof messageSchema === "object")
                ? messageSchema
                : typeof messageSchemaRaw === "boolean" || (messageSchemaRaw && typeof messageSchemaRaw === "object")
                  ? messageSchemaRaw
                  : null;

        if (
            typeof id !== "string" ||
            typeof projectIdValue !== "string" ||
            typeof createdAtValue !== "string" ||
            typeof name !== "string" ||
            visibilityValue === undefined
        ) {
            throw new RoomException("Invalid feed payload: missing required fields");
        }

        return {
            id,
            projectId: projectIdValue,
            createdAt: new Date(createdAtValue),
            name,
            description: typeof description === "string" ? description : "",
            visibility: visibilityValue,
            paused: paused === true,
            annotations: annotations && typeof annotations === "object" ? annotations as Record<string, string> : {},
            messageSchema: messageSchemaValue,
        };
    }

    private parseFeedSubscription(data: any): FeedSubscription {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid feed subscription payload");
        }

        const {
            id,
            feed_id: feedIdRaw,
            feedId,
            project_id: projectIdRaw,
            projectId,
            room,
            room_id: roomIdRaw,
            roomId,
            path,
            filename_datetime_format: filenameDatetimeFormatRaw,
            filenameDatetimeFormat,
            created_at: createdAtRaw,
            createdAt,
            annotations,
        } = data as any;
        const feedIdValue = typeof feedId === "string" ? feedId : feedIdRaw;
        const projectIdValue = typeof projectId === "string" ? projectId : projectIdRaw;
        const createdAtValue = typeof createdAt === "string" ? createdAt : createdAtRaw;
        const roomIdValue = typeof roomId === "string" ? roomId : roomIdRaw;
        const filenameDatetimeFormatValue =
            typeof filenameDatetimeFormat === "string"
                ? filenameDatetimeFormat
                : typeof filenameDatetimeFormatRaw === "string"
                  ? filenameDatetimeFormatRaw
                  : undefined;

        if (
            typeof id !== "string" ||
            typeof feedIdValue !== "string" ||
            typeof projectIdValue !== "string" ||
            typeof room !== "string" ||
            typeof path !== "string" ||
            typeof createdAtValue !== "string"
        ) {
            throw new RoomException("Invalid feed subscription payload: missing required fields");
        }

        return {
            id,
            feedId: feedIdValue,
            projectId: projectIdValue,
            room,
            roomId: typeof roomIdValue === "string" ? roomIdValue : undefined,
            path,
            filenameDatetimeFormat: filenameDatetimeFormatValue,
            createdAt: new Date(createdAtValue),
            annotations: annotations && typeof annotations === "object" ? annotations as Record<string, string> : {},
        };
    }

    private parseLLMLogger(data: any): LLMLogger {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid LLM logger payload");
        }

        const {
            id,
            project_id: projectIdRaw,
            projectId,
            destination_feed_id: destinationFeedIdRaw,
            destinationFeedId,
            filter_expression: filterExpressionRaw,
            filterExpression,
            paused,
            created_at: createdAtRaw,
            createdAt,
            annotations,
        } = data as any;
        const projectIdValue = typeof projectId === "string" ? projectId : projectIdRaw;
        const destinationFeedIdValue =
            typeof destinationFeedId === "string" ? destinationFeedId : destinationFeedIdRaw;
        const filterExpressionValue =
            typeof filterExpression === "string" ? filterExpression : filterExpressionRaw;
        const createdAtValue = typeof createdAt === "string" ? createdAt : createdAtRaw;

        if (
            typeof id !== "string" ||
            typeof projectIdValue !== "string" ||
            typeof destinationFeedIdValue !== "string" ||
            typeof filterExpressionValue !== "string" ||
            typeof createdAtValue !== "string"
        ) {
            throw new RoomException("Invalid LLM logger payload: missing required fields");
        }

        return {
            id,
            projectId: projectIdValue,
            destinationFeedId: destinationFeedIdValue,
            filterExpression: filterExpressionValue,
            paused: paused === true,
            createdAt: new Date(createdAtValue),
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

    private parseAccessResource(resource: any): AccessResource {
        if (!resource || typeof resource !== "object" || typeof resource.type !== "string" || typeof resource.id !== "string") {
            throw new RoomException("Invalid access resource payload");
        }
        return {
            type: resource.type as AccessResourceType,
            id: resource.id,
            name: typeof resource.name === "string" ? resource.name : null,
            metadata: resource.metadata && typeof resource.metadata === "object" ? resource.metadata as Record<string, unknown> : {},
            annotations: resource.annotations && typeof resource.annotations === "object" ? resource.annotations as Record<string, string> : {},
        };
    }

    private parseAccessSubject(subject: any): AccessSubject {
        if (!subject || typeof subject !== "object" || typeof subject.type !== "string" || typeof subject.id !== "string") {
            throw new RoomException("Invalid access subject payload");
        }
        return {
            type: subject.type as AccessSubjectType,
            id: subject.id,
            name: typeof subject.name === "string" ? subject.name : null,
            firstName: typeof subject.first_name === "string" ? subject.first_name : null,
            lastName: typeof subject.last_name === "string" ? subject.last_name : null,
            email: typeof subject.email === "string" ? subject.email : null,
            objectType: typeof subject.object_type === "string" ? subject.object_type as "project" : null,
            relation: typeof subject.relation === "string" ? subject.relation as "member" | "developer" | "agent" : null,
        };
    }

    private serializeAccessSubject(subject: AccessSubject): Record<string, unknown> {
        return {
            type: subject.type,
            id: subject.id,
            ...(subject.name !== undefined ? { name: subject.name } : {}),
            ...(subject.firstName !== undefined ? { first_name: subject.firstName } : {}),
            ...(subject.lastName !== undefined ? { last_name: subject.lastName } : {}),
            ...(subject.email !== undefined ? { email: subject.email } : {}),
            ...(subject.objectType !== undefined ? { object_type: subject.objectType } : {}),
            ...(subject.relation !== undefined ? { relation: subject.relation } : {}),
        };
    }

    private serializeAccessResource(resource: AccessResource): Record<string, unknown> {
        return {
            type: resource.type,
            id: resource.id,
            ...(resource.name !== undefined ? { name: resource.name } : {}),
            ...(resource.metadata !== undefined ? { metadata: resource.metadata } : {}),
            ...(resource.annotations !== undefined ? { annotations: resource.annotations } : {}),
        };
    }

    private parseProjectMember(data: any): ProjectMember {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid project member payload");
        }
        const user = data.user && typeof data.user === "object" ? data.user : data;
        const directRoles = Array.isArray(data.direct_roles)
            ? data.direct_roles.filter(
                  (item: unknown): item is ProjectRole =>
                      item === "member" ||
                      item === "admin" ||
                      item === "developer" ||
                      item === "room_creator" ||
                      item === "agent_creator" ||
                      item === "mailbox_creator" ||
                      item === "route_creator" ||
                      item === "scheduled_task_creator" ||
                      item === "llm_proxy_user" ||
                      item === "usage_reporter" ||
                      item === "billing_manager" ||
                      item === "group_manager",
              )
            : [];
        const id = typeof user.id === "string" ? user.id : "";
        const email = typeof user.email === "string" ? user.email : "";
        return {
            id,
            email,
            firstName: typeof user.first_name === "string" ? user.first_name : null,
            lastName: typeof user.last_name === "string" ? user.last_name : null,
            directRoles,
        };
    }

    private parseGroupMember(data: any): GroupMember {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid group member payload");
        }
        const directRoles = Array.isArray(data.direct_roles)
            ? data.direct_roles.filter((item: unknown): item is "member" | "manager" => item === "member" || item === "manager")
            : [];
        return {
            subject: this.parseAccessSubject(data.subject),
            directRoles,
        };
    }

    private parseProjectRoomGrant(data: any): ProjectRoomGrant {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid room grant payload");
        }
        const parsedResource = this.parseAccessResource((data as any).resource);
        const parsedSubject = this.parseAccessSubject((data as any).subject);
        const parsedDirectRoles = Array.isArray((data as any).direct_roles)
            ? (data as any).direct_roles.filter((item: unknown): item is AccessRole =>
                  item === "member" ||
                  item === "viewer" ||
                  item === "operator" ||
                  item === "developer" ||
                  item === "admin" ||
                  item === "room_creator" ||
                  item === "room_inventory" ||
                  item === "room_manager" ||
                  item === "session_inventory" ||
                  item === "agent_creator" ||
                  item === "agent_inventory" ||
                  item === "agent_manager" ||
                  item === "repository_creator" ||
                  item === "repository_inventory" ||
                  item === "repository_manager" ||
                  item === "feed_creator" ||
                  item === "feed_inventory" ||
                  item === "feed_manager" ||
                  item === "oauth_client_creator" ||
                  item === "oauth_client_inventory" ||
                  item === "oauth_client_manager" ||
                  item === "api_key_creator" ||
                  item === "api_key_inventory" ||
                  item === "api_key_manager" ||
                  item === "service_creator" ||
                  item === "service_inventory" ||
                  item === "service_manager" ||
                  item === "service_account_creator" ||
                  item === "service_account_inventory" ||
                  item === "service_account_manager" ||
                  item === "participant_token_creator" ||
                  item === "mailbox_creator" ||
                  item === "mailbox_inventory" ||
                  item === "mailbox_manager" ||
                  item === "route_creator" ||
                  item === "route_inventory" ||
                  item === "route_manager" ||
                  item === "scheduled_task_creator" ||
                  item === "scheduled_task_inventory" ||
                  item === "scheduled_task_manager" ||
                  item === "feed_subscription_creator" ||
                  item === "feed_subscription_inventory" ||
                  item === "feed_subscription_manager" ||
                  item === "llm_logger_creator" ||
                  item === "llm_logger_inventory" ||
                  item === "llm_logger_manager" ||
                  item === "llm_proxy_user" ||
                  item === "usage_reporter" ||
                  item === "billing_manager" ||
                  item === "group_manager" ||
                  item === "reader" ||
                  item === "subscriber" ||
                  item === "publisher" ||
                  item === "manager" ||
                  item === "list")
            : [];
        const room: RoomInfo = {
            id: parsedResource.id,
            name: parsedResource.name ?? parsedResource.id,
            metadata: parsedResource.metadata ?? {},
            annotations: parsedResource.annotations ?? {},
        };
        return {
            resource: parsedResource,
            subject: parsedSubject,
            directRoles: parsedDirectRoles,
            room,
            userId: parsedSubject.id,
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
        const monthlyBudget = (data as any).monthly_budget ?? (data as any).monthlyBudget;
        const autoRechargePaused = (data as any).auto_recharge_paused ?? (data as any).autoRechargePaused;
        const autoRechargedThisMonth = (data as any).auto_recharged_this_month ?? (data as any).autoRechargedThisMonth;
        return {
            balance: balanceValue,
            autoRechargeThreshold: typeof threshold === "number" ? threshold : null,
            autoRechargeAmount: typeof amount === "number" ? amount : null,
            lastRecharge: typeof lastRechargeRaw === "string" ? new Date(lastRechargeRaw) : null,
            monthlyBudget: typeof monthlyBudget === "number" ? monthlyBudget : null,
            autoRechargePaused: autoRechargePaused === true,
            autoRechargedThisMonth: typeof autoRechargedThisMonth === "number" ? autoRechargedThisMonth : null,
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

    private parseOAuthClient(data: any): OAuthClient {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid OAuth client payload");
        }
        if ("client" in data && data.client && typeof data.client === "object") {
            data = data.client;
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
            official: Boolean((data as any).official),
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

    private parseAgentConnectionInfo(data: any): AgentConnectionInfo {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid agent connection payload");
        }
        const { jwt, agent_name: agentNameRaw, agentName, project_id: projectIdRaw, projectId, agent_url: agentUrlRaw, agentUrl } = data as any;
        const agentNameValue = typeof agentName === "string" ? agentName : agentNameRaw;
        const projectIdValue = typeof projectId === "string" ? projectId : projectIdRaw;
        const agentUrlValue = typeof agentUrl === "string" ? agentUrl : agentUrlRaw;
        if (typeof jwt !== "string" || typeof agentNameValue !== "string" || typeof projectIdValue !== "string" || typeof agentUrlValue !== "string") {
            throw new RoomException("Invalid agent connection payload: missing fields");
        }
        const parsedUrl = new URL(agentUrlValue);
        const legacySuffix = `/accounts/projects/${encodeURIComponent(projectIdValue)}/agents/${encodeURIComponent(agentNameValue)}/messages`;
        if (parsedUrl.pathname.endsWith(legacySuffix)) {
            const prefix = parsedUrl.pathname.slice(0, -legacySuffix.length);
            parsedUrl.pathname = `${prefix}/agents/${encodeURIComponent(projectIdValue)}/${encodeURIComponent(agentNameValue)}/messages`;
        }
        return { jwt, agentName: agentNameValue, projectId: projectIdValue, agentUrl: parsedUrl.toString() };
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
        options: { roles?: ProjectRole[]; email?: string; inviteRedirectUrl?: string } = {},
    ): Promise<Record<string, unknown>> {
        const { roles = ["member"], email, inviteRedirectUrl } = options;
        return await this.request(`/accounts/projects/${projectId}/users`, {
            method: "POST",
            json: {
                project_id: projectId,
                user_id: userId,
                roles,
                ...(email !== undefined ? { email } : {}),
                ...(inviteRedirectUrl !== undefined ? { invite_redirect_url: inviteRedirectUrl } : {}),
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

    async updateUserInProject(projectId: string, userId: string, roles: ProjectRole[]): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects/${projectId}/users/${userId}`, {
            method: "PUT",
            json: { roles },
            action: "update project user",
        });
    }

    async getUsersInProjectPage(projectId: string, options: { pageSize?: number; continuationToken?: string; filter?: string; email?: string } = {}): Promise<ProjectMembersPage> {
        const { pageSize = 100, continuationToken, filter, email } = options;
        const data = await this.request<{ users?: any[]; continuation_token?: string | null }>(`/accounts/projects/${projectId}/users`, {
            query: { page_size: pageSize, continuation_token: continuationToken, filter, email },
            action: "fetch project users",
        });
        const users = Array.isArray(data?.users) ? data.users : [];
        return { users: users.map((user) => this.parseProjectMember(user)), continuationToken: data?.continuation_token ?? null };
    }

    async getUsersInProject(projectId: string): Promise<ProjectMember[]> {
        const page = await this.getUsersInProjectPage(projectId);
        return page.users;
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

    async getProjectByKey(projectKey: string): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects/by-key/${encodeURIComponent(projectKey)}`, {
            action: "get project by key",
        });
    }

    // Service accounts --------------------------------------------------------

    async listServiceAccounts(projectId: string, options: { pageSize?: number; continuationToken?: string; filter?: string; view?: string } = {}): Promise<ServiceAccountsPage> {
        const params = new URLSearchParams();
        if (options.pageSize !== undefined) params.set("page_size", String(options.pageSize));
        if (options.continuationToken !== undefined) params.set("continuation_token", options.continuationToken);
        if (options.filter !== undefined) params.set("filter", options.filter);
        if (options.view !== undefined) params.set("view", options.view);
        const query = params.toString();
        return await this.request(`/accounts/projects/${projectId}/service-accounts${query ? `?${query}` : ""}`, {
            action: "list service accounts",
        });
    }

    async createServiceAccount(projectId: string, name: string, options: { displayName?: string; description?: string; metadata?: Record<string, unknown>; annotations?: Record<string, string> } = {}): Promise<ServiceAccountInfo> {
        return await this.request(`/accounts/projects/${projectId}/service-accounts`, {
            method: "POST",
            json: { name, ...options },
            action: "create service account",
        });
    }

    async mintParticipantToken(
        projectId: string,
        options: { name: string; roomName?: string; role?: string; api?: Record<string, unknown>; grants?: Record<string, unknown>[] },
    ): Promise<string> {
        const json =
            options.grants !== undefined
                ? { name: options.name, grants: options.grants }
                : {
                      name: options.name,
                      room_name: options.roomName,
                      role: options.role,
                      api: options.api,
                  };
        const data = await this.request<{ token?: unknown }>(`/accounts/projects/${projectId}/participant-tokens`, {
            method: "POST",
            json,
            action: "mint participant token",
        });
        if (typeof data?.token !== "string" || data.token.trim() === "") {
            throw new Error("Invalid participant token mint response");
        }
        return data.token;
    }

    // API keys ----------------------------------------------------------------

    async createApiKey(projectId: string, serviceAccountId: string, name: string, description: string): Promise<ApiKeyInfo> {
        return await this.request(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/api-keys`, {
            method: "POST",
            json: { name, description },
            action: "create api key",
        });
    }

    async deleteApiKey(projectId: string, serviceAccountId: string, id: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/api-keys/${id}`, {
            method: "DELETE",
            action: "delete api key",
            responseType: "void",
        });
    }

    async revokeApiKeysByMsid(projectId: string, serviceAccountId: string, msid: string): Promise<ApiKeysRevocationResult> {
        return await this.request(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/api-keys:revoke`, {
            method: "POST",
            json: { msid },
            action: "revoke api keys",
        });
    }

    async listApiKeys(projectId: string, serviceAccountId: string): Promise<ApiKeysPage> {
        return await this.request(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/api-keys`, {
            action: "list api keys",
        });
    }

    // Secrets -----------------------------------------------------------------

    async createUserSecret(input: Required<Pick<SecretInput, "projectId" | "name">> & Omit<SecretInput, "projectId" | "name">): Promise<Secret> {
        return await this.request<Secret>(`/accounts/users/me/secrets`, {
            method: "POST",
            json: this.secretPayload(input),
            action: "create user secret",
        });
    }

    async listUserSecrets(options: { pageSize?: number; continuationToken?: string; filter?: string } = {}): Promise<SecretsPage> {
        return await this.request<SecretsPage>(`/accounts/users/me/secrets`, {
            query: {
                page_size: options.pageSize ?? 100,
                continuation_token: options.continuationToken,
                filter: options.filter,
            },
            action: "list user secrets",
        });
    }

    async searchUserSecrets(input: SecretSearchInput = {}): Promise<SecretsPage> {
        return await this.request<SecretsPage>(`/accounts/users/me/secrets:search`, {
            method: "POST",
            json: this.secretSearchPayload(input),
            action: "search user secrets",
        });
    }

    async getUserSecret(secretId: string, options: { includeValue?: boolean } = {}): Promise<Secret> {
        return await this.request<Secret>(`/accounts/users/me/secrets/${secretId}`, {
            query: {
                include_value: options.includeValue ? "true" : undefined,
            },
            action: "get user secret",
        });
    }

    async updateUserSecret(secretId: string, input: SecretInput): Promise<Secret> {
        return await this.request<Secret>(`/accounts/users/me/secrets/${secretId}`, {
            method: "PATCH",
            json: this.secretPayload(input),
            action: "update user secret",
        });
    }

    async deleteUserSecret(secretId: string): Promise<void> {
        await this.request(`/accounts/users/me/secrets/${secretId}`, {
            method: "DELETE",
            action: "delete user secret",
            responseType: "void",
        });
    }

    async listUserSecretVersions(secretId: string): Promise<SecretVersion[]> {
        const page = await this.request<SecretVersionsPage>(`/accounts/users/me/secrets/${secretId}/versions`, {
            action: "list user secret versions",
        });
        return page.versions;
    }

    async createUserSecretVersion(secretId: string, input: SecretVersionInput): Promise<SecretVersion> {
        return await this.request<SecretVersion>(`/accounts/users/me/secrets/${secretId}/versions`, {
            method: "POST",
            json: this.secretVersionPayload(input),
            action: "create user secret version",
        });
    }

    async listUserSecretProxyAccess(secretId: string, options: { pageSize?: number; continuationToken?: string } = {}): Promise<SecretProxyAccessGrantsPage> {
        return await this.request<SecretProxyAccessGrantsPage>(`/accounts/users/me/secrets/${secretId}/access`, {
            query: {
                page_size: options.pageSize ?? 100,
                continuation_token: options.continuationToken,
            },
            action: "list user secret proxy access",
        });
    }

    async grantUserSecretProxyAccess(secretId: string, serviceAccountId: string): Promise<void> {
        await this.request(`/accounts/users/me/secrets/${secretId}/access:grant-proxy`, {
            method: "POST",
            json: { subject: { type: "service_account", id: serviceAccountId } },
            action: "grant user secret proxy access",
            responseType: "void",
        });
    }

    async revokeUserSecretProxyAccess(secretId: string, serviceAccountId: string): Promise<void> {
        await this.request(`/accounts/users/me/secrets/${secretId}/access:revoke-proxy`, {
            method: "POST",
            json: { subject: { type: "service_account", id: serviceAccountId } },
            action: "revoke user secret proxy access",
            responseType: "void",
        });
    }

    async createServiceAccountSecret(
        projectId: string,
        serviceAccountId: string,
        input: Required<Pick<SecretInput, "name">> & Omit<SecretInput, "projectId" | "name">,
    ): Promise<Secret> {
        return await this.request<Secret>(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/secrets`, {
            method: "POST",
            json: this.secretPayload(input),
            action: "create service account secret",
        });
    }

    async listServiceAccountSecrets(projectId: string, serviceAccountId: string, options: { pageSize?: number; continuationToken?: string; filter?: string } = {}): Promise<SecretsPage> {
        return await this.request<SecretsPage>(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/secrets`, {
            query: {
                page_size: options.pageSize ?? 100,
                continuation_token: options.continuationToken,
                filter: options.filter,
            },
            action: "list service account secrets",
        });
    }

    async searchServiceAccountSecrets(projectId: string, serviceAccountId: string, input: SecretSearchInput = {}): Promise<SecretsPage> {
        return await this.request<SecretsPage>(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/secrets:search`, {
            method: "POST",
            json: this.secretSearchPayload(input),
            action: "search service account secrets",
        });
    }

    async getServiceAccountSecret(projectId: string, serviceAccountId: string, secretId: string, options: { includeValue?: boolean } = {}): Promise<Secret> {
        return await this.request<Secret>(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/secrets/${secretId}`, {
            query: {
                include_value: options.includeValue ? "true" : undefined,
            },
            action: "get service account secret",
        });
    }

    async updateServiceAccountSecret(projectId: string, serviceAccountId: string, secretId: string, input: SecretInput): Promise<Secret> {
        return await this.request<Secret>(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/secrets/${secretId}`, {
            method: "PATCH",
            json: this.secretPayload(input),
            action: "update service account secret",
        });
    }

    async deleteServiceAccountSecret(projectId: string, serviceAccountId: string, secretId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/secrets/${secretId}`, {
            method: "DELETE",
            action: "delete service account secret",
            responseType: "void",
        });
    }

    async listServiceAccountSecretVersions(projectId: string, serviceAccountId: string, secretId: string): Promise<SecretVersion[]> {
        const page = await this.request<SecretVersionsPage>(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/secrets/${secretId}/versions`, {
            action: "list service account secret versions",
        });
        return page.versions;
    }

    async createServiceAccountSecretVersion(projectId: string, serviceAccountId: string, secretId: string, input: SecretVersionInput): Promise<SecretVersion> {
        return await this.request<SecretVersion>(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/secrets/${secretId}/versions`, {
            method: "POST",
            json: this.secretVersionPayload(input),
            action: "create service account secret version",
        });
    }

    async listServiceAccountPullSecrets(projectId: string, serviceAccountId: string): Promise<Secret[]> {
        const page = await this.request<SecretsPage>(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/pull-secrets`, {
            action: "list service account pull secrets",
        });
        return page.secrets;
    }

    async addServiceAccountPullSecret(projectId: string, serviceAccountId: string, secretId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/pull-secrets/${secretId}`, {
            method: "PUT",
            action: "add service account pull secret",
            responseType: "void",
        });
    }

    async removeServiceAccountPullSecret(projectId: string, serviceAccountId: string, secretId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/service-accounts/${serviceAccountId}/pull-secrets/${secretId}`, {
            method: "DELETE",
            action: "remove service account pull secret",
            responseType: "void",
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

    async setAutoRecharge({
        projectId,
        enabled,
        amount,
        threshold,
        monthlyBudget = null,
    }: {
        projectId: string;
        enabled: boolean;
        amount: number;
        threshold: number;
        monthlyBudget?: number | null;
    }): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/recharge`, {
            method: "POST",
            json: { enabled, amount, threshold, monthly_budget: monthlyBudget },
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
        options: { start?: Date; end?: Date; interval?: string; report?: string; users?: string[]; room?: string; provider?: string; model?: string; usageType?: string; client?: string; annotations?: Record<string, string> } = {},
    ): Promise<Record<string, unknown>[]> {
        const { start, end, interval, report, users, room, provider, model, usageType, client, annotations } = options;
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
                client: client && client.trim().length > 0 ? client.trim() : undefined,
                annotations: annotations && Object.keys(annotations).length > 0 ? JSON.stringify(annotations) : undefined,
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

    async listRecentRoomSessions(projectId: string, roomName: string, options: { limit?: number } = {}): Promise<RoomSession[]> {
        const params = new URLSearchParams();
        if (options.limit !== undefined) {
            params.set("limit", String(options.limit));
        }
        const query = params.size > 0 ? `?${params.toString()}` : "";
        const data = await this.request<{ sessions?: any[] }>(
            `/accounts/projects/${projectId}/rooms/${encodeURIComponent(roomName)}/sessions${query}`,
            { action: "list recent room sessions" },
        );
        const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
        return sessions.map((item) => this.parseRoomSession(item));
    }

    async listRecentSingleAgentSessions(projectId: string, agentName: string, options: { limit?: number } = {}): Promise<RoomSession[]> {
        const params = new URLSearchParams();
        if (options.limit !== undefined) {
            params.set("limit", String(options.limit));
        }
        const query = params.size > 0 ? `?${params.toString()}` : "";
        const data = await this.request<{ sessions?: any[] }>(
            `/accounts/projects/${projectId}/agents/${encodeURIComponent(agentName)}/sessions${query}`,
            { action: "list recent agent sessions" },
        );
        const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
        return sessions.map((item) => this.parseRoomSession(item));
    }

    async createAgent(params: {
        projectId: string;
        configuration: Record<string, unknown>;
        ifNotExists?: boolean;
        permissions?: unknown[] | null;
    }): Promise<ManagedAgent> {
        const body: Record<string, unknown> = {
            configuration: params.configuration,
            if_not_exists: params.ifNotExists ?? false,
        };
        if (params.permissions != null) {
            body.permissions = params.permissions;
        }
        return await this.request<ManagedAgent>(
            `/accounts/projects/${params.projectId}/agents`,
            {
                method: "POST",
                json: body,
                action: "create agent",
            },
        );
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

    private parseMailbox(item: unknown): Mailbox {
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
    }

    async listMailboxesPage(projectId: string, options: { pageSize?: number; continuationToken?: string; filter?: string } = {}): Promise<MailboxesPage> {
        const { pageSize = 100, continuationToken, filter } = options;
        const data = await this.request<{ mailboxes?: any[]; total?: number; continuation_token?: string | null }>(`/accounts/projects/${projectId}/mailboxes`, {
            query: { page_size: pageSize, continuation_token: continuationToken, filter },
            action: "list mailboxes",
        });
        const mailboxes = Array.isArray(data?.mailboxes) ? data.mailboxes : [];
        const parsed = mailboxes.map((item) => this.parseMailbox(item));
        return { mailboxes: parsed, total: typeof data?.total === "number" ? data.total : parsed.length, continuationToken: data.continuation_token ?? null };
    }

    async listMailboxes(projectId: string, options: { pageSize?: number; filter?: string } = {}): Promise<Mailbox[]> {
        const mailboxes: Mailbox[] = [];
        let continuationToken: string | undefined;
        do {
            const page = await this.listMailboxesPage(projectId, { ...options, continuationToken });
            mailboxes.push(...page.mailboxes);
            continuationToken = page.continuationToken ?? undefined;
        } while (continuationToken);
        return mailboxes;
    }

    async deleteMailbox(projectId: string, address: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/mailboxes/${address}`, {
            method: "DELETE",
            action: "delete mailbox",
            responseType: "void",
        });
    }

    // Feeds -------------------------------------------------------------------

    async createFeed(params: {
        projectId: string;
        name: string;
        description?: string;
        visibility?: FeedVisibility;
        paused?: boolean;
        annotations?: Record<string, string>;
        messageSchema?: Record<string, unknown> | boolean | null;
    }): Promise<Feed> {
        const {
            projectId,
            name,
            description = "",
            visibility = "private",
            paused = false,
            annotations = {},
            messageSchema = null,
        } = params;
        const data = await this.request<Record<string, unknown>>(`/accounts/projects/${projectId}/feeds`, {
            method: "POST",
            json: {
                name,
                description,
                visibility,
                paused,
                annotations,
                message_schema: messageSchema,
            },
            action: "create feed",
        });
        return this.parseFeed((data as any).feed);
    }

    async updateFeed(params: {
        projectId: string;
        feedId: string;
        name: string;
        description?: string;
        paused?: boolean;
        annotations?: Record<string, string>;
        messageSchema?: Record<string, unknown> | boolean | null;
    }): Promise<void> {
        const {
            projectId,
            feedId,
            name,
            description = "",
            paused = false,
            annotations = {},
            messageSchema = null,
        } = params;
        await this.request(`/accounts/projects/${projectId}/feeds/${feedId}`, {
            method: "PUT",
            json: {
                name,
                description,
                paused,
                annotations,
                message_schema: messageSchema,
            },
            action: "update feed",
            responseType: "void",
        });
    }

    async getFeed(projectId: string, feedId: string): Promise<Feed> {
        const data = await this.request<Record<string, unknown>>(`/accounts/projects/${projectId}/feeds/${feedId}`, {
            action: "get feed",
        });
        return this.parseFeed((data as any).feed);
    }

    async listFeedsPage(projectId: string, options: { pageSize?: number; continuationToken?: string; filter?: string; view?: "my" | "all" } = {}): Promise<FeedsPage> {
        const { pageSize = 100, continuationToken, filter, view } = options;
        const data = await this.request<{ feeds?: any[]; total?: number; continuation_token?: string | null }>(`/accounts/projects/${projectId}/feeds`, {
            query: { page_size: pageSize, continuation_token: continuationToken, filter, view },
            action: "list feeds",
        });
        const feeds = Array.isArray(data?.feeds) ? data.feeds : [];
        const parsed = feeds.map((item) => this.parseFeed(item));
        return { feeds: parsed, total: typeof data?.total === "number" ? data.total : parsed.length, continuationToken: data.continuation_token ?? null };
    }

    async listFeeds(projectId: string, options: { pageSize?: number; filter?: string; view?: "my" | "all" } = {}): Promise<Feed[]> {
        const feeds: Feed[] = [];
        let continuationToken: string | undefined;
        do {
            const page = await this.listFeedsPage(projectId, { ...options, continuationToken });
            feeds.push(...page.feeds);
            continuationToken = page.continuationToken ?? undefined;
        } while (continuationToken);
        return feeds;
    }

    async listRoomFeedsPage(projectId: string, roomName: string, options: { count?: number; offset?: number; filter?: string } = {}): Promise<FeedsPage> {
        const { count = 100, offset = 0, filter } = options;
        const data = await this.request<{ feeds?: any[]; total?: number }>(`/accounts/projects/${projectId}/rooms/${roomName}/feeds`, {
            query: { count, offset, filter },
            action: "list room feeds",
        });
        const feeds = Array.isArray(data?.feeds) ? data.feeds : [];
        const parsed = feeds.map((item) => this.parseFeed(item));
        return { feeds: parsed, total: typeof data?.total === "number" ? data.total : parsed.length };
    }

    async listRoomFeeds(projectId: string, roomName: string, options: { count?: number; offset?: number; filter?: string } = {}): Promise<Feed[]> {
        const page = await this.listRoomFeedsPage(projectId, roomName, options);
        return page.feeds;
    }

    async deleteFeed(projectId: string, feedId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/feeds/${feedId}`, {
            method: "DELETE",
            action: "delete feed",
            responseType: "void",
        });
    }

    async publishFeedMessage(params: { projectId: string; feedId: string; message: JsonRequest }): Promise<void> {
        const { projectId, feedId, message } = params;
        await this.request(`/accounts/projects/${projectId}/feeds/${feedId}/messages`, {
            method: "POST",
            json: message,
            action: "publish feed message",
            responseType: "void",
        });
    }

    async publishFeedBatch(params: { projectId: string; feedId: string; messages: JsonRequest[] }): Promise<void> {
        const { projectId, feedId, messages } = params;
        await this.request(`/accounts/projects/${projectId}/feeds/${feedId}/messages/batch`, {
            method: "POST",
            json: messages,
            action: "publish feed messages",
            responseType: "void",
        });
    }

    async createFeedSubscription(params: {
        projectId: string;
        feedId: string;
        room: string;
        path: string;
        filenameDatetimeFormat?: string | null;
        annotations?: Record<string, string>;
    }): Promise<FeedSubscription> {
        const { projectId, feedId, room, path, filenameDatetimeFormat, annotations = {} } = params;
        const data = await this.request<Record<string, unknown>>(
            `/accounts/projects/${projectId}/feeds/${feedId}/subscriptions`,
            {
                method: "POST",
                json: {
                    room,
                    path,
                    ...(filenameDatetimeFormat !== undefined ? { filename_datetime_format: filenameDatetimeFormat } : {}),
                    annotations,
                },
                action: "create feed subscription",
            },
        );
        return this.parseFeedSubscription((data as any).subscription);
    }

    async updateFeedSubscription(params: {
        projectId: string;
        feedId: string;
        subscriptionId: string;
        filenameDatetimeFormat?: string | null;
        annotations?: Record<string, string>;
    }): Promise<void> {
        const { projectId, feedId, subscriptionId, filenameDatetimeFormat, annotations = {} } = params;
        await this.request(`/accounts/projects/${projectId}/feeds/${feedId}/subscriptions/${subscriptionId}`, {
            method: "PUT",
            json: {
                ...(filenameDatetimeFormat !== undefined ? { filename_datetime_format: filenameDatetimeFormat } : {}),
                annotations,
            },
            action: "update feed subscription",
            responseType: "void",
        });
    }

    async getFeedSubscription(projectId: string, feedId: string, subscriptionId: string): Promise<FeedSubscription> {
        const data = await this.request<Record<string, unknown>>(
            `/accounts/projects/${projectId}/feeds/${feedId}/subscriptions/${subscriptionId}`,
            {
                action: "get feed subscription",
            },
        );
        return this.parseFeedSubscription((data as any).subscription);
    }

    async listFeedSubscriptions(projectId: string, feedId: string): Promise<FeedSubscription[]> {
        const data = await this.request<{ subscriptions?: any[] }>(
            `/accounts/projects/${projectId}/feeds/${feedId}/subscriptions`,
            {
                action: "list feed subscriptions",
            },
        );
        const subscriptions = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
        return subscriptions.map((item) => this.parseFeedSubscription(item));
    }

    async deleteFeedSubscription(projectId: string, feedId: string, subscriptionId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/feeds/${feedId}/subscriptions/${subscriptionId}`, {
            method: "DELETE",
            action: "delete feed subscription",
            responseType: "void",
        });
    }

    // LLM Loggers -------------------------------------------------------------

    async createLLMLogger(params: {
        projectId: string;
        destinationFeedId: string;
        filterExpression: string;
        paused?: boolean;
        annotations?: Record<string, string>;
    }): Promise<LLMLogger> {
        const { projectId, destinationFeedId, filterExpression, paused = false, annotations = {} } = params;
        const data = await this.request<Record<string, unknown>>(`/accounts/projects/${projectId}/llm-loggers`, {
            method: "POST",
            json: {
                destination_feed_id: destinationFeedId,
                filter_expression: filterExpression,
                paused,
                annotations,
            },
            action: "create LLM logger",
        });
        return this.parseLLMLogger((data as any).logger);
    }

    async updateLLMLogger(params: {
        projectId: string;
        loggerId: string;
        destinationFeedId: string;
        filterExpression: string;
        paused?: boolean;
        annotations?: Record<string, string>;
    }): Promise<void> {
        const { projectId, loggerId, destinationFeedId, filterExpression, paused = false, annotations = {} } = params;
        await this.request(`/accounts/projects/${projectId}/llm-loggers/${loggerId}`, {
            method: "PUT",
            json: {
                destination_feed_id: destinationFeedId,
                filter_expression: filterExpression,
                paused,
                annotations,
            },
            action: "update LLM logger",
            responseType: "void",
        });
    }

    async getLLMLogger(projectId: string, loggerId: string): Promise<LLMLogger> {
        const data = await this.request<Record<string, unknown>>(`/accounts/projects/${projectId}/llm-loggers/${loggerId}`, {
            action: "get LLM logger",
        });
        return this.parseLLMLogger((data as any).logger);
    }

    async listLLMLoggers(projectId: string): Promise<LLMLogger[]> {
        const data = await this.request<{ loggers?: any[] }>(`/accounts/projects/${projectId}/llm-loggers`, {
            action: "list LLM loggers",
        });
        const loggers = Array.isArray(data?.loggers) ? data.loggers : [];
        return loggers.map((item) => this.parseLLMLogger(item));
    }

    async deleteLLMLogger(projectId: string, loggerId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/llm-loggers/${loggerId}`, {
            method: "DELETE",
            action: "delete LLM logger",
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

    async listRepositoriesPage(projectId: string, options: { pageSize?: number; view?: "my" | "all"; continuationToken?: string } = {}): Promise<{ repositories: ProjectRepository[]; total: number; continuationToken?: string | null }> {
        const { pageSize = 100, view, continuationToken } = options;
        const data = await this.request<{ repositories?: unknown[]; total?: number; continuation_token?: string | null }>(
            `/accounts/projects/${projectId}/repositories`,
            {
                query: { page_size: pageSize, view, continuation_token: continuationToken },
                action: "list repositories",
            },
        );
        const repositories = Array.isArray(data?.repositories) ? data.repositories : [];
        return {
            repositories: repositories.map((item) => this.parseProjectRepository(item)),
            total: Number(data.total ?? repositories.length),
            continuationToken: data.continuation_token ?? null,
        };
    }

    async listRepositories(projectId: string, options: { view?: "my" | "all" } = {}): Promise<ProjectRepository[]> {
        const repositories: ProjectRepository[] = [];
        let continuationToken: string | undefined;
        do {
            const page = await this.listRepositoriesPage(projectId, { view: options.view, continuationToken });
            repositories.push(...page.repositories);
            continuationToken = page.continuationToken ?? undefined;
        } while (continuationToken);
        return repositories;
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
            json: serializeCreateServiceSpec(service),
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
                json: serializeCreateServiceSpec(service),
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
        return normalizeServiceSpec(data as ServiceSpec);
    }

    async listRoomServices(projectId: string, roomName: string): Promise<ServiceSpec[]> {
        const data = await this.request<{ services?: any[] }>(
            `/accounts/projects/${projectId}/rooms/${roomName}/services`,
            {
                action: "list room services",
            },
        );
        const services = Array.isArray(data?.services) ? data.services : [];
        return services.map((service) => normalizeServiceSpec(service as ServiceSpec));
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
        return normalizeServiceSpec(data as ServiceSpec);
    }

    async listServices(projectId: string): Promise<ServiceSpec[]> {
        const data = await this.request<{ services?: any[] }>(`/accounts/projects/${projectId}/services`, {
            action: "list services",
        });
        const services = Array.isArray(data?.services) ? data.services : [];
        return services.map((service) => normalizeServiceSpec(service as ServiceSpec));
    }

    async deleteService(projectId: string, serviceId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/services/${serviceId}`, {
            method: "DELETE",
            action: "delete service",
            responseType: "void",
        });
    }

    // Rooms -------------------------------------------------------------------

    async createRoom(params: { projectId: string; name: string; ifNotExists?: boolean; metadata?: Record<string, unknown>; annotations?: Record<string, string> }): Promise<RoomInfo> {
        const { projectId, name, ifNotExists = false, metadata, annotations } = params;
        const payload: Record<string, unknown> = {
            name,
            if_not_exists: Boolean(ifNotExists),
            metadata,
            annotations,
        };
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

    async createGroup(params: {
        projectId: string;
        name: string;
        metadata?: Record<string, unknown>;
        annotations?: Record<string, string>;
    }): Promise<GroupInfo> {
        const { projectId, name, metadata, annotations } = params;
        const data = await this.request(`/accounts/projects/${projectId}/groups`, {
            method: "POST",
            json: { name, metadata, annotations },
            action: "create group",
        });
        return this.parseGroup(data);
    }

    async getGroup(projectId: string, groupId: string): Promise<GroupInfo> {
        const data = await this.request(`/accounts/projects/${projectId}/groups/${groupId}`, {
            action: "fetch group",
        });
        return this.parseGroup(data);
    }

    async updateGroup(
        projectId: string,
        groupId: string,
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
        await this.request(`/accounts/projects/${projectId}/groups/${groupId}`, {
            method: "PUT",
            json: payload,
            action: "update group",
            responseType: "void",
        });
    }

    async deleteGroup(projectId: string, groupId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/groups/${groupId}`, {
            method: "DELETE",
            action: "delete group",
            responseType: "void",
        });
    }

    async listGroupsPage(projectId: string, options: { pageSize?: number; continuationToken?: string; filter?: string } = {}): Promise<GroupsPage> {
        const data = await this.request<{ groups?: unknown[]; continuation_token?: string | null }>(
            `/accounts/projects/${projectId}/groups`,
            {
                query: {
                    page_size: options.pageSize ?? 50,
                    continuation_token: options.continuationToken,
                    filter: options.filter,
                },
                action: "list groups",
            },
        );
        const groups = Array.isArray(data?.groups) ? data.groups : [];
        return {
            groups: groups.map((item) => this.parseGroup(item)),
            continuationToken: data?.continuation_token ?? null,
        };
    }

    async listGroups(projectId: string, options: { pageSize?: number; continuationToken?: string; filter?: string } = {}): Promise<GroupInfo[]> {
        const page = await this.listGroupsPage(projectId, options);
        return page.groups;
    }

    async setGroupMember(params: { projectId: string; groupId: string; subject: AccessSubject; role?: "member" | "manager" }): Promise<void> {
        const { projectId, groupId, subject, role = "member" } = params;
        await this.request(`/accounts/projects/${projectId}/groups/${groupId}/members`, {
            method: "POST",
            json: { subject, role },
            action: "set group member",
            responseType: "void",
        });
    }

    async listGroupMembersPage(projectId: string, groupId: string, options: { pageSize?: number; continuationToken?: string } = {}): Promise<GroupMembersPage> {
        const data = await this.request<{ members?: unknown[]; continuation_token?: string | null }>(
            `/accounts/projects/${projectId}/groups/${groupId}/members`,
            {
                query: { page_size: options.pageSize ?? 50, continuation_token: options.continuationToken },
                action: "list group members",
            },
        );
        const members = Array.isArray(data?.members) ? data.members : [];
        return { members: members.map((item) => this.parseGroupMember(item)), continuationToken: data?.continuation_token ?? null };
    }

    async listGroupMembers(projectId: string, groupId: string, options: { pageSize?: number; continuationToken?: string } = {}): Promise<GroupMember[]> {
        const page = await this.listGroupMembersPage(projectId, groupId, options);
        return page.members;
    }

    async deleteGroupMember(params: { projectId: string; groupId: string; subjectType: "user" | "agent" | "service_account" | "group"; subjectId: string }): Promise<void> {
        const { projectId, groupId, subjectType, subjectId } = params;
        await this.request(`/accounts/projects/${projectId}/groups/${groupId}/members/${subjectType}/${subjectId}`, {
            method: "DELETE",
            action: "delete group member",
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

    async connectAgent(projectId: string, agentName: string): Promise<AgentConnectionInfo> {
        const data = await this.request(
            `/accounts/projects/${projectId}/agents/${encodeURIComponent(agentName)}/connect`,
            {
                method: "POST",
                json: {},
                action: "connect agent",
            },
        );
        return this.parseAgentConnectionInfo(data);
    }

    async listRooms(
        projectId: string,
        options: { pageSize?: number; continuationToken?: string; filter?: string; view?: "my" | "all" } = {},
    ): Promise<RoomInfo[]> {
        const { pageSize = 50, continuationToken, filter, view } = options;
        const data = await this.request<{ rooms?: any[] }>(`/accounts/projects/${projectId}/rooms`, {
            query: { page_size: pageSize, continuation_token: continuationToken, filter, view },
            action: "list rooms",
        });
        const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
        return rooms.map((item) => this.parseRoom(item));
    }

    async createRoute(params: { projectId: string; spec: RouteSpec }): Promise<void> {
        await this.request(`/accounts/projects/${params.projectId}/routes`, {
            method: "POST",
            json: { spec: params.spec },
            action: "create route",
            responseType: "void",
        });
    }

    async updateRoute(params: { projectId: string; domain: string; spec: RouteSpec }): Promise<void> {
        const domain = this.encodePathComponent(params.domain);
        await this.request(`/accounts/projects/${params.projectId}/routes/${domain}`, {
            method: "PUT",
            json: { spec: params.spec },
            action: "update route",
            responseType: "void",
        });
    }

    async getRoute(params: { projectId: string; domain: string }): Promise<Route> {
        const domain = this.encodePathComponent(params.domain);
        const data = await this.request<{ route?: any }>(`/accounts/projects/${params.projectId}/routes/${domain}`, {
            action: "get route",
        });
        return this.parseRoute(data.route);
    }

    async listRoutesPage(projectId: string, options: { pageSize?: number; continuationToken?: string; filter?: string } = {}): Promise<RoutesPage> {
        const { pageSize = 100, continuationToken, filter } = options;
        const data = await this.request<{ routes?: any[]; total?: number; continuation_token?: string | null }>(`/accounts/projects/${projectId}/routes`, {
            query: { page_size: pageSize, continuation_token: continuationToken, filter },
            action: "list routes",
        });
        const routes = Array.isArray(data.routes) ? data.routes.map((item) => this.parseRoute(item)) : [];
        return { routes, total: Number(data.total ?? routes.length), continuationToken: data.continuation_token ?? null };
    }

    async listRoutes(projectId: string, options: { pageSize?: number; filter?: string } = {}): Promise<Route[]> {
        const routes: Route[] = [];
        let continuationToken: string | undefined;
        do {
            const page = await this.listRoutesPage(projectId, { ...options, continuationToken });
            routes.push(...page.routes);
            continuationToken = page.continuationToken ?? undefined;
        } while (continuationToken);
        return routes;
    }

    async listRoomRoutesPage(params: { projectId: string; roomName: string; count?: number; offset?: number; filter?: string }): Promise<RoutesPage> {
        const { projectId, roomName, count = 100, offset = 0, filter } = params;
        const room = this.encodePathComponent(roomName);
        const data = await this.request<{ routes?: any[]; total?: number }>(`/accounts/projects/${projectId}/rooms/${room}/routes`, {
            query: { count, offset, filter },
            action: "list room routes",
        });
        const routes = Array.isArray(data.routes) ? data.routes.map((item) => this.parseRoute(item)) : [];
        return { routes, total: Number(data.total ?? routes.length) };
    }

    async listRoomRoutes(params: { projectId: string; roomName: string; count?: number; offset?: number; filter?: string }): Promise<Route[]> {
        return (await this.listRoomRoutesPage(params)).routes;
    }

    async listAgentRoutesPage(params: { projectId: string; agentName: string; count?: number; offset?: number; filter?: string }): Promise<RoutesPage> {
        const { projectId, agentName, count = 100, offset = 0, filter } = params;
        const agent = this.encodePathComponent(agentName);
        const data = await this.request<{ routes?: any[]; total?: number }>(`/accounts/projects/${projectId}/agents/${agent}/routes`, {
            query: { count, offset, filter },
            action: "list agent routes",
        });
        const routes = Array.isArray(data.routes) ? data.routes.map((item) => this.parseRoute(item)) : [];
        return { routes, total: Number(data.total ?? routes.length) };
    }

    async listAgentRoutes(params: { projectId: string; agentName: string; count?: number; offset?: number; filter?: string }): Promise<Route[]> {
        return (await this.listAgentRoutesPage(params)).routes;
    }

    async deleteRoute(params: { projectId: string; domain: string }): Promise<void> {
        const domain = this.encodePathComponent(params.domain);
        await this.request(`/accounts/projects/${params.projectId}/routes/${domain}`, {
            method: "DELETE",
            action: "delete route",
            responseType: "void",
        });
    }

    async testAccess(projectId: string, params: { subject: AccessSubject; resource: AccessResource; relation: string }): Promise<AccessTestResult> {
        const data = await this.request<any>(`/accounts/projects/${projectId}/access:test`, {
            method: "POST",
            json: {
                subject: this.serializeAccessSubject(params.subject),
                resource: this.serializeAccessResource(params.resource),
                relation: params.relation,
            },
            action: "test access",
        });
        return {
            allowed: data?.allowed === true,
            resource: data?.resource && typeof data.resource === "object" ? this.parseAccessResource(data.resource) : undefined,
            subject: data?.subject && typeof data.subject === "object" ? this.parseAccessSubject(data.subject) : undefined,
            relation: typeof data?.relation === "string" ? data.relation : undefined,
        };
    }

    async getEffectiveAccess(projectId: string, params: { subject: AccessSubject; resource: AccessResource; relations?: string[] }): Promise<EffectiveAccess> {
        const data = await this.request<any>(`/accounts/projects/${projectId}/access:effective`, {
            method: "POST",
            json: {
                subject: this.serializeAccessSubject(params.subject),
                resource: this.serializeAccessResource(params.resource),
                ...(params.relations ? { relations: params.relations } : {}),
            },
            action: "get effective access",
        });
        return {
            resource: this.parseAccessResource(data?.resource),
            subject: this.parseAccessSubject(data?.subject),
            effectiveRoles: Array.isArray(data?.effective_roles) ? data.effective_roles.filter((item: unknown): item is string => typeof item === "string") : [],
            capabilities: data?.capabilities && typeof data.capabilities === "object" ? data.capabilities as Record<string, boolean> : {},
        };
    }

    async listAccessBindings(projectId: string, params: { subject: AccessSubject }): Promise<ProjectRoomGrant[]> {
        const page = await this.listAccessBindingsPage(projectId, params);
        return page.accessGrants;
    }

    async listAccessBindingsPage(projectId: string, params: { subject: AccessSubject }): Promise<AccessBindingsPage> {
        const data = await this.request<any>(`/accounts/projects/${projectId}/access:bindings`, {
            method: "POST",
            json: {
                subject: this.serializeAccessSubject(params.subject),
            },
            action: "list access bindings",
        });
        return {
            accessGrants: Array.isArray(data?.access_grants)
                ? data.access_grants.map((item: unknown) => this.parseProjectRoomGrant(item))
                : [],
        };
    }

    async getResourcePolicyPage(projectId: string, params: { resourceType: string; resourceId: string; pageSize?: number; continuationToken?: string }): Promise<ResourcePolicyPage> {
        this.validateResourcePolicyType(params.resourceType);
        const data = await this.request<any>(`/accounts/projects/${projectId}/iam/${params.resourceType}/${params.resourceId}/policy`, {
            method: "GET",
            query: { page_size: params.pageSize ?? 50, continuation_token: params.continuationToken },
            action: "get resource policy",
        });
        return {
            resource: this.parseAccessResource(data?.resource),
            accessGrants: Array.isArray(data?.access_grants)
                ? data.access_grants.map((item: unknown) => this.parseProjectRoomGrant(item))
                : [],
            continuationToken: typeof data?.continuation_token === "string" ? data.continuation_token : null,
        };
    }

    async getResourcePolicy(projectId: string, params: { resourceType: string; resourceId: string; pageSize?: number; continuationToken?: string }): Promise<ProjectRoomGrant[]> {
        const grants: ProjectRoomGrant[] = [];
        let continuationToken = params.continuationToken;
        do {
            const page = await this.getResourcePolicyPage(projectId, { ...params, continuationToken });
            grants.push(...page.accessGrants);
            continuationToken = page.continuationToken ?? undefined;
        } while (continuationToken);
        return grants;
    }

    async grantResourcePolicy(projectId: string, params: { resourceType: string; resourceId: string; subject: AccessSubject; roles: string[]; inviteRedirectUrl?: string }): Promise<void> {
        this.validateResourcePolicyType(params.resourceType);
        await this.request(`/accounts/projects/${projectId}/iam/${params.resourceType}/${params.resourceId}/policy:grant`, {
            method: "POST",
            json: {
                subject: this.serializeAccessSubject(params.subject),
                roles: params.roles,
                ...(params.inviteRedirectUrl ? { invite_redirect_url: params.inviteRedirectUrl } : {}),
            },
            action: "grant resource policy",
        });
    }

    async revokeResourcePolicy(projectId: string, params: { resourceType: string; resourceId: string; subject: AccessSubject }): Promise<void> {
        this.validateResourcePolicyType(params.resourceType);
        await this.request(`/accounts/projects/${projectId}/iam/${params.resourceType}/${params.resourceId}/policy:revoke`, {
            method: "POST",
            json: {
                subject: this.serializeAccessSubject(params.subject),
            },
            action: "revoke resource policy",
        });
    }

    private validateResourcePolicyType(resourceType: string): void {
        if (resourceType === "agent") {
            throw new Error("managed agent resource policies are not supported; use agent run_as instead");
        }
    }

    // OAuth Clients -----------------------------------------------------------

    async createOAuthClient(projectId: string, params: { grantTypes: string[]; responseTypes: string[]; redirectUris: string[]; scope: string; metadata?: Record<string, any>; official?: boolean }): Promise<OAuthClient> {
        const { grantTypes, responseTypes, redirectUris, scope, metadata = {}, official = false } = params;
        const data = await this.request(`/accounts/projects/${projectId}/oauth/clients`, {
            method: "POST",
            json: { grant_types: grantTypes, response_types: responseTypes, redirect_uris: redirectUris, scope, metadata, official },
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

    async listOAuthClientsPage(projectId: string, options: { count?: number; offset?: number; filter?: string } = {}): Promise<OAuthClientsPage> {
        const { count = 100, offset = 0, filter } = options;
        const data = await this.request<{ clients?: any[]; total?: number }>(`/accounts/projects/${projectId}/oauth/clients`, {
            query: { count, offset, filter },
            action: "list oauth clients",
        });
        const clients = Array.isArray(data?.clients) ? data.clients : [];
        const parsed = clients.map((item) => this.parseOAuthClient(item));
        return { clients: parsed, total: typeof data?.total === "number" ? data.total : parsed.length };
    }

    async listOAuthClients(projectId: string, options: { count?: number; offset?: number; filter?: string } = {}): Promise<OAuthClient[]> {
        const page = await this.listOAuthClientsPage(projectId, options);
        return page.clients;
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
