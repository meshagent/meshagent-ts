import { expect } from "chai";

import { MessagingClient } from "../messaging-client.js";
import { RemoteParticipant } from "../participant.js";
import { RoomMessage } from "../room-event.js";
import { JsonContent } from "../response.js";
import { RoomServerException } from "../room-server-client.js";

class FakeProtocol {
  public handlers = new Map<string, unknown>();

  public addHandler(type: string, handler: unknown): void {
    this.handlers.set(type, handler);
  }

  public removeHandler(type: string, handler: unknown): void {
    const current = this.handlers.get(type);
    if (current !== handler) {
      throw new Error(`handler mismatch for ${type}`);
    }
    this.handlers.delete(type);
  }
}

class FakeRoom {
  public readonly protocol = new FakeProtocol();
  public readonly invocations: Array<{toolkit: string; tool: string; input: Record<string, any>}> = [];
  public sendResponseGate: Promise<void> | null = null;
  public firstSendDispatchGate: Promise<void> | null = null;
  public isConnected = true;
  public _allowDisconnectedRequests = false;
  public localParticipant = null;

  public async invokeContent(params: {
    toolkit: string;
    tool: string;
    input: unknown;
    afterSend?: () => void;
  }): Promise<void> {
    const input = params.input instanceof JsonContent
      ? params.input.json
      : (params.input as Record<string, any>);
    if (
      params.tool === "send"
      && JSON.parse(input["message_json"] as string).index === 1
      && this.firstSendDispatchGate != null
    ) {
      await this.firstSendDispatchGate;
    }
    this.invocations.push({
      toolkit: params.toolkit,
      tool: params.tool,
      input,
    });
    params.afterSend?.();
    if (params.tool === "send" && this.sendResponseGate != null) {
      await this.sendResponseGate;
    }
  }

  public invokeNowait(params: {
    toolkit: string;
    tool: string;
    input?: unknown;
  }): void {
    void this.invokeContent({
      toolkit: params.toolkit,
      tool: params.tool,
      input: params.input ?? {},
    });
  }

  public isActiveProtocol(): boolean {
    return true;
  }

  public async _waitUntilConnectedForMessages(): Promise<void> {}

  public _raiseIfTerminalForMessages(): void {}

  public _coerceMessageSendError(error: RoomServerException): RoomServerException {
    return error;
  }

  public _messageStopError(): RoomServerException {
    return new RoomServerException("Cannot send messages because messaging has been stopped");
  }

  public emit(): void {}
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 250;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("condition was not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function participantEnabledMessage(): RoomMessage {
  return new RoomMessage({
    fromParticipantId: "remote-1",
    type: "participant.enabled",
    message: {
      id: "remote-1",
      role: "member",
      attributes: { name: "Remote User" },
    },
  });
}

function participantDisabledMessage(): RoomMessage {
  return new RoomMessage({
    fromParticipantId: "remote-1",
    type: "participant.disabled",
    message: { id: "remote-1" },
  });
}

describe("messaging participant presence", () => {
  it("resolves ad-hoc remote participants by id before sending", async () => {
    const room = new FakeRoom();
    const client = new MessagingClient({ room: room as never });
    client.start();

    (client as any)._onParticipantEnabled(participantEnabledMessage());

    await client.sendMessage({
      to: new RemoteParticipant(room as never, "remote-1", "member"),
      type: "direct",
      message: { value: 1 },
    });

    expect(room.invocations).to.have.length(1);
    expect(room.invocations[0]).to.deep.equal({
      toolkit: "messaging",
      tool: "send",
      input: {
        to_participant_id: "remote-1",
        type: "direct",
        message_json: JSON.stringify({ value: 1 }),
      },
    });

    await client.stop();
  });

  it("pipelines queued sends before their responses", async () => {
    const room = new FakeRoom();
    let releaseResponses!: () => void;
    room.sendResponseGate = new Promise<void>((resolve) => {
      releaseResponses = resolve;
    });
    let releaseFirstDispatch!: () => void;
    room.firstSendDispatchGate = new Promise<void>((resolve) => {
      releaseFirstDispatch = resolve;
    });
    const client = new MessagingClient({ room: room as never });
    client.start();
    (client as any)._onParticipantEnabled(participantEnabledMessage());
    const remote = client.getParticipant("remote-1")!;

    client.sendMessageNowait({ to: remote, type: "delta", message: { index: 1 } });
    client.sendMessageNowait({ to: remote, type: "delta", message: { index: 2 } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(room.invocations.filter((invocation) => invocation.tool === "send")).to.be.empty;
    releaseFirstDispatch();
    await waitUntil(() => room.invocations.length === 2);
    expect(room.invocations.map((invocation) => JSON.parse(invocation.input["message_json"]).index))
      .to.deep.equal([1, 2]);

    releaseResponses();
    await client.stop();
  });

  it("ignores offline remotes when ignoreOffline is enabled", async () => {
    const room = new FakeRoom();
    const client = new MessagingClient({ room: room as never });
    client.start();

    (client as any)._onParticipantEnabled(participantEnabledMessage());
    const remote = [...client.remoteParticipants][0];

    (client as any)._onParticipantDisabled(participantDisabledMessage());

    expect(remote.online).to.equal(false);

    await client.sendMessage({
      to: remote,
      type: "direct",
      message: { value: 1 },
      ignoreOffline: true,
    });

    expect(room.invocations).to.deep.equal([]);
    await client.stop();
  });

  it("throws when sending to an offline remote without ignoreOffline", async () => {
    const room = new FakeRoom();
    const client = new MessagingClient({ room: room as never });
    client.start();

    (client as any)._onParticipantEnabled(participantEnabledMessage());
    const remote = [...client.remoteParticipants][0];
    (client as any)._onParticipantDisabled(participantDisabledMessage());

    let error: unknown;
    try {
      await client.sendMessage({
        to: remote,
        type: "direct",
        message: { value: 1 },
      });
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(RoomServerException);
    expect((error as Error).message).to.equal("the participant was not found");
    await client.stop();
  });

  it("exposes participant lookup helpers and enable state", async () => {
    const room = new FakeRoom();
    const client = new MessagingClient({ room: room as never });

    expect(client.isEnabled).to.equal(false);
    client.enable();
    expect(client.isEnabled).to.equal(true);

    (client as any)._onParticipantEnabled(participantEnabledMessage());

    const participants = client.getParticipants();
    expect(participants).to.have.length(1);
    expect(client.getParticipant("remote-1")).to.equal(participants[0]);
    expect(client.getParticipantByName("Remote User")).to.equal(participants[0]);

    client.disable();
    expect(client.isEnabled).to.equal(false);
  });

  it("drops nowait messages for removed participants", async () => {
    const room = new FakeRoom();
    const client = new MessagingClient({ room: room as never });
    client.start();

    (client as any)._onParticipantEnabled(participantEnabledMessage());
    const remote = client.getParticipant("remote-1");
    expect(remote).to.not.equal(null);

    client.sendMessageNowait({
      to: remote!,
      type: "direct",
      message: { value: 1 },
    });
    (client as any)._onParticipantDisabled(participantDisabledMessage());

    await client.stop();

    expect(room.invocations).to.deep.equal([]);
    expect(remote!.online).to.equal(false);
    expect(client.getParticipant("remote-1")).to.equal(null);
  });

  it("clears participants while disconnected and reenables on reconnect", () => {
    const room = new FakeRoom();
    const client = new MessagingClient({ room: room as never });
    client.start();
    client.enable();

    (client as any)._onMessagingEnabled(new RoomMessage({
      fromParticipantId: "remote-1",
      type: "messaging.enabled",
      message: {
        participants: [{
          id: "remote-1",
          role: "member",
          attributes: { name: "Remote User" },
        }],
      },
    }));

    expect(client.online).to.equal(true);
    expect(client.remoteParticipants).to.have.length(1);

    client._onRoomDisconnect({ reason: "socket error" });

    expect(client.online).to.equal(false);
    expect(client.remoteParticipants).to.deep.equal([]);

    client._onRoomReconnect();

    expect(room.invocations).to.deep.include({
      toolkit: "messaging",
      tool: "enable",
      input: {},
    });
  });
});
