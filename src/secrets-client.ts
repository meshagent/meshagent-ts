import { RoomClient } from "./room-client";
import { BinaryContent, EmptyContent, FileContent, JsonContent } from "./response";

export interface SecretInfo {
  id: string;
  name: string;
  type?: string;
  delegatedTo?: string | null;
}

export class SecretsClient {
  private client: RoomClient;

  constructor({ room }: { room: RoomClient }) {
    this.client = room;
  }

  private unexpectedResponse(operation: string): Error {
    return new Error(`unexpected return type from secrets.${operation}`);
  }

  public async setSecret({
    secretId,
    data,
    mimeType,
    name,
    delegatedTo,
    forIdentity,
  }: {
    secretId: string;
    data: Uint8Array;
    mimeType?: string;
    name?: string;
    delegatedTo?: string;
    forIdentity?: string;
  }): Promise<void> {
    const response = await this.client.invoke({
      toolkit: "secrets",
      tool: "set_secret",
      input: new BinaryContent({
        data,
        headers: {
          secret_id: secretId,
          type: mimeType ?? null,
          name: name ?? null,
          delegated_to: delegatedTo ?? null,
          for_identity: forIdentity ?? null,
          has_data: true,
        },
      }),
    });
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw this.unexpectedResponse("set_secret");
  }

  public async getSecret({
    secretId,
    delegatedTo,
  }: {
    secretId: string;
    delegatedTo?: string;
  }): Promise<FileContent | null> {
    const req: Record<string, any> = {
      secret_id: secretId,
      type: null,
      name: null,
      delegated_to: delegatedTo ?? null,
    };

    const response = await this.client.invoke({ toolkit: "secrets", tool: "get_secret", input: req });
    if (response instanceof EmptyContent) {
      return null;
    }
    if (response instanceof FileContent) {
      return response;
    }
    throw this.unexpectedResponse("get_secret");
  }

  public async listSecrets(): Promise<SecretInfo[]> {
    const response = await this.client.invoke({ toolkit: "secrets", tool: "list_secrets", input: {} });
    if (!(response instanceof JsonContent)) {
      throw this.unexpectedResponse("list_secrets");
    }

    const secrets = Array.isArray(response.json?.secrets) ? response.json.secrets : [];
    return secrets.map((item: any) => ({
      id: item.id as string,
      name: item.name as string,
      type: item.type as string | undefined,
      delegatedTo: item.delegated_to as string | null | undefined,
    }));
  }

  public async deleteSecret({
    secretId,
    delegatedTo,
  }: {
    secretId: string;
    delegatedTo?: string;
  }): Promise<void> {
    const req: Record<string, any> = {
      id: secretId,
      delegated_to: delegatedTo ?? null,
    };

    const response = await this.client.invoke({ toolkit: "secrets", tool: "delete_secret", input: req });
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
    delegatedTo?: string;
  }): Promise<void> {
    const req: Record<string, any> = {
      url,
      type,
      delegated_to: delegatedTo ?? null,
    };

    const response = await this.client.invoke({ toolkit: "secrets", tool: "delete_requested_secret", input: req });
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw this.unexpectedResponse("delete_requested_secret");
  }
}
