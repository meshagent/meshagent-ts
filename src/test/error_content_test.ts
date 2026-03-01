import { expect } from "chai";

import { ErrorContent, unpackContent } from "../response";
import { RoomClient } from "../room-client";
import { RoomServerException } from "../room-server-client";
import { Protocol, ProtocolChannel } from "../protocol";

class NoopChannel implements ProtocolChannel {
  start(
    _onDataReceived: (data: Uint8Array) => void,
    _opts: { onDone?: () => void; onError?: (error: any) => void },
  ): void {}

  dispose(): void {}

  async sendData(_data: Uint8Array): Promise<void> {}
}

class TestProtocol extends Protocol {
  constructor(private readonly fixedMessageId: number) {
    super({ channel: new NoopChannel() });
  }

  override getNextMessageId(): number {
    return this.fixedMessageId;
  }

  override async send(_type: string, _data: Uint8Array, _id?: number): Promise<void> {}
}

describe("error_content_test", () => {
  it("round trips error code through pack/unpack", () => {
    const packed = new ErrorContent({ text: "boom", code: 1234 }).pack();
    const unpacked = unpackContent(packed);

    expect(unpacked).to.be.instanceOf(ErrorContent);
    const error = unpacked as ErrorContent;
    expect(error.text).to.equal("boom");
    expect(error.code).to.equal(1234);
  });

  it("maps ErrorContent.code to RoomServerException.code in sendRequest", async () => {
    const messageId = 77;
    const protocol = new TestProtocol(messageId);
    const room = new RoomClient({ protocol });

    const pending = room.sendRequest("room.test", {});
    await (room as any)._handleResponse(
      protocol,
      messageId,
      "__response__",
      new ErrorContent({ text: "permission denied", code: 4032 }).pack(),
    );

    try {
      await pending;
      expect.fail("Expected sendRequest to reject");
    } catch (error) {
      expect(error).to.be.instanceOf(RoomServerException);
      const roomError = error as RoomServerException;
      expect(roomError.message).to.equal("permission denied");
      expect(roomError.code).to.equal(4032);
    }
  });
});
