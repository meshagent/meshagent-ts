import { expect } from "chai";

import { ForbiddenException, Meshagent } from "../index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  } as unknown as Response;
}

describe("client_profile_test", () => {
    it("sends partial metadata and project editor updates", async () => {
        const originalFetch = globalThis.fetch;
        const calls: Array<{ url: string; body: unknown }> = [];
        globalThis.fetch = (async (url, init) => {
            calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
            return jsonResponse({ ok: true });
        }) as typeof fetch;
        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });
            await client.updateUserProfile("me", undefined, undefined, { metadata: {} });
            await client.updateUserProfile("user-2", "Grace", "Hopper", { metadata: { active: true }, annotations: { department: "research" }, projectId: "project-1" });
            expect(calls).to.deep.equal([
                { url: "http://example.test/accounts/profiles/me", body: { metadata: {} } },
                { url: "http://example.test/accounts/profiles/user-2?project_id=project-1", body: { first_name: "Grace", last_name: "Hopper", metadata: { active: true }, annotations: { department: "research" } } },
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("preserves project member profile fields and user_profile_editor role", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => jsonResponse({ users: [{ user: { id: "user-1", email: "ada@example.test", metadata: { active: true }, annotations: { department: "research" } }, direct_roles: ["member", "user_profile_editor"] }] })) as typeof fetch;
        try {
            const client = new Meshagent({ baseUrl: "http://example.test", token: "test-token" });
            const members = await client.getUsersInProject("project-1");
            expect(members[0].metadata).to.deep.equal({ active: true });
            expect(members[0].annotations).to.deep.equal({ department: "research" });
            expect(members[0].directRoles).to.deep.equal(["member", "user_profile_editor"]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

  it("getUserProfile throws ForbiddenException on 403", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (url) => {
      expect(url).to.equal("http://example.test/accounts/profiles/me");
      return jsonResponse({ error: "forbidden" }, 403);
    }) as typeof fetch;

    try {
      const meshagent = new Meshagent({
        baseUrl: "http://example.test",
        token: "test-token",
      });

      try {
        await meshagent.getUserProfile("me");
        throw new Error("expected ForbiddenException");
      } catch (error) {
        expect(error).to.be.instanceOf(ForbiddenException);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses dedicated project settings document routes", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body?: string }> = [];

    globalThis.fetch = (async (url, init) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return jsonResponse(calls.length === 1 ? { roles: {} } : {});
    }) as typeof fetch;

    try {
      const meshagent = new Meshagent({
        baseUrl: "http://example.test",
        token: "test-token",
      });

      expect(await meshagent.getProjectSettingsDocument("project-1", "room_roles")).to.deep.equal({ roles: {} });
      await meshagent.setProjectSettingsDocument("project-1", "room_roles", { roles: {} });
      await meshagent.deleteProjectSettingsDocument("project-1", "room_roles");

      expect(calls).to.deep.equal([
        {
          url: "http://example.test/accounts/projects/project-1/settings/room-roles",
          method: "GET",
          body: undefined,
        },
        {
          url: "http://example.test/accounts/projects/project-1/settings/room-roles",
          method: "PUT",
          body: JSON.stringify({ roles: {} }),
        },
        {
          url: "http://example.test/accounts/projects/project-1/settings/room-roles",
          method: "DELETE",
          body: undefined,
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns undefined for a missing project settings document", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => jsonResponse({}, 404)) as typeof fetch;

    try {
      const meshagent = new Meshagent({ baseUrl: "http://example.test" });
      expect(await meshagent.getProjectSettingsDocument("project-1", "room")).to.equal(undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
