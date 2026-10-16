import { expect } from "chai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiScope, FilesPolicy, ParticipantToken, StorageGrant } from "../index.js";

describe("storage_policy_test", () => {
    it("round trips shared policy vectors without expanding file grants", async () => {
        const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "../../testdata/files-permissions.json"), "utf8"));
        for (const [key, cases] of [["grant", "cases"], ["legacy_grant", "legacy_cases"]]) {
            const grant = StorageGrant.fromJSON(fixture[key]);
            let restored = StorageGrant.fromJSON(JSON.parse(JSON.stringify(grant.toJSON())));
            const participant = new ParticipantToken({ name: "files-policy-test" });
            participant.addApiGrant(new ApiScope({ storage: restored }));
            const secret = "files-policy-test-secret-at-least-32-bytes";
            const decoded = await ParticipantToken.fromJwt(await participant.toJwt({ token: secret }), { token: secret });
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
