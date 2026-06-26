import { expect } from "chai";

import { Meshagent, RoomSession } from "../index.js";

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
    } as unknown as Response;
}

describe("managed_agents_client_test", () => {
    it("createAgent omits null permissions", async () => {
        const originalFetch = globalThis.fetch;
        let body: Record<string, unknown> | undefined;

        globalThis.fetch = (async (url, init) => {
            expect(url).to.equal("http://example.test/accounts/projects/proj_123/agents");
            expect(init?.method).to.equal("POST");
            body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return jsonResponse({
                id: "agent-1",
                name: "chatbot",
                configuration: { name: "chatbot" },
            });
        }) as typeof fetch;

        try {
            const meshagent = new Meshagent({
                baseUrl: "http://example.test",
                token: "test-token",
            });

            const agent = await meshagent.createAgent({
                projectId: "proj_123",
                configuration: { name: "chatbot" },
            });

            expect(agent).to.deep.equal({
                id: "agent-1",
                name: "chatbot",
                configuration: { name: "chatbot" },
            });
            expect(body).to.deep.equal({
                configuration: { name: "chatbot" },
                if_not_exists: false,
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("RoomSession omits null managed-agent fields", () => {
        const session = new RoomSession({
            id: "session-1",
            roomId: "room-1",
            roomName: "general",
            createdAt: new Date("2026-05-15T12:00:00Z"),
            isActive: true,
            participants: null,
        });

        expect(session.toJson()).to.deep.equal({
            id: "session-1",
            room_id: "room-1",
            room_name: "general",
            started_at: "2026-05-15T12:00:00.000Z",
            is_active: true,
            kind: "room",
        });
    });
});
