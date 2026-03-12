// test_storage_client_mocha.ts

// import { describe, it, before, after } from "mocha";
import { expect } from "chai";

import {
    ChildProperty,
    ElementType,
    FileDeletedEvent,
    FileUpdatedEvent,

    MeshSchema,
    RoomClient,
    RoomEvent,
    SimpleValue,
    ValueProperty,
    websocketProtocol,
} from "../index";

import { encoder } from "../utils";

import { room, subscribe, getConfig } from "./utils";

const schema = new MeshSchema({
    rootTagName: "sample",
    elements: [
        new ElementType({
            description: "test",
            tagName: "sample",
            properties: [
                new ChildProperty({
                    name: "children",
                    description: "desc",
                    childTagNames: ["child"],
                }),
            ],
        }),
        new ElementType({
            tagName: "child",
            description: "child",
            properties: [
                new ValueProperty({
                    name: "prop",
                    description: "desc",
                    type: SimpleValue.number,
                }),
            ],
        }),
    ],
});

async function* singleChunk(data: Uint8Array): AsyncIterable<Uint8Array> {
    yield data;
}

describe("test storage client", function () {
    // Increase timeout if necessary for network or WebSocket delays
    this.timeout(10000);

    let client: RoomClient;

    before(async () => {
        const config = getConfig();

        const protocol = await websocketProtocol({
            roomName: room,
            participantName: "client",
            ...config,
        });

        client = new RoomClient({ protocol });

        // Start the client and wait for readiness
        await client.start();
    });

    after(async () => {
        client.dispose();
    });

    it("test_storage_exists_when_non_existent", async () => {
        const path = "non_existent_file.txt";
        const exists = await client.storage.exists(path);

        expect(exists).to.equal(false, "Expected file to not exist");
    });

    it("test_storage_create_file", async () => {
        const path = "test_file.txt";
        const dataToWrite = encoder.encode("Hello, world!");
        await client.storage.uploadStream(path, singleChunk(dataToWrite), { overwrite: false, size: dataToWrite.length });

        const exists = await client.storage.exists(path);
        expect(exists).to.equal(true, `Expected file ${path} to exist after writing`);
    });

    it("test_storage_download", async () => {
        const path = "download_test.txt";
        const content = encoder.encode("Check download content");

        await client.storage.uploadStream(path, singleChunk(content), { overwrite: false, size: content.length });

        // Now download
        const fileResponse = await client.storage.download(path);

        // fileResponse.data should be a Uint8Array matching 'content'
        expect(fileResponse.data).to.deep.equal(content, "Downloaded content should match what was written");
    });

    it("test_storage_storage_download_url", async () => {
        const path = "download_url_test.bin";
        const content = encoder.encode("Some binary content");

        await client.storage.uploadStream(path, singleChunk(content), { overwrite: false, size: content.length });

        const downloadLink = await client.storage.downloadUrl(path);
        expect(downloadLink).to.be.a("string", "Expected downloadUrl to return a string");
        expect(/(ws|http)/.test(downloadLink)).to.equal(
            true,
            `Expected the returned URL to be an HTTP/WS address, got ${downloadLink}`
        );
    });

    it("test_storage_list", async () => {
        const path = "list_test_folder";
        const files = ["a.txt", "b.txt", "c.txt"];

        for (const f of files) {
            const fullPath = `${path}/${f}`;
            const content = encoder.encode("some content");
            await client.storage.uploadStream(fullPath, singleChunk(content), { overwrite: true, size: content.length });
        }

        const listing = await client.storage.list(path);
        expect(listing.length).to.equal(files.length, `Expected ${files.length} files in folder listing`);

        const listedNames = listing.map((x) => x.name).sort();
        files.sort();
        expect(listedNames).to.deep.equal(files, "The listed files should match the created files");
    });

    it("test_storage_delete", async () => {
        const path = "delete_me.txt";
        const content = encoder.encode("Delete this content");

        await client.storage.uploadStream(path, singleChunk(content), { overwrite: false, size: content.length });

        const existsNow = await client.storage.exists(path);
        expect(existsNow).to.equal(true, "File should exist after creation");

        // delete the file
        await client.storage.delete(path);
        const stillExists = await client.storage.exists(path);
        expect(stillExists).to.equal(false, "File should not exist after deletion");
    });

    it("test_storage_file_update_events", async () => {
        const path = "event_test.txt";

        // This requires that your server (via `StorageExtension`) actually emits the events
        let updatedCalledResolve: () => void = () => {};
        let deletedCalledResolve: () => void = () => {};

        // Patch the client storage handlers
        const subscription = subscribe<RoomEvent>(client.listen(), {
            next: (event: RoomEvent) => {
                if (event instanceof FileUpdatedEvent) {
                    updatedCalledResolve();
                }
                if (event instanceof FileDeletedEvent) {
                    deletedCalledResolve();
                }
            },
        });

        const updatedCalled = new Promise<void>((res) => (updatedCalledResolve = res));
        {
            const content = encoder.encode("Testing events");
            await client.storage.uploadStream(path, singleChunk(content), { overwrite: false, size: content.length });
        }
        await updatedCalled;

        const updatedCalledAgain = new Promise<void>((res) => (updatedCalledResolve = res));
        {
            const content = encoder.encode("Changed content");
            await client.storage.uploadStream(path, singleChunk(content), { overwrite: true, size: content.length });
        }
        await updatedCalledAgain;

        // 3) Now delete it, watch for 'file_deleted'
        const deletedCalledP = new Promise<void>((res) => (deletedCalledResolve = res));
        await client.storage.delete(path);
        await deletedCalledP;

        subscription.unsubscribe();
    });

    it("test_room_client_schema", async () => {
        const path = ".schemas/sample_test_schema.json";
        const content = encoder.encode(JSON.stringify(schema.toJson()));
        await client.storage.uploadStream(path, singleChunk(content), { overwrite: true, size: content.length });

        const exists = await client.storage.exists(path);
        expect(exists).to.be.true;
    });

    it("test_room_client_download_multiple_files", async () => {
        const path1 = "file_text_1.txt";
        const content1 = encoder.encode(JSON.stringify({ message: "Hello, world! (1)" }));
        await client.storage.uploadStream(path1, singleChunk(content1), { overwrite: true, size: content1.length });

        const path2 = "file_text_2.txt";
        const content2 = encoder.encode(JSON.stringify({ message: "Hello, world! (2)" }));
        await client.storage.uploadStream(path2, singleChunk(content2), { overwrite: true, size: content2.length });

        const path3 = "file_text_3.txt";
        const content3 = encoder.encode(JSON.stringify({ message: "Hello, world! (3)" }));
        await client.storage.uploadStream(path3, singleChunk(content3), { overwrite: true, size: content3.length });

        const downloadResponse1 = await client.storage.download(path1);
        const downloadResponse2 = await client.storage.download(path2);
        const downloadResponse3 = await client.storage.download(path3);

        expect(downloadResponse1.data).to.deep.equal(content1, "Content should match what was written");
        expect(downloadResponse2.data).to.deep.equal(content2, "Content should match what was written");
        expect(downloadResponse3.data).to.deep.equal(content3, "Content should match what was written");
    });
});
