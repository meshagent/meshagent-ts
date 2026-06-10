import { expect } from "chai";

import {
    ConnectorRef,
    Meshagent,
    OAuthClientConfig,
} from "../index.js";

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

    it("listProjectSecrets sends view query when provided", async () => {
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
                secrets: [
                    {
                        id: "secret-1",
                        name: "registry",
                        type: "docker",
                    },
                ],
            });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            const secrets = await client.listProjectSecrets("proj_123", { view: "my" });

            expect(secrets[0].id).to.equal("secret-1");
            expect(calls).to.deep.equal([
                {
                    method: "GET",
                    url: "http://example.test/accounts/projects/proj_123/secrets?view=my",
                },
            ]);
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

    it("createProjectSecret sends a base64 payload", async () => {
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

            return jsonResponse({ id: "secret-1" });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            const secretId = await client.createProjectSecret({
                projectId: "proj_123",
                name: "registry",
                type: "docker",
                data: new TextEncoder().encode('{"server":"registry.example.com"}'),
            });

            expect(secretId).to.equal("secret-1");
            expect(calls).to.deep.equal([
                {
                    method: "POST",
                    url: "http://example.test/accounts/projects/proj_123/secrets",
                    body: {
                        name: "registry",
                        type: "docker",
                        data_base64: "eyJzZXJ2ZXIiOiJyZWdpc3RyeS5leGFtcGxlLmNvbSJ9",
                    },
                },
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("listSecrets compatibility wrapper fetches managed secret payloads", async () => {
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

            if (url.endsWith("/accounts/projects/proj_123/secrets")) {
                return jsonResponse({
                    secrets: [
                        {
                            id: "secret-1",
                            name: "registry",
                            type: "docker",
                            delegated_to: null,
                        },
                    ],
                });
            }

            if (url.endsWith("/accounts/projects/proj_123/secrets/secret-1")) {
                return jsonResponse({
                    id: "secret-1",
                    name: "registry",
                    type: "docker",
                    data_base64: "eyJzZXJ2ZXIiOiJyZWdpc3RyeS5leGFtcGxlLmNvbSIsInVzZXJuYW1lIjoiYWxpY2UiLCJwYXNzd29yZCI6InNlY3JldCIsImVtYWlsIjoibm9uZUBleGFtcGxlLmNvbSJ9",
                });
            }

            throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            const secrets = await client.listSecrets("proj_123");

            expect(secrets).to.have.length(1);
            expect(secrets[0]).to.deep.equal({
                id: "secret-1",
                name: "registry",
                type: "docker",
                server: "registry.example.com",
                username: "alice",
                password: "secret",
                email: "none@example.com",
            });
            expect(calls).to.deep.equal([
                {
                    method: "GET",
                    url: "http://example.test/accounts/projects/proj_123/secrets",
                },
                {
                    method: "GET",
                    url: "http://example.test/accounts/projects/proj_123/secrets/secret-1",
                },
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("room secret and external oauth methods pass query parameters", async () => {
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

            if (url === "http://example.test/accounts/projects/proj_123/rooms/room-a/secrets/secret-1?delegated_to=agent&for_identity=agent") {
                return jsonResponse({
                    id: "secret-1",
                    name: "api-key",
                    type: "application/octet-stream",
                    delegated_to: "agent",
                    data_base64: "c2VjcmV0",
                });
            }

            if (url === "http://example.test/accounts/projects/proj_123/rooms/room-a/external-oauth?delegated_to=agent") {
                return jsonResponse({
                    registrations: [
                        {
                            id: "registration-1",
                            delegated_to: "agent",
                            connector: null,
                            oauth: {
                                authorization_endpoint: "https://auth.example.com/authorize",
                                token_endpoint: "https://auth.example.com/token",
                                client_id: "client-id",
                                client_secret: null,
                                scopes: ["openid"],
                            },
                            client_id: "client-id",
                            client_secret: "client-secret",
                        },
                    ],
                });
            }

            if (url === "http://example.test/accounts/projects/proj_123/rooms/room-a/external-oauth/registration-1?delegated_to=agent") {
                return jsonResponse({});
            }

            throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            const secret = await client.getRoomSecret({
                projectId: "proj_123",
                roomName: "room-a",
                secretId: "secret-1",
                delegatedTo: "agent",
                forIdentity: "agent",
            });
            const registrations = await client.listRoomExternalOAuthRegistrations({
                projectId: "proj_123",
                roomName: "room-a",
                delegatedTo: "agent",
            });
            await client.deleteRoomExternalOAuthRegistration({
                projectId: "proj_123",
                roomName: "room-a",
                registrationId: "registration-1",
                delegatedTo: "agent",
            });

            expect(new TextDecoder().decode(secret.data)).to.equal("secret");
            expect(registrations[0].id).to.equal("registration-1");
            expect(calls).to.deep.equal([
                {
                    method: "GET",
                    url: "http://example.test/accounts/projects/proj_123/rooms/room-a/secrets/secret-1?delegated_to=agent&for_identity=agent",
                },
                {
                    method: "GET",
                    url: "http://example.test/accounts/projects/proj_123/rooms/room-a/external-oauth?delegated_to=agent",
                },
                {
                    method: "DELETE",
                    url: "http://example.test/accounts/projects/proj_123/rooms/room-a/external-oauth/registration-1?delegated_to=agent",
                },
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("createProjectExternalOAuthRegistration serializes connector payloads", async () => {
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

            return jsonResponse({ id: "registration-1" });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });
            const connector: ConnectorRef = {
                openaiConnectorId: "connector-1",
                serverUrl: "https://connector.example.com",
                clientSecretId: "secret-1",
            };
            const oauth: OAuthClientConfig = {
                authorization_endpoint: "https://auth.example.com/authorize",
                token_endpoint: "https://auth.example.com/token",
                client_id: "configured-client-id",
                scopes: ["openid"],
            };

            const registrationId = await client.createProjectExternalOAuthRegistration({
                projectId: "proj_123",
                oauth,
                clientId: "client-id",
                clientSecret: "client-secret",
                delegatedTo: "agent",
                connector,
            });

            expect(registrationId).to.equal("registration-1");
            expect(calls).to.deep.equal([
                {
                    method: "POST",
                    url: "http://example.test/accounts/projects/proj_123/external-oauth",
                    body: {
                        oauth,
                        client_id: "client-id",
                        client_secret: "client-secret",
                        delegated_to: "agent",
                        connector: {
                            openai_connector_id: "connector-1",
                            server_url: "https://connector.example.com",
                            client_secret_id: "secret-1",
                        },
                    },
                },
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
