import type {
    ConnectorRef,
    OAuthClientConfig,
    ServiceSpec,
    PortSpec,
    EndpointSpec,
} from "./meshagent-client.js";
import type { RemoteParticipant } from "./participant.js";
import type { RoomClient } from "./room-client.js";

export class MCPHeader {
    public readonly name: string;
    public readonly value: string;

    constructor({ name, value }: { name: string; value: string }) {
        this.name = name;
        this.value = value;
    }

    static fromJson(json: Record<string, unknown>): MCPHeader {
        return new MCPHeader({
            name: String(json["name"]),
            value: String(json["value"]),
        });
    }

    toJson(): Record<string, string> {
        return {
            name: this.name,
            value: this.value,
        };
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMcpHeaders(value: unknown): MCPHeader[] | undefined {
    if (value == null) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => {
            if (!isRecord(entry)) {
                throw new Error("MCPServer.headers entries must be JSON objects");
            }
            return MCPHeader.fromJson(entry);
        });
    }

    if (isRecord(value)) {
        return Object.entries(value).map(([name, headerValue]) => new MCPHeader({
            name,
            value: String(headerValue),
        }));
    }

    throw new Error("MCPServer.headers must be a header list or object");
}

export type MCPRequireApproval = "always" | "never";

export class MCPServer {
    public readonly serverLabel: string;
    public readonly authorization?: string;
    public readonly serverUrl?: string;
    public readonly allowedTools?: string[];
    public readonly headers?: MCPHeader[];
    public readonly requireApproval?: MCPRequireApproval;
    public readonly alwaysRequireApproval?: string[];
    public readonly neverRequireApproval?: string[];
    public readonly openaiConnectorId?: string;

    constructor({
        serverLabel,
        authorization,
        serverUrl,
        allowedTools,
        headers,
        requireApproval,
        alwaysRequireApproval,
        neverRequireApproval,
        openaiConnectorId,
    }: {
        serverLabel: string;
        authorization?: string | null;
        serverUrl?: string | null;
        allowedTools?: string[] | null;
        headers?: MCPHeader[] | null;
        requireApproval?: MCPRequireApproval | null;
        alwaysRequireApproval?: string[] | null;
        neverRequireApproval?: string[] | null;
        openaiConnectorId?: string | null;
    }) {
        this.serverLabel = serverLabel;
        this.authorization = authorization ?? undefined;
        this.serverUrl = serverUrl ?? undefined;
        this.allowedTools = allowedTools ?? undefined;
        this.headers = headers ?? undefined;
        this.requireApproval = requireApproval ?? undefined;
        this.alwaysRequireApproval = alwaysRequireApproval ?? undefined;
        this.neverRequireApproval = neverRequireApproval ?? undefined;
        this.openaiConnectorId = openaiConnectorId ?? undefined;
    }

    static fromJson(json: Record<string, unknown>): MCPServer {
        const serverLabel = json["server_label"];
        if (typeof serverLabel !== "string") {
            throw new Error("MCPServer requires server_label");
        }

        const requireApproval = json["require_approval"];
        if (requireApproval != null && requireApproval !== "always" && requireApproval !== "never") {
            throw new Error("MCPServer.require_approval must be always or never");
        }

        return new MCPServer({
            serverLabel,
            authorization: typeof json["authorization"] === "string" ? json["authorization"] : undefined,
            serverUrl: typeof json["server_url"] === "string" ? json["server_url"] : undefined,
            allowedTools: Array.isArray(json["allowed_tools"])
                ? json["allowed_tools"].map(String)
                : undefined,
            headers: parseMcpHeaders(json["headers"]),
            requireApproval,
            alwaysRequireApproval: Array.isArray(json["always_require_approval"])
                ? json["always_require_approval"].map(String)
                : undefined,
            neverRequireApproval: Array.isArray(json["never_require_approval"])
                ? json["never_require_approval"].map(String)
                : undefined,
            openaiConnectorId: typeof json["openai_connector_id"] === "string"
                ? json["openai_connector_id"]
                : (typeof json["openaiConnectorId"] === "string" ? json["openaiConnectorId"] : undefined),
        });
    }

    static fromJsonString(data: string): MCPServer {
        const parsed = JSON.parse(data);
        if (!isRecord(parsed)) {
            throw new Error("MCPServer JSON must be an object");
        }
        return MCPServer.fromJson(parsed);
    }

    toJson(): Record<string, unknown> {
        const json: Record<string, unknown> = {
            server_label: this.serverLabel,
            server_url: this.serverUrl ?? null,
        };
        if (this.authorization !== undefined) {
            json["authorization"] = this.authorization;
        }
        if (this.allowedTools !== undefined) {
            json["allowed_tools"] = this.allowedTools;
        }
        if (this.headers !== undefined) {
            json["headers"] = this.headers.map((header) => header.toJson());
        }
        if (this.requireApproval !== undefined) {
            json["require_approval"] = this.requireApproval;
        }
        if (this.alwaysRequireApproval !== undefined) {
            json["always_require_approval"] = this.alwaysRequireApproval;
        }
        if (this.neverRequireApproval !== undefined) {
            json["never_require_approval"] = this.neverRequireApproval;
        }
        if (this.openaiConnectorId !== undefined) {
            json["openai_connector_id"] = this.openaiConnectorId;
        }
        return json;
    }

    toJsonString(): string {
        return JSON.stringify(this.toJson());
    }

    copyWith({
        serverLabel,
        authorization,
        serverUrl,
        allowedTools,
        headers,
        requireApproval,
        alwaysRequireApproval,
        neverRequireApproval,
        openaiConnectorId,
    }: {
        serverLabel?: string;
        authorization?: string | null;
        serverUrl?: string | null;
        allowedTools?: string[] | null;
        headers?: MCPHeader[] | null;
        requireApproval?: MCPRequireApproval | null;
        alwaysRequireApproval?: string[] | null;
        neverRequireApproval?: string[] | null;
        openaiConnectorId?: string | null;
    }): MCPServer {
        return new MCPServer({
            serverLabel: serverLabel ?? this.serverLabel,
            authorization: authorization ?? this.authorization,
            serverUrl: serverUrl ?? this.serverUrl,
            allowedTools: allowedTools ?? this.allowedTools,
            headers: headers ?? this.headers,
            requireApproval: requireApproval ?? this.requireApproval,
            alwaysRequireApproval: alwaysRequireApproval ?? this.alwaysRequireApproval,
            neverRequireApproval: neverRequireApproval ?? this.neverRequireApproval,
            openaiConnectorId: openaiConnectorId ?? this.openaiConnectorId,
        });
    }
}

export class Connector {
    public readonly name: string;
    public readonly oauth?: OAuthClientConfig;
    public readonly server: MCPServer;

    constructor({
        name,
        server,
        oauth,
    }: {
        name: string;
        server: MCPServer;
        oauth?: OAuthClientConfig | null;
    }) {
        this.name = name;
        this.server = server;
        this.oauth = oauth ?? undefined;
    }

    private static oauthClientSecretIdFromHeaders(server: MCPServer): string | null {
        for (const header of server.headers ?? []) {
            if (header.name === "Meshagent-OAuth-Client-Secret-Id") {
                const value = header.value.trim();
                if (value.length > 0) {
                    return value;
                }
            }
        }
        return null;
    }

    static buildConnectorRef({
        server,
        oauth,
    }: {
        server: MCPServer;
        oauth?: OAuthClientConfig | null;
    }): ConnectorRef | null {
        const clientSecretId = Connector.oauthClientSecretIdFromHeaders(server);
        const serverUrl = server.serverUrl;
        const hasServerUrl = serverUrl != null && serverUrl.trim().length > 0;
        const requiresOAuth = oauth != null || server.openaiConnectorId != null || clientSecretId != null;
        if (!requiresOAuth) {
            return null;
        }
        if (server.openaiConnectorId == null && clientSecretId == null && !hasServerUrl) {
            return null;
        }
        return {
            openaiConnectorId: server.openaiConnectorId ?? null,
            serverUrl: hasServerUrl ? serverUrl.trim() : null,
            clientSecretId,
        };
    }

    private buildConnectorRef(): ConnectorRef | null {
        return Connector.buildConnectorRef({ server: this.server, oauth: this.oauth });
    }

    async isConnected(room: RoomClient, agentName: string): Promise<boolean> {
        const connector = this.buildConnectorRef();
        if (connector == null && this.oauth == null) {
            return true;
        }
        const token = await room.secrets.getOfflineOAuthToken({
            connector,
            oauth: this.oauth,
            delegatedTo: agentName,
        });
        return token != null;
    }

    async authenticate(client: RoomClient, agent: RemoteParticipant, redirectUri: string | URL): Promise<string | null> {
        const connector = this.buildConnectorRef();
        if (connector == null && this.oauth == null) {
            return null;
        }
        const localParticipant = client.localParticipant;
        if (localParticipant == null) {
            throw new Error("Connector.authenticate requires a local participant");
        }
        const agentName = agent.getAttribute("name");
        return await client.secrets.requestOAuthToken({
            fromParticipantId: localParticipant.id,
            connector,
            oauth: this.oauth,
            redirectUri,
            delegateTo: agentName == null ? null : String(agentName),
        });
    }
}

function headersFromEndpointSpec(headers?: Record<string, string> | null): MCPHeader[] | undefined {
    if (headers == null || Object.keys(headers).length === 0) {
        return undefined;
    }
    return Object.entries(headers).map(([name, value]) => new MCPHeader({ name, value }));
}

function normalizeEndpointPath(path: string): string {
    return path.startsWith("/") ? path : `/${path}`;
}

function bracketIpv6Host(host: string): string {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function roomServiceMcpServerUrl({
    service,
    port,
    endpoint,
}: {
    service: ServiceSpec;
    port: PortSpec;
    endpoint: EndpointSpec;
}): string | null {
    const endpointPath = normalizeEndpointPath(endpoint.path);
    const portValue = port.host_port ?? (typeof port.num === "number" ? port.num : null);

    if (service.external == null) {
        if (portValue == null) {
            return `http://localhost${endpointPath}`;
        }
        return `http://localhost:${portValue}${endpointPath}`;
    }

    const externalUrl = service.external.url;
    if (externalUrl.length === 0) {
        return null;
    }

    let baseUrl: URL;
    try {
        baseUrl = new URL(externalUrl.includes("://") ? externalUrl : `https://${externalUrl}`);
    } catch {
        return null;
    }

    if (baseUrl.hostname.length === 0) {
        return null;
    }

    const normalizedBasePath = baseUrl.pathname.endsWith("/")
        ? baseUrl.pathname.slice(0, -1)
        : baseUrl.pathname;
    const joinedPath = normalizedBasePath.length === 0 || normalizedBasePath === "/"
        ? endpointPath
        : `${normalizedBasePath}${endpointPath}`;

    if (portValue == null) {
        baseUrl.pathname = joinedPath;
        return baseUrl.toString();
    }

    const userInfo = baseUrl.username.length > 0
        ? `${baseUrl.username}${baseUrl.password.length > 0 ? `:${baseUrl.password}` : ""}@`
        : "";
    const query = baseUrl.search;
    const fragment = baseUrl.hash;
    return `${baseUrl.protocol}//${userInfo}${bracketIpv6Host(baseUrl.hostname)}:${portValue}${joinedPath}${query}${fragment}`;
}

export function mcpConnectorsFromRoomServices({
    services,
    agentName,
}: {
    services: Iterable<ServiceSpec>;
    agentName?: string | null;
}): Connector[] {
    const connectors: Connector[] = [];

    for (const service of services) {
        const filter = service.metadata.annotations?.["meshagent.agent.filter"];
        if (filter != null && filter !== agentName) {
            continue;
        }

        for (const port of service.ports ?? []) {
            for (const endpoint of port.endpoints ?? []) {
                const mcp = endpoint.mcp;
                if (mcp == null) {
                    continue;
                }

                connectors.push(new Connector({
                    name: mcp.label,
                    server: new MCPServer({
                        serverLabel: mcp.label,
                        serverUrl: roomServiceMcpServerUrl({ service, port, endpoint }),
                        headers: headersFromEndpointSpec(mcp.headers),
                        requireApproval: mcp.require_approval,
                        openaiConnectorId: mcp.openai_connector_id,
                    }),
                    oauth: mcp.oauth,
                }));
            }
        }
    }

    return connectors;
}

function getEnvValue(name: string): string {
    if (typeof process === "undefined") {
        return "";
    }
    return process.env?.[name] ?? "";
}

export class OpenAIConnectors {
    static readonly dropbox = new Connector({
        name: "Dropbox",
        server: new MCPServer({ serverLabel: "Dropbox", openaiConnectorId: "connector_dropbox" }),
        oauth: {
            client_id: getEnvValue("DROPBOX_CONNECTOR_OAUTH_CLIENT_ID"),
            client_secret: "CLIENT_SECRET",
            authorization_endpoint: "https://www.dropbox.com/oauth2/authorize",
            token_endpoint: "https://api.dropbox.com/oauth2/token",
            no_pkce: true,
            scopes: ["files.metadata.read", "account_info.read", "files.content.read"],
        },
    });

    static readonly gmail = new Connector({
        name: "Gmail",
        server: new MCPServer({ serverLabel: "Gmail", openaiConnectorId: "connector_gmail" }),
        oauth: {
            client_id: getEnvValue("GOOGLE_CONNECTOR_OAUTH_CLIENT_ID"),
            authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
            token_endpoint: "https://oauth2.googleapis.com/token",
            no_pkce: false,
            scopes: [
                "https://www.googleapis.com/auth/gmail.modify",
                "https://www.googleapis.com/auth/userinfo.email",
                "https://www.googleapis.com/auth/userinfo.profile",
            ],
        },
    });

    static readonly googleCalendar = new Connector({
        name: "Google Calendar",
        server: new MCPServer({ serverLabel: "Google_Calendar", openaiConnectorId: "connector_googlecalendar" }),
        oauth: {
            client_id: getEnvValue("GOOGLE_CONNECTOR_OAUTH_CLIENT_ID"),
            authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
            token_endpoint: "https://oauth2.googleapis.com/token",
            no_pkce: false,
            scopes: [
                "https://www.googleapis.com/auth/userinfo.email",
                "https://www.googleapis.com/auth/userinfo.profile",
                "https://www.googleapis.com/auth/calendar.events",
            ],
        },
    });

    static readonly googleDrive = new Connector({
        name: "Google Drive",
        server: new MCPServer({ serverLabel: "Google_Drive", openaiConnectorId: "connector_googledrive" }),
        oauth: {
            client_id: "CLIENT_ID",
            client_secret: getEnvValue("GOOGLE_CONNECTOR_OAUTH_CLIENT_ID"),
            authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
            token_endpoint: "https://oauth2.googleapis.com/token",
            no_pkce: false,
            scopes: [
                "https://www.googleapis.com/auth/userinfo.email",
                "https://www.googleapis.com/auth/userinfo.profile",
                "https://www.googleapis.com/auth/drive.readonly",
            ],
        },
    });

    static readonly microsoftTeams = new Connector({
        name: "Microsoft Teams",
        server: new MCPServer({ serverLabel: "Microsoft_Teams", openaiConnectorId: "connector_microsoftteams" }),
        oauth: {
            client_id: getEnvValue("MICROSOFT_CONNECTOR_OAUTH_CLIENT_ID"),
            client_secret: "CLIENT_SECRET",
            authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            no_pkce: false,
            scopes: ["User.Read", "Chat.Read", "ChannelMessage.Read.All"],
        },
    });

    static readonly outlookCalendar = new Connector({
        name: "Outlook Calendar",
        server: new MCPServer({ serverLabel: "Outlook_Calendar", openaiConnectorId: "connector_outlookcalendar" }),
        oauth: {
            client_id: getEnvValue("MICROSOFT_CONNECTOR_OAUTH_CLIENT_ID"),
            client_secret: "CLIENT_SECRET",
            authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            no_pkce: false,
            scopes: ["Calendars.Read", "User.Read"],
        },
    });

    static readonly outlookEmail = new Connector({
        name: "Outlook Email",
        server: new MCPServer({ serverLabel: "Outlook_Email", openaiConnectorId: "connector_outlookemail" }),
        oauth: {
            client_id: getEnvValue("MICROSOFT_CONNECTOR_OAUTH_CLIENT_ID"),
            client_secret: "CLIENT_SECRET",
            authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            no_pkce: false,
            scopes: ["User.Read", "Mail.Read"],
        },
    });

    static readonly sharepoint = new Connector({
        name: "Sharepoint",
        server: new MCPServer({ serverLabel: "Sharepoint", openaiConnectorId: "connector_sharepoint" }),
        oauth: {
            client_id: getEnvValue("MICROSOFT_CONNECTOR_OAUTH_CLIENT_ID"),
            client_secret: "CLIENT_SECRET",
            authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            no_pkce: false,
            scopes: ["Sites.Read.All", "Files.Read.All", "User.Read"],
        },
    });

    static readonly all = [
        OpenAIConnectors.dropbox,
        OpenAIConnectors.gmail,
        OpenAIConnectors.googleCalendar,
        OpenAIConnectors.googleDrive,
        OpenAIConnectors.microsoftTeams,
        OpenAIConnectors.sharepoint,
        OpenAIConnectors.outlookEmail,
        OpenAIConnectors.outlookCalendar,
    ];
}
