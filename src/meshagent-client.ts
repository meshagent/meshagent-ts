import { meshagentBaseUrl } from "./helpers";
import { RoomException } from "./requirement";
import { ApiScope } from "./participant-token";

export type ProjectRole = "member" | "admin" | "developer";

export interface RoomShare {
    id: string;
    projectId: string;
    settings: Record<string, unknown>;
}

export interface RoomShareConnectionInfo {
    jwt: string;
    roomName: string;
    projectId: string;
    settings: Record<string, unknown>;
    roomUrl: string;
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

export interface ContainerMountSpec {
    room?: RoomStorageMountSpec[];
    project?: ProjectStorageMountSpec[];
}

export interface ServiceApiKeySpec {
    role: "admin";
    name: string;
    auto_provision?: boolean | null;
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
    api_key?: ServiceApiKeySpec;
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
    return pruneUndefinedValues(service) as Record<string, unknown>;
}

export interface Mailbox {
    address: string;
    room: string;
    queue: string;
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
            body: requestBody ?? undefined,
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

    private parseRoomShareConnectionInfo(data: any): RoomShareConnectionInfo {
        if (!data || typeof data !== "object") {
            throw new RoomException("Invalid room share connection payload");
        }
        const { jwt, room_name: roomNameRaw, roomName, project_id: projectIdRaw, projectId, settings, room_url: roomUrlRaw, roomUrl } = data as any;
        if (typeof jwt !== "string") {
            throw new RoomException("Invalid room share connection payload: missing jwt");
        }
        const roomNameValue = typeof roomName === "string" ? roomName : roomNameRaw;
        const projectIdValue = typeof projectId === "string" ? projectId : projectIdRaw;
        const roomUrlValue = typeof roomUrl === "string" ? roomUrl : roomUrlRaw;
        if (typeof roomNameValue !== "string" || typeof projectIdValue !== "string" || typeof roomUrlValue !== "string") {
            throw new RoomException("Invalid room share connection payload: missing fields");
        }
        return {
            jwt,
            roomName: roomNameValue,
            projectId: projectIdValue,
            settings: (settings && typeof settings === "object") ? settings as Record<string, unknown> : {},
            roomUrl: roomUrlValue,
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
        const { id, name, metadata } = data as any;
        if (typeof id !== "string" || typeof name !== "string") {
            throw new RoomException("Invalid room payload: missing id or name");
        }
        return {
            id,
            name,
            metadata: metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {},
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

    async connectShare(shareId: string): Promise<RoomShareConnectionInfo> {
        const data = await this.request(`/shares/${shareId}/connect`, {
            method: "POST",
            json: {},
            action: "connect share",
        });
        return this.parseRoomShareConnectionInfo(data);
    }

    // Projects & users --------------------------------------------------------

    async createProject(name: string, settings?: Record<string, unknown>): Promise<Record<string, unknown>> {
        return await this.request(`/accounts/projects`, {
            method: "POST",
            json: { name, settings },
            action: "create project",
        });
    }

    async addUserToProject(projectId: string, userId: string, options: { isAdmin?: boolean; isDeveloper?: boolean, canCreateRooms?: boolean } = {}): Promise<Record<string, unknown>> {
        const { isAdmin = false, isDeveloper = false, canCreateRooms = false } = options;
        return await this.request(`/accounts/projects/${projectId}/users`, {
            method: "POST",
            json: {
                project_id: projectId,
                user_id: userId,
                is_admin: isAdmin,
                is_developer: isDeveloper,
                can_create_rooms: canCreateRooms,
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

    async getUsage(projectId: string, options: { start?: Date; end?: Date; interval?: string; report?: string } = {}): Promise<Record<string, unknown>[]> {
        const { start, end, interval, report } = options;
        const data = await this.request<Record<string, any>>(`/accounts/projects/${projectId}/usage`, {
            query: {
                start: start ? start.toISOString() : undefined,
                end: end ? end.toISOString() : undefined,
                interval,
                report,
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
            const { address, room, queue } = item as any;
            if (typeof address !== "string" || typeof room !== "string" || typeof queue !== "string") {
                throw new RoomException("Invalid mailbox payload: missing fields");
            }
            return { address, room, queue };
        });
    }

    async deleteMailbox(projectId: string, address: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/mailboxes/${address}`, {
            method: "DELETE",
            action: "delete mailbox",
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

    async createSecret(projectId: string, secret: SecretLike): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/secrets`, {
            method: "POST",
            json: this.toSecretPayload(secret),
            action: "create secret",
            responseType: "void",
        });
    }

    async updateSecret(projectId: string, secret: SecretLike): Promise<void> {
        if (!secret.id) {
            throw new RoomException("Secret id is required to update a secret");
        }
        await this.request(`/accounts/projects/${projectId}/secrets/${secret.id}`, {
            method: "PUT",
            json: this.toSecretPayload(secret),
            action: "update secret",
            responseType: "void",
        });
    }

    async deleteSecret(projectId: string, secretId: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/secrets/${secretId}`, {
            method: "DELETE",
            action: "delete secret",
            responseType: "void",
        });
    }

    async listSecrets(projectId: string): Promise<SecretLike[]> {
        const data = await this.request<{ secrets?: any[] }>(`/accounts/projects/${projectId}/secrets`, {
            action: "list secrets",
        });
        const secrets = Array.isArray(data?.secrets) ? data.secrets : [];
        return secrets.map((item) => this.parseSecret(item));
    }

    // Rooms -------------------------------------------------------------------

    async createRoom(params: { projectId: string; name: string; ifNotExists?: boolean; metadata?: Record<string, unknown>; permissions?: Record<string, ApiScope> }): Promise<RoomInfo> {
        const { projectId, name, ifNotExists = false, metadata, permissions } = params;
        const payload: Record<string, unknown> = {
            name,
            if_not_exists: Boolean(ifNotExists),
            metadata,
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

    async updateRoom(projectId: string, roomId: string, name: string): Promise<void> {
        await this.request(`/accounts/projects/${projectId}/rooms/${roomId}`, {
            method: "PUT",
            json: { name },
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
