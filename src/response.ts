import { packMessage, splitMessageHeader, splitMessagePayload } from "./utils";

/** Represents protocol-level response content with a method to pack into bytes. */
export interface Content {
  pack(): Uint8Array;
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

  constructor({ text }: { text: string }) {
    this.text = text;
  }

  static unpack(header: Record<string, any>, _payload: Uint8Array): ErrorContent {
    return new ErrorContent({ text: header["text"] });
  }

  pack(): Uint8Array {
    return packMessage({
      type: "error",
      text: this.text,
    });
  }

  toString(): string {
    return `ErrorContent: ${this.text}`;
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

/** A dictionary to map protocol `type` => unpack function. */
const _contentTypes: Record<string, (header: Record<string, any>, payload: Uint8Array) => Content> = {
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
