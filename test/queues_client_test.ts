// test_queues_mocha.ts

// import { describe, it, before, after } from "mocha";
import { expect } from "chai"; // or any other Chai interface you prefer

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

describe("test_queues_client", function () {
  // Increase timeout if necessary to accommodate WebSocket round trips.
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
  });

  after(async () => {
    client1.dispose();
    client2.dispose();
  });

  it("test_can_receive_last", async () => {
    await client1.queues.send("test_queue", { hello: "world" }, true);

    const message = await client2.queues.receive("test_queue", false, true);

    expect(message?.hello).to.equal("world");
  });

  it("test_can_receive_first", async () => {
    const messageFuture = client2.queues.receive("test_queue", true, true);

    // small delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await client1.queues.send("test_queue", { hello: "world" }, false);

    const message = await messageFuture;

    expect(message?.hello).to.equal("world");
  });

  it("test_can_receive_no_wait", async () => {
    // client2 checks immediately (no wait), expects null. Then client1 sends a message.
    let message = await client2.queues.receive("test_queue", true, false);

    expect(message).to.equal(null);

    // Now send a message
    await client1.queues.send("test_queue", { hello: "world" }, false);

    // And receive again with no wait
    message = await client2.queues.receive("test_queue", true, false);

    expect(message?.hello).to.equal("world");
  });
});
