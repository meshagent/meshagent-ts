import { packMessage, splitMessageHeader, splitMessagePayload } from "./utils";

/** Represents protocol-level response content with a method to pack into bytes. */
export interface Content {
  pack(): Uint8Array;
}
export type Chunk = Content;

/**
 * Minimally replicate chunk classes:
 */
export class LinkChunk implements Content {
    public url: string;
    public name: string;

  constructor({url, name}: {
    url: string;
    name: string;
  }) {
    this.url = url;
    this.name = name;
  }

  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new LinkChunk({
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
    return `LinkChunk (${this.name}): ${this.url}`;
  }
}

export class FileChunk implements Content {
  public data: Uint8Array;
  public name: string;
  public mimeType: string;

  constructor({data, name, mimeType}: {
    data: Uint8Array;
    name: string;
    mimeType: string;
  }) {
    this.data = data;
    this.name = name;
    this.mimeType = mimeType;
  }

  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new FileChunk({
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
    return `FileChunk (${this.name}): ${this.mimeType}`;
  }
}

export class TextChunk implements Content {
  public text: string;

  constructor({text}: {text: string}) {
    this.text = text;
  }

  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new TextChunk({
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
    return `TextChunk: ${this.text}`;
  }
}

/** Example JSON-based response class. */
export class JsonChunk implements Chunk {
  public json: Record<string, any>;

  constructor({json}: {json: Record<string, any>}) {
    this.json = json;
  }

  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new JsonChunk({json: header["json"]});
  }

  pack(): Uint8Array {
    return packMessage({
      type: "json",
      json: this.json,
    });
  }

  toString(): string {
    return `JsonChunk: ${JSON.stringify(this.json)}`;
  }
}

export class ErrorChunk implements Chunk {
  public text: string;

  constructor({text}: {text: string}) {
    this.text = text;
  }

  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new ErrorChunk({text: header["text"]});
  }

  pack(): Uint8Array {
    return packMessage({
      type: "error",
      text: this.text,
    });
  }

  toString(): string {
    return `ErrorChunk: ${this.text}`;
  }
}

export class EmptyChunk implements Chunk {
  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new EmptyChunk();
  }

  pack(): Uint8Array {
    return packMessage({ type: "empty" });
  }

  toString(): string {
    return `EmptyChunk`;
  }
}

/** A dictionary to map 'type' => function to unpack. */
const _chunkTypes: Record<string, (header: Record<string, any>, payload: Uint8Array) => Content> = {
  empty: EmptyChunk.unpack,
  error: ErrorChunk.unpack,
  file: FileChunk.unpack,
  json: JsonChunk.unpack,
  link: LinkChunk.unpack,
  text: TextChunk.unpack,
};

/**
 * Unpacks a response from a combined packet.
 */
export function unpackChunk(data: Uint8Array): Content {
  const header = JSON.parse(splitMessageHeader(data));
  const payload = splitMessagePayload(data);
  const typeKey = header["type"];

  if (!_chunkTypes[typeKey]) {
    throw new Error(`Unknown chunk type: ${typeKey}`);
  }

  return _chunkTypes[typeKey](header, payload);
}

/** @deprecated use unpackChunk */
export function unpackResponse(data: Uint8Array): Content {
  return unpackChunk(data);
}

export type LinkContent = LinkChunk;
export const LinkContent = LinkChunk;
export type FileContent = FileChunk;
export const FileContent = FileChunk;
export type TextContent = TextChunk;
export const TextContent = TextChunk;
export type JsonContent = JsonChunk;
export const JsonContent = JsonChunk;
export type ErrorContent = ErrorChunk;
export const ErrorContent = ErrorChunk;
export type EmptyContent = EmptyChunk;
export const EmptyContent = EmptyChunk;

export function unpackContent(data: Uint8Array): Content {
  return unpackChunk(data);
}
