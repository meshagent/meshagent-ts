// test_queues_mocha.ts

import { expect } from "chai"; // or any other Chai interface you prefer

import { RoomClient, websocketProtocol } from "../index";

import { getConfig, room } from "./utils";

describe("test_queues_client", function () {
    // Increase timeout if necessary to accommodate WebSocket round trips.
    this.timeout(10000);

    let client1: RoomClient;
    let client2: RoomClient;

    before(async () => {
        const config = getConfig();

        const protocol1 = await websocketProtocol({
            roomName: room,
            participantName: 'client1',
            ...config,
        });
        const protocol2 = await websocketProtocol({
            roomName: room,
            participantName: 'client2',
            ...config,
        });

        client1 = new RoomClient({protocol: protocol1});
        client2 = new RoomClient({protocol: protocol2});

        await client1.start();
        await client2.start();
    });

    after(async () => {
        client1.dispose();
        client2.dispose();
    });

    it("test_can_receive_last", async () => {
        await client1.queues.send("test_queue", { hello: "world" }, { create: true });

        const message = await client2.queues.receive("test_queue", { create: false, wait: true });

        expect(message?.hello).to.equal("world");
    });

    it("test_can_receive_first", async () => {
        const messageFuture = client2.queues.receive("test_queue", { create: true, wait: true });

        // small delay
        await new Promise((resolve) => setTimeout(resolve, 1000));

        await client1.queues.send("test_queue", { hello: "world" }, { create: false });

        const message = await messageFuture;

        expect(message?.hello).to.equal("world");
    });

    it("test_can_receive_no_wait", async () => {
        // client2 checks immediately (no wait), expects null. Then client1 sends a message.
        let message = await client2.queues.receive("test_queue", { create: true, wait: false });

        expect(message).to.equal(null);

        // Now send a message
        await client1.queues.send("test_queue", { hello: "world" }, { create: false });

        // And receive again with no wait
        message = await client2.queues.receive("test_queue", { create: true, wait: false });

        expect(message?.hello).to.equal("world");
    });
});
