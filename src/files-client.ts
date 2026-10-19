import { FILE_ACTIONS as fileActions, validateFilePath as canonicalPath } from "./file-permissions.js";
import type { FileAction } from "./file-permissions.js";
export { FilePathRule, FilesPolicy } from "./file-permissions.js";
export type { FileAction, FileRole } from "./file-permissions.js";
import { RoomException } from "./requirement.js";
import { StorageEntry } from "./storage-client.js";

export type FilesTargetKind = "room" | "agent";
export type PresignedFileMethod = "GET" | "HEAD" | "PUT" | "DELETE";



function component(value: string): string {
    if (typeof value !== "string" || !value || value === "." || value === ".." || /[/\\\x00-\x1f\x7f-\x9f]/.test(value)) {
        throw new TypeError("Files identifiers must be single path components");
    }
    return value;
}


export class FilesTarget {
    readonly projectId: string;
    readonly kind: FilesTargetKind;
    readonly name: string;

    constructor({ projectId, kind, name }: { projectId: string; kind: FilesTargetKind; name: string }) {
        this.projectId = component(projectId);
        this.name = component(name);
        if (kind !== "room" && kind !== "agent") throw new TypeError("Expected room or agent files target");
        this.kind = kind;
        Object.freeze(this);
    }

    toJson(): { project_id: string; kind: FilesTargetKind; name: string } {
        return { project_id: this.projectId, kind: this.kind, name: this.name };
    }
}

export class FileLocation {
    readonly target: FilesTarget;
    readonly path: string;

    constructor({ target, path }: { target: FilesTarget; path: string }) {
        this.target = new FilesTarget(target);
        this.path = canonicalPath(path);
        Object.freeze(this);
    }

    toJson(): { target: ReturnType<FilesTarget["toJson"]>; path: string } {
        return { target: this.target.toJson(), path: this.path };
    }
}

export interface FilePermissions {
    readonly actions: readonly FileAction[];
    readonly recursiveActions: readonly FileAction[];
}
export interface FilesPage {
    readonly entries: readonly StorageEntry[];
    readonly continuationToken: string | null;
}
export interface FileMetadata {
    readonly path: string;
    readonly size: number;
    readonly isFolder: boolean;
    readonly contentType: string | null;
    readonly etag: string | null;
    readonly lastModified: string | null;
}
export interface PresignedFileUrl {
    readonly url: string;
    readonly method: PresignedFileMethod;
    readonly headers: Readonly<Record<string, string>>;
    readonly expiresAt: Date;
}
export interface MeshagentDomains {
    studio?: string | null;
    accounts?: string | null;
    powerboards?: string | null;
    api?: string | null;
    mail?: string | null;
    pages?: string | null;
    registry?: string | null;
    files?: string | null;
}
export interface MeshagentDeploymentConfig {
    domains: MeshagentDomains;
    version?: string | null;
}

export class FilesApiError extends RoomException {
    constructor(message: string, readonly status?: number, readonly code?: string) {
        super(message);
        this.name = "FilesApiError";
    }
}

export interface FilesTransport {
    getConfig(options?: { signal?: AbortSignal }): Promise<MeshagentDeploymentConfig>;
    send(url: string, init: RequestInit): Promise<Response>;
}

function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new FilesApiError("Invalid files JSON response");
    return value as Record<string, unknown>;
}
function string(value: unknown): string {
    if (typeof value !== "string") throw new FilesApiError("Invalid files string field");
    return value;
}
function optionalString(value: unknown): string | null {
    return value == null ? null : string(value);
}
function size(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new FilesApiError("Invalid files size field");
    return value;
}
function timestamp(value: unknown): Date | null {
    if (value == null) return null;
    const result = new Date(string(value));
    if (Number.isNaN(result.getTime())) throw new FilesApiError("Invalid files timestamp field");
    return result;
}
function actions(value: unknown): readonly FileAction[] {
    if (!Array.isArray(value) || !value.every(action => fileActions.includes(action))) throw new FilesApiError("Invalid files actions");
    return Object.freeze([...value] as FileAction[]);
}

export async function readFilesControlResponse(response: Response, limit = 1024 * 1024): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new FilesApiError("Missing files control response");
    const chunks: Uint8Array[] = [];
    let length = 0;
    let done = false;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) { done = true; break; }
            length += next.value.length;
            if (length > limit) throw new FilesApiError("Files control response exceeds its size limit");
            chunks.push(next.value);
        }
    } finally {
        if (!done) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export function parseFilesDeploymentConfig(value: unknown): MeshagentDeploymentConfig {
    const data = record(value);
    const source = record(data.domains);
    const domains: MeshagentDomains = {};
    for (const key of ["studio", "accounts", "powerboards", "api", "mail", "pages", "registry", "files"] as const) {
        if (source[key] !== undefined) domains[key] = optionalString(source[key]);
    }
    return { domains, version: optionalString(data.version) };
}

/** Shares the parent Meshagent client's transport and current credentials. */
export class FilesClient {
    private endpointPromise?: Promise<string>;
    constructor(private readonly transport: FilesTransport) {}

    forRoom({ projectId, roomName }: { projectId: string; roomName: string }): TargetFilesClient {
        return this.forTarget(new FilesTarget({ projectId, kind: "room", name: roomName }));
    }
    forAgent({ projectId, agentName }: { projectId: string; agentName: string }): TargetFilesClient {
        return this.forTarget(new FilesTarget({ projectId, kind: "agent", name: agentName }));
    }
    forTarget(target: FilesTarget): TargetFilesClient {
        return new TargetFilesClient(this, new FilesTarget(target));
    }

    private async discover(): Promise<string> {
        const domain = (await this.transport.getConfig()).domains.files;
        if (!domain) throw new FilesApiError("The files API is unavailable: deployment config has no domains.files");
        const url = new URL(domain.includes("://") ? domain : `https://${domain}`);
        if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || domain.includes("?") || domain.includes("#")) {
            throw new FilesApiError("Deployment config contains an invalid files endpoint");
        }
        return url.toString().replace(/\/+$/, "");
    }
    private endpoint(): Promise<string> {
        if (!this.endpointPromise) this.endpointPromise = this.discover().catch(error => { this.endpointPromise = undefined; throw error; });
        return this.endpointPromise;
    }
    async url(target: FilesTarget, path: string, query: Record<string, string> = {}): Promise<string> {
        canonicalPath(path);
        const namespace = target.kind === "room" ? "rooms" : "agents";
        const url = new URL(`${await this.endpoint()}/${encodeURIComponent(target.projectId)}/${namespace}/${encodeURIComponent(target.name)}/${path.split("/").map(encodeURIComponent).join("/")}`);
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
        return url.toString();
    }
    async send(url: string, init: RequestInit): Promise<Response> {
        const response = await this.transport.send(url, { ...init, redirect: "error" });
        if (response.status >= 200 && response.status < 300) return response;
        let message = `Files request failed with HTTP ${response.status}`;
        let code: string | undefined;
        if (response.body) {
            try {
                const body = record(await readFilesControlResponse(response, 64 * 1024));
                const error = body.error === undefined ? body : record(body.error);
                if (typeof error.message === "string") message = error.message;
                if (typeof error.code === "string") code = error.code;
            } catch { /* Preserve the HTTP failure when the error body is malformed. */ }
        }
        throw new FilesApiError(message, response.status, code);
    }
    async json(url: string, init: RequestInit): Promise<Record<string, unknown>> {
        return record(await readFilesControlResponse(await this.send(url, init)));
    }
    async presignUrl(): Promise<string> { return `${await this.endpoint()}/v1/presign`; }
}

export type FilesUpload = Uint8Array | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

function uploadBody(data: FilesUpload): { body: RequestInit["body"]; streaming: boolean } {
    if (data instanceof Uint8Array) return { body: new Uint8Array(data).buffer, streaming: false };
    if (Symbol.asyncIterator in data) {
        const iterator = data[Symbol.asyncIterator]();
        return { streaming: true, body: new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    const next = await iterator.next();
                    if (next.done) controller.close(); else controller.enqueue(next.value);
                } catch (error) { controller.error(error); }
            },
            async cancel() { await iterator.return?.(); },
        }) };
    }
    return { body: data, streaming: true };
}

export class TargetFilesClient {
    constructor(private readonly files: FilesClient, readonly target: FilesTarget) {}

    location(path: string): FileLocation { return new FileLocation({ target: this.target, path }); }
    async permissions(path = "", { signal }: { signal?: AbortSignal } = {}): Promise<FilePermissions> {
        const data = await this.files.json(await this.files.url(this.target, path, { permissions: "" }), { method: "GET", signal });
        return { actions: actions(data.actions), recursiveActions: actions(data.recursive_actions) };
    }
    async listPage({ path = "", continuationToken, limit = 1000, signal }: { path?: string; continuationToken?: string | null; limit?: number; signal?: AbortSignal } = {}): Promise<FilesPage> {
        canonicalPath(path);
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError("Files listing limit must be between 1 and 1000");
        const query: Record<string, string> = { list: "", prefix: path, limit: String(limit) };
        if (continuationToken != null) query.continuation_token = continuationToken;
        const data = await this.files.json(await this.files.url(this.target, "", query), { method: "GET", signal });
        if (!Array.isArray(data.entries)) throw new FilesApiError("Invalid files listing");
        const entries = data.entries.map(value => {
            const entry = record(value);
            if (typeof entry.is_folder !== "boolean") throw new FilesApiError("Invalid files entry kind");
            return new StorageEntry({ name: component(string(entry.name)), isFolder: entry.is_folder, size: entry.size == null ? null : size(entry.size), createdAt: timestamp(entry.created_at), updatedAt: timestamp(entry.updated_at) });
        });
        return { entries, continuationToken: optionalString(data.continuation_token) };
    }
    async *list(path = "", { signal }: { signal?: AbortSignal } = {}): AsyncGenerator<StorageEntry> {
        let token: string | null = null;
        const seen = new Set<string>();
        do {
            const page = await this.listPage({ path, continuationToken: token, signal });
            yield* page.entries;
            token = page.continuationToken;
            if (token !== null && seen.has(token)) throw new FilesApiError("Files server returned a repeated pagination token");
            if (token !== null) seen.add(token);
        } while (token !== null);
    }
    async stat(path: string, { signal }: { signal?: AbortSignal } = {}): Promise<FileMetadata> {
        const response = await this.files.send(await this.files.url(this.target, path), { method: "HEAD", signal });
        await response.body?.cancel();
        const rawSize = response.headers.get("content-length") ?? "0";
        if (!/^\d+$/.test(rawSize)) throw new FilesApiError("Invalid files content length");
        return { path, size: size(Number(rawSize)), isFolder: response.headers.get("x-meshagent-is-folder") === "true", contentType: response.headers.get("content-type"), etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
    }
    async exists(path: string, options: { signal?: AbortSignal } = {}): Promise<boolean> {
        try { await this.stat(path, options); return true; }
        catch (error) { if (error instanceof FilesApiError && error.status === 404) return false; throw error; }
    }
    async *downloadStream(path: string, { signal }: { signal?: AbortSignal } = {}): AsyncGenerator<Uint8Array> {
        const response = await this.files.send(await this.files.url(this.target, path), { method: "GET", signal });
        const reader = response.body?.getReader();
        if (!reader) return;
        let done = false;
        try {
            while (true) {
                const next = await reader.read();
                if (next.done) { done = true; return; }
                yield next.value;
            }
        } finally {
            if (!done) await reader.cancel().catch(() => undefined);
            reader.releaseLock();
        }
    }
    /** Buffers the complete file. Use downloadStream for large files. */
    async download(path: string, options: { signal?: AbortSignal } = {}): Promise<Uint8Array> {
        const chunks: Uint8Array[] = [];
        let length = 0;
        for await (const chunk of this.downloadStream(path, options)) { chunks.push(chunk); length += chunk.length; }
        const result = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
        return result;
    }
    async upload(path: string, data: FilesUpload, { contentType = "application/octet-stream", overwrite = true, signal }: { contentType?: string; overwrite?: boolean; signal?: AbortSignal } = {}): Promise<void> {
        const input = uploadBody(data);
        const options: RequestInit & { duplex?: "half" } = { method: "PUT", headers: { "Content-Type": contentType }, body: input.body, signal };
        if (input.streaming) options.duplex = "half";
        const response = await this.files.send(await this.files.url(this.target, path, { overwrite: String(overwrite) }), options);
        await response.body?.cancel();
    }
    async delete(path: string, { recursive = false, signal }: { recursive?: boolean; signal?: AbortSignal } = {}): Promise<void> {
        const response = await this.files.send(await this.files.url(this.target, path, { recursive: String(recursive) }), { method: "DELETE", signal });
        await response.body?.cancel();
    }
    async mkdir(path: string, options: { signal?: AbortSignal } = {}): Promise<void> { await this.action(path, "mkdir", {}, options); }
    async copy(source: FileLocation, destination: string, { overwrite = false, signal }: { overwrite?: boolean; signal?: AbortSignal } = {}): Promise<void> {
        await this.action(destination, "copy", { source: new FileLocation(source).toJson(), overwrite }, { signal });
    }
    async move(source: FileLocation, destination: string, { overwrite = false, signal }: { overwrite?: boolean; signal?: AbortSignal } = {}): Promise<void> {
        await this.action(destination, "move", { source: new FileLocation(source).toJson(), overwrite }, { signal });
    }
    private async action(path: string, action: string, body: Record<string, unknown>, { signal }: { signal?: AbortSignal }): Promise<void> {
        const response = await this.files.send(await this.files.url(this.target, path, { action }), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
        await response.body?.cancel();
    }
    async presign(path: string, { method = "GET", expiresIn = 3600, signal }: { method?: PresignedFileMethod; expiresIn?: number; signal?: AbortSignal } = {}): Promise<PresignedFileUrl> {
        canonicalPath(path);
        if (!["GET", "HEAD", "PUT", "DELETE"].includes(method) || !Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 604800) throw new TypeError("Invalid presigned URL method or lifetime");
        const data = await this.files.json(await this.files.presignUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: this.target.toJson(), path, method, expires_in: expiresIn }), signal });
        const signedMethod = string(data.method);
        if (!["GET", "HEAD", "PUT", "DELETE"].includes(signedMethod)) throw new FilesApiError("Invalid presigned URL method");
        const headers = record(data.headers ?? {});
        const parsedHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(headers)) parsedHeaders[key] = string(value);
        const expiresAt = timestamp(data.expires_at);
        if (!expiresAt) throw new FilesApiError("Missing presigned URL expiration");
        const url = string(data.url);
        if (!["http:", "https:"].includes(new URL(url).protocol)) throw new FilesApiError("Invalid presigned URL");
        return { url, method: signedMethod as PresignedFileMethod, headers: parsedHeaders, expiresAt };
    }
}
