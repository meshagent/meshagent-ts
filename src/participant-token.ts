import { decodeJwt, jwtVerify, JWTPayload, SignJWT } from "jose";

export type StringList = string[];

export class AgentsGrant {
    public registerAgent = true;
    public registerPublicToolkit = true;
    public registerPrivateToolkit = true;
    public call = true;
    public useAgents = true;
    public useTools = true;
}

export class LivekitGrant {
    public breakoutRooms?: StringList;

    canJoinBreakoutRoom(name: string): boolean {
        return !this.breakoutRooms || this.breakoutRooms.includes(name);
    }
}

export class QueuesGrant {
    public send?: StringList;
    public receive?: StringList;
    public list = true;

    canSend(q: string) {
        return !this.send || this.send.includes(q);
    }
    canReceive(q: string) {
        return !this.receive || this.receive.includes(q);
    }
}

export class MessagingGrant {
    broadcast = true;
    list = true;
    send = true;
}

export class TableGrant {
    public name!: string;
    public write = false;
    public read = true;
    public alter = false;
}

export class DatabaseGrant {
    public tables?: TableGrant[];
    public listTables = true;

    private _match(table: string) {
        if (!this.tables) return undefined;

        return this.tables.find(t => t.name === table);
    }

    canWrite(table: string) {
        const t = this._match(table);

        return t ? t.write : this.tables === undefined;
    }

    canRead(table: string) {
        const t = this._match(table);

        return t ? t.read : this.tables === undefined;
    }

    canAlter(table: string) {
        const t = this._match(table);

        return t ? t.alter : this.tables === undefined;
    }
}

export class SyncPathGrant {
    public path!: string;
    public readOnly = false;
}

export class SyncGrant {
    public paths?: SyncPathGrant[];

    private matches(p: SyncPathGrant, path: string) {
        return p.path === path || (p.path.endsWith("*") && path.startsWith(p.path.slice(0, -1)));
    }

    canRead(path: string) {
        if (!this.paths) return true;

        return this.paths.some(p => this.matches(p, path));
    }

    canWrite(path: string) {
        if (!this.paths) return true;

        const p = this.paths.find(pp => this.matches(pp, path));

        return p ? !p.readOnly : false;
    }
}

export class StoragePathGrant {
    public path!: string;
    public readOnly = false;
}

export class StorageGrant {
    public paths?: StoragePathGrant[];

    private matches(p: StoragePathGrant, path: string) {
        return path.startsWith(p.path);
    }

    canRead(path: string) {
        if (!this.paths) return true;

        return this.paths.some(p => this.matches(p, path));
    }

    canWrite(path: string) {
        if (!this.paths) return true;

        const p = this.paths.find(pp => this.matches(pp, path));

        return p ? !p.readOnly : false;
    }
}

export class ContainersGrant {
    public build = true;
    public logs = true;
    public pull?: StringList;
    public run?: StringList;
    public use_containers = true;

    private match(list: StringList | undefined, tag: string) {
        if (!list) {
            return true;
        }

        return list.some(t => tag === t || tag.startsWith(t.endsWith("*") ? t.slice(0, -1) : t));
    }

    canPull(tag: string) {
        return this.match(this.pull, tag);
    }

    canRun(tag: string) {
        return this.match(this.run, tag);
    }
}

export class DeveloperGrant {
    public logs = true;
}

export class AdminGrant {
    public paths?: StoragePathGrant[];

    private matches(p: StoragePathGrant, path: string) {
        return path.startsWith(p.path);
    }

    canRead(path: string) {
        if (!this.paths) {
            return true;
        }

        return this.paths.some(p => this.matches(p, path));
    }
    canWrite(path: string) {
        if (!this.paths) {
            return true;
        }

        const p = this.paths.find(pp => this.matches(pp, path));

        return p ? !p.readOnly : false;
    }
}

export class SecretsGrant {
    public requestOauthToken?: StringList;

    canRequestOauthToken(authorizationEndpoint: string) {
        if (!this.requestOauthToken) {
            return true;
        }

        return this.requestOauthToken.some(
            t => t === authorizationEndpoint || (
                (t.endsWith("*") && authorizationEndpoint.startsWith(t.slice(0, -1)))
            ));
    }
}

export class ApiScope {
    public livekit?: LivekitGrant;
    public queues?: QueuesGrant;
    public messaging?: MessagingGrant;
    public database?: DatabaseGrant;
    public sync?: SyncGrant;
    public storage?: StorageGrant;
    public containers?: ContainersGrant;
    public developer?: DeveloperGrant;
    public agents?: AgentsGrant;
    public admin?: AdminGrant;
    public secrets?: SecretsGrant;

    static agentDefault(): ApiScope {
        const s = new ApiScope();

        s.livekit = new LivekitGrant();
        s.queues = new QueuesGrant();
        s.messaging = new MessagingGrant();
        s.database = new DatabaseGrant();
        s.sync = new SyncGrant();
        s.storage = new StorageGrant();
        s.containers = new ContainersGrant();
        s.developer = new DeveloperGrant();
        s.agents = new AgentsGrant();
        s.secrets = new SecretsGrant();

        return s;
    }

    static full(): ApiScope {
        const s = ApiScope.agentDefault();

        s.admin = new AdminGrant();

        return s;
    }

    toJSON(): Record<string, any> {
        return { ...this };
    }

    static fromJSON(obj: any): ApiScope {
        return Object.assign(new ApiScope(), obj);
    }
}

/* ------------------------------- ParticipantGrant ------------------------------- */

export class ParticipantGrant {
    public name: string;
    public scope?: string | ApiScope;

    constructor({ name, scope }: { name: string; scope?: string | ApiScope }) {
        this.name = name;
        this.scope = scope;
    }

    toJson(): Record<string, any> {
        if (this.name === "api" && this.scope && typeof this.scope !== "string") {
            return {
                name: this.name,
                scope: (this.scope as ApiScope).toJSON(),
            };
        }

        return {
            name: this.name,
            scope: this.scope,
        };
    }

    static fromJson(json: Record<string, any>): ParticipantGrant {
        const name = json["name"] as string;

        let scope: string | ApiScope | undefined = json["scope"];

        if (name === "api" && scope && typeof scope === "object") {
            scope = ApiScope.fromJSON(scope);
        }

        return new ParticipantGrant({
            name,
            scope,
        });
    }
}

/* ------------------------------- ParticipantToken ------------------------------- */

function compareSemver(a: string, b: string): number {
    const pa = a.split(".").map(n => parseInt(n, 10));
    const pb = b.split(".").map(n => parseInt(n, 10));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x !== y) return x - y;
    }
    return 0;
}

export class ParticipantToken {
    public name: string;
    public projectId?: string;
    public apiKeyId?: string;

    public version?: string;
    public grants: ParticipantGrant[];
    public extra?: Record<string, any>;

    constructor({
        name,
        projectId,
        apiKeyId,

        version,
        extra,
        grants,
    }: {
        name: string;
        projectId?: string;
        apiKeyId?: string;

        version?: string;
        extra?: Record<string, any>;
        grants?: ParticipantGrant[];
    }) {
        this.name = name;
        this.projectId = projectId;
        this.apiKeyId = apiKeyId;

        this.version = version;
        this.extra = extra ?? {};
        this.grants = grants ?? [];
    }

    /* --------- parity: role / is_user like the Python properties ---------- */

    get role(): string {
        for (const g of this.grants) {
            if (g.name === "role" && g.scope !== "user") {
                return String(g.scope);
            }
        }
        return "user";
    }

    /**
     * Indicates if this token has a role grant that matches "agent".
     */
    get isAgent(): boolean {
        for (const grant of this.grants) {
            if (grant.name === "role" && grant.scope === "agent") {
                return true;
            }
        }
        return false;
    }

    get isUser(): boolean {
        for (const grant of this.grants) {
            if (grant.name === "role" && grant.scope !== "user") {
                return false;
            }
        }
        return true;
    }

    /* --------------------------------- helpers --------------------------------- */

    addTunnelGrant(ports: number[]) {
        const portsStr = ports.join(",");

        this.grants.push(new ParticipantGrant({ name: "tunnel_ports", scope: portsStr }));
    }

    addRoleGrant(role: string) {
        this.grants.push(new ParticipantGrant({ name: "role", scope: role }));
    }

    addRoomGrant(roomName: string) {
        this.grants.push(new ParticipantGrant({ name: "room", scope: roomName }));
    }

    addApiGrant(grant: ApiScope) {
        this.grants.push(new ParticipantGrant({ name: "api", scope: grant }));
    }

    grantScope(name: string): string | ApiScope | undefined {
        return this.grants.find(g => g.name === name)?.scope;
    }

    getApiGrant(): ApiScope | undefined {
        const api = this.grantScope("api");

        if (api && typeof api !== "string") {
            return api as ApiScope;
        }

        if (this.version && compareSemver(this.version, "0.5.3") <= 0 && !api) {
            const fallback = ApiScope.agentDefault();

            fallback.containers = new ContainersGrant();

            return fallback;
        }
    }

    toJson(): Record<string, any> {
        const base: Record<string, any> = {
            name: this.name,
            grants: this.grants.map(g => g.toJson()),
        };

        if (this.projectId) {
            base["sub"] = this.projectId;
        }
        if (this.apiKeyId) {
            base["kid"] = this.apiKeyId;
        }
        if (this.version) {
            base["version"] = this.version;
        }

        return base;
    }

    public async toJwt({ token, expiration}: {
        token: string;
        expiration?: Date;
    }): Promise<string> {
        // jose requires a Uint8Array key for HMAC
        const secretKey = new TextEncoder().encode(token);

        // Merge core token JSON plus any extras
        const payload: JWTPayload = {
            ...this.toJson(),
            ...this.extra,
        };

        // Sign using HS256
        if (expiration) {
            payload.exp = Math.floor(expiration.getTime() / 1000);
        }

        const jwt = await new SignJWT(payload)
            .setProtectedHeader({ alg: "HS256", typ: "JWT" })
            .sign(secretKey);

        return jwt;
    }

    /**
     * Creates a ParticipantToken from a JSON Map.
     */
    static fromJson(json: Record<string, any>): ParticipantToken {
        const { name, sub, grants, kid, version, ...rest } = json;

        const extra: Record<string, any> = { ...rest };

        const v = version ? (version as string) : "0.5.3"; // Python default for older tokens

        return new ParticipantToken({
            name: name as string,
            projectId: sub as string | undefined,
            apiKeyId: kid as string | undefined,
            version: v,
            grants: (grants as Array<any>)?.map((g) =>
                ParticipantGrant.fromJson(g as Record<string, any>)
            ),
            extra,
        });
    }

    /**
     * Decodes a JWT to a ParticipantToken.
     * Provide `token` to verify (HS256). Set `verify=false` to just decode.
     */
    static async fromJwt(jwtStr: string, options: { token?: string; verify?: boolean }): Promise<ParticipantToken> {
        const { token, verify = true } = options ?? {};

        if (verify) {
            const secretKey = new TextEncoder().encode(token);

            const { payload } = await jwtVerify(jwtStr, secretKey, {
                // optional: specify allowed algorithms
                algorithms: ["HS256"],
            });

            return ParticipantToken.fromJson(payload as Record<string, any>);
        } else {
            // decode without verifying
            try {
                const payload = decodeJwt(jwtStr);

                return ParticipantToken.fromJson(payload as Record<string, any>);
            } catch (err) {
                throw new Error("Failed to decode JWT");
            }
        }
    }
}
