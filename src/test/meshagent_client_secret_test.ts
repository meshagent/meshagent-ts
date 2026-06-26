import { expect } from "chai";

import { Meshagent } from "../index.js";

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
    } as unknown as Response;
}

describe("meshagent_client_secret_test", () => {
    it("getProjectByKey requests the project key endpoint", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ method: string; url: string }> = [];

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
            });

            return jsonResponse({ id: "proj_123", project_key: "team/app" });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            const project = await client.getProjectByKey("team/app");

            expect(project).to.deep.equal({ id: "proj_123", project_key: "team/app" });
            expect(calls).to.deep.equal([
                {
                    method: "GET",
                    url: "http://example.test/accounts/projects/by-key/team%2Fapp",
                },
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("uses v2 user and service account secret endpoints", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
        const secret = {
            id: "secret-1",
            project_id: "proj_123",
            owner_user_id: "user-1",
            type: "oauth",
            name: "github",
            http_only: true,
            metadata: { service: "github" },
            annotations: { "meshagent.io/secret.service": "github" },
            current_version_id: "version-1",
            value_base64: "dmFsdWU=",
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-01T00:00:00Z",
        };
        const version = {
            id: "version-1",
            secret_id: "secret-1",
            version: 1,
            encryption_key_id: "key-1",
            value_sha256: "BQ==",
            created_at: "2026-06-01T00:00:00Z",
        };

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
                body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
            });

            if (url.endsWith("/versions")) {
                return jsonResponse((init?.method ?? "GET") === "POST" ? version : { versions: [version] });
            }
            if (url.endsWith("/access")) {
                return jsonResponse({
                    access_grants: [{ subject: { type: "service_account", id: "sa-1" }, roles: ["use_proxy"] }],
                    continuation_token: null,
                });
            }
            if (url.endsWith("/pull-secrets")) {
                return jsonResponse({ secrets: [secret], continuation_token: null });
            }
            if ((init?.method ?? "GET") === "PUT" || (init?.method ?? "GET") === "DELETE") {
                return jsonResponse({}, 204);
            }
            if (url.includes(":search") || url.endsWith("/secrets")) {
                return jsonResponse((init?.method ?? "GET") === "GET" ? { secrets: [secret], continuation_token: "next" } : secret);
            }
            return jsonResponse(secret);
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            await client.createUserSecret({
                projectId: "proj_123",
                name: "github",
                type: "oauth",
                httpOnly: true,
                metadata: { service: "github" },
                annotations: { "meshagent.io/secret.service": "github" },
            });
            await client.listUserSecrets({ pageSize: 10, continuationToken: "cursor", filter: "github" });
            await client.searchUserSecrets({ name: "github", httpOnly: true, pageSize: 5 });
            await client.createUserSecretVersion("secret-1", {
                value: new Uint8Array([1, 2, 3]),
                setCurrent: false,
            });
            const fetchedUserSecret = await client.getUserSecret("secret-1", { includeValue: true });
            await client.listUserSecretProxyAccess("secret-1");
            await client.grantUserSecretProxyAccess("secret-1", "sa-1");
            await client.revokeUserSecretProxyAccess("secret-1", "sa-1");
            await client.createServiceAccountSecret("proj_123", "sa-1", { name: "pull", type: "opaque" });
            const fetchedServiceAccountSecret = await client.getServiceAccountSecret("proj_123", "sa-1", "secret-1", { includeValue: true });
            await client.listServiceAccountPullSecrets("proj_123", "sa-1");
            await client.addServiceAccountPullSecret("proj_123", "sa-1", "secret-1");
            await client.removeServiceAccountPullSecret("proj_123", "sa-1", "secret-1");

            expect(calls[0]).to.deep.include({
                method: "POST",
                url: "http://example.test/accounts/users/me/secrets",
            });
            expect(calls[0].body).to.deep.include({
                project_id: "proj_123",
                name: "github",
                type: "oauth",
                http_only: true,
            });
            expect(calls[1]).to.deep.include({
                method: "GET",
                url: "http://example.test/accounts/users/me/secrets?page_size=10&continuation_token=cursor&filter=github",
            });
            expect(calls[2].url).to.equal("http://example.test/accounts/users/me/secrets:search");
            expect(calls[2].body).to.deep.equal({
                page_size: 5,
                name: "github",
                http_only: true,
            });
            expect(calls[3].body).to.deep.equal({
                value_base64: "AQID",
                set_current: false,
            });
            expect(fetchedUserSecret.value_base64).to.equal("dmFsdWU=");
            expect(calls[4]).to.deep.include({
                method: "GET",
                url: "http://example.test/accounts/users/me/secrets/secret-1?include_value=true",
            });
            expect(calls[6].body).to.deep.equal({
                subject: { type: "service_account", id: "sa-1" },
            });
            expect(calls[8]).to.deep.include({
                method: "POST",
                url: "http://example.test/accounts/projects/proj_123/service-accounts/sa-1/secrets",
            });
            expect(fetchedServiceAccountSecret.value_base64).to.equal("dmFsdWU=");
            expect(calls[9]).to.deep.include({
                method: "GET",
                url: "http://example.test/accounts/projects/proj_123/service-accounts/sa-1/secrets/secret-1?include_value=true",
            });
            expect(calls[10]).to.deep.include({
                method: "GET",
                url: "http://example.test/accounts/projects/proj_123/service-accounts/sa-1/pull-secrets",
            });
            expect(calls[11]).to.deep.include({
                method: "PUT",
                url: "http://example.test/accounts/projects/proj_123/service-accounts/sa-1/pull-secrets/secret-1",
            });
            expect(calls[12]).to.deep.include({
                method: "DELETE",
                url: "http://example.test/accounts/projects/proj_123/service-accounts/sa-1/pull-secrets/secret-1",
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("createRoom does not serialize permission grants", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
                body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
            });

            return jsonResponse({ id: "room-1", name: "demo", metadata: {}, annotations: {} });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            await client.createRoom({
                projectId: "proj_123",
                name: "demo",
            });

            expect(calls).to.have.length(1);
            expect(calls[0].method).to.equal("POST");
            expect(calls[0].url).to.equal("http://example.test/accounts/projects/proj_123/rooms");
            expect(calls[0].body).to.include({
                name: "demo",
                if_not_exists: false,
            });
            expect(calls[0].body).not.to.have.property("permissions");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("lists scoped room and agent sessions", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ method: string; url: string }> = [];

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
            });

            return jsonResponse({
                sessions: [
                    {
                        id: "session-1",
                        room_name: "agent/name",
                        created_at: "2026-04-01T00:00:00Z",
                        is_active: false,
                        kind: "agent",
                        agent_id: "agent-1",
                        agent_name: "agent/name",
                    },
                ],
            });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            await client.listRecentRoomSessions("proj_123", "room/name", { limit: 12 });
            const agentSessions = await client.listRecentSingleAgentSessions("proj_123", "agent/name", { limit: 7 });

            expect(calls).to.deep.equal([
                {
                    method: "GET",
                    url: "http://example.test/accounts/projects/proj_123/rooms/room%2Fname/sessions?limit=12",
                },
                {
                    method: "GET",
                    url: "http://example.test/accounts/projects/proj_123/agents/agent%2Fname/sessions?limit=7",
                },
            ]);
            expect(agentSessions[0].kind).to.equal("agent");
            expect(agentSessions[0].agentId).to.equal("agent-1");
            expect(agentSessions[0].agentName).to.equal("agent/name");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("createOAuthClient parses wrapped client responses", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
                body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
            });

            return jsonResponse({
                client: {
                    client_id: "client-1",
                    client_secret: "secret-1",
                    grant_types: ["authorization_code"],
                    response_types: ["code"],
                    redirect_uris: ["https://example.test/callback"],
                    scope: "rooms:read",
                    project_id: "proj_123",
                    metadata: { name: "smoke" },
                    official: true,
                },
            });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            const oauthClient = await client.createOAuthClient("proj_123", {
                grantTypes: ["authorization_code"],
                responseTypes: ["code"],
                redirectUris: ["https://example.test/callback"],
                scope: "rooms:read",
                metadata: { name: "smoke" },
                official: true,
            });

            expect(oauthClient.clientId).to.equal("client-1");
            expect(oauthClient.official).to.equal(true);
            expect(calls).to.have.length(1);
            expect(calls[0].method).to.equal("POST");
            expect(calls[0].url).to.equal("http://example.test/accounts/projects/proj_123/oauth/clients");
            expect(calls[0].body).to.deep.include({
                scope: "rooms:read",
                official: true,
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("listRooms sends view query when provided", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ method: string; url: string }> = [];

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
            });

            return jsonResponse({ rooms: [] });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            await client.listRooms("proj_123", { view: "all" });

            expect(calls).to.have.length(1);
            expect(calls[0].method).to.equal("GET");
            expect(calls[0].url).to.equal("http://example.test/accounts/projects/proj_123/rooms?page_size=50&view=all");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("addUserToProject sends project roles", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
                body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
            });

            return jsonResponse({ ok: true });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            await client.addUserToProject("proj_123", "user-1");
            await client.addUserToProject("proj_123", "user-2", {
                roles: ["member", "developer", "room_creator"],
            });

            expect(calls).to.deep.equal([
                {
                    method: "POST",
                    url: "http://example.test/accounts/projects/proj_123/users",
                    body: {
                        project_id: "proj_123",
                        user_id: "user-1",
                        roles: ["member"],
                    },
                },
                {
                    method: "POST",
                    url: "http://example.test/accounts/projects/proj_123/users",
                    body: {
                        project_id: "proj_123",
                        user_id: "user-2",
                        roles: ["member", "developer", "room_creator"],
                    },
                },
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("getUsersInProjectPage returns typed OpenFGA member rows", async () => {
        const originalFetch = globalThis.fetch;

        globalThis.fetch = (async () => {
            return jsonResponse({
                users: [
                    {
                        user: { id: "user-1", email: "ada@example.test", first_name: "Ada", last_name: "Lovelace" },
                        direct_roles: ["member", "admin", "room_creator"],
                    },
                ],
                continuation_token: "next-token",
            });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            const page = await client.getUsersInProjectPage("proj_123");
            const member = page.users[0];

            expect(page.continuationToken).to.equal("next-token");
            expect(member.id).to.equal("user-1");
            expect(member.email).to.equal("ada@example.test");
            expect(member.firstName).to.equal("Ada");
            expect(member.lastName).to.equal("Lovelace");
            expect(member.directRoles).to.deep.equal(["member", "admin", "room_creator"]);
            expect(member).not.to.have.property("isAdmin");
            expect(member).not.to.have.property("canCreateRooms");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("room policy methods use subject and role payloads", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
                body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
            });

            if ((init?.method ?? "GET") === "GET") {
                return jsonResponse({
                    resource: { type: "room", id: "room-1", name: "demo", metadata: {}, annotations: {} },
                    access_grants: [
                        {
                            resource: { type: "room", id: "room-1", name: "demo", metadata: {}, annotations: {} },
                            subject: { type: "user", id: "user-1" },
                            direct_roles: ["operator", "list"],
                        },
                    ],
                    continuation_token: "next-token",
                });
            }
            return jsonResponse({});
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            await client.grantResourcePolicy("proj_123", {
                resourceType: "room",
                resourceId: "room-1",
                subject: { type: "user", id: "user-1" },
                roles: ["operator", "list"],
            });
            await client.grantResourcePolicy("proj_123", {
                resourceType: "room",
                resourceId: "room-1",
                subject: { type: "group", id: "group-1" },
                roles: ["viewer"],
            });
            const page = await client.getResourcePolicyPage("proj_123", {
                resourceType: "room",
                resourceId: "room-1",
                continuationToken: "cursor-1",
            });
            await client.revokeResourcePolicy("proj_123", {
                resourceType: "room",
                resourceId: "room-1",
                subject: { type: "user", id: "user-1" },
            });

            expect(page.continuationToken).to.equal("next-token");
            expect(page.accessGrants[0].directRoles).to.deep.equal(["operator", "list"]);
            expect(calls[0].body).to.deep.equal({
                subject: { type: "user", id: "user-1" },
                roles: ["operator", "list"],
            });
            expect(calls[1].body).to.deep.equal({
                subject: { type: "group", id: "group-1" },
                roles: ["viewer"],
            });
            expect(calls[2].url).to.equal("http://example.test/accounts/projects/proj_123/iam/room/room-1/policy?page_size=50&continuation_token=cursor-1");
            expect(calls[3].url).to.equal("http://example.test/accounts/projects/proj_123/iam/room/room-1/policy:revoke");
            for (const call of calls.slice(0, 2)) {
                expect(call.body).not.to.have.property("permissions");
                expect(call.body).not.to.have.property("user_id");
            }
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("feed policy methods use feed roles and IAM policy endpoints", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
                body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
            });

            if (url.includes("/iam/feed/feed-1/policy")) {
                return jsonResponse({
                    resource: { type: "feed", id: "feed-1", name: "events", annotations: {} },
                    access_grants: [
                        {
                            resource: { type: "feed", id: "feed-1", name: "events", annotations: {} },
                            subject: { type: "user", id: "user-1" },
                            direct_roles: ["manager"],
                        },
                    ],
                    continuation_token: "next-token",
                });
            }
            return jsonResponse({});
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            await client.grantResourcePolicy("proj_123", {
                resourceType: "feed",
                resourceId: "feed-1",
                subject: { type: "user", id: "user-1" },
                roles: ["subscriber", "list"],
            });
            await client.grantResourcePolicy("proj_123", {
                resourceType: "feed",
                resourceId: "feed-1",
                subject: { type: "group", id: "group-1" },
                roles: ["manager"],
            });
            const page = await client.getResourcePolicyPage("proj_123", {
                resourceType: "feed",
                resourceId: "feed-1",
                continuationToken: "cursor-1",
            });
            await client.revokeResourcePolicy("proj_123", {
                resourceType: "feed",
                resourceId: "feed-1",
                subject: { type: "user", id: "user-1" },
            });

            expect(page.continuationToken).to.equal("next-token");
            expect(page.accessGrants[0].directRoles).to.deep.equal(["manager"]);
            expect(calls[0].url).to.equal("http://example.test/accounts/projects/proj_123/iam/feed/feed-1/policy:grant");
            expect(calls[0].body).to.deep.equal({
                subject: { type: "user", id: "user-1" },
                roles: ["subscriber", "list"],
            });
            expect(calls[1].url).to.equal("http://example.test/accounts/projects/proj_123/iam/feed/feed-1/policy:grant");
            expect(calls[1].body).to.deep.equal({
                subject: { type: "group", id: "group-1" },
                roles: ["manager"],
            });
            expect(calls[2].url).to.equal("http://example.test/accounts/projects/proj_123/iam/feed/feed-1/policy?page_size=50&continuation_token=cursor-1");
            expect(calls[3].url).to.equal("http://example.test/accounts/projects/proj_123/iam/feed/feed-1/policy:revoke");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("managed agent policy methods are rejected client-side", async () => {
        const originalFetch = globalThis.fetch;
        const calls: string[] = [];

        globalThis.fetch = (async (url) => {
            calls.push(String(url));
            return jsonResponse({});
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });
            const expectedMessage = /managed agent resource policies are not supported/;

            for (const action of [
                () => client.grantResourcePolicy("proj_123", {
                    resourceType: "agent",
                    resourceId: "agent-1",
                    subject: { type: "user", id: "user-1" },
                    roles: ["manager"],
                }),
                () => client.getResourcePolicyPage("proj_123", {
                    resourceType: "agent",
                    resourceId: "agent-1",
                }),
                () => client.revokeResourcePolicy("proj_123", {
                    resourceType: "agent",
                    resourceId: "agent-1",
                    subject: { type: "user", id: "user-1" },
                }),
            ]) {
                try {
                    await action();
                    throw new Error("expected managed agent resource policy call to fail");
                } catch (error) {
                    expect(error).to.be.instanceOf(Error);
                    expect((error as Error).message).to.match(expectedMessage);
                }
            }

            expect(calls).to.deep.equal([]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("access evaluator methods post subject resource and relation payloads", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
                body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
            });

            if (url.endsWith("/access:test")) {
                return jsonResponse({ allowed: true, relation: "can_use" });
            }
            if (url.endsWith("/access:bindings")) {
                return jsonResponse({
                    access_grants: [
                        {
                            resource: { type: "agent", id: "agent-1", name: "planner" },
                            subject: { type: "user", id: "user-1" },
                            direct_roles: ["admin"],
                        },
                    ],
                });
            }
            return jsonResponse({
                resource: { type: "room", id: "room-1", name: "demo" },
                subject: { type: "user", id: "user-1" },
                effective_roles: ["developer"],
                capabilities: { can_use: true, can_manage: false },
            });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            const testResult = await client.testAccess("proj_123", {
                subject: { type: "user", id: "user-1" },
                resource: { type: "room", id: "room-1" },
                relation: "can_use",
            });
            const effective = await client.getEffectiveAccess("proj_123", {
                subject: { type: "user", id: "user-1" },
                resource: { type: "room", id: "room-1" },
                relations: ["can_use", "can_manage"],
            });
            const accessBindings = await client.listAccessBindings("proj_123", {
                subject: { type: "user", id: "user-1" },
            });
            await client.grantResourcePolicy("proj_123", {
                resourceType: "room",
                resourceId: "room-1",
                subject: { type: "userset", id: "proj_123", objectType: "project", relation: "member" },
                roles: ["viewer", "list"],
            });

            expect(testResult.allowed).to.equal(true);
            expect(effective.effectiveRoles).to.deep.equal(["developer"]);
            expect(effective.capabilities).to.deep.equal({ can_use: true, can_manage: false });
            expect(accessBindings[0].resource).to.deep.include({ type: "agent", id: "agent-1", name: "planner" });
            expect(accessBindings[0].directRoles).to.deep.equal(["admin"]);
            expect(calls[0].url).to.equal("http://example.test/accounts/projects/proj_123/access:test");
            expect(calls[0].body).to.deep.equal({
                subject: { type: "user", id: "user-1" },
                resource: { type: "room", id: "room-1" },
                relation: "can_use",
            });
            expect(calls[1].url).to.equal("http://example.test/accounts/projects/proj_123/access:effective");
            expect(calls[2].url).to.equal("http://example.test/accounts/projects/proj_123/access:bindings");
            expect(calls[2].body).to.deep.equal({
                subject: { type: "user", id: "user-1" },
            });
            expect(calls[3].body).to.deep.equal({
                subject: { type: "userset", id: "proj_123", object_type: "project", relation: "member" },
                roles: ["viewer", "list"],
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("group methods use group resources and subject payloads", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
                body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
            });

            if ((init?.method ?? "GET") === "GET" && new URL(url).pathname.endsWith("/groups/group-1/members")) {
                return jsonResponse({
                    members: [
                        {
                            subject: { type: "user", id: "user-1", email: "dev@example.com" },
                            direct_roles: ["member", "manager"],
                        },
                        {
                            subject: { type: "agent", id: "agent-1", name: "planner" },
                            direct_roles: ["member"],
                        },
                        {
                            subject: { type: "group", id: "group-child", name: "child group" },
                            direct_roles: ["member"],
                        },
                    ],
                    continuation_token: "next-member",
                });
            }
            if ((init?.method ?? "GET") === "GET" && new URL(url).pathname.endsWith("/groups")) {
                return jsonResponse({
                    groups: [{ id: "group-1", name: "developers", metadata: {}, annotations: {} }],
                    continuation_token: "next-group",
                });
            }
            if ((init?.method ?? "GET") === "GET") {
                return jsonResponse({ id: "group-1", name: "developers", metadata: {}, annotations: {} });
            }
            if ((init?.method ?? "GET") === "POST" && url.endsWith("/groups")) {
                return jsonResponse({ id: "group-1", name: "developers", metadata: {}, annotations: {} });
            }
            return jsonResponse({});
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            const group = await client.createGroup({
                projectId: "proj_123",
                name: "developers",
                metadata: { color: "blue" },
                annotations: { owner: "platform" },
            });
            await client.updateGroup("proj_123", "group-1", "operators");
            const page = await client.listGroupsPage("proj_123", { continuationToken: "cursor-1" });
            await client.setGroupMember({
                projectId: "proj_123",
                groupId: "group-1",
                subject: { type: "group", id: "group-child" },
                role: "manager",
            });
            const members = await client.listGroupMembersPage("proj_123", "group-1", { continuationToken: "member-cursor" });
            await client.deleteGroupMember({
                projectId: "proj_123",
                groupId: "group-1",
                subjectType: "agent",
                subjectId: "agent-1",
            });
            await client.deleteGroup("proj_123", "group-1");

            expect(group.id).to.equal("group-1");
            expect(page.continuationToken).to.equal("next-group");
            expect(members.continuationToken).to.equal("next-member");
            expect(members.members[0].subject.email).to.equal("dev@example.com");
            expect(members.members[0].directRoles).to.deep.equal(["member", "manager"]);
            expect(members.members[1].subject.type).to.equal("agent");
            expect(members.members[2].subject.type).to.equal("group");
            expect(calls.map((call) => `${call.method} ${call.url}`)).to.deep.equal([
                "POST http://example.test/accounts/projects/proj_123/groups",
                "PUT http://example.test/accounts/projects/proj_123/groups/group-1",
                "GET http://example.test/accounts/projects/proj_123/groups?page_size=50&continuation_token=cursor-1",
                "POST http://example.test/accounts/projects/proj_123/groups/group-1/members",
                "GET http://example.test/accounts/projects/proj_123/groups/group-1/members?page_size=50&continuation_token=member-cursor",
                "DELETE http://example.test/accounts/projects/proj_123/groups/group-1/members/agent/agent-1",
                "DELETE http://example.test/accounts/projects/proj_123/groups/group-1",
            ]);
            expect(calls[0].body).to.deep.equal({
                name: "developers",
                metadata: { color: "blue" },
                annotations: { owner: "platform" },
            });
            expect(calls[3].body).to.deep.equal({
                subject: { type: "group", id: "group-child" },
                role: "manager",
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("external oauth registration methods are removed from the client", () => {
        const removed = [
            "createProjectExternalOAuthRegistration",
            "updateProjectExternalOAuthRegistration",
            "listProjectExternalOAuthRegistrations",
            "deleteProjectExternalOAuthRegistration",
            "createRoomExternalOAuthRegistration",
            "updateRoomExternalOAuthRegistration",
            "listRoomExternalOAuthRegistrations",
            "deleteRoomExternalOAuthRegistration",
        ];

        for (const method of removed) {
            expect(Object.prototype.hasOwnProperty.call(Meshagent.prototype, method)).to.equal(false);
        }
    });
});
