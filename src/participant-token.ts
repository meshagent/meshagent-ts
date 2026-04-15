import { decodeJwt, jwtVerify, SignJWT } from "jose";
import type { JWTPayload } from "jose";
import type { ConnectorRef, OAuthClientConfig } from "./meshagent-client";
import { parseApiKey } from "./api_keys";
import { __version__ } from "./version";

export type StringList = string[];

function matchesGrantPattern(
    patterns: StringList | undefined,
    value: string,
    allowIfUnset: boolean,
): boolean {
    if (!patterns) {
        return allowIfUnset;
    }

    return patterns.some((pattern) =>
        value === pattern
        || (
            pattern.endsWith("*")
            && value.startsWith(pattern.slice(0, -1))
        )
    );
}

function getEnvValue(name: string): string | undefined {
    if (typeof process === "undefined") {
        return undefined;
    }

    return process.env?.[name];
}

function normalizeNamespace(namespace?: StringList): string[] {
    return namespace ?? [];
}

function namespacesEqual(left?: StringList, right?: StringList): boolean {
    const normalizedLeft = normalizeNamespace(left);
    const normalizedRight = normalizeNamespace(right);

    if (normalizedLeft.length !== normalizedRight.length) {
        return false;
    }

    return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null;
}

function asStringList(value: unknown): StringList | undefined {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value
        : undefined;
}

/* ---------------------------------- Grants ---------------------------------- */

export class AgentsGrant {
    public registerAgent: boolean;
    public registerPublicToolkit: boolean;
    public registerPrivateToolkit: boolean;
    public call: boolean;
    public useAgents: boolean;
    public useTools: boolean;
    public allowedToolkits?: StringList;

    constructor({
        registerAgent,
        registerPublicToolkit,
        registerPrivateToolkit,
        call,
        useAgents,
        useTools,
        allowedToolkits,
    }: {
        registerAgent?: boolean;
        registerPublicToolkit?: boolean;
        registerPrivateToolkit?: boolean;
        call?: boolean;
        useAgents?: boolean;
        useTools?: boolean;
        allowedToolkits?: StringList;
    } = {}) {
        this.registerAgent = registerAgent ?? true;
        this.registerPublicToolkit = registerPublicToolkit ?? true;
        this.registerPrivateToolkit = registerPrivateToolkit ?? true;
        this.call = call ?? true;
        this.useAgents = useAgents ?? true;
        this.useTools = useTools ?? true;
        this.allowedToolkits = allowedToolkits;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.registerAgent !== true) {
            json["register_agent"] = this.registerAgent;
        }
        if (this.registerPublicToolkit !== true) {
            json["register_public_toolkit"] = this.registerPublicToolkit;
        }
        if (this.registerPrivateToolkit !== true) {
            json["register_private_toolkit"] = this.registerPrivateToolkit;
        }
        if (this.call !== true) {
            json["call"] = this.call;
        }
        if (this.useAgents !== true) {
            json["use_agents"] = this.useAgents;
        }
        if (this.useTools !== true) {
            json["use_tools"] = this.useTools;
        }
        if (this.allowedToolkits !== undefined) {
            json["allowed_toolkits"] = this.allowedToolkits;
        }
        return json;
    }

    static fromJSON(obj: unknown): AgentsGrant {
        if (!isRecord(obj)) {
            return new AgentsGrant();
        }

        return new AgentsGrant({
            registerAgent: obj.register_agent ?? obj.registerAgent,
            registerPublicToolkit: obj.register_public_toolkit ?? obj.registerPublicToolkit,
            registerPrivateToolkit: obj.register_private_toolkit ?? obj.registerPrivateToolkit,
            call: obj.call,
            useAgents: obj.use_agents ?? obj.useAgents,
            useTools: obj.use_tools ?? obj.useTools,
            allowedToolkits: asStringList(obj.allowed_toolkits ?? obj.allowedToolkits),
        });
    }
}

export class LivekitGrant {
    public breakoutRooms?: StringList;

    constructor({ breakoutRooms }: { breakoutRooms?: StringList } = {}) {
        this.breakoutRooms = breakoutRooms;
    }

    canJoinBreakoutRoom(name: string): boolean {
        return !this.breakoutRooms || this.breakoutRooms.includes(name);
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.breakoutRooms !== undefined) {
            json["breakout_rooms"] = this.breakoutRooms;
        }
        return json;
    }

    static fromJSON(obj: unknown): LivekitGrant {
        if (!isRecord(obj)) {
            return new LivekitGrant();
        }

        return new LivekitGrant({
            breakoutRooms: asStringList(obj.breakout_rooms ?? obj.breakoutRooms),
        });
    }
}

export class QueuesGrant {
    public send?: StringList;
    public receive?: StringList;
    public list: boolean;

    constructor({
        send,
        receive,
        list,
    }: {
        send?: StringList;
        receive?: StringList;
        list?: boolean;
    } = {}) {
        this.send = send;
        this.receive = receive;
        this.list = list ?? true;
    }

    canSend(queue: string): boolean {
        return !this.send || this.send.includes(queue);
    }

    canReceive(queue: string): boolean {
        return !this.receive || this.receive.includes(queue);
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.send !== undefined) {
            json["send"] = this.send;
        }
        if (this.receive !== undefined) {
            json["receive"] = this.receive;
        }
        if (this.list !== true) {
            json["list"] = this.list;
        }
        return json;
    }

    static fromJSON(obj: unknown): QueuesGrant {
        if (!isRecord(obj)) {
            return new QueuesGrant();
        }

        return new QueuesGrant({
            send: asStringList(obj.send),
            receive: asStringList(obj.receive),
            list: obj.list,
        });
    }
}

export class MessagingGrant {
    public broadcast: boolean;
    public list: boolean;
    public send: boolean;

    constructor({
        broadcast,
        list,
        send,
    }: {
        broadcast?: boolean;
        list?: boolean;
        send?: boolean;
    } = {}) {
        this.broadcast = broadcast ?? true;
        this.list = list ?? true;
        this.send = send ?? true;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.broadcast !== true) {
            json["broadcast"] = this.broadcast;
        }
        if (this.list !== true) {
            json["list"] = this.list;
        }
        if (this.send !== true) {
            json["send"] = this.send;
        }
        return json;
    }

    static fromJSON(obj: unknown): MessagingGrant {
        if (!isRecord(obj)) {
            return new MessagingGrant();
        }

        return new MessagingGrant({
            broadcast: obj.broadcast,
            list: obj.list,
            send: obj.send,
        });
    }
}

export class TableGrant {
    public name: string;
    public namespace?: StringList;
    public write: boolean;
    public read: boolean;
    public alter: boolean;

    constructor({
        name,
        namespace,
        write,
        read,
        alter,
    }: {
        name: string;
        namespace?: StringList;
        write?: boolean;
        read?: boolean;
        alter?: boolean;
    }) {
        this.name = name;
        this.namespace = namespace;
        this.write = write ?? false;
        this.read = read ?? true;
        this.alter = alter ?? false;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {
            name: this.name,
        };
        if (this.namespace !== undefined) {
            json["namespace"] = this.namespace;
        }
        if (this.write !== false) {
            json["write"] = this.write;
        }
        if (this.read !== true) {
            json["read"] = this.read;
        }
        if (this.alter !== false) {
            json["alter"] = this.alter;
        }
        return json;
    }

    static fromJSON(obj: unknown): TableGrant {
        if (!isRecord(obj) || typeof obj.name !== "string") {
            throw new Error("TableGrant requires a name");
        }

        return new TableGrant({
            name: obj.name,
            namespace: asStringList(obj.namespace),
            write: obj.write,
            read: obj.read,
            alter: obj.alter,
        });
    }
}

export class DatabaseGrant {
    public tables?: TableGrant[];
    public listTables: boolean;

    constructor({
        tables,
        listTables,
    }: {
        tables?: TableGrant[];
        listTables?: boolean;
    } = {}) {
        this.tables = tables;
        this.listTables = listTables ?? true;
    }

    private matchingTables(table: string, namespace?: StringList): TableGrant[] {
        if (this.tables === undefined) {
            return [];
        }

        return this.tables.filter((tableGrant) => {
            if (tableGrant.name !== table) {
                return false;
            }
            if (tableGrant.namespace === undefined) {
                return true;
            }
            return namespacesEqual(tableGrant.namespace, namespace);
        });
    }

    canWrite(table: string, namespace?: StringList): boolean {
        if (this.tables === undefined) {
            return true;
        }

        const matches = this.matchingTables(table, namespace);
        if (matches.length === 0) {
            return false;
        }

        return matches.some((tableGrant) => tableGrant.write);
    }

    canRead(table: string, namespace?: StringList): boolean {
        if (this.tables === undefined) {
            return true;
        }

        const matches = this.matchingTables(table, namespace);
        if (matches.length === 0) {
            return false;
        }

        return matches.some((tableGrant) => tableGrant.read);
    }

    canAlter(table: string, namespace?: StringList): boolean {
        if (this.tables === undefined) {
            return true;
        }

        const matches = this.matchingTables(table, namespace);
        if (matches.length === 0) {
            return false;
        }

        return matches.some((tableGrant) => tableGrant.alter);
    }

    canAccess(table: string, namespace?: StringList): boolean {
        return (
            this.canRead(table, namespace)
            || this.canWrite(table, namespace)
            || this.canAlter(table, namespace)
        );
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.tables !== undefined) {
            json["tables"] = this.tables.map((tableGrant) => tableGrant.toJSON());
        }
        if (this.listTables !== true) {
            json["list_tables"] = this.listTables;
        }
        return json;
    }

    static fromJSON(obj: unknown): DatabaseGrant {
        if (!isRecord(obj)) {
            return new DatabaseGrant();
        }

        return new DatabaseGrant({
            tables: Array.isArray(obj.tables)
                ? obj.tables.map((tableGrant) => TableGrant.fromJSON(tableGrant))
                : undefined,
            listTables: obj.list_tables ?? obj.listTables,
        });
    }
}

export class MemoryPermissions {
    public create: boolean;
    public drop: boolean;
    public inspect: boolean;
    public query: boolean;
    public upsert: boolean;
    public ingest: boolean;
    public recall: boolean;
    public optimize: boolean;

    constructor({
        create,
        drop,
        inspect,
        query,
        upsert,
        ingest,
        recall,
        optimize,
    }: {
        create?: boolean;
        drop?: boolean;
        inspect?: boolean;
        query?: boolean;
        upsert?: boolean;
        ingest?: boolean;
        recall?: boolean;
        optimize?: boolean;
    } = {}) {
        this.create = create ?? true;
        this.drop = drop ?? true;
        this.inspect = inspect ?? true;
        this.query = query ?? true;
        this.upsert = upsert ?? true;
        this.ingest = ingest ?? true;
        this.recall = recall ?? true;
        this.optimize = optimize ?? true;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.create !== true) {
            json["create"] = this.create;
        }
        if (this.drop !== true) {
            json["drop"] = this.drop;
        }
        if (this.inspect !== true) {
            json["inspect"] = this.inspect;
        }
        if (this.query !== true) {
            json["query"] = this.query;
        }
        if (this.upsert !== true) {
            json["upsert"] = this.upsert;
        }
        if (this.ingest !== true) {
            json["ingest"] = this.ingest;
        }
        if (this.recall !== true) {
            json["recall"] = this.recall;
        }
        if (this.optimize !== true) {
            json["optimize"] = this.optimize;
        }
        return json;
    }

    static fromJSON(obj: unknown): MemoryPermissions {
        if (!isRecord(obj)) {
            return new MemoryPermissions();
        }

        return new MemoryPermissions({
            create: obj.create,
            drop: obj.drop,
            inspect: obj.inspect,
            query: obj.query,
            upsert: obj.upsert,
            ingest: obj.ingest,
            recall: obj.recall,
            optimize: obj.optimize,
        });
    }
}

export class MemoryEntryGrant {
    public name: string;
    public namespace?: StringList;
    public permissions: MemoryPermissions;

    constructor({
        name,
        namespace,
        permissions,
    }: {
        name: string;
        namespace?: StringList;
        permissions?: MemoryPermissions;
    }) {
        this.name = name;
        this.namespace = namespace;
        this.permissions = permissions ?? new MemoryPermissions();
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {
            name: this.name,
        };
        if (this.namespace !== undefined) {
            json["namespace"] = this.namespace;
        }
        json["permissions"] = this.permissions.toJSON();
        return json;
    }

    static fromJSON(obj: unknown): MemoryEntryGrant {
        if (!isRecord(obj) || typeof obj.name !== "string") {
            throw new Error("MemoryEntryGrant requires a name");
        }

        return new MemoryEntryGrant({
            name: obj.name,
            namespace: asStringList(obj.namespace),
            permissions: MemoryPermissions.fromJSON(obj.permissions),
        });
    }
}

type MemoryPermissionName =
    | "create"
    | "drop"
    | "inspect"
    | "query"
    | "upsert"
    | "ingest"
    | "recall"
    | "optimize";

export class MemoryGrant {
    public list: boolean;
    public memories?: MemoryEntryGrant[];

    constructor({
        list,
        memories,
    }: {
        list?: boolean;
        memories?: MemoryEntryGrant[];
    } = {}) {
        this.list = list ?? true;
        this.memories = memories;
    }

    private matchingMemories(name: string, namespace?: StringList): MemoryEntryGrant[] {
        if (this.memories === undefined) {
            return [];
        }

        return this.memories.filter((memoryGrant) => {
            if (memoryGrant.name !== name) {
                return false;
            }
            if (memoryGrant.namespace === undefined) {
                return true;
            }
            return namespacesEqual(memoryGrant.namespace, namespace);
        });
    }

    private can(name: string, namespace: StringList | undefined, permission: MemoryPermissionName): boolean {
        if (this.memories === undefined) {
            return true;
        }

        const matches = this.matchingMemories(name, namespace);
        if (matches.length === 0) {
            return false;
        }

        return matches.some((memoryGrant) => memoryGrant.permissions[permission]);
    }

    canCreate(name: string, namespace?: StringList): boolean {
        return this.can(name, namespace, "create");
    }

    canDrop(name: string, namespace?: StringList): boolean {
        return this.can(name, namespace, "drop");
    }

    canInspect(name: string, namespace?: StringList): boolean {
        return this.can(name, namespace, "inspect");
    }

    canQuery(name: string, namespace?: StringList): boolean {
        return this.can(name, namespace, "query");
    }

    canUpsert(name: string, namespace?: StringList): boolean {
        return this.can(name, namespace, "upsert");
    }

    canIngest(name: string, namespace?: StringList): boolean {
        return this.can(name, namespace, "ingest");
    }

    canRecall(name: string, namespace?: StringList): boolean {
        return this.can(name, namespace, "recall");
    }

    canOptimize(name: string, namespace?: StringList): boolean {
        return this.can(name, namespace, "optimize");
    }

    canAccessExisting(name: string, namespace?: StringList): boolean {
        return (
            this.canDrop(name, namespace)
            || this.canInspect(name, namespace)
            || this.canQuery(name, namespace)
            || this.canUpsert(name, namespace)
            || this.canIngest(name, namespace)
            || this.canRecall(name, namespace)
            || this.canOptimize(name, namespace)
        );
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.list !== true) {
            json["list"] = this.list;
        }
        if (this.memories !== undefined) {
            json["memories"] = this.memories.map((memoryGrant) => memoryGrant.toJSON());
        }
        return json;
    }

    static fromJSON(obj: unknown): MemoryGrant {
        if (!isRecord(obj)) {
            return new MemoryGrant();
        }

        return new MemoryGrant({
            list: obj.list,
            memories: Array.isArray(obj.memories)
                ? obj.memories.map((memoryGrant) => MemoryEntryGrant.fromJSON(memoryGrant))
                : undefined,
        });
    }
}

export class SyncPathGrant {
    public path: string;
    public readOnly: boolean;

    constructor({ path, readOnly }: { path: string; readOnly?: boolean }) {
        this.path = path;
        this.readOnly = readOnly ?? false;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {
            path: this.path,
        };
        if (this.readOnly !== false) {
            json["read_only"] = this.readOnly;
        }
        return json;
    }

    static fromJSON(obj: unknown): SyncPathGrant {
        if (!isRecord(obj) || typeof obj.path !== "string") {
            throw new Error("SyncPathGrant requires a path");
        }

        return new SyncPathGrant({
            path: obj.path,
            readOnly: obj.read_only ?? obj.readOnly,
        });
    }
}

export class SyncGrant {
    public paths?: SyncPathGrant[];

    constructor({ paths }: { paths?: SyncPathGrant[] } = {}) {
        this.paths = paths;
    }

    private matches(pathGrant: SyncPathGrant, path: string): boolean {
        return pathGrant.path === path
            || (
                pathGrant.path.endsWith("*")
                && path.startsWith(pathGrant.path.slice(0, -1))
            );
    }

    canRead(path: string): boolean {
        if (this.paths === undefined) {
            return true;
        }

        return this.paths.some((pathGrant) => this.matches(pathGrant, path));
    }

    canWrite(path: string): boolean {
        if (this.paths === undefined) {
            return true;
        }

        for (const pathGrant of this.paths) {
            if (this.matches(pathGrant, path)) {
                return !pathGrant.readOnly;
            }
        }

        return false;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.paths !== undefined) {
            json["paths"] = this.paths.map((pathGrant) => pathGrant.toJSON());
        }
        return json;
    }

    static fromJSON(obj: unknown): SyncGrant {
        if (!isRecord(obj)) {
            return new SyncGrant();
        }

        return new SyncGrant({
            paths: Array.isArray(obj.paths)
                ? obj.paths.map((pathGrant) => SyncPathGrant.fromJSON(pathGrant))
                : undefined,
        });
    }
}

export class StoragePathGrant {
    public path: string;
    public readOnly: boolean;

    constructor({ path, readOnly }: { path: string; readOnly?: boolean }) {
        this.path = path;
        this.readOnly = readOnly ?? false;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {
            path: this.path,
        };
        if (this.readOnly !== false) {
            json["read_only"] = this.readOnly;
        }
        return json;
    }

    static fromJSON(obj: unknown): StoragePathGrant {
        if (!isRecord(obj) || typeof obj.path !== "string") {
            throw new Error("StoragePathGrant requires a path");
        }

        return new StoragePathGrant({
            path: obj.path,
            readOnly: obj.read_only ?? obj.readOnly,
        });
    }
}

export class StorageGrant {
    public paths?: StoragePathGrant[];

    constructor({ paths }: { paths?: StoragePathGrant[] } = {}) {
        this.paths = paths;
    }

    canRead(path: string): boolean {
        if (this.paths === undefined) {
            return true;
        }

        return this.paths.some((pathGrant) => path.startsWith(pathGrant.path));
    }

    canWrite(path: string): boolean {
        if (this.paths === undefined) {
            return true;
        }

        for (const pathGrant of this.paths) {
            if (path.startsWith(pathGrant.path)) {
                return !pathGrant.readOnly;
            }
        }

        return false;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.paths !== undefined) {
            json["paths"] = this.paths.map((pathGrant) => pathGrant.toJSON());
        }
        return json;
    }

    static fromJSON(obj: unknown): StorageGrant {
        if (!isRecord(obj)) {
            return new StorageGrant();
        }

        return new StorageGrant({
            paths: Array.isArray(obj.paths)
                ? obj.paths.map((pathGrant) => StoragePathGrant.fromJSON(pathGrant))
                : undefined,
        });
    }
}

export class ContainerRegistryGrant {
    public list?: StringList;
    public pull?: StringList;
    public run?: StringList;
    public write?: StringList;

    constructor({
        list,
        pull,
        run,
        write,
    }: {
        list?: StringList;
        pull?: StringList;
        run?: StringList;
        write?: StringList;
    } = {}) {
        this.list = list;
        this.pull = pull;
        this.run = run;
        this.write = write;
    }

    canList(repository: string): boolean {
        if (this.list !== undefined) {
            return matchesGrantPattern(this.list, repository, false);
        }

        if (this.pull === undefined && this.run === undefined && this.write === undefined) {
            return true;
        }

        return [this.pull, this.run, this.write]
            .filter((patterns): patterns is StringList => patterns !== undefined)
            .some((patterns) => matchesGrantPattern(patterns, repository, false));
    }

    canPull(repository: string): boolean {
        return matchesGrantPattern(this.pull, repository, true);
    }

    canRun(repository: string): boolean {
        return matchesGrantPattern(this.run, repository, true);
    }

    canWrite(repository: string): boolean {
        return matchesGrantPattern(this.write, repository, true);
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.list !== undefined) {
            json["list"] = this.list;
        }
        if (this.pull !== undefined) {
            json["pull"] = this.pull;
        }
        if (this.run !== undefined) {
            json["run"] = this.run;
        }
        if (this.write !== undefined) {
            json["write"] = this.write;
        }
        return json;
    }

    static fromJSON(obj: unknown): ContainerRegistryGrant {
        if (!isRecord(obj)) {
            return new ContainerRegistryGrant();
        }

        return new ContainerRegistryGrant({
            list: asStringList(obj.list),
            pull: asStringList(obj.pull),
            run: asStringList(obj.run),
            write: asStringList(obj.write),
        });
    }
}

export class ContainersGrant {
    public logs: boolean;
    public pull?: StringList;
    public run?: StringList;
    public registry?: ContainerRegistryGrant;
    public useContainers: boolean;

    constructor({
        logs,
        pull,
        run,
        registry,
        useContainers,
    }: {
        logs?: boolean;
        pull?: StringList;
        run?: StringList;
        registry?: ContainerRegistryGrant;
        useContainers?: boolean;
    } = {}) {
        this.logs = logs ?? true;
        this.pull = pull;
        this.run = run;
        this.registry = registry;
        this.useContainers = useContainers ?? true;
    }

    canPull(tag: string): boolean {
        return matchesGrantPattern(this.pull, tag, true);
    }

    canRun(tag: string): boolean {
        return matchesGrantPattern(this.run, tag, true);
    }

    canRegistryList(repository: string): boolean {
        if (this.registry === undefined) {
            return true;
        }

        return this.registry.canList(repository);
    }

    canRegistryPull(repository: string): boolean {
        if (this.registry === undefined) {
            return true;
        }

        return this.registry.canPull(repository);
    }

    canRegistryRun(repository: string): boolean {
        if (this.registry === undefined) {
            return true;
        }

        return this.registry.canRun(repository);
    }

    canRegistryWrite(repository: string): boolean {
        if (this.registry === undefined) {
            return true;
        }

        return this.registry.canWrite(repository);
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.logs !== true) {
            json["logs"] = this.logs;
        }
        if (this.pull !== undefined) {
            json["pull"] = this.pull;
        }
        if (this.run !== undefined) {
            json["run"] = this.run;
        }
        if (this.registry !== undefined) {
            json["registry"] = this.registry.toJSON();
        }
        if (this.useContainers !== true) {
            json["use_containers"] = this.useContainers;
        }
        return json;
    }

    static fromJSON(obj: unknown): ContainersGrant {
        if (!isRecord(obj)) {
            return new ContainersGrant();
        }

        return new ContainersGrant({
            logs: obj.logs,
            pull: asStringList(obj.pull),
            run: asStringList(obj.run),
            registry: obj.registry ? ContainerRegistryGrant.fromJSON(obj.registry) : undefined,
            useContainers: obj.use_containers ?? obj.useContainers,
        });
    }
}

export class DeveloperGrant {
    public logs: boolean;

    constructor({ logs }: { logs?: boolean } = {}) {
        this.logs = logs ?? true;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.logs !== true) {
            json["logs"] = this.logs;
        }
        return json;
    }

    static fromJSON(obj: unknown): DeveloperGrant {
        if (!isRecord(obj)) {
            return new DeveloperGrant();
        }

        return new DeveloperGrant({
            logs: obj.logs,
        });
    }
}

export class AdminGrant {
    public config: boolean;

    constructor({ config }: { config?: boolean } = {}) {
        this.config = config ?? true;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.config !== true) {
            json["config"] = this.config;
        }
        return json;
    }

    static fromJSON(obj: unknown): AdminGrant {
        if (!isRecord(obj)) {
            return new AdminGrant();
        }

        return new AdminGrant({
            config: obj.config,
        });
    }
}

export class OAuthEndpoint {
    public endpoint: string;
    public clientId: string;

    constructor({ endpoint, clientId }: { endpoint: string; clientId: string }) {
        this.endpoint = endpoint;
        this.clientId = clientId;
    }

    toJSON(): Record<string, any> {
        return {
            endpoint: this.endpoint,
            client_id: this.clientId,
        };
    }

    static fromJSON(obj: unknown): OAuthEndpoint {
        if (!isRecord(obj) || typeof obj.endpoint !== "string") {
            throw new Error("OAuthEndpoint requires an endpoint");
        }

        const clientId = obj.client_id ?? obj.clientId;
        if (typeof clientId !== "string") {
            throw new Error("OAuthEndpoint requires a client_id");
        }

        return new OAuthEndpoint({
            endpoint: obj.endpoint,
            clientId,
        });
    }
}

export class SecretsGrant {
    public requestOauthToken?: OAuthEndpoint[];

    constructor({ requestOauthToken }: { requestOauthToken?: OAuthEndpoint[] } = {}) {
        this.requestOauthToken = requestOauthToken;
    }

    canRequestOauthToken({
        connector,
        oauth,
    }: {
        connector?: ConnectorRef | null;
        oauth?: OAuthClientConfig | null;
    } = {}): boolean {
        void connector;

        if (this.requestOauthToken === undefined) {
            return true;
        }

        const authorizationEndpoint = typeof oauth?.authorization_endpoint === "string"
            ? oauth.authorization_endpoint.trim()
            : "";
        const clientId = typeof oauth?.client_id === "string"
            ? oauth.client_id.trim()
            : "";

        if (authorizationEndpoint === "" || clientId === "") {
            return false;
        }

        return this.requestOauthToken.some((endpointGrant) => (
            (
                endpointGrant.endpoint === authorizationEndpoint
                || (
                    endpointGrant.endpoint.endsWith("*")
                    && authorizationEndpoint.startsWith(endpointGrant.endpoint.slice(0, -1))
                )
            )
            && endpointGrant.clientId === clientId
        ));
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.requestOauthToken !== undefined) {
            json["request_oauth_token"] = this.requestOauthToken.map((endpointGrant) => endpointGrant.toJSON());
        }
        return json;
    }

    static fromJSON(obj: unknown): SecretsGrant {
        if (!isRecord(obj)) {
            return new SecretsGrant();
        }

        const requestOauthToken = obj.request_oauth_token ?? obj.requestOauthToken;
        return new SecretsGrant({
            requestOauthToken: Array.isArray(requestOauthToken)
                ? requestOauthToken.map((endpointGrant) => OAuthEndpoint.fromJSON(endpointGrant))
                : undefined,
        });
    }
}

export class TunnelsGrant {
    public ports?: StringList;

    constructor({ ports }: { ports?: StringList } = {}) {
        this.ports = ports;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.ports !== undefined) {
            json["ports"] = this.ports;
        }
        return json;
    }

    static fromJSON(obj: unknown): TunnelsGrant {
        if (!isRecord(obj)) {
            return new TunnelsGrant();
        }

        return new TunnelsGrant({
            ports: asStringList(obj.ports),
        });
    }
}

export class ServicesGrant {
    public list: boolean;

    constructor({ list }: { list?: boolean } = {}) {
        this.list = list ?? true;
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.list !== true) {
            json["list"] = this.list;
        }
        return json;
    }

    static fromJSON(obj: unknown): ServicesGrant {
        if (!isRecord(obj)) {
            return new ServicesGrant();
        }

        return new ServicesGrant({
            list: obj.list,
        });
    }
}

export class LLMGrant {
    public models?: StringList;

    constructor({ models }: { models?: StringList } = {}) {
        this.models = models;
    }

    canUseProvider(provider: string): boolean {
        const normalizedProvider = provider.trim();
        if (normalizedProvider === "") {
            return false;
        }
        if (!this.models) {
            return true;
        }

        const prefix = `${normalizedProvider}/`;
        return this.models.some((pattern) => pattern.trim().startsWith(prefix));
    }

    canUseModel(provider: string, model: string): boolean {
        const normalizedProvider = provider.trim();
        const normalizedModel = model.trim();
        if (normalizedProvider === "" || normalizedModel === "") {
            return false;
        }

        return matchesGrantPattern(this.models, `${normalizedProvider}/${normalizedModel}`, true);
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.models !== undefined) {
            json["models"] = this.models;
        }
        return json;
    }

    static fromJSON(obj: unknown): LLMGrant {
        if (!isRecord(obj)) {
            return new LLMGrant();
        }

        return new LLMGrant({
            models: asStringList(obj.models),
        });
    }
}

export class ApiScope {
    public livekit?: LivekitGrant;
    public queues?: QueuesGrant;
    public messaging?: MessagingGrant;
    public database?: DatabaseGrant;
    public memory?: MemoryGrant;
    public sync?: SyncGrant;
    public storage?: StorageGrant;
    public containers?: ContainersGrant;
    public developer?: DeveloperGrant;
    public agents?: AgentsGrant;
    public llm?: LLMGrant;
    public admin?: AdminGrant;
    public secrets?: SecretsGrant;
    public tunnels?: TunnelsGrant;
    public services?: ServicesGrant;

    constructor({
        livekit,
        queues,
        messaging,
        database,
        memory,
        sync,
        storage,
        containers,
        developer,
        agents,
        llm,
        admin,
        secrets,
        tunnels,
        services,
    }: {
        livekit?: LivekitGrant;
        queues?: QueuesGrant;
        messaging?: MessagingGrant;
        database?: DatabaseGrant;
        memory?: MemoryGrant;
        sync?: SyncGrant;
        storage?: StorageGrant;
        containers?: ContainersGrant;
        developer?: DeveloperGrant;
        agents?: AgentsGrant;
        llm?: LLMGrant;
        admin?: AdminGrant;
        secrets?: SecretsGrant;
        tunnels?: TunnelsGrant;
        services?: ServicesGrant;
    } = {}) {
        this.livekit = livekit;
        this.queues = queues;
        this.messaging = messaging;
        this.database = database;
        this.memory = memory;
        this.sync = sync;
        this.storage = storage;
        this.containers = containers;
        this.developer = developer;
        this.agents = agents;
        this.llm = llm;
        this.admin = admin;
        this.secrets = secrets;
        this.tunnels = tunnels;
        this.services = services;
    }

    static agentDefault({ tunnels = false }: { tunnels?: boolean } = {}): ApiScope {
        return new ApiScope({
            livekit: new LivekitGrant(),
            queues: new QueuesGrant(),
            messaging: new MessagingGrant(),
            database: new DatabaseGrant(),
            memory: new MemoryGrant(),
            sync: new SyncGrant(),
            storage: new StorageGrant(),
            containers: new ContainersGrant(),
            developer: new DeveloperGrant(),
            agents: new AgentsGrant(),
            llm: new LLMGrant(),
            secrets: new SecretsGrant(),
            services: new ServicesGrant(),
            tunnels: tunnels ? new TunnelsGrant() : undefined,
        });
    }

    static userDefault(): ApiScope {
        return new ApiScope({
            livekit: new LivekitGrant(),
            queues: new QueuesGrant(),
            messaging: new MessagingGrant(),
            database: new DatabaseGrant(),
            memory: new MemoryGrant(),
            sync: new SyncGrant(),
            storage: new StorageGrant(),
            containers: new ContainersGrant(),
            developer: new DeveloperGrant(),
            agents: new AgentsGrant(),
            secrets: new SecretsGrant(),
            services: new ServicesGrant(),
        });
    }

    static full(): ApiScope {
        return new ApiScope({
            livekit: new LivekitGrant(),
            queues: new QueuesGrant(),
            messaging: new MessagingGrant(),
            database: new DatabaseGrant(),
            memory: new MemoryGrant(),
            sync: new SyncGrant(),
            storage: new StorageGrant(),
            containers: new ContainersGrant(),
            developer: new DeveloperGrant(),
            agents: new AgentsGrant(),
            llm: new LLMGrant(),
            admin: new AdminGrant(),
            secrets: new SecretsGrant(),
            tunnels: new TunnelsGrant(),
            services: new ServicesGrant(),
        });
    }

    toJSON(): Record<string, any> {
        const json: Record<string, any> = {};
        if (this.livekit !== undefined) {
            json["livekit"] = this.livekit.toJSON();
        }
        if (this.queues !== undefined) {
            json["queues"] = this.queues.toJSON();
        }
        if (this.messaging !== undefined) {
            json["messaging"] = this.messaging.toJSON();
        }
        if (this.database !== undefined) {
            json["database"] = this.database.toJSON();
        }
        if (this.memory !== undefined) {
            json["memory"] = this.memory.toJSON();
        }
        if (this.sync !== undefined) {
            json["sync"] = this.sync.toJSON();
        }
        if (this.storage !== undefined) {
            json["storage"] = this.storage.toJSON();
        }
        if (this.containers !== undefined) {
            json["containers"] = this.containers.toJSON();
        }
        if (this.developer !== undefined) {
            json["developer"] = this.developer.toJSON();
        }
        if (this.agents !== undefined) {
            json["agents"] = this.agents.toJSON();
        }
        if (this.llm !== undefined) {
            json["llm"] = this.llm.toJSON();
        }
        if (this.admin !== undefined) {
            json["admin"] = this.admin.toJSON();
        }
        if (this.secrets !== undefined) {
            json["secrets"] = this.secrets.toJSON();
        }
        if (this.tunnels !== undefined) {
            json["tunnels"] = this.tunnels.toJSON();
        }
        if (this.services !== undefined) {
            json["services"] = this.services.toJSON();
        }
        return json;
    }

    static fromJSON(obj: unknown): ApiScope {
        if (!isRecord(obj)) {
            return new ApiScope();
        }

        return new ApiScope({
            livekit: obj.livekit ? LivekitGrant.fromJSON(obj.livekit) : undefined,
            queues: obj.queues ? QueuesGrant.fromJSON(obj.queues) : undefined,
            messaging: obj.messaging ? MessagingGrant.fromJSON(obj.messaging) : undefined,
            database: obj.database ? DatabaseGrant.fromJSON(obj.database) : undefined,
            memory: obj.memory ? MemoryGrant.fromJSON(obj.memory) : undefined,
            sync: obj.sync ? SyncGrant.fromJSON(obj.sync) : undefined,
            storage: obj.storage ? StorageGrant.fromJSON(obj.storage) : undefined,
            containers: obj.containers ? ContainersGrant.fromJSON(obj.containers) : undefined,
            developer: obj.developer ? DeveloperGrant.fromJSON(obj.developer) : undefined,
            agents: obj.agents ? AgentsGrant.fromJSON(obj.agents) : undefined,
            llm: obj.llm ? LLMGrant.fromJSON(obj.llm) : undefined,
            admin: obj.admin ? AdminGrant.fromJSON(obj.admin) : undefined,
            secrets: obj.secrets ? SecretsGrant.fromJSON(obj.secrets) : undefined,
            tunnels: obj.tunnels ? TunnelsGrant.fromJSON(obj.tunnels) : undefined,
            services: obj.services ? ServicesGrant.fromJSON(obj.services) : undefined,
        });
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
                scope: this.scope.toJSON(),
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
    const pa = a.split(".").map((value) => parseInt(value, 10));
    const pb = b.split(".").map((value) => parseInt(value, 10));
    for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
        const left = pa[index] || 0;
        const right = pb[index] || 0;
        if (left !== right) {
            return left - right;
        }
    }
    return 0;
}

export class ParticipantToken {
    public name: string;
    public projectId?: string;
    public apiKeyId?: string;
    public version: string;
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
        this.version = version ?? __version__;
        this.extra = extra ?? {};
        this.grants = grants ?? [];
    }

    get role(): string {
        for (const grant of this.grants) {
            if (grant.name === "role" && grant.scope !== "user") {
                return String(grant.scope);
            }
        }

        return "user";
    }

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

    addTunnelGrant(ports: number[]): void {
        this.grants.push(new ParticipantGrant({
            name: "tunnel_ports",
            scope: ports.join(","),
        }));
    }

    addRoleGrant(role: string): void {
        this.grants.push(new ParticipantGrant({ name: "role", scope: role }));
    }

    addRoomGrant(roomName: string): void {
        this.grants.push(new ParticipantGrant({ name: "room", scope: roomName }));
    }

    addApiGrant(grant: ApiScope): void {
        for (const existingGrant of this.grants) {
            if (existingGrant.name === "api") {
                throw new Error("can only have a single api grant");
            }
        }

        this.grants.push(new ParticipantGrant({ name: "api", scope: grant }));
    }

    grantScope(name: string): string | ApiScope | undefined {
        return this.grants.find((grant) => grant.name === name)?.scope;
    }

    getApiGrant(): ApiScope | undefined {
        const apiGrant = this.grantScope("api");
        if (apiGrant && typeof apiGrant !== "string") {
            return apiGrant;
        }

        return undefined;
    }

    toJson(): Record<string, any> {
        const json: Record<string, any> = {
            ...(this.extra ?? {}),
            name: this.name,
            grants: this.grants.map((grant) => grant.toJson()),
        };

        if (this.projectId !== undefined) {
            json["sub"] = this.projectId;
        }
        if (this.apiKeyId !== undefined) {
            json["kid"] = this.apiKeyId;
        }
        if (this.version !== undefined) {
            json["version"] = this.version;
        }

        return json;
    }

    public async toJwt({
        token,
        expiration,
        apiKey,
    }: {
        token?: string;
        expiration?: Date;
        apiKey?: string;
    } = {}): Promise<string> {
        const apiGrant = this.grants.find((grant) => grant.name === "api");
        if (!apiGrant && compareSemver(this.version, "0.3.5") > 0) {
            console.warn(
                "there is no ApiScope in the participant token, this participant will not be able to make calls to the the room API. Use addApiGrant to add an ApiScope to this token.",
            );
        }

        const payload: JWTPayload = this.toJson();
        const resolvedApiKey = apiKey ?? getEnvValue("MESHAGENT_API_KEY");

        let resolvedSecret = token;
        if (resolvedApiKey !== undefined) {
            const parsed = parseApiKey(resolvedApiKey);
            resolvedSecret = parsed.secret;
            payload["kid"] = parsed.id;
            payload["sub"] = parsed.projectId;
        } else if (resolvedSecret === undefined) {
            delete payload["kid"];
        }

        if (resolvedSecret === undefined) {
            resolvedSecret = getEnvValue("MESHAGENT_SECRET");
        }
        if (resolvedSecret === undefined) {
            throw new Error(
                "ParticipantToken.toJwt: No secret provided. Pass `token`, `apiKey`, or set MESHAGENT_SECRET / MESHAGENT_API_KEY.",
            );
        }

        if (expiration !== undefined) {
            payload.exp = Math.floor(expiration.getTime() / 1000);
        }

        const secretKey = new TextEncoder().encode(resolvedSecret);
        return await new SignJWT(payload)
            .setProtectedHeader({ alg: "HS256", typ: "JWT" })
            .sign(secretKey);
    }

    static fromJson(json: Record<string, any>): ParticipantToken {
        const data = { ...json };
        if (typeof data.name !== "string") {
            throw new Error(`Participant token does not have a name ${JSON.stringify(json)}`);
        }

        const name = data.name;
        delete data.name;

        const grantsRaw = Array.isArray(data.grants) ? data.grants : [];
        delete data.grants;

        const projectId = typeof data.sub === "string" ? data.sub : undefined;
        delete data.sub;

        const apiKeyId = typeof data.kid === "string" ? data.kid : undefined;
        delete data.kid;

        const version = typeof data.version === "string" ? data.version : __version__;
        delete data.version;

        return new ParticipantToken({
            name,
            projectId,
            apiKeyId,
            grants: grantsRaw.map((grant) => ParticipantGrant.fromJson(grant as Record<string, any>)),
            extra: data,
            version,
        });
    }

    static async fromJwt(
        jwtStr: string,
        options: { token?: string; verify?: boolean } = {},
    ): Promise<ParticipantToken> {
        const { token, verify = true } = options;

        if (verify) {
            const verificationToken = token ?? getEnvValue("MESHAGENT_SECRET");
            if (verificationToken === undefined) {
                throw new Error("Failed to verify JWT: no token provided");
            }

            const secretKey = new TextEncoder().encode(verificationToken);
            const { payload } = await jwtVerify(jwtStr, secretKey, {
                algorithms: ["HS256"],
            });
            return ParticipantToken.fromJson(payload as Record<string, any>);
        }

        try {
            return ParticipantToken.fromJson(decodeJwt(jwtStr) as Record<string, any>);
        } catch {
            throw new Error("Failed to decode JWT");
        }
    }
}
