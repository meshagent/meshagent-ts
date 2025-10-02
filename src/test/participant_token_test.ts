import { jwtVerify } from "jose";

import { expect } from "chai";

// ────────────────────────────────────────────────────────────────────────────────
// Replace this single import line as needed
import {
    AgentsGrant,
    LivekitGrant,
    QueuesGrant,
    TableGrant,
    DatabaseGrant,
    SyncGrant,
    SyncPathGrant,
    StorageGrant,
    StoragePathGrant,
    ContainersGrant,
    ApiScope,
    ParticipantToken,
    encodeApiKey,
    parseApiKey,
} from "../index";


type AgentsGrantKey = keyof AgentsGrant;

function getPropertyValue<T, K extends keyof T>(obj: T, key: K): T[K] {
    return obj[key];
}

// ────────────────────────────────────────────────────────────────────────────────
// Basic, per‑grant behaviour
// ────────────────────────────────────────────────────────────────────────────────
describe("Grants", () => {
    it("agents grant defaults", () => {
        const g = new AgentsGrant();

        [
            "registerAgent",
            "registerPublicToolkit",
            "registerPrivateToolkit",
            "call",
            "useAgents",
            "useTools",
        ].forEach((field) => {
            const value = getPropertyValue(g, field as AgentsGrantKey);

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
            const g = new LivekitGrant({ breakoutRooms: rooms });

            expect(g.canJoinBreakoutRoom(name)).to.equal(expected);
        });
    });

    it("queues grant", () => {
        const g = new QueuesGrant();

        expect(g.canSend("alpha")).to.equal(true);
        expect(g.canReceive("beta")).to.equal(true);

        const restricted = new QueuesGrant({
            send: ["s1"],
            receive: ["r1"],
        });

        expect(restricted.canSend("s1")).to.equal(true);
        expect(restricted.canSend("x")).to.equal(false);
        expect(restricted.canReceive("r1")).to.equal(true);
        expect(restricted.canReceive("s1")).to.equal(false);
    });

    it("database grant", () => {
        // unrestricted
        let g = new DatabaseGrant();
        expect(g.canRead("tbl")).to.equal(true);
        expect(g.canWrite("tbl")).to.equal(true);
        expect(g.canAlter("tbl")).to.equal(true);

        // table‑level rules
        const tables = [
            new TableGrant({ name: "read_only", read: true, write: false, alter: false }),
            new TableGrant({ name: "write_only", read: false, write: true, alter: false }),
        ];

        g = new DatabaseGrant({ tables });
        expect(g.canRead("read_only")).to.equal(true);
        expect(g.canWrite("read_only")).to.equal(false);
        expect(g.canWrite("write_only")).to.equal(true);
        expect(g.canRead("write_only")).to.equal(false);
        expect(g.canRead("unknown")).to.equal(false);
        expect(g.canWrite("unknown")).to.equal(false);
    });

    it("sync grant path and wildcard", () => {
        const anyPath = new SyncGrant();
        expect(anyPath.canRead("/data/x")).to.equal(true);
        expect(anyPath.canWrite("/data/x")).to.equal(true);

        const paths = [
            new SyncPathGrant({ path: "/cfg/settings.json", readOnly: true }),
            new SyncPathGrant({ path: "/public/*" }),
        ];

        const g = new SyncGrant({ paths });

        expect(g.canRead("/cfg/settings.json")).to.equal(true);
        expect(g.canWrite("/cfg/settings.json")).to.equal(false);
        expect(g.canWrite("/public/hello.txt")).to.equal(true);
        expect(g.canRead("/private/secret.txt")).to.equal(false);
    });

    it("storage grant", () => {
        const unrestricted = new StorageGrant();
        expect(unrestricted.canWrite("bucket/file")).to.equal(true);

        const g = new StorageGrant({
            paths: [
                new StoragePathGrant({ path: "bucket/photos/", readOnly: true }),
                new StoragePathGrant({ path: "bucket/logs/" }),
            ],
        });

        expect(g.canRead("bucket/photos/pic.jpg")).to.equal(true);
        expect(g.canWrite("bucket/photos/pic.jpg")).to.equal(false);
        expect(g.canWrite("bucket/logs/app.log")).to.equal(true);
        expect(g.canRead("other/file")).to.equal(false);
    });

    it("containers grant", () => {
        let g = new ContainersGrant();
        expect(g.canPull("repo/image")).to.equal(true);
        expect(g.canRun("repo/image")).to.equal(true);

        g = new ContainersGrant({ pull: ["lib/*"], run: ["runtime/*"] });

        // Pull follows pull‑list
        expect(g.canPull("lib/tool")).to.equal(true);
        expect(g.canPull("xxx/tool")).to.equal(false);

        // Run should follow *run‑list*
        expect(g.canRun("runtime/app")).to.equal(true);
        expect(g.canRun("other/app")).to.equal(false);
    });
});

// ────────────────────────────────────────────────────────────────────────────────
// ParticipantToken behaviour
// ────────────────────────────────────────────────────────────────────────────────
describe("ParticipantToken", () => {
    it("role and is_user", () => {
        const p = new ParticipantToken({ name: "alice" });

        expect(p.role).to.equal("user");
        expect(p.isUser).to.equal(true);

        p.addRoleGrant("admin");

        expect(p.role).to.equal("admin");
        expect(p.isUser).to.equal(false);
    });

    it("get_api_grant defaults to full for old versions", () => {
        const pt = new ParticipantToken({ name: "bob", version: "0.5.3" });

        const api = pt.getApiGrant();
        expect(api).to.be.instanceOf(ApiScope);

        const a = api as ApiScope;
        expect(a.queues).to.exist;
        expect(a.sync).to.exist;
    });

    it("token json round trip", () => {
        const pt = new ParticipantToken({ name: "charlie" });
        pt.addRoleGrant("moderator");
        pt.addRoomGrant("main");

        const clone = ParticipantToken.fromJson(pt.toJson());
        expect(clone.name).to.equal(pt.name);
        expect(clone.role).to.equal("moderator");
        expect(clone.grantScope("room")).to.equal("main");
    });

    it("token jwt round trip", async () => {
        const secret = "expire‑secret";

        const pt = new ParticipantToken({ name: "dave" });

        const jwtStr = await pt.toJwt({ token: secret });

        const recovered = await ParticipantToken.fromJwt(jwtStr, { token: secret });

        expect(recovered.name).to.equal("dave");
    });

    it("token jwt with api key", async () => {
        const apiKey = encodeApiKey({
            id: "72c17196-3f2d-4444-a55b-39825e35cbb7",
            projectId: "44bb91aa-2555-4487-8173-580027a87558",
            secret: "api-key-secret",
        });

        const pt = new ParticipantToken({ name: "frank" });

        const jwtStr = await pt.toJwt({ apiKey });
        const parsed = parseApiKey(apiKey);

        const { payload } = await jwtVerify(jwtStr, new TextEncoder().encode(parsed.secret), {
            algorithms: ["HS256"],
        });

        expect(payload.kid).to.equal(parsed.id);
        expect(payload.sub).to.equal(parsed.projectId);
    });

    it("token expiration", async () => {
        const secret = "expire‑secret";

        const pt = new ParticipantToken({ name: "eve" });
        const exp = new Date(Date.now() + 5000); // +5 seconds

        const token = await pt.toJwt({ token: secret, expiration: exp });

        const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
            algorithms: ["HS256"],
        });
        const expAsSeconds = typeof payload.exp === "number" ? payload.exp : 0;

        expect(Math.abs(expAsSeconds - Math.floor(exp.getTime() / 1000))).to.be.lessThan(2);
    });

    it("token jwt uses default secret and strips kid", async () => {
        const token = new ParticipantToken({ name: "grace", apiKeyId: "should-strip" });
        const envVars = process.env as Record<string, string | undefined>;
        const previousSecret = envVars.MESHAGENT_SECRET;
        const previousApiKey = envVars.MESHAGENT_API_KEY;

        envVars.MESHAGENT_SECRET = "default-secret";
        delete envVars.MESHAGENT_API_KEY;

        try {
            const jwtStr = await token.toJwt();
            const { payload } = await jwtVerify(jwtStr, new TextEncoder().encode("default-secret"), {
                algorithms: ["HS256"],
            });

            expect(payload.kid).to.equal(undefined);
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
});

it("legacy token", () => {
    const token = ParticipantToken.fromJson({
        name: "72c17196-3f2d-4444-a55b-39825e35cbb7",
        grants: [{ name: "room", scope: "44bb91aa-2555-4487-8173-580027a87558" }],
        sub: "2",
    });

    expect(token.version).to.equal("0.5.3");
    const api = token.getApiGrant();

    expect(api).to.be.instanceOf(ApiScope);

    expect(api).to.not.equal(undefined);

    const a = api as ApiScope;

    expect(a.storage).to.not.equal(undefined);
    expect(a.livekit).to.not.equal(undefined);
    expect(a.agents).to.not.equal(undefined);
    expect(a.developer).to.not.equal(undefined);
    expect(a.database).to.not.equal(undefined);
    expect(a.messaging).to.not.equal(undefined);
    expect(a.queues).to.not.equal(undefined);
    expect(a.containers).to.equal(undefined);
    expect(a.admin).to.equal(undefined);

    expect(token.grantScope("room")).to.equal("44bb91aa-2555-4487-8173-580027a87558");

    expect(token.name).to.equal("72c17196-3f2d-4444-a55b-39825e35cbb7");
    expect(a.storage?.canRead("/test")).to.equal(true);
});

