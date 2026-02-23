import { RoomClient } from "./room-client";
import { EmptyContent, FileContent, JsonContent } from "./response";

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
    const req: Record<string, any> = {
      secret_id: secretId,
    };

    if (mimeType) req.type = mimeType;
    if (name) req.name = name;
    if (delegatedTo) req.delegated_to = delegatedTo;
    if (forIdentity) req.for_identity = forIdentity;

    const response = await this.client.sendRequest("secrets.set_secret", req, data);
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw new Error("Invalid response received, expected EmptyContent or JsonContent");
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
    };

    if (delegatedTo) req.delegated_to = delegatedTo;

    const response = await this.client.sendRequest("secrets.get_secret", req);
    if (response instanceof EmptyContent) {
      return null;
    }
    if (response instanceof FileContent) {
      return response;
    }
    throw new Error("Invalid response received, expected FileContent or EmptyContent");
  }

  public async listSecrets(): Promise<SecretInfo[]> {
    const response = await this.client.sendRequest("secrets.list_secrets", {});
    if (!(response instanceof JsonContent)) {
      throw new Error("Invalid response received, expected JsonContent");
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
    };
    if (delegatedTo) req.delegated_to = delegatedTo;

    const response = await this.client.sendRequest("secrets.delete_secret", req);
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw new Error("Invalid response received, expected EmptyContent or JsonContent");
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
    };
    if (delegatedTo) req.delegated_to = delegatedTo;

    const response = await this.client.sendRequest("secrets.delete_requested_secret", req);
    if (response instanceof EmptyContent || response instanceof JsonContent) {
      return;
    }
    throw new Error("Invalid response received, expected EmptyContent or JsonContent");
  }
}
