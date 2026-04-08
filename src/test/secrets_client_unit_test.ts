import { expect } from "chai";

import type { ConnectorRef, OAuthClientConfig } from "../meshagent-client";
import { Protocol } from "../protocol";
import { BinaryContent, Content, EmptyContent, FileContent, JsonContent } from "../response";
import {
  OAuthTokenRequest,
  SecretRequest,
  SecretsClient,
} from "../secrets-client";
import { packMessage } from "../utils";

type InvokeParams = {
  toolkit: string;
  tool: string;
  input: Record<string, unknown> | Content;
};

type SecretsEventHandler = (
  protocol: Protocol,
  messageId: number,
  type: string,
  bytes?: Uint8Array,
) => Promise<void>;

class FakeProtocol {
  private handlers = new Map<string, SecretsEventHandler>();

  public addHandler(type: string, handler: SecretsEventHandler): void {
    this.handlers.set(type, handler);
  }

  public async dispatch(type: string, payload: Record<string, unknown>): Promise<void> {
    const handler = this.handlers.get(type);
    if (handler == null) {
      throw new Error(`no handler registered for ${type}`);
    }
    await handler(this as unknown as Protocol, 0, type, packMessage(payload as Record<string, any>));
  }
}

class FakeSecretsRoom {
  public readonly protocol = new FakeProtocol();
  public readonly requests: InvokeParams[] = [];

  public async invoke(params: InvokeParams): Promise<Content> {
    this.requests.push(params);

    switch (params.tool) {
      case "get_offline_oauth_token":
        return new JsonContent({ json: { access_token: "offline-token" } });
      case "request_oauth_token":
        return new JsonContent({ json: { access_token: "oauth-token" } });
      case "list_secrets":
        return new JsonContent({
          json: {
            secrets: [
              {
                id: "secret-1",
                type: "text/plain",
                name: "secret.txt",
                delegated_to: null,
              },
            ],
          },
        });
      case "exists": {
        const input = params.input as Record<string, unknown>;
        return new JsonContent({
          json: {
            exists: input["secret_id"] === "secret-1",
          },
        });
      }
      case "request_secret":
        return new FileContent({
          data: new TextEncoder().encode("delegated"),
          name: "delegated.txt",
          mimeType: "text/plain",
        });
      case "get_secret": {
        const input = params.input as Record<string, unknown>;
        if (input["secret_id"] === "missing") {
          return new EmptyContent();
        }
        return new FileContent({
          data: new TextEncoder().encode("secret"),
          name: "secret.txt",
          mimeType: "text/plain",
        });
      }
      default:
        return new EmptyContent();
    }
  }
}

describe("secrets_client_unit_test", () => {
  it("delivers inbound oauth and secret requests to registered handlers", async () => {
    const room = new FakeSecretsRoom();
    const oauthRequests: OAuthTokenRequest[] = [];
    const secretRequests: SecretRequest[] = [];
    new SecretsClient({
      room: room as never,
      oauthTokenRequestHandler: async (request) => {
        oauthRequests.push(request);
      },
      secretRequestHandler: async (request) => {
        secretRequests.push(request);
      },
    });

    await room.protocol.dispatch("secrets.request_oauth_token", {
      request_id: "req-1",
      request: {
        oauth: {
          client_id: "client-id",
          authorization_endpoint: "https://example.com/authorize",
          token_endpoint: "https://example.com/token",
          scopes: ["openid"],
        },
      },
      challenge: "challenge",
    });
    await room.protocol.dispatch("secrets.request_secret", {
      request_id: "req-2",
      request: {
        url: "https://example.com/secret",
        type: "text/plain",
        delegate_to: "agent",
      },
    });
    await Promise.resolve();

    expect(oauthRequests).to.deep.equal([
      {
        requestId: "req-1",
        clientId: "client-id",
        authorizationEndpoint: "https://example.com/authorize",
        tokenEndpoint: "https://example.com/token",
        scopes: ["openid"],
        challenge: "challenge",
      },
    ]);
    expect(secretRequests).to.deep.equal([
      {
        requestId: "req-2",
        url: "https://example.com/secret",
        type: "text/plain",
        delegateTo: "agent",
      },
    ]);
  });

  it("matches the Python secrets client request surface", async () => {
    const room = new FakeSecretsRoom();
    const client = new SecretsClient({ room: room as never });
    const oauth: OAuthClientConfig = {
      client_id: "client-id",
      authorization_endpoint: "https://example.com/authorize",
      token_endpoint: "https://example.com/token",
    };
    const connector: ConnectorRef = {
      openaiConnectorId: "openai-1",
      serverUrl: "https://connector.example",
      clientSecretId: "secret-id",
    };

    await client.provideOAuthAuthorization({ requestId: "req-1", code: "code-1" });
    await client.rejectOAuthAuthorization({ requestId: "req-2", error: "nope" });
    await client.provideSecret({ requestId: "req-3", data: new TextEncoder().encode("secret-bytes") });
    await client.rejectSecret({ requestId: "req-4", error: "declined" });
    expect(await client.getOfflineOAuthToken({ oauth, delegatedBy: "provider" })).to.equal("offline-token");
    expect(
      await client.requestOAuthToken({
        connector,
        oauth,
        fromParticipantId: "provider-id",
        redirectUri: "http://localhost/callback",
        delegateTo: "delegate",
      }),
    ).to.equal("oauth-token");
    expect(await client.listSecrets()).to.deep.equal([
      {
        id: "secret-1",
        type: "text/plain",
        name: "secret.txt",
        delegatedTo: null,
      },
    ]);
    await client.deleteSecret({ secretId: "secret-1" });
    await client.deleteRequestedSecret({ url: "https://example.com/secret", type: "text/plain" });
    expect(
      new TextDecoder().decode(
        await client.requestSecret({
          fromParticipantId: "provider-id",
          url: "https://example.com/secret",
          type: "text/plain",
        }),
      ),
    ).to.equal("delegated");
    await client.setSecret({
      type: "text/plain",
      name: "secret.txt",
      data: new TextEncoder().encode("payload"),
    });
    const secret = await client.getSecret({ type: "text/plain", name: "secret.txt" });
    expect(secret).to.not.equal(null);
    expect(new TextDecoder().decode(secret!.data)).to.equal("secret");
    expect(await client.getSecret({ secretId: "missing" })).to.equal(null);

    expect(room.requests.map((entry) => entry.tool)).to.deep.equal([
      "provide_oauth_authorization",
      "provide_oauth_authorization",
      "provide_secret",
      "provide_secret",
      "get_offline_oauth_token",
      "request_oauth_token",
      "list_secrets",
      "delete_secret",
      "delete_requested_secret",
      "request_secret",
      "set_secret",
      "get_secret",
      "get_secret",
    ]);

    const provideSecretInput = room.requests[2].input;
    expect(provideSecretInput).to.be.instanceOf(BinaryContent);
    expect((provideSecretInput as BinaryContent).headers).to.deep.equal({
      request_id: "req-3",
      error: null,
    });
    expect(new TextDecoder().decode((provideSecretInput as BinaryContent).data)).to.equal("secret-bytes");

    const rejectSecretInput = room.requests[3].input;
    expect(rejectSecretInput).to.be.instanceOf(BinaryContent);
    expect((rejectSecretInput as BinaryContent).headers).to.deep.equal({
      request_id: "req-4",
      error: "declined",
    });
    expect((rejectSecretInput as BinaryContent).data).to.deep.equal(new Uint8Array(0));

    expect(room.requests[4].input).to.deep.equal({
      connector: null,
      oauth: {
        client_id: "client-id",
        client_secret: null,
        authorization_endpoint: "https://example.com/authorize",
        token_endpoint: "https://example.com/token",
        no_pkce: null,
        scopes: null,
      },
      delegated_to: null,
      delegated_by: "provider",
    });

    expect(room.requests[5].input).to.deep.equal({
      connector: {
        openai_connector_id: "openai-1",
        server_url: "https://connector.example",
        client_secret_id: "secret-id",
      },
      oauth: {
        client_id: "client-id",
        client_secret: null,
        authorization_endpoint: "https://example.com/authorize",
        token_endpoint: "https://example.com/token",
        no_pkce: null,
        scopes: null,
      },
      redirect_uri: "http://localhost/callback",
      timeout: 300,
      participant_id: "provider-id",
      delegate_to: "delegate",
    });

    const setSecretInput = room.requests[10].input;
    expect(setSecretInput).to.be.instanceOf(BinaryContent);
    expect((setSecretInput as BinaryContent).headers).to.deep.equal({
      secret_id: null,
      type: "text/plain",
      name: "secret.txt",
      delegated_to: null,
      for_identity: null,
      has_data: true,
    });
    expect(new TextDecoder().decode((setSecretInput as BinaryContent).data)).to.equal("payload");

    expect(room.requests[11].input).to.deep.equal({
      secret_id: null,
      type: "text/plain",
      name: "secret.txt",
      delegated_to: null,
    });
  });

  it("exists uses room.invoke and parses boolean responses", async () => {
    const room = new FakeSecretsRoom();
    const client = new SecretsClient({ room: room as never });

    expect(
      await client.exists({
        secretId: "secret-1",
        delegatedTo: "agent",
        forIdentity: "agent",
      }),
    ).to.equal(true);
    expect(await client.exists({ secretId: "missing" })).to.equal(false);

    expect(room.requests.map((entry) => entry.tool)).to.deep.equal([
      "exists",
      "exists",
    ]);
    expect(room.requests[0].input).to.deep.equal({
      secret_id: "secret-1",
      delegated_to: "agent",
      for_identity: "agent",
    });
    expect(room.requests[1].input).to.deep.equal({
      secret_id: "missing",
      delegated_to: null,
      for_identity: null,
    });
  });
});
