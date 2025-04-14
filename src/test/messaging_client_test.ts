// test_messaging_client_mocha.ts

// import { describe, it, before, after } from "mocha";
import { expect } from "chai";

import { RoomClient, websocketProtocol } from "../index";

import { room } from "./utils";

import { encoder } from "../utils";

describe("messaging", function () {
    // Increase the test timeout if necessary (WebSocket + network delays).
    this.timeout(10000);

    let client1: RoomClient;
    let client2: RoomClient;

    before(async () => {
        const protocol1 = await websocketProtocol({roomName: room, participantName: 'client1'});
        const protocol2 = await websocketProtocol({roomName: room, participantName: 'client2'});

        client1 = new RoomClient({protocol: protocol1});
        client2 = new RoomClient({protocol: protocol2});

        await client1.start();
        await client2.start();

        // Enable the messaging module
        await client1.messaging.enable();
        await client2.messaging.enable();
    });

    after(async () => {
        client1.dispose();
        client2.dispose();
    });

    it("should send and receive a message", async () => {
        client2.messaging.on("message", (event) => {
            expect(event.message.type).to.equal("test");
            expect(event.message.message).to.deep.equal({ test: "test2" });
        });

        await client1.messaging.sendMessage({
            to: client2.localParticipant!,
            type: "test",
            message: { test: "test2" },
            attachment: encoder.encode("bytes"),
        });
    });
});

