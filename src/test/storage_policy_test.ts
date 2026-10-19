import { expect } from "chai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiScope, encodeApiKey, FilesPolicy, ParticipantToken, StorageGrant } from "../index.js";

describe("storage_policy_test", () => {
    it("round trips shared policy vectors without expanding file grants", async () => {
        const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "../../testdata/files-permissions.json"), "utf8"));
        for (const [key, cases] of [["grant", "cases"], ["legacy_grant", "legacy_cases"]]) {
            const grant = StorageGrant.fromJSON(fixture[key]);
            let restored = StorageGrant.fromJSON(JSON.parse(JSON.stringify(grant.toJSON())));
            const participant = new ParticipantToken({ name: "files-policy-test" });
            participant.addApiGrant(new ApiScope({ storage: restored }));
            const secret = "files-policy-test-secret-at-least-32-bytes";
            // An explicit API key keeps this fixture independent of CI's
            // MESHAGENT_API_KEY, which takes precedence over a bare secret.
            const apiKey = encodeApiKey({
                id: "72c17196-3f2d-4444-a55b-39825e35cbb7",
                projectId: "44bb91aa-2555-4487-8173-580027a87558",
                secret,
            });
            const decoded = await ParticipantToken.fromJwt(await participant.toJwt({ apiKey }), { token: secret });
            restored = decoded.getApiGrant()!.storage!;
            for (const value of fixture[cases]) {
                const { path, ...expected } = value;
                expect({
                    read: restored.canRead(path), write: restored.canWrite(path), delete: restored.canDelete(path),
                    list: restored.canList(path), list_directory: restored.canListDirectory(path), presign: restored.canPresign(path),
                    read_tree: restored.canRead(path, { subtree: true }), write_tree: restored.canWrite(path, { subtree: true }),
                    delete_tree: restored.canDelete(path, { recursive: true }),
                }, `${key}: ${path}`).to.deep.equal(expected);
            }
        }
        expect(new StorageGrant({ files: new FilesPolicy() }).canRead("public/file")).to.equal(false);
        expect(new StorageGrant({ files: new FilesPolicy() }).canWrite("public/file")).to.equal(false);
        expect(new StorageGrant().canPresign("file")).to.equal(false);
    });
});
