import { expect } from "chai";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { AnonymousAccessTokenProvider } from "../anonymous-access-token-provider.js";
import { RoomClient } from "../room-client.js";
import { WebSocketProtocolChannel } from "../protocol.js";
import { packMessage } from "../utils.js";

function send(socket: WebSocket, id: number, type: string, data: Record<string, unknown>): void {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(id, 4);
  header.writeUInt32BE(1, 12);
  socket.send(Buffer.concat([header, Buffer.from(type)]));
  const part = Buffer.alloc(12);
  part.writeUInt32BE(id, 4);
  part.writeUInt32BE(1, 8);
  socket.send(Buffer.concat([part, packMessage(data)]));
}

describe("anonymous connections", () => {
  it("does not retry denied anonymous access", async () => {
    let calls = 0;
    const room = RoomClient.withAnonymous({ authorizationUrl: "https://example.test/.well-known/meshagent/authorize", fetch: async () => {
      calls++;
      return new Response("denied", { status: 401 });
    }});
    try {
      await room.start();
      throw new Error("expected refusal");
    } catch (error) {
      expect(String(error)).to.contain("denied");
      expect(error).to.have.property("statusCode", 401);
      expect(error).to.have.property("errorCode", "anonymous_access_denied");
      expect(calls).to.equal(1);
    } finally { room.dispose(); }
  });
  it("renews an expired room token on reconnect without changing the visitor", async () => {
    const cookies: (string | undefined)[] = [];
    const tokens: string[] = [];
    let issued = 0;
    const server = createServer((request, response) => {
      expect(request.method).to.equal("POST");
      expect(request.url).to.equal("/.well-known/meshagent/authorize");
      cookies.push(request.headers.cookie);
      response.setHeader("Set-Cookie", "__meshagent_anonymous=visitor-one; HttpOnly; Path=/");
      response.end(JSON.stringify({ jwt: `token-${++issued}`, connect_path: "/.well-known/meshagent/room/connect", expires_in: 0.01 }));
    });
    const sockets = new WebSocketServer({ server });
    let finish!: () => void;
    const reconnected = new Promise<void>((resolve) => { finish = resolve; });
    sockets.on("connection", (socket, request) => {
      tokens.push(request.headers.authorization ?? "");
      send(socket, 0, "room_ready", { room_name: "test", room_url: "/test", session_id: "session" });
      send(socket, 1, "connected", { type: "init", participantId: "visitor-one", attributes: { name: "visitor-one" } });
      if (tokens.length === 1) setTimeout(() => socket.close(1012, "restart"), 30);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address == null || typeof address === "string") throw new Error("missing address");
    const room = RoomClient.withAnonymous({ authorizationUrl: `http://127.0.0.1:${address.port}/.well-known/meshagent/authorize`, reconnectTimeout: 2000 });
    room.on("reconnected", finish);
    try {
      await room.start();
      await reconnected;
      expect(tokens).to.deep.equal(["Bearer token-1", "Bearer token-2"]);
      expect(cookies).to.deep.equal([undefined, "__meshagent_anonymous=visitor-one"]);
      expect(room.protocol.token).to.equal("token-2");
    } finally {
      room.dispose();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("shares concurrent exchanges, exposes expiry, and rejects revoked access", async () => {
    let requests = 0;
    const provider = new AnonymousAccessTokenProvider({
      resource: "room", authorizationUrl: "https://example.test/.well-known/meshagent/authorize",
      fetch: async (_url, init) => {
        expect(init?.credentials).to.equal("include");
        return ++requests === 1
          ? new Response(JSON.stringify({ jwt: "first", connect_path: "/.well-known/meshagent/room/connect", expires_in: 300 }))
          : new Response("revoked", { status: 403 });
      },
    });
    expect(await Promise.all([provider.getToken(), provider.getToken()])).to.deep.equal(["first", "first"]);
    expect(requests).to.equal(1);
    expect(provider.expiresAt!.getTime()).to.be.greaterThan(Date.now());
    try { await provider.getToken(); throw new Error("expected refusal"); }
    catch (error) { expect(error).to.have.property("statusCode", 403); expect(String(error)).to.contain("revoked"); }
  });

  for (const [body, status, message, code] of [
    ["<html>proxy failure</html>", 503, "Anonymous authorization failed", "anonymous_authorization_failed"],
    ["not json", 200, "expected JSON", "invalid_anonymous_authorization_response"],
    ["{}", 200, "Invalid anonymous authorization response", "invalid_anonymous_authorization_response"],
  ] as const) {
    it(`reports a useful error for ${body}`, async () => {
      const provider = new AnonymousAccessTokenProvider({ resource: "room", authorizationUrl: "https://example.test", fetch: async () => new Response(body, { status }) });
      try { await provider.getToken(); throw new Error("expected failure"); }
      catch (error) {
        expect(String(error)).to.contain(message);
        expect(String(error)).not.to.contain("<html>");
        expect(error).to.have.property("errorCode", code);
      }
    });
  }

  it("does not open a socket after disposal during authorization", async () => {
    let resolve!: (token: string) => void;
    const channel = new WebSocketProtocolChannel({ url: "ws://127.0.0.1:1", jwt: null, tokenProvider: () => new Promise<string>((done) => { resolve = done; }) });
    channel.start(() => {}, { onError: () => { throw new Error("disposed channel reported an error"); } });
    channel.dispose();
    resolve("late-token");
    await new Promise((done) => setTimeout(done, 0));
    expect(channel.webSocket).to.equal(null);
  });
});
