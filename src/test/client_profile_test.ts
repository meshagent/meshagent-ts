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
});
