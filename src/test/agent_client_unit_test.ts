import { expect } from "chai";

import { AgentsClient } from "../agent-client.js";
import { ToolContentInput, ToolContentOutput, ToolStreamInput, ToolStreamOutput } from "../agent.js";
import { JsonContent, TextContent, type Content } from "../response.js";
import type { RoomClient } from "../room-client.js";

type InvokeParams = {
  toolkit: string;
  tool: string;
  arguments?: Record<string, unknown>;
  participantId?: string;
  onBehalfOfId?: string;
};

type InvokeToolCallParams = {
  toolkit: string;
  tool: string;
  input: Content | AsyncIterable<Content>;
  streamInput?: boolean;
  participantId?: string;
  onBehalfOfId?: string;
};

class FakeRoom {
  public readonly invokeCalls: InvokeParams[] = [];
  public readonly invokeToolCalls: InvokeToolCallParams[] = [];

  public async invokeContent(params: InvokeParams): Promise<Content> {
    this.invokeCalls.push(params);
    return new JsonContent({ json: { legacy: true } });
  }

  public async invokeToolCall(params: InvokeToolCallParams): Promise<
    { kind: "content"; content: Content; inputClosed?: Promise<void> }
    | { kind: "stream"; stream: AsyncIterable<Content>; inputClosed?: Promise<void> }
  > {
    this.invokeToolCalls.push(params);
    if (params.streamInput === true) {
      async function* output(): AsyncIterable<Content> {
        yield new TextContent({ text: "chunk" });
      }
      return { kind: "stream", stream: output(), inputClosed: Promise.resolve() };
    }
    return { kind: "content", content: new JsonContent({ json: { ok: true } }) };
  }
}

describe("agent_client_unit_test", () => {
  it("keeps legacy JSON argument invokeTool calls", async () => {
    const room = new FakeRoom();
    const client = new AgentsClient({ room: room as unknown as RoomClient });

    const output = await client.invokeTool({
      toolkit: "math",
      tool: "sum",
      arguments: { a: 1, b: 2 },
      participantId: "participant-1",
      onBehalfOfId: "user-1",
    });

    expect(output).to.be.instanceOf(JsonContent);
    expect((output as JsonContent).json).to.deep.equal({ legacy: true });
    expect(room.invokeCalls).to.deep.equal([
      {
        toolkit: "math",
        tool: "sum",
        arguments: { a: 1, b: 2 },
        participantId: "participant-1",
        onBehalfOfId: "user-1",
      },
    ]);
  });

  it("accepts ToolContentInput and returns ToolContentOutput", async () => {
    const room = new FakeRoom();
    const client = new AgentsClient({ room: room as unknown as RoomClient });
    const input = new ToolContentInput(new JsonContent({ json: { value: "hello" } }));

    const output = await client.invokeTool({
      toolkit: "demo",
      tool: "echo",
      input,
      participantId: "participant-1",
      onBehalfOfId: "user-1",
    });

    expect(output).to.be.instanceOf(ToolContentOutput);
    expect((output as ToolContentOutput).content).to.be.instanceOf(JsonContent);
    expect(room.invokeToolCalls).to.have.length(1);
    expect(room.invokeToolCalls[0]).to.include({
      toolkit: "demo",
      tool: "echo",
      input: input.content,
      participantId: "participant-1",
      onBehalfOfId: "user-1",
    });
  });

  it("accepts ToolStreamInput and returns ToolStreamOutput", async () => {
    const room = new FakeRoom();
    const client = new AgentsClient({ room: room as unknown as RoomClient });
    async function* input(): AsyncIterable<Content> {
      yield new TextContent({ text: "request" });
    }

    const output = await client.invokeTool({
      toolkit: "demo",
      tool: "stream",
      input: new ToolStreamInput(input()),
    });

    expect(output).to.be.instanceOf(ToolStreamOutput);
    const chunks: Content[] = [];
    for await (const chunk of (output as ToolStreamOutput).stream) {
      chunks.push(chunk);
    }
    await (output as ToolStreamOutput).inputClosed;
    expect(chunks).to.have.length(1);
    expect(chunks[0]).to.be.instanceOf(TextContent);
    expect((chunks[0] as TextContent).text).to.equal("chunk");
    expect(room.invokeToolCalls[0].streamInput).to.equal(true);
  });
});
