// test_messaging_client_mocha.ts

// import { describe, it, before, after } from "mocha";
import { expect } from "chai";

import { RoomClient, websocketProtocol } from "../index.js";

import { getConfig, room } from "./utils.js";

import { encoder } from "../utils.js";

describe("messaging", function (this: Mocha.Suite) {
    // Increase the test timeout if necessary (WebSocket + network delays).
    this.timeout(10000);

    let client1: RoomClient;
    let client2: RoomClient;

    before(async () => {
        const config = getConfig();
        const protocolFactory1 = await websocketProtocol({roomName: room, participantName: 'client1', ...config});
        const protocolFactory2 = await websocketProtocol({roomName: room, participantName: 'client2', ...config});

        client1 = new RoomClient({protocolFactory: protocolFactory1});
        client2 = new RoomClient({protocolFactory: protocolFactory2});

        await client1.start();
        await client2.start();

        // Enable the messaging module
        client1.messaging.enable();
        client2.messaging.enable();
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
