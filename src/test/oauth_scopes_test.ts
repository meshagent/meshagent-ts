import { expect } from "chai";

import { fullOAuthScope, fullOAuthScopes } from "../oauth-scopes.js";

describe("oauth_scopes_test", () => {
  it("fullOAuthScope matches the shared scope list", () => {
    expect(fullOAuthScope).to.equal(fullOAuthScopes.join(" "));
  });

  it("fullOAuthScopes matches the official scope set", () => {
    expect(fullOAuthScopes).to.deep.equal([
      "profile",
      "project/*",
      "room/*",
      "create_users",
      "create_rooms",
      "create_agents",
      "managed_agents",
      "llm_proxy",
      "admin",
      "developer",
      "connect_room",
      "delete_room",
      "update_room",
      "delete_agent",
      "update_agent",
    ]);
  });
});
