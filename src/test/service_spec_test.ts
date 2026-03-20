import { expect } from "chai";

import { Meshagent, ServiceSpec } from "../index";

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
    } as unknown as Response;
}

describe("service_spec_test", () => {
    it("round trips agent channels through service save and load", async () => {
        const originalFetch = globalThis.fetch;
        let savedServiceJson: Record<string, unknown> | undefined;

        const service: ServiceSpec = {
            version: "v1",
            kind: "Service",
            metadata: { name: "channel-service" },
            container: { image: "meshagent/example" },
            agents: [
                {
                    name: "agent-1",
                    description: "Handles requests",
                    annotations: { role: "support" },
                    channels: {
                        email: [
                            {
                                address: "support@example.com",
                                private: false,
                                annotations: { label: "inbox" },
                            },
                        ],
                        messaging: [
                            {
                                protocol: "meshagent.agent-message.v1",
                                prompts: [
                                    {
                                        name: "welcome",
                                        prompt: "Hello there",
                                    },
                                ],
                            },
                        ],
                        queue: [
                            {
                                queue: "jobs",
                                threading_mode: "default-new",
                                message_schema: {
                                    type: "object",
                                    properties: {
                                        task: { type: "string" },
                                    },
                                },
                            },
                        ],
                        toolkit: [
                            { name: "helper-tools" },
                        ],
                    },
                },
            ],
        };

        globalThis.fetch = (async (url, init) => {
            if (typeof url !== "string") {
                throw new Error("expected string url");
            }

            if (url.endsWith("/accounts/projects/project-1/services") && init?.method === "POST") {
                savedServiceJson = JSON.parse(String(init.body)) as Record<string, unknown>;
                return jsonResponse({ id: "svc-1" });
            }

            if (url.endsWith("/accounts/projects/project-1/services/svc-1")) {
                return jsonResponse({
                    ...savedServiceJson,
                    id: "svc-1",
                });
            }

            throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });

            const serviceId = await client.createService("project-1", service);
            const loaded = await client.getService("project-1", serviceId);

            expect(savedServiceJson).to.deep.equal({
                version: "v1",
                kind: "Service",
                metadata: { name: "channel-service" },
                container: { image: "meshagent/example" },
                agents: [
                    {
                        name: "agent-1",
                        description: "Handles requests",
                        annotations: { role: "support" },
                        channels: {
                            email: [
                                {
                                    address: "support@example.com",
                                    private: false,
                                    annotations: { label: "inbox" },
                                },
                            ],
                            messaging: [
                                {
                                    protocol: "meshagent.agent-message.v1",
                                    prompts: [
                                        {
                                            name: "welcome",
                                            prompt: "Hello there",
                                        },
                                    ],
                                },
                            ],
                            queue: [
                                {
                                    queue: "jobs",
                                    threading_mode: "default-new",
                                    message_schema: {
                                        type: "object",
                                        properties: {
                                            task: { type: "string" },
                                        },
                                    },
                                },
                            ],
                            toolkit: [
                                { name: "helper-tools" },
                            ],
                        },
                    },
                ],
            });
            expect(loaded.agents?.[0]?.channels?.email?.[0]?.address).to.equal("support@example.com");
            expect(loaded.agents?.[0]?.channels?.messaging?.[0]?.protocol).to.equal("meshagent.agent-message.v1");
            expect(loaded.agents?.[0]?.channels?.messaging?.[0]?.prompts?.[0]?.name).to.equal("welcome");
            expect(loaded.agents?.[0]?.channels?.messaging?.[0]?.prompts?.[0]?.description).to.equal(undefined);
            expect(loaded.agents?.[0]?.channels?.queue?.[0]?.threading_mode).to.equal("default-new");
            expect(loaded.agents?.[0]?.channels?.queue?.[0]?.message_schema).to.deep.equal({
                type: "object",
                properties: {
                    task: { type: "string" },
                },
            });
            expect(loaded.agents?.[0]?.channels?.toolkit?.[0]?.name).to.equal("helper-tools");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
