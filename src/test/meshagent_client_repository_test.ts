import { expect } from "chai";

import { Meshagent } from "../index";

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
        arrayBuffer: async () =>
            new TextEncoder().encode(JSON.stringify(body)).buffer,
    } as unknown as Response;
}

describe("meshagent_client_repository_test", () => {
    it("creates and updates repositories with the expected payload", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{
            method: string;
            url: string;
            body?: Record<string, unknown>;
        }> = [];

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            calls.push({
                method: init?.method ?? "GET",
                url,
                body: init?.body
                    ? (JSON.parse(String(init.body)) as Record<string, unknown>)
                    : undefined,
            });

            if (url.endsWith("/repositories")) {
                return jsonResponse({
                    id: "repo-1",
                    project_id: "proj_123",
                    name: "apps/demo",
                    description: "Demo registry",
                    annotations: { team: "platform" },
                    created_at: "2026-04-19T00:00:00Z",
                });
            }

            return jsonResponse({
                id: "repo-1",
                project_id: "proj_123",
                name: "apps/demo",
                description: "Updated registry",
                annotations: { team: "platform", tier: "prod" },
                created_at: "2026-04-19T00:00:00Z",
            });
        }) as typeof fetch;

        try {
            const client = new Meshagent({
                baseUrl: "http://example.test",
                token: "test-token",
            });

            const created = await client.createRepository({
                projectId: "proj_123",
                name: "apps/demo",
                description: "Demo registry",
                annotations: { team: "platform" },
            });
            const updated = await client.updateRepository({
                projectId: "proj_123",
                repositoryId: "repo-1",
                name: "apps/demo",
                description: "Updated registry",
                annotations: { team: "platform", tier: "prod" },
            });

            expect(created).to.include({
                id: "repo-1",
                projectId: "proj_123",
                name: "apps/demo",
                description: "Demo registry",
            });
            expect(created.annotations).to.deep.equal({ team: "platform" });
            expect(updated).to.include({
                id: "repo-1",
                projectId: "proj_123",
                name: "apps/demo",
                description: "Updated registry",
            });
            expect(updated.annotations).to.deep.equal({
                team: "platform",
                tier: "prod",
            });
            expect(calls).to.deep.equal([
                {
                    method: "POST",
                    url: "http://example.test/accounts/projects/proj_123/repositories",
                    body: {
                        name: "apps/demo",
                        description: "Demo registry",
                        annotations: { team: "platform" },
                    },
                },
                {
                    method: "PUT",
                    url: "http://example.test/accounts/projects/proj_123/repositories/repo-1",
                    body: {
                        name: "apps/demo",
                        description: "Updated registry",
                        annotations: { team: "platform", tier: "prod" },
                    },
                },
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("lists, fetches, and deletes repositories", async () => {
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

            if (url.endsWith("/repositories")) {
                return jsonResponse({
                    repositories: [
                        {
                            id: "repo-1",
                            project_id: "proj_123",
                            name: "apps/demo",
                            description: "Demo registry",
                            annotations: { team: "platform" },
                            created_at: "2026-04-19T00:00:00Z",
                        },
                    ],
                });
            }

            if (url.endsWith("/repositories/repo-1")) {
                if ((init?.method ?? "GET") === "DELETE") {
                    return jsonResponse({}, 204);
                }

                return jsonResponse({
                    id: "repo-1",
                    project_id: "proj_123",
                    name: "apps/demo",
                    description: "Demo registry",
                    annotations: { team: "platform" },
                    created_at: "2026-04-19T00:00:00Z",
                });
            }

            throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
        }) as typeof fetch;

        try {
            const client = new Meshagent({
                baseUrl: "http://example.test",
                token: "test-token",
            });

            const repositories = await client.listRepositories("proj_123");
            const repository = await client.getRepository("proj_123", "repo-1");
            await client.deleteRepository("proj_123", "repo-1");

            expect(repositories).to.have.length(1);
            expect(repositories[0]).to.include({
                id: "repo-1",
                projectId: "proj_123",
                name: "apps/demo",
            });
            expect(repository).to.include({
                id: "repo-1",
                projectId: "proj_123",
                name: "apps/demo",
            });
            expect(calls).to.deep.equal([
                {
                    method: "GET",
                    url: "http://example.test/accounts/projects/proj_123/repositories",
                },
                {
                    method: "GET",
                    url: "http://example.test/accounts/projects/proj_123/repositories/repo-1",
                },
                {
                    method: "DELETE",
                    url: "http://example.test/accounts/projects/proj_123/repositories/repo-1",
                },
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
