import { expect } from "chai";

import {
    ConnectorRef,
    Meshagent,
    OAuthClientConfig,
} from "../index";

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
    it("addUserToProject omits unset permission fields but keeps explicit false", async () => {
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
                isAdmin: false,
                isDeveloper: false,
                canCreateRooms: false,
            });

            expect(calls).to.deep.equal([
                {
                    method: "POST",
                    url: "http://example.test/accounts/projects/proj_123/users",
                    body: {
                        project_id: "proj_123",
                        user_id: "user-1",
                    },
                },
                {
                    method: "POST",
                    url: "http://example.test/accounts/projects/proj_123/users",
                    body: {
                        project_id: "proj_123",
                        user_id: "user-2",
                        is_admin: false,
                        is_developer: false,
                        can_create_rooms: false,
                    },
                },
            ]);
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
