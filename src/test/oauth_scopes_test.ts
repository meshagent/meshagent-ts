import { expect } from "chai";

import { fullOAuthScope, fullOAuthScopes } from "../index.js";

const expectedFullOAuthScopes = [
    "profile:read",
    "profile:write",
    "project/*",
    "room/*",
    "users:create",
    "users:read",
    "users:update",
    "users:delete",
    "projects:read",
    "projects:update",
    "projects:iam.read",
    "projects:iam.write",
    "projects:billing.read",
    "projects:billing.write",
    "rooms:create",
    "rooms:read",
    "rooms:connect",
    "rooms:update",
    "rooms:delete",
    "agents:create",
    "agents:read",
    "agents:update",
    "agents:delete",
    "agents:run",
    "agents:sessions.read",
    "mailboxes:create",
    "mailboxes:read",
    "mailboxes:update",
    "mailboxes:delete",
    "routes:create",
    "routes:read",
    "routes:update",
    "routes:delete",
    "scheduledTasks:create",
    "scheduledTasks:read",
    "scheduledTasks:update",
    "scheduledTasks:delete",
    "services:create",
    "services:read",
    "services:update",
    "services:delete",
    "repositories:create",
    "repositories:read",
    "repositories:update",
    "repositories:delete",
    "apiKeys:create",
    "apiKeys:read",
    "apiKeys:delete",
    "serviceAccounts:create",
    "serviceAccounts:read",
    "serviceAccounts:update",
    "serviceAccounts:delete",
    "oauthClients:create",
    "oauthClients:read",
    "oauthClients:update",
    "oauthClients:delete",
    "llm:invoke",
    "llm:usage.read",
    "llm:logs.read",
    "llm:logs.write",
    "secrets:read",
    "secrets:write",
    "secrets:delete",
    "secrets:grant",
    "secrets:proxy",
];

describe("OAuth scopes", () => {
    it("fullOAuthScope matches the shared scope list", () => {
        expect(fullOAuthScope).to.equal(fullOAuthScopes.join(" "));
    });

    it("fullOAuthScopes matches the official scope set", () => {
        expect(fullOAuthScopes).to.deep.equal(expectedFullOAuthScopes);
    });

    it("fullOAuthScopes are unique and non-empty", () => {
        expect(new Set(fullOAuthScopes).size).to.equal(fullOAuthScopes.length);
        expect(fullOAuthScopes.every((scope) => scope.trim() === scope && scope.length > 0)).to.equal(true);
    });

    for (const scope of expectedFullOAuthScopes) {
        it(`fullOAuthScope includes ${scope}`, () => {
            expect(fullOAuthScope.split(" ")).to.include(scope);
        });
    }

    it("powerboards, studio, and accounts request the full official scope set", () => {
        expect(fullOAuthScope.split(" ")).to.deep.equal(expectedFullOAuthScopes);
    });
});
