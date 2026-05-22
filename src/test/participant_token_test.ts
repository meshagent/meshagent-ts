import { jwtVerify } from "jose";
import { expect } from "chai";

import {
    AgentsGrant,
    ApiScope,
    ContainerRegistryGrant,
    ContainersGrant,
    DatasetGrant,
    encodeApiKey,
    LivekitGrant,
    LLMGrant,
    MemoryEntryGrant,
    MemoryGrant,
    MemoryPermissions,
    MessagingGrant,
    ParticipantToken,
    parseApiKey,
    QueuesGrant,
    ServicesGrant,
    StorageGrant,
    StoragePathGrant,
    SyncGrant,
    SyncPathGrant,
    TableGrant,
    __version__,
} from "../index";

type AgentsGrantKey = keyof AgentsGrant;

function getPropertyValue<T, K extends keyof T>(obj: T, key: K): T[K] {
    return obj[key];
}

describe("Grants", () => {
    it("agents grant defaults", () => {
        const grant = new AgentsGrant();

        [
            "registerAgent",
            "registerPublicToolkit",
            "registerPrivateToolkit",
            "call",
            "useAgents",
            "useTools",
        ].forEach((field) => {
            const value = getPropertyValue(grant, field as AgentsGrantKey);
            expect(value).to.equal(true);
        });
    });

    ([
        { rooms: undefined, name: "anything", expected: true },
        { rooms: ["blue", "red"], name: "blue", expected: true },
        { rooms: ["blue", "red"], name: "green", expected: false },
    ] as Array<{
        rooms?: string[];
        name: string;
        expected: boolean;
    }>).forEach(({ rooms, name, expected }) => {
        it(`livekit can_join_breakout_room rooms=${JSON.stringify(rooms)} name=${name}`, () => {
            const grant = new LivekitGrant({ breakoutRooms: rooms });
            expect(grant.canJoinBreakoutRoom(name)).to.equal(expected);
        });
    });

    it("queues grant", () => {
        const unrestricted = new QueuesGrant();
        expect(unrestricted.canSend("alpha")).to.equal(true);
        expect(unrestricted.canReceive("beta")).to.equal(true);

        const restricted = new QueuesGrant({
            send: ["s1"],
            receive: ["r1"],
        });
        expect(restricted.canSend("s1")).to.equal(true);
        expect(restricted.canSend("x")).to.equal(false);
        expect(restricted.canReceive("r1")).to.equal(true);
        expect(restricted.canReceive("s1")).to.equal(false);
    });

    it("datasets grant supports namespace matching", () => {
        let grant = new DatasetGrant();
        expect(grant.canRead("tbl")).to.equal(true);
        expect(grant.canWrite("tbl")).to.equal(true);
        expect(grant.canAlter("tbl")).to.equal(true);

        grant = new DatasetGrant({
            tables: [
                new TableGrant({ name: "read_only", read: true, write: false, alter: false }),
                new TableGrant({
                    name: "write_only",
                    namespace: ["analytics"],
                    read: false,
                    write: true,
                    alter: false,
                }),
            ],
        });

        expect(grant.canRead("read_only")).to.equal(true);
        expect(grant.canWrite("read_only")).to.equal(false);
        expect(grant.canWrite("write_only", ["analytics"])).to.equal(true);
        expect(grant.canWrite("write_only", ["default"])).to.equal(false);
        expect(grant.canRead("write_only", ["analytics"])).to.equal(false);
        expect(grant.canRead("unknown")).to.equal(false);
    });

    it("memory grant scopes to memory name and namespace", () => {
        const unrestricted = new MemoryGrant();
        expect(unrestricted.canCreate("profile")).to.equal(true);
        expect(unrestricted.canQuery("profile")).to.equal(true);
        expect(unrestricted.canRecall("profile")).to.equal(true);

        const restricted = new MemoryGrant({
            memories: [
                new MemoryEntryGrant({
                    name: "memories",
                    namespace: ["agents", "assistant"],
                    permissions: new MemoryPermissions({
                        create: true,
                        drop: false,
                        inspect: true,
                        query: true,
                        upsert: true,
                        ingest: true,
                        recall: true,
                        optimize: false,
                    }),
                }),
            ],
        });

        expect(restricted.canCreate("memories", ["agents", "assistant"])).to.equal(true);
        expect(restricted.canDrop("memories", ["agents", "assistant"])).to.equal(false);
        expect(restricted.canOptimize("memories", ["agents", "assistant"])).to.equal(false);
        expect(restricted.canQuery("memories", ["agents", "other"])).to.equal(false);
        expect(restricted.canQuery("other", ["agents", "assistant"])).to.equal(false);
    });

    it("sync grant path and wildcard", () => {
        const unrestricted = new SyncGrant();
        expect(unrestricted.canRead("/data/x")).to.equal(true);
        expect(unrestricted.canWrite("/data/x")).to.equal(true);

        const grant = new SyncGrant({
            paths: [
                new SyncPathGrant({ path: "/cfg/settings.json", readOnly: true }),
                new SyncPathGrant({ path: "/public/*" }),
            ],
        });

        expect(grant.canRead("/cfg/settings.json")).to.equal(true);
        expect(grant.canWrite("/cfg/settings.json")).to.equal(false);
        expect(grant.canWrite("/public/hello.txt")).to.equal(true);
        expect(grant.canRead("/private/secret.txt")).to.equal(false);
    });

    it("storage grant", () => {
        const unrestricted = new StorageGrant();
        expect(unrestricted.canWrite("bucket/file")).to.equal(true);

        const grant = new StorageGrant({
            paths: [
                new StoragePathGrant({ path: "bucket/photos/", readOnly: true }),
                new StoragePathGrant({ path: "bucket/logs/" }),
            ],
        });

        expect(grant.canRead("bucket/photos/pic.jpg")).to.equal(true);
        expect(grant.canWrite("bucket/photos/pic.jpg")).to.equal(false);
        expect(grant.canWrite("bucket/logs/app.log")).to.equal(true);
        expect(grant.canRead("other/file")).to.equal(false);
    });

    it("containers grant supports registry rules", () => {
        let grant = new ContainersGrant();
        expect(grant.canPull("repo/image")).to.equal(true);
        expect(grant.canRun("repo/image")).to.equal(true);
        expect(grant.canRegistryList("team/app")).to.equal(true);
        expect(grant.canRegistryPull("team/app")).to.equal(true);
        expect(grant.canRegistryRun("team/app")).to.equal(true);
        expect(grant.canRegistryWrite("team/app")).to.equal(true);

        grant = new ContainersGrant({ pull: ["lib/*"], run: ["runtime/*"] });
        expect(grant.canPull("lib/tool")).to.equal(true);
        expect(grant.canPull("xxx/tool")).to.equal(false);
        expect(grant.canRun("runtime/app")).to.equal(true);
        expect(grant.canRun("other/app")).to.equal(false);

        const registryGrant = new ContainersGrant({
            registry: new ContainerRegistryGrant({
                pull: ["team/*"],
                run: ["runtime/*"],
                write: ["publish/*"],
            }),
        });
        expect(registryGrant.canRegistryList("team/app")).to.equal(true);
        expect(registryGrant.canRegistryList("runtime/app")).to.equal(true);
        expect(registryGrant.canRegistryList("publish/site")).to.equal(true);
        expect(registryGrant.canRegistryList("other/app")).to.equal(false);
        expect(registryGrant.canRegistryPull("team/app")).to.equal(true);
        expect(registryGrant.canRegistryPull("other/app")).to.equal(false);
        expect(registryGrant.canRegistryRun("runtime/app")).to.equal(true);
        expect(registryGrant.canRegistryRun("team/app")).to.equal(false);
        expect(registryGrant.canRegistryWrite("publish/site")).to.equal(true);
        expect(registryGrant.canRegistryWrite("team/app")).to.equal(false);
    });

    it("llm grant enforces provider and model restrictions", () => {
        const grant = new LLMGrant({ models: ["openai/gpt-4o*", "anthropic/claude-sonnet-4-5"] });
        expect(grant.canUseProvider("openai")).to.equal(true);
        expect(grant.canUseProvider("anthropic")).to.equal(true);
        expect(grant.canUseProvider("google")).to.equal(false);
        expect(grant.canUseModel("openai", "gpt-4o-mini")).to.equal(true);
        expect(grant.canUseModel("openai", "gpt-4.1")).to.equal(false);
        expect(grant.canUseModel("anthropic", "claude-sonnet-4-5")).to.equal(true);
    });

    it("api scope agent default excludes secrets, admin, and tunnels", () => {
        const scope = ApiScope.agentDefault();
        expect(scope.livekit).to.be.instanceOf(LivekitGrant);
        expect(scope.llm).to.be.instanceOf(LLMGrant);
        expect(scope.memory).to.be.instanceOf(MemoryGrant);
        expect(scope.services).to.be.instanceOf(ServicesGrant);
        expect(scope.secrets).to.equal(undefined);
        expect(scope.admin).to.equal(undefined);
        expect(scope.tunnels).to.equal(undefined);
    });

    it("api scope user default includes llm and secrets without admin or tunnels", () => {
        const scope = ApiScope.userDefault();
        expect(scope.livekit).to.be.instanceOf(LivekitGrant);
        expect(scope.llm).to.be.instanceOf(LLMGrant);
        expect(scope.memory).to.be.instanceOf(MemoryGrant);
        expect(scope.services).to.be.instanceOf(ServicesGrant);
        expect(scope.secrets).to.exist;
        expect(scope.admin).to.equal(undefined);
        expect(scope.tunnels).to.equal(undefined);
    });
});

describe("ParticipantToken", () => {
    it("role and is_user", () => {
        const token = new ParticipantToken({ name: "alice" });
        expect(token.role).to.equal("user");
        expect(token.isUser).to.equal(true);

        token.addRoleGrant("admin");
        expect(token.role).to.equal("admin");
        expect(token.isUser).to.equal(false);
    });

    it("get_api_grant requires explicit api scope", () => {
        const token = new ParticipantToken({ name: "bob", version: "0.5.3" });
        expect(token.getApiGrant()).to.equal(undefined);
    });

    it("constructor defaults version to current package version", () => {
        const token = new ParticipantToken({ name: "versioned" });
        expect(token.version).to.equal(__version__);
    });

    it("token json round trip", () => {
        const token = new ParticipantToken({
            name: "charlie",
            extra: { meshagent_bootstrap: true, custom: "value" },
        });
        token.addRoleGrant("moderator");
        token.addRoomGrant("main");

        const clone = ParticipantToken.fromJson(token.toJson());
        expect(clone.name).to.equal(token.name);
        expect(clone.role).to.equal("moderator");
        expect(clone.grantScope("room")).to.equal("main");
        expect(clone.extra).to.deep.equal({ meshagent_bootstrap: true, custom: "value" });
    });

    it("token jwt round trip with explicit secret", async () => {
        const envVars = process.env as Record<string, string | undefined>;
        const previousApiKey = envVars.MESHAGENT_API_KEY;
        delete envVars.MESHAGENT_API_KEY;

        try {
            const token = new ParticipantToken({ name: "dave" });
            const jwtStr = await token.toJwt({ token: "explicit-secret" });
            const recovered = await ParticipantToken.fromJwt(jwtStr, { token: "explicit-secret" });
            expect(recovered.name).to.equal("dave");
        } finally {
            if (previousApiKey === undefined) {
                delete envVars.MESHAGENT_API_KEY;
            } else {
                envVars.MESHAGENT_API_KEY = previousApiKey;
            }
        }
    });

    it("fromJwt uses default env secret", async () => {
        const envVars = process.env as Record<string, string | undefined>;
        const previousSecret = envVars.MESHAGENT_SECRET;
        const previousApiKey = envVars.MESHAGENT_API_KEY;
        envVars.MESHAGENT_SECRET = "env-secret";
        delete envVars.MESHAGENT_API_KEY;

        try {
            const token = new ParticipantToken({ name: "env-user" });
            const jwtStr = await token.toJwt({ token: "env-secret" });
            const recovered = await ParticipantToken.fromJwt(jwtStr);
            expect(recovered.name).to.equal("env-user");
        } finally {
            if (previousSecret === undefined) {
                delete envVars.MESHAGENT_SECRET;
            } else {
                envVars.MESHAGENT_SECRET = previousSecret;
            }

            if (previousApiKey === undefined) {
                delete envVars.MESHAGENT_API_KEY;
            } else {
                envVars.MESHAGENT_API_KEY = previousApiKey;
            }
        }
    });

    it("token jwt with api key", async () => {
        const apiKey = encodeApiKey({
            id: "72c17196-3f2d-4444-a55b-39825e35cbb7",
            projectId: "44bb91aa-2555-4487-8173-580027a87558",
            secret: "api-key-secret",
        });

        const token = new ParticipantToken({ name: "frank" });
        const jwtStr = await token.toJwt({ apiKey });
        const parsed = parseApiKey(apiKey);

        const { payload } = await jwtVerify(jwtStr, new TextEncoder().encode(parsed.secret), {
            algorithms: ["HS256"],
        });

        expect(payload.kid).to.equal(parsed.id);
        expect(payload.sub).to.equal(parsed.projectId);
    });

    it("env api key overrides an explicit raw secret like python", async () => {
        const apiKey = encodeApiKey({
            id: "72c17196-3f2d-4444-a55b-39825e35cbb7",
            projectId: "44bb91aa-2555-4487-8173-580027a87558",
            secret: "api-key-secret",
        });
        const envVars = process.env as Record<string, string | undefined>;
        const previousApiKey = envVars.MESHAGENT_API_KEY;
        envVars.MESHAGENT_API_KEY = apiKey;

        try {
            const token = new ParticipantToken({ name: "frank" });
            const jwtStr = await token.toJwt({ token: "explicit-secret" });
            const parsed = parseApiKey(apiKey);
            const { payload } = await jwtVerify(jwtStr, new TextEncoder().encode(parsed.secret), {
                algorithms: ["HS256"],
            });

            expect(payload.kid).to.equal(parsed.id);
            expect(payload.sub).to.equal(parsed.projectId);
        } finally {
            if (previousApiKey === undefined) {
                delete envVars.MESHAGENT_API_KEY;
            } else {
                envVars.MESHAGENT_API_KEY = previousApiKey;
            }
        }
    });

    it("token expiration", async () => {
        const envVars = process.env as Record<string, string | undefined>;
        const previousApiKey = envVars.MESHAGENT_API_KEY;
        delete envVars.MESHAGENT_API_KEY;

        try {
            const token = new ParticipantToken({ name: "eve" });
            const expiration = new Date(Date.now() + 5000);
            const jwtStr = await token.toJwt({ token: "expire-secret", expiration });

            const { payload } = await jwtVerify(jwtStr, new TextEncoder().encode("expire-secret"), {
                algorithms: ["HS256"],
            });
            const expAsSeconds = typeof payload.exp === "number" ? payload.exp : 0;
            expect(Math.abs(expAsSeconds - Math.floor(expiration.getTime() / 1000))).to.be.lessThan(2);
        } finally {
            if (previousApiKey === undefined) {
                delete envVars.MESHAGENT_API_KEY;
            } else {
                envVars.MESHAGENT_API_KEY = previousApiKey;
            }
        }
    });

    it("token explicit secret preserves kid", async () => {
        const envVars = process.env as Record<string, string | undefined>;
        const previousApiKey = envVars.MESHAGENT_API_KEY;
        delete envVars.MESHAGENT_API_KEY;

        try {
            const token = new ParticipantToken({
                name: "heidi",
                apiKeyId: "should-preserve",
                projectId: "project-1",
            });

            const jwtStr = await token.toJwt({ token: "explicit-secret" });
            const { payload } = await jwtVerify(jwtStr, new TextEncoder().encode("explicit-secret"), {
                algorithms: ["HS256"],
            });

            expect(payload.kid).to.equal("should-preserve");
            expect(payload.sub).to.equal("project-1");
        } finally {
            if (previousApiKey === undefined) {
                delete envVars.MESHAGENT_API_KEY;
            } else {
                envVars.MESHAGENT_API_KEY = previousApiKey;
            }
        }
    });

    it("token default secret strips kid without api key", async () => {
        const envVars = process.env as Record<string, string | undefined>;
        const previousSecret = envVars.MESHAGENT_SECRET;
        const previousApiKey = envVars.MESHAGENT_API_KEY;
        envVars.MESHAGENT_SECRET = "default-secret";
        delete envVars.MESHAGENT_API_KEY;

        try {
            const token = new ParticipantToken({
                name: "grace",
                apiKeyId: "should-strip",
                projectId: "project-1",
            });
            const jwtStr = await token.toJwt();
            const { payload } = await jwtVerify(jwtStr, new TextEncoder().encode("default-secret"), {
                algorithms: ["HS256"],
            });

            expect(payload.kid).to.equal(undefined);
            expect(payload.sub).to.equal("project-1");
        } finally {
            if (previousSecret === undefined) {
                delete envVars.MESHAGENT_SECRET;
            } else {
                envVars.MESHAGENT_SECRET = previousSecret;
            }

            if (previousApiKey === undefined) {
                delete envVars.MESHAGENT_API_KEY;
            } else {
                envVars.MESHAGENT_API_KEY = previousApiKey;
            }
        }
    });

    it("addApiGrant only allows a single api grant", () => {
        const token = new ParticipantToken({ name: "single-api" });
        token.addApiGrant(ApiScope.agentDefault());
        expect(() => token.addApiGrant(ApiScope.userDefault())).to.throw("can only have a single api grant");
    });

    it("unversioned token uses current version and no implicit api scope", () => {
        const token = ParticipantToken.fromJson({
            name: "72c17196-3f2d-4444-a55b-39825e35cbb7",
            grants: [{ name: "room", scope: "44bb91aa-2555-4487-8173-580027a87558" }],
            sub: "2",
        });

        expect(token.version).to.equal(__version__);
        expect(token.getApiGrant()).to.equal(undefined);
        expect(token.grantScope("room")).to.equal("44bb91aa-2555-4487-8173-580027a87558");
        expect(token.name).to.equal("72c17196-3f2d-4444-a55b-39825e35cbb7");
    });
});
