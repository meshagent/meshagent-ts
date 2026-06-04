import { expect } from "chai";

import { Meshagent, ServiceSpec, ServiceTemplateSpec } from "../index.js";

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
                    email: {
                        address: "assistant@example.com",
                        public: true,
                    },
                    heartbeat: {
                        queue: "assistant-scheduled-tasks",
                        thread_id: "/agents/assistant/threads/heartbeats/{YYYY}/{MM}/{DD}/{HH}/{mm}/heartbeat.thread",
                        prompt: [
                            {
                                type: "file",
                                url: "room:///agents/assistant/heartbeat.md",
                            },
                            {
                                type: "text",
                                text: "Review the latest support queue.",
                            },
                        ],
                        minutes: 60,
                    },
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
                        email: {
                            address: "assistant@example.com",
                            public: true,
                        },
                        heartbeat: {
                            queue: "assistant-scheduled-tasks",
                            thread_id: "/agents/assistant/threads/heartbeats/{YYYY}/{MM}/{DD}/{HH}/{mm}/heartbeat.thread",
                            prompt: [
                                {
                                    type: "file",
                                    url: "room:///agents/assistant/heartbeat.md",
                                },
                                {
                                    type: "text",
                                    text: "Review the latest support queue.",
                                },
                            ],
                            minutes: 60,
                        },
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
            expect(loaded.agents?.[0]?.email?.address).to.equal("assistant@example.com");
            expect(loaded.agents?.[0]?.email?.public).to.equal(true);
            expect(loaded.agents?.[0]?.heartbeat?.queue).to.equal("assistant-scheduled-tasks");
            expect(loaded.agents?.[0]?.heartbeat?.thread_id).to.equal(
                "/agents/assistant/threads/heartbeats/{YYYY}/{MM}/{DD}/{HH}/{mm}/heartbeat.thread",
            );
            expect(loaded.agents?.[0]?.heartbeat?.minutes).to.equal(60);
            expect(loaded.agents?.[0]?.heartbeat?.prompt?.[0]).to.deep.equal({
                type: "file",
                url: "room:///agents/assistant/heartbeat.md",
            });
            expect(loaded.agents?.[0]?.heartbeat?.prompt?.[1]).to.deep.equal({
                type: "text",
                text: "Review the latest support queue.",
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

    it("service template toServiceSpec fills and preserves agent channels", () => {
        const template = ServiceTemplateSpec.fromJson({
            version: "v1",
            kind: "ServiceTemplate",
            metadata: { name: "channel-template" },
            agents: [
                {
                    name: "helper-{role}",
                    description: "Handles {role}",
                    annotations: { role: "{role}" },
                    email: { address: "assistant+{role}@example.com" },
                    heartbeat: {
                        queue: "assistant-scheduled-tasks-{role}",
                        thread_id: "/agents/{role}/heartbeat.thread",
                        prompt: [
                            { type: "file", url: "room:///agents/{role}/heartbeat.md" },
                            { type: "text", text: "Review the {role} queue" },
                        ],
                        minutes: 60,
                    },
                    channels: {
                        email: [
                            {
                                address: "support+{role}@example.com",
                                annotations: { label: "{role}-inbox" },
                            },
                        ],
                        messaging: [
                            {
                                prompts: [
                                    { name: "summary-{role}", prompt: "Summarize the {role} request" },
                                ],
                            },
                        ],
                        queue: [
                            {
                                queue: "jobs-{role}",
                                threading_mode: "default-new",
                                message_schema: { type: "object", description: "Schema for {role}" },
                            },
                        ],
                        toolkit: [
                            { name: "docs-{role}" },
                        ],
                    },
                },
            ],
            container: { image: "meshagent/example" },
        });

        const service = template.toServiceSpec({ values: { role: "ops" } });
        const agent = service.agents?.[0];

        expect(agent?.name).to.equal("helper-ops");
        expect(agent?.description).to.equal("Handles ops");
        expect(agent?.annotations?.role).to.equal("ops");
        expect(agent?.email?.address).to.equal("assistant+ops@example.com");
        expect(agent?.email?.public).to.equal(false);
        expect(agent?.heartbeat?.queue).to.equal("assistant-scheduled-tasks-ops");
        expect(agent?.heartbeat?.thread_id).to.equal("/agents/ops/heartbeat.thread");
        expect(agent?.heartbeat?.minutes).to.equal(60);
        expect(agent?.heartbeat?.prompt?.[0]).to.deep.equal({
            type: "file",
            url: "room:///agents/ops/heartbeat.md",
        });
        expect(agent?.heartbeat?.prompt?.[1]).to.deep.equal({
            type: "text",
            text: "Review the ops queue",
        });
        expect(agent?.channels?.email?.[0]?.address).to.equal("support+ops@example.com");
        expect(agent?.channels?.email?.[0]?.annotations?.label).to.equal("ops-inbox");
        expect(agent?.channels?.messaging?.[0]?.protocol).to.equal("meshagent.agent-message.v1");
        expect(agent?.channels?.messaging?.[0]?.prompts?.[0]?.name).to.equal("summary-ops");
        expect(agent?.channels?.messaging?.[0]?.prompts?.[0]?.description).to.equal(undefined);
        expect(agent?.channels?.messaging?.[0]?.prompts?.[0]?.prompt).to.equal("Summarize the ops request");
        expect(agent?.channels?.queue?.[0]?.queue).to.equal("jobs-ops");
        expect(agent?.channels?.queue?.[0]?.threading_mode).to.equal("default-new");
        expect(agent?.channels?.queue?.[0]?.message_schema).to.deep.equal({
            type: "object",
            description: "Schema for ops",
        });
        expect(agent?.channels?.toolkit?.[0]?.name).to.equal("docs-ops");
    });

    it("service template storage preserves files and config mounts", () => {
        const template = ServiceTemplateSpec.fromJson({
            version: "v1",
            kind: "ServiceTemplate",
            metadata: { name: "storage-template" },
            container: {
                image: "meshagent/example",
                storage: {
                    files: [
                        { path: "/rules/assistant.txt", text: "Follow the rules." },
                    ],
                    configs: [{}],
                },
            },
        });

        const service = template.toServiceSpec();

        expect(service.container?.storage?.files).to.have.length(1);
        expect(service.container?.storage?.files?.[0]).to.deep.equal({
            path: "/rules/assistant.txt",
            read_only: true,
            text: "Follow the rules.",
        });
        expect(service.container?.storage?.configs).to.deep.equal([
            { path: "/var/run/meshagent" },
        ]);
    });

    it("service spec storage preserves config mount defaults from dynamic maps", async () => {
        const originalFetch = globalThis.fetch;

        globalThis.fetch = (async (url) => {
            expect(url).to.equal("http://example.test/accounts/projects/project-1/services/svc-1");
            return jsonResponse({
                version: "v1",
                kind: "Service",
                metadata: { name: "storage-service" },
                container: {
                    image: "meshagent/example",
                    storage: {
                        configs: [{}],
                    },
                },
            });
        }) as typeof fetch;

        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });
            const service = await client.getService("project-1", "svc-1");

            expect(service.container?.storage?.configs).to.deep.equal([
                { path: "/var/run/meshagent" },
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
