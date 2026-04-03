import { expect } from "chai";

import { MessagingClient } from "../messaging-client";
import { RemoteParticipant } from "../participant";
import { RoomMessage } from "../room-event";
import { RoomServerException } from "../room-server-client";

class FakeProtocol {
  public handlers = new Map<string, unknown>();

  public addHandler(type: string, handler: unknown): void {
    this.handlers.set(type, handler);
  }

  public removeHandler(type: string): void {
    this.handlers.delete(type);
  }
}

class FakeRoom {
  public readonly protocol = new FakeProtocol();
  public readonly invocations: Array<{toolkit: string; tool: string; input: Record<string, any>}> = [];

  public async invoke(params: {
    toolkit: string;
    tool: string;
    input: Record<string, any>;
  }): Promise<void> {
    this.invocations.push(params);
  }

  public emit(): void {}
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
    await client.start();

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

  it("ignores offline remotes when ignoreOffline is enabled", async () => {
    const room = new FakeRoom();
    const client = new MessagingClient({ room: room as never });
    await client.start();

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
    await client.start();

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
    await client.enable();
    expect(client.isEnabled).to.equal(true);

    (client as any)._onParticipantEnabled(participantEnabledMessage());

    const participants = client.getParticipants();
    expect(participants).to.have.length(1);
    expect(client.getParticipant("remote-1")).to.equal(participants[0]);
    expect(client.getParticipantByName("Remote User")).to.equal(participants[0]);

    await client.disable();
    expect(client.isEnabled).to.equal(false);
  });

  it("drops nowait messages for removed participants", async () => {
    const room = new FakeRoom();
    const client = new MessagingClient({ room: room as never });
    await client.start();

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
});
