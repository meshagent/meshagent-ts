// test_storage_client_mocha.ts

// import { describe, it, before, after } from "mocha";
import { expect } from "chai";

import {
    ChildProperty,
    ElementType,
    FileHandle,

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

import { room, subscribe } from "./utils";

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

describe("test storage client", function () {
    // Increase timeout if necessary for network or WebSocket delays
    this.timeout(10000);

    let client: RoomClient;

    before(async () => {
        const protocol = await websocketProtocol({
            roomName: room,
            participantName: "client",
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

        const handle = await client.storage.open(path, { overwrite: false });
        expect(handle).to.be.instanceOf(FileHandle, "Expected handle to be a FileHandle");

        const dataToWrite = encoder.encode("Hello, world!");
        await client.storage.write(handle, dataToWrite);
        await client.storage.close(handle);

        const exists = await client.storage.exists(path);
        expect(exists).to.equal(true, `Expected file ${path} to exist after writing`);
    });

    it("test_storage_download", async () => {
        const path = "download_test.txt";
        const content = encoder.encode("Check download content");

        // Open/write/close
        const handle = await client.storage.open(path, { overwrite: false });
        await client.storage.write(handle, content);
        await client.storage.close(handle);

        // Now download
        const fileResponse = await client.storage.download(path);

        // fileResponse.data should be a Uint8Array matching 'content'
        expect(fileResponse.data).to.deep.equal(content, "Downloaded content should match what was written");
    });

    it("test_storage_storage_download_url", async () => {
        const path = "download_url_test.bin";
        const content = encoder.encode("Some binary content");

        const handle = await client.storage.open(path, { overwrite: false });
        await client.storage.write(handle, content);
        await client.storage.close(handle);

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
            const handle = await client.storage.open(fullPath, { overwrite: true });
            await client.storage.write(handle, encoder.encode("some content"));
            await client.storage.close(handle);
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

        // create the file
        const handle = await client.storage.open(path, { overwrite: false });
        await client.storage.write(handle, content);
        await client.storage.close(handle);

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

        // 1) Open/write/close triggers 'file_updated'
        const updatedCalled = new Promise<void>((res) => (updatedCalledResolve = res));
        const handle = await client.storage.open(path, { overwrite: false });
        await client.storage.write(handle, encoder.encode("Testing events"));
        await client.storage.close(handle);
        await updatedCalled;

        // 2) Re-open & write to trigger 'file_updated' event again
        const updatedCalledAgain = new Promise<void>((res) => (updatedCalledResolve = res));
        const handle2 = await client.storage.open(path, { overwrite: true });
        await client.storage.write(handle2, encoder.encode("Changed content"));
        await client.storage.close(handle2);
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
        const handle = await client.storage.open(path, { overwrite: true });

        await client.storage.write(handle, content);
        await client.storage.close(handle);

        const exists = await client.storage.exists(path);
        expect(exists).to.be.true;
    });
});

