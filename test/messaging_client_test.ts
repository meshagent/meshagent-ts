// test_messaging_client_mocha.ts

// import { describe, it, before, after } from "mocha";
import { expect } from "chai";

import {
  Protocol,
  RoomClient,
  WebSocketProtocolChannel,
} from "../src/index";

import {
  createJwt,
  MESHAGENT_URL,
  room,
} from "./utils";

import { encoder } from "../src/utils";

describe("messaging", function () {
  // Increase the test timeout if necessary (WebSocket + network delays).
  this.timeout(10000);

  const url = `${MESHAGENT_URL}/rooms/${room}`;

  let token1: string;
  let token2: string;
  let chan1: WebSocketProtocolChannel;
  let chan2: WebSocketProtocolChannel;
  let protocol1: Protocol;
  let protocol2: Protocol;
  let client1: RoomClient;
  let client2: RoomClient;

  before(async () => {
    token1 = await createJwt("client1");
    token2 = await createJwt("client2");

    chan1 = new WebSocketProtocolChannel(url, token1);
    chan2 = new WebSocketProtocolChannel(url, token2);

    protocol1 = new Protocol(chan1);
    protocol2 = new Protocol(chan2);

    client1 = new RoomClient(protocol1);
    client2 = new RoomClient(protocol2);

    // Start the clients
    client1.start();
    client2.start();

    // Wait for both to be ready
    await client1.ready;
    await client2.ready;

    // Enable the messaging module
    await client1.messaging.enable();
    await client2.messaging.enable();
  });

  after(async () => {
    client1.dispose();
    client2.dispose();
  });

  it("should send and receive a message", async () => {
    client2.messaging.addListener((event) => {
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

