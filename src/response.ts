import { packMessage, splitMessageHeader, splitMessagePayload } from "./utils";

/** Represents protocol-level response content with a method to pack into bytes. */
export interface Content {
  pack(): Uint8Array;
}

export class BinaryContent implements Content {
  public data: Uint8Array;
  public headers: Record<string, any>;

  constructor({ data, headers = {} }: { data: Uint8Array; headers?: Record<string, any> }) {
    this.data = data;
    this.headers = headers;
  }

  static unpack(header: Record<string, any>, payload: Uint8Array): BinaryContent {
    return new BinaryContent({
      data: payload,
      headers: typeof header["headers"] === "object" && header["headers"] != null ? header["headers"] : {},
    });
  }

  pack(): Uint8Array {
    return packMessage({
      type: "binary",
      headers: this.headers,
    }, this.data);
  }

  toString(): string {
    return `BinaryContent: headers=${JSON.stringify(this.headers)} length=${this.data.length}`;
  }
}

/**
 * Content envelope for a remote link.
 */
export class LinkContent implements Content {
  public url: string;
  public name: string;

  constructor({ url, name }: {
    url: string;
    name: string;
  }) {
    this.url = url;
    this.name = name;
  }

  static unpack(header: Record<string, any>, _payload: Uint8Array): LinkContent {
    return new LinkContent({
      url: header["url"],
      name: header["name"]!,
    });
  }

  pack(): Uint8Array {
    return packMessage({
      type: "link",
      name: this.name,
      url: this.url,
    });
  }

  toString(): string {
    return `LinkContent (${this.name}): ${this.url}`;
  }
}

export class FileContent implements Content {
  public data: Uint8Array;
  public name: string;
  public mimeType: string;

  constructor({ data, name, mimeType }: {
    data: Uint8Array;
    name: string;
    mimeType: string;
  }) {
    this.data = data;
    this.name = name;
    this.mimeType = mimeType;
  }

  static unpack(header: Record<string, any>, payload: Uint8Array): FileContent {
    return new FileContent({
      data: payload,
      name: header["name"],
      mimeType: header["mime_type"],
    });
  }

  pack(): Uint8Array {
    return packMessage({
      type: "file",
      name: this.name,
      mime_type: this.mimeType,
    }, this.data);
  }

  toString(): string {
    return `FileContent (${this.name}): ${this.mimeType}`;
  }
}

export class TextContent implements Content {
  public text: string;

  constructor({ text }: { text: string }) {
    this.text = text;
  }

  static unpack(header: Record<string, any>, _payload: Uint8Array): TextContent {
    return new TextContent({
      text: header["text"],
    });
  }

  pack(): Uint8Array {
    return packMessage({
      type: "text",
      text: this.text,
    });
  }

  toString(): string {
    return `TextContent: ${this.text}`;
  }
}

export class JsonContent implements Content {
  public json: Record<string, any>;

  constructor({ json }: { json: Record<string, any> }) {
    this.json = json;
  }

  static unpack(header: Record<string, any>, _payload: Uint8Array): JsonContent {
    return new JsonContent({ json: header["json"] });
  }

  pack(): Uint8Array {
    return packMessage({
      type: "json",
      json: this.json,
    });
  }

  toString(): string {
    return `JsonContent: ${JSON.stringify(this.json)}`;
  }
}

export class ErrorContent implements Content {
  public text: string;
  public code?: number;

  constructor({ text, code }: { text: string; code?: number }) {
    this.text = text;
    this.code = code;
  }

  static unpack(header: Record<string, any>, _payload: Uint8Array): ErrorContent {
    const rawCode = header["code"];
    let code: number | undefined;
    if (typeof rawCode === "number" && Number.isInteger(rawCode)) {
      code = rawCode;
    } else if (typeof rawCode === "string") {
      const parsed = Number.parseInt(rawCode, 10);
      if (!Number.isNaN(parsed)) {
        code = parsed;
      }
    }
    return new ErrorContent({ text: header["text"], code });
  }

  pack(): Uint8Array {
    const header: Record<string, any> = {
      type: "error",
      text: this.text,
    };
    if (this.code !== undefined) {
      header["code"] = this.code;
    }
    return packMessage(header);
  }

  toString(): string {
    return this.code !== undefined
      ? `ErrorContent: ${this.text} (${this.code})`
      : `ErrorContent: ${this.text}`;
  }
}

export class EmptyContent implements Content {
  static unpack(_header: Record<string, any>, _payload: Uint8Array): EmptyContent {
    return new EmptyContent();
  }

  pack(): Uint8Array {
    return packMessage({ type: "empty" });
  }

  toString(): string {
    return `EmptyContent`;
  }
}

export enum ControlCloseStatus {
  NORMAL = 1000,
  INVALID_DATA = 1007,
}

export class ControlContent implements Content {
  public method: "open" | "close";
  public statusCode?: number;
  public message?: string;

  constructor({
    method,
    statusCode,
    message,
  }: {
    method: "open" | "close";
    statusCode?: number;
    message?: string;
  }) {
    this.method = method;
    this.statusCode = method === "close" ? statusCode ?? ControlCloseStatus.NORMAL : statusCode;
    this.message = message;
  }

  static unpack(header: Record<string, any>, _payload: Uint8Array): ControlContent {
    const method = header["method"];
    if (method !== "open" && method !== "close") {
      throw new Error(`Invalid control method: ${method}`);
    }

    const rawStatusCode = header["status_code"];
    let statusCode: number | undefined;
    if (typeof rawStatusCode === "number" && Number.isInteger(rawStatusCode)) {
      statusCode = rawStatusCode;
    } else if (typeof rawStatusCode === "string") {
      const parsed = Number.parseInt(rawStatusCode, 10);
      if (!Number.isNaN(parsed)) {
        statusCode = parsed;
      }
    }

    return new ControlContent({
      method,
      statusCode,
      message: typeof header["message"] === "string" ? header["message"] : undefined,
    });
  }

  pack(): Uint8Array {
    const header: Record<string, any> = {
      type: "control",
      method: this.method,
    };
    if (this.method === "close") {
      header["status_code"] = this.statusCode ?? ControlCloseStatus.NORMAL;
      if (this.message !== undefined) {
        header["message"] = this.message;
      }
    }
    return packMessage(header);
  }

  toString(): string {
    return `ControlContent: ${this.method}`;
  }
}

/** A dictionary to map protocol `type` => unpack function. */
const _contentTypes: Record<string, (header: Record<string, any>, payload: Uint8Array) => Content> = {
  binary: BinaryContent.unpack,
  control: ControlContent.unpack,
  empty: EmptyContent.unpack,
  error: ErrorContent.unpack,
  file: FileContent.unpack,
  json: JsonContent.unpack,
  link: LinkContent.unpack,
  text: TextContent.unpack,
};

/**
 * Unpacks a content envelope from a combined packet.
 */
export function unpackContent(data: Uint8Array): Content {
  const header = JSON.parse(splitMessageHeader(data));
  const payload = splitMessagePayload(data);
  const typeKey = header["type"];

  if (!_contentTypes[typeKey]) {
    throw new Error(`Unknown content type: ${typeKey}`);
  }

  return _contentTypes[typeKey](header, payload);
}
