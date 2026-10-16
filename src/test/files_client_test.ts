import assert from "node:assert/strict";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { once } from "node:events";
import { FilePathRule, FilesApiError, FilesPolicy, FilesTarget, Meshagent } from "../index.js";

interface Call { method: string; url: string; authorization: string | undefined; contentType: string | undefined; body: Uint8Array }

class Fixture {
    server: Server;
    baseUrl = "";
    discovery = 0;
    calls: Call[] = [];
    blobs = new Map<string, Uint8Array>();
    actions: unknown[] = [];
    repeatToken = false;
    uploadStarted!: () => void;
    uploadStartedPromise = new Promise<void>(resolve => { this.uploadStarted = resolve; });

    constructor() {
        this.server = createServer((request, response) => { void this.handle(request, response).catch(error => { response.destroy(error as Error); }); });
    }
    async start(): Promise<this> {
        this.server.listen(0, "127.0.0.1");
        await once(this.server, "listening");
        const address = this.server.address();
        assert.ok(address && typeof address !== "string");
        this.baseUrl = `http://127.0.0.1:${address.port}`;
        return this;
    }
    async close(): Promise<void> {
        this.server.closeAllConnections();
        await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
    }
    json(response: ServerResponse, value: unknown, status = 200): void {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
    }
    async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = new URL(request.url!, this.baseUrl);
        if (url.pathname === "/config") { this.discovery++; this.json(response, { domains: { files: this.baseUrl } }); return; }
        const chunks: Buffer[] = [];
        for await (const chunk of request) { chunks.push(Buffer.from(chunk)); if (request.method === "PUT") this.uploadStarted(); }
        const body = Buffer.concat(chunks);
        this.calls.push({ method: request.method!, url: request.url!, authorization: request.headers.authorization, contentType: request.headers["content-type"], body });
        const path = decodeURIComponent(url.pathname);
        if (path.endsWith("/denied")) { this.json(response, { error: { code: "denied", message: "Access denied" } }, 403); return; }
        if (path.endsWith("/unauthenticated")) { this.json(response, {}, 401); return; }
        if (path.endsWith("/redirect")) { response.writeHead(307, { Location: `${this.baseUrl}/unexpected` }); response.end(); return; }
        if (path === "/unexpected") throw new Error("Files client followed a redirect");
        if (path.endsWith("/slow")) {
            response.writeHead(200);
            response.write(new Uint8Array([0, 255]));
            return; // Closed by abort or fixture cleanup.
        }
        if (url.searchParams.has("permissions")) { this.json(response, { actions: ["list", "read"], recursive_actions: ["read"] }); return; }
        if (url.searchParams.has("list")) {
            const second = url.searchParams.has("continuation_token");
            this.json(response, { entries: [{ name: second ? "two.txt" : "one.txt", is_folder: false, size: 5, created_at: "2026-01-01T00:00:00Z" }], continuation_token: second && !this.repeatToken ? null : "page/2 +%" });
            return;
        }
        if (request.method === "POST") {
            assert.equal(request.headers["content-type"], "application/json");
            const action = JSON.parse(body.toString()) as Record<string, unknown>;
            this.actions.push(action);
            if (path === "/v1/presign") this.json(response, { url: `${this.baseUrl}/signed?X-Amz-Signature=signature`, method: action.method, headers: { "x-test": "value" }, expires_at: "2030-01-01T00:00:00Z" });
            else { response.writeHead(204); response.end(); }
            return;
        }
        if (request.method === "PUT") { this.blobs.set(path, body); response.writeHead(204); response.end(); return; }
        if (request.method === "DELETE") { this.blobs.delete(path); response.writeHead(204); response.end(); return; }
        const data = this.blobs.get(path);
        if (!data) { this.json(response, {}, 404); return; }
        response.writeHead(200, { "Content-Length": data.length, "Content-Type": "application/octet-stream", "ETag": '"v1"' });
        response.end(request.method === "HEAD" ? undefined : data);
    }
}

describe("files_client_test", () => {
    let fixture: Fixture;
    beforeEach(async () => { fixture = await new Fixture().start(); });
    afterEach(async () => { await fixture.close(); });

    it("streams encoded binary paths, isolates targets and reuses discovery/current credentials", async () => {
        let token = "first";
        const api = new Meshagent({ baseUrl: fixture.baseUrl, tokenProvider: () => token });
        const room = api.files.forRoom({ projectId: "p +%", roomName: "same" });
        const agent = api.files.forAgent({ projectId: "p +%", agentName: "same" });
        const path = "résumé +%/#?.bin";
        const bytes = new Uint8Array([0, 255, 128, 1]);
        await Promise.all([room.upload(path, bytes, { overwrite: false, contentType: "image/png" }), agent.upload("binary", bytes)]);
        assert.equal(fixture.discovery, 1);
        assert.deepEqual(await room.download(path), bytes);
        assert.deepEqual(await agent.download("binary"), bytes);
        const metadata = await room.stat(path);
        assert.equal(metadata.size, 4);
        assert.equal(metadata.etag, '"v1"');
        assert.equal(metadata.contentType, "application/octet-stream");
        assert.ok(fixture.calls.every(call => call.authorization === "Bearer first"));
        assert.ok(fixture.calls.some(call => call.url.includes("p%20%2B%25/rooms/same/r%C3%A9sum%C3%A9%20%2B%25/%23%3F.bin")));
        assert.ok(fixture.calls.some(call => call.contentType === "image/png" && call.url.endsWith("overwrite=false")));
        token = "second";
        await room.stat(path);
        assert.equal(fixture.calls.at(-1)!.authorization, "Bearer second");
        assert.equal(await agent.exists(path), false);
    });

    it("consumes uploads before the producer finishes and honors abort signals on downloads", async () => {
        const api = new Meshagent({ baseUrl: fixture.baseUrl, token: "secret" });
        const files = api.files.forAgent({ projectId: "p", agentName: "a" });
        let release!: () => void;
        const wait = new Promise<void>(resolve => { release = resolve; });
        async function* bytes(): AsyncGenerator<Uint8Array> { yield new Uint8Array([0, 255]); await wait; yield new Uint8Array([128]); }
        const upload = files.upload("binary", bytes());
        await fixture.uploadStartedPromise;
        release();
        await upload;
        assert.deepEqual(await files.download("binary"), new Uint8Array([0, 255, 128]));
        const abort = new AbortController();
        const stream = files.downloadStream("slow", { signal: abort.signal });
        assert.deepEqual((await stream.next()).value, new Uint8Array([0, 255]));
        abort.abort();
        await assert.rejects(stream.next(), error => error instanceof Error && error.name === "AbortError");
    });

    it("paginates opaque cursors, detects cycles and keeps cross-target operation payloads typed", async () => {
        const api = new Meshagent({ baseUrl: fixture.baseUrl, token: "secret" });
        const room = api.files.forRoom({ projectId: "source-project", roomName: "source" });
        const agent = api.files.forAgent({ projectId: "destination-project", agentName: "dest" });
        const entries = [];
        for await (const entry of agent.list("folder +%")) entries.push(entry);
        assert.deepEqual(entries.map(entry => entry.name), ["one.txt", "two.txt"]);
        assert.equal(entries[0].createdAt!.toISOString(), "2026-01-01T00:00:00.000Z");
        assert.ok(fixture.calls.some(call => new URL(call.url, fixture.baseUrl).searchParams.get("continuation_token") === "page/2 +%"));
        await agent.copy(room.location("source.txt"), "dest.txt");
        assert.deepEqual(fixture.actions.at(-1), { source: { target: { project_id: "source-project", kind: "room", name: "source" }, path: "source.txt" }, overwrite: false });
        await agent.move(room.location("source.txt"), "moved.txt", { overwrite: true });
        assert.equal(new URL(fixture.calls.at(-1)!.url, fixture.baseUrl).searchParams.get("action"), "move");
        await agent.mkdir("directory");
        await agent.delete("directory", { recursive: true });
        assert.equal(fixture.calls.at(-1)!.method, "DELETE");
        assert.ok(fixture.calls.at(-1)!.url.endsWith("recursive=true"));
        const signed = await agent.presign("upload", { method: "PUT", expiresIn: 60 });
        assert.deepEqual(fixture.actions.at(-1), { target: { project_id: "destination-project", kind: "agent", name: "dest" }, path: "upload", method: "PUT", expires_in: 60 });
        assert.equal(signed.method, "PUT");
        assert.equal(signed.expiresAt.toISOString(), "2030-01-01T00:00:00.000Z");
        assert.deepEqual(signed.headers, { "x-test": "value" });
        const permissions = await agent.permissions("somewhere");
        assert.deepEqual(permissions, { actions: ["list", "read"], recursiveActions: ["read"] });
        fixture.repeatToken = true;
        await assert.rejects(async () => { for await (const _entry of agent.list()) { /* exhaust */ } }, /repeated pagination token/);
    });

    it("only 404 means absent and redirects cannot forward credentials", async () => {
        const files = new Meshagent({ baseUrl: fixture.baseUrl, token: "secret" }).files.forRoom({ projectId: "p", roomName: "r" });
        assert.equal(await files.exists("missing"), false);
        for (const [path, status] of [["denied", 403], ["unauthenticated", 401]] as const) {
            await assert.rejects(files.exists(path), error => error instanceof FilesApiError && error.status === status);
        }
        await assert.rejects(files.exists("redirect"));
        assert.ok(fixture.calls.every(call => call.url !== "/unexpected"));
    });

    it("rejects invalid selectors, paths, config and request parameters before storage access", async () => {
        assert.throws(() => new FilesTarget({ projectId: "a/b", kind: "room", name: "r" }), TypeError);
        let discoveries = 0;
        let domain: string | undefined;
        const api = new Meshagent({ baseUrl: fixture.baseUrl, fetch: async url => { assert.equal(url, `${fixture.baseUrl}/config`); discoveries++; return Response.json({ domains: { files: domain } }); } });
        const files = api.files.forAgent({ projectId: "p", agentName: "a" });
        for (const value of [undefined, "ftp://files.test", "https://u:p@files.test", "https://files.test?", "https://files.test#"]) {
            domain = value;
            await assert.rejects(files.stat("valid"));
        }
        assert.equal(discoveries, 5);
        for (const path of ["/absolute", "../escape", "a//b", "a/./b", "a\\b", "a\u0085b", ".meshagent-directory", "a/.meshagent-upload-private"]) {
            await assert.rejects(files.stat(path), TypeError);
        }
        await assert.rejects(files.listPage({ limit: 0 }), TypeError);
        await assert.rejects(files.presign("file", { expiresIn: 0 }), TypeError);
        assert.equal(discoveries, 5);
    });

    it("cancels oversized control responses and cancelled downloads", async () => {
        let cancelled = false;
        let big = true;
        const api = new Meshagent({ baseUrl: fixture.baseUrl, fetch: async url => {
            if (url === `${fixture.baseUrl}/config`) return Response.json({ domains: { files: "https://files.test" } });
            return new Response(new ReadableStream<Uint8Array>({
                pull(controller) { controller.enqueue(new Uint8Array(big ? 1024 * 1024 + 1 : 3)); },
                cancel() { cancelled = true; },
            }));
        } });
        const files = api.files.forAgent({ projectId: "p", agentName: "a" });
        await assert.rejects(files.listPage(), /size limit/);
        assert.equal(cancelled, true);
        cancelled = false;
        big = false;
        for await (const _chunk of files.downloadStream("stream")) break;
        assert.equal(cancelled, true);
    });

    it("preserves excluded subtree and segment-boundary file policies", () => {
        const rule = new FilePathRule({ path: "reports", recursive: true, actions: ["read", "write"], excludedPaths: ["reports/private"] });
        const policy = new FilesPolicy({ paths: [rule] });
        assert.equal(policy.allows("write", "reports/public/file"), true);
        assert.equal(policy.allows("write", "reports/private/file"), false);
        assert.equal(policy.allows("read", "reports2/file"), false);
        assert.equal(policy.allows("write", "reports", { subtree: true }), false);
        assert.deepEqual(policy.toJson(), { paths: [{ path: "reports", recursive: true, actions: ["read", "write"], excluded_paths: ["reports/private"] }] });
    });
});
