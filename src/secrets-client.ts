import type { ConnectorRef, OAuthClientConfig } from "./meshagent-client";
import { Protocol } from "./protocol";
import { BinaryContent, EmptyContent, FileContent, JsonContent, type Content } from "./response";
import { RoomClient } from "./room-client";
import { RoomServerException } from "./room-server-client";
import { unpackMessage } from "./utils";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface SecretInfo {
  id: string;
  name: string;
  type: string;
  delegatedTo?: string | null;
}

export interface OAuthTokenRequest {
  requestId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  challenge?: string | null;
  scopes?: string[] | null;
  clientId?: string | null;
}

export type OAuthTokenRequestHandler = (request: OAuthTokenRequest) => Promise<void> | void;

export interface SecretRequest {
  requestId: string;
  url: string;
  type: string;
  delegateTo?: string | null;
}

export type SecretRequestHandler = (request: SecretRequest) => Promise<void> | void;

export class SecretsClient {
  private readonly client: RoomClient;
  private readonly oauthTokenRequestHandler?: OAuthTokenRequestHandler;
  private readonly secretRequestHandler?: SecretRequestHandler;
  private readonly _oauthRequestHandler = this._handleClientOAuthTokenRequest.bind(this);
  private readonly _secretRequestHandler = this._handleClientSecretRequest.bind(this);

  constructor({
    room,
    oauthTokenRequestHandler,
    secretRequestHandler,
  }: {
    room: RoomClient;
    oauthTokenRequestHandler?: OAuthTokenRequestHandler;
    secretRequestHandler?: SecretRequestHandler;
  }) {
    this.client = room;
    this.oauthTokenRequestHandler = oauthTokenRequestHandler;
    this.secretRequestHandler = secretRequestHandler;

    this.client.protocol.addHandler("secrets.request_oauth_token", this._oauthRequestHandler);
    this.client.protocol.addHandler("secrets.request_secret", this._secretRequestHandler);
  }

  private unexpectedResponse(operation: string): RoomServerException {
    return new RoomServerException(`unexpected return type from secrets.${operation}`);
  }

  private async invoke(operation: string, input: Record<string, unknown> | Content): Promise<Content> {
    return await this.client.invoke({
      toolkit: "secrets",
      tool: operation,
      input,
    });
  }

  private serializeConnectorRef(connector?: ConnectorRef | null): Record<string, unknown> | null {
    if (connector == null) {
      return null;
    }

    return {
      openai_connector_id: connector.openaiConnectorId ?? null,
      server_url: connector.serverUrl ?? null,
      client_secret_id: connector.clientSecretId ?? null,
    };
  }

  private serializeOAuthConfig(oauth?: OAuthClientConfig | null): Record<string, unknown> | null {
    if (oauth == null) {
      return null;
    }

    return {
      client_id: oauth.client_id,
      client_secret: oauth.client_secret ?? null,
      authorization_endpoint: oauth.authorization_endpoint,
      token_endpoint: oauth.token_endpoint,
      no_pkce: oauth.no_pkce ?? null,
      scopes: oauth.scopes ?? null,
    };
  }

  private parseAccessToken(operation: string, response: Content): string | null {
    if (!(response instanceof JsonContent)) {
      throw this.unexpectedResponse(operation);
    }

    const token = response.json["access_token"];
    if (typeof token !== "string" || token.length === 0) {
      return null;
    }
    return token;
  }

  private parseSecretInfo(value: unknown): SecretInfo {
    if (!isRecord(value) || typeof value["id"] !== "string" || typeof value["name"] !== "string" || typeof value["type"] !== "string") {
      throw this.unexpectedResponse("list_secrets");
    }

    const delegatedTo = value["delegated_to"];
    if (delegatedTo !== undefined && delegatedTo !== null && typeof delegatedTo !== "string") {
      throw this.unexpectedResponse("list_secrets");
    }

    return {
      id: value["id"],
      name: value["name"],
      type: value["type"],
      delegatedTo: delegatedTo as string | null | undefined,
    };
  }

  private async _handleClientOAuthTokenRequest(
    protocol: Protocol,
    messageId: number,
    type: string,
    bytes?: Uint8Array,
  ): Promise<void> {
    void protocol;
    void messageId;
    void type;

    if (bytes == null) {
      throw new RoomServerException("invalid secrets.request_oauth_token payload");
    }
    if (this.oauthTokenRequestHandler == null) {
      throw new RoomServerException("No oauth token handler registered");
    }

    const [request] = unpackMessage(bytes);
    const requestId = request["request_id"];
    const challenge = request["challenge"];
    const requestPayload = request["request"];
    if (typeof requestId !== "string" || !isRecord(requestPayload)) {
      throw new RoomServerException("invalid secrets.request_oauth_token payload");
    }

    const oauth = requestPayload["oauth"];
    if (!isRecord(oauth) || typeof oauth["authorization_endpoint"] !== "string" || typeof oauth["token_endpoint"] !== "string") {
      throw new RoomServerException("invalid secrets.request_oauth_token payload");
    }
    const scopes = oauth["scopes"];
    if (scopes !== undefined && scopes !== null && (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string"))) {
      throw new RoomServerException("invalid secrets.request_oauth_token payload");
    }

    Promise.resolve(
      this.oauthTokenRequestHandler({
        requestId,
        authorizationEndpoint: oauth["authorization_endpoint"],
        tokenEndpoint: oauth["token_endpoint"],
        challenge: typeof challenge === "string" ? challenge : null,
        scopes: (scopes as string[] | null | undefined) ?? null,
        clientId: typeof oauth["client_id"] === "string" ? oauth["client_id"] : null,
      }),
    ).catch((error: unknown) => {
      console.warn("OAuth token request handler threw", error);
    });
  }

  private async _handleClientSecretRequest(
    protocol: Protocol,
    messageId: number,
    type: string,
    bytes?: Uint8Array,
  ): Promise<void> {
    void protocol;
    void messageId;
    void type;

    if (bytes == null) {
      throw new RoomServerException("invalid secrets.request_secret payload");
    }
    if (this.secretRequestHandler == null) {
      throw new RoomServerException("No secret handler registered");
    }

    const [request] = unpackMessage(bytes);
    const requestId = request["request_id"];
    const requestPayload = request["request"];
    if (typeof requestId !== "string" || !isRecord(requestPayload) || typeof requestPayload["url"] !== "string" || typeof requestPayload["type"] !== "string") {
      throw new RoomServerException("invalid secrets.request_secret payload");
    }

    Promise.resolve(
      this.secretRequestHandler({
        requestId,
        url: requestPayload["url"],
        type: requestPayload["type"],
        delegateTo: typeof requestPayload["delegate_to"] === "string" ? requestPayload["delegate_to"] : null,
      }),
    ).catch((error: unknown) => {
      console.warn("Secret request handler threw", error);
    });
  }

  public async provideOAuthAuthorization({
    requestId,
    code,
  }: {
    requestId: string;
    code: string;
  }): Promise<void> {
    const response = await this.invoke("provide_oauth_authorization", {
      request_id: requestId,
      code,
      error: null,
    });
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw this.unexpectedResponse("provide_oauth_authorization");
  }

  public async rejectOAuthAuthorization({
    requestId,
    error,
  }: {
    requestId: string;
    error: string;
  }): Promise<void> {
    const response = await this.invoke("provide_oauth_authorization", {
      request_id: requestId,
      code: null,
      error,
    });
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw this.unexpectedResponse("provide_oauth_authorization");
  }

  public async provideSecret({
    requestId,
    data,
  }: {
    requestId: string;
    data: Uint8Array;
  }): Promise<void> {
    const response = await this.invoke("provide_secret", new BinaryContent({
      data,
      headers: {
        request_id: requestId,
        error: null,
      },
    }));
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw this.unexpectedResponse("provide_secret");
  }

  public async rejectSecret({
    requestId,
    error,
  }: {
    requestId: string;
    error: string;
  }): Promise<void> {
    const response = await this.invoke("provide_secret", new BinaryContent({
      data: new Uint8Array(0),
      headers: {
        request_id: requestId,
        error,
      },
    }));
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw this.unexpectedResponse("provide_secret");
  }

  public async getOfflineOAuthToken({
    connector,
    oauth,
    delegatedTo,
    delegatedBy,
  }: {
    connector?: ConnectorRef | null;
    oauth?: OAuthClientConfig | null;
    delegatedTo?: string | null;
    delegatedBy?: string | null;
  }): Promise<string | null> {
    const response = await this.invoke("get_offline_oauth_token", {
      connector: this.serializeConnectorRef(connector),
      oauth: this.serializeOAuthConfig(oauth),
      delegated_to: delegatedTo ?? null,
      delegated_by: delegatedBy ?? null,
    });
    return this.parseAccessToken("get_offline_oauth_token", response);
  }

  public async requestOAuthToken({
    connector,
    oauth,
    timeout = 60 * 5,
    fromParticipantId,
    redirectUri,
    delegateTo,
  }: {
    connector?: ConnectorRef | null;
    oauth?: OAuthClientConfig | null;
    timeout?: number;
    fromParticipantId: string;
    redirectUri: string | URL;
    delegateTo?: string | null;
  }): Promise<string | null> {
    const response = await this.invoke("request_oauth_token", {
      connector: this.serializeConnectorRef(connector),
      oauth: this.serializeOAuthConfig(oauth),
      redirect_uri: typeof redirectUri === "string" ? redirectUri : redirectUri.toString(),
      timeout,
      participant_id: fromParticipantId,
      delegate_to: delegateTo ?? null,
    });
    return this.parseAccessToken("request_oauth_token", response);
  }

  public async listSecrets(): Promise<SecretInfo[]> {
    const response = await this.invoke("list_secrets", {});
    if (!(response instanceof JsonContent)) {
      throw this.unexpectedResponse("list_secrets");
    }

    const secrets = response.json["secrets"];
    if (!Array.isArray(secrets)) {
      throw this.unexpectedResponse("list_secrets");
    }
    return secrets.map((item) => this.parseSecretInfo(item));
  }

  public async deleteSecret({
    secretId,
    delegatedTo,
  }: {
    secretId: string;
    delegatedTo?: string | null;
  }): Promise<void> {
    const response = await this.invoke("delete_secret", {
      id: secretId,
      delegated_to: delegatedTo ?? null,
    });
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw this.unexpectedResponse("delete_secret");
  }

  public async deleteRequestedSecret({
    url,
    type,
    delegatedTo,
  }: {
    url: string;
    type: string;
    delegatedTo?: string | null;
  }): Promise<void> {
    const response = await this.invoke("delete_requested_secret", {
      url,
      type,
      delegated_to: delegatedTo ?? null,
    });
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw this.unexpectedResponse("delete_requested_secret");
  }

  public async requestSecret({
    fromParticipantId,
    url,
    type,
    timeout = 60 * 5,
    delegateTo,
  }: {
    fromParticipantId: string;
    url: string;
    type: string;
    timeout?: number;
    delegateTo?: string | null;
  }): Promise<Uint8Array> {
    const response = await this.invoke("request_secret", {
      url,
      type,
      participant_id: fromParticipantId,
      timeout,
      delegate_to: delegateTo ?? null,
    });
    if (response instanceof FileContent) {
      return response.data;
    }
    throw this.unexpectedResponse("request_secret");
  }

  public async setSecret({
    secretId,
    type,
    mimeType,
    name,
    delegatedTo,
    forIdentity,
    data,
  }: {
    secretId?: string | null;
    type?: string | null;
    mimeType?: string | null;
    name?: string | null;
    delegatedTo?: string | null;
    forIdentity?: string | null;
    data: Uint8Array;
  }): Promise<void> {
    const response = await this.invoke("set_secret", new BinaryContent({
      data,
      headers: {
        secret_id: secretId ?? null,
        type: type ?? mimeType ?? null,
        name: name ?? null,
        delegated_to: delegatedTo ?? null,
        for_identity: forIdentity ?? null,
        has_data: true,
      },
    }));
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw this.unexpectedResponse("set_secret");
  }

  public async getSecret({
    secretId,
    type,
    name,
    delegatedTo,
  }: {
    secretId?: string | null;
    type?: string | null;
    name?: string | null;
    delegatedTo?: string | null;
  }): Promise<FileContent | null> {
    const response = await this.invoke("get_secret", {
      secret_id: secretId ?? null,
      type: type ?? null,
      name: name ?? null,
      delegated_to: delegatedTo ?? null,
    });
    if (response instanceof EmptyContent) {
      return null;
    }
    if (response instanceof FileContent) {
      return response;
    }
    throw this.unexpectedResponse("get_secret");
  }
}
