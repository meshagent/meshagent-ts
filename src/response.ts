import {
    packMessage,
    splitMessageHeader,
    splitMessagePayload,
} from "./utils";

/** Represents a network or protocol-level response with a method to pack into bytes. */
export interface Response {
  pack(): Uint8Array;
}

/** 
 * Minimally replicate "Response" classes:
 */
export class LinkResponse implements Response {
  constructor(public url: string, public name: string) { }

  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new LinkResponse(header["url"], header["name"]);
  }

  pack(): Uint8Array {
    return packMessage({
      type: "link",
      name: this.name,
      url: this.url,
    });
  }

  toString(): string {
    return `LinkResponse (${this.name}): ${this.url}`;
  }
}

export class FileResponse implements Response {
  constructor(
    public data: Uint8Array,
    public name: string,
    public mimeType: string
  ) { }

  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new FileResponse(payload, header["name"], header["mime_type"]);
  }

  pack(): Uint8Array {
    return packMessage({
      type: "file",
      name: this.name,
      mime_type: this.mimeType,
    }, this.data);
  }

  toString(): string {
    return `FileResponse (${this.name}): ${this.mimeType}`;
  }
}

export class TextResponse implements Response {
  constructor(public text: string) { }

  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new TextResponse(header["text"]);
  }

  pack(): Uint8Array {
    return packMessage({
      type: "text",
      text: this.text,
    });
  }

  toString(): string {
    return `TextResponse: ${this.text}`;
  }
}

/** Example JSON-based response class. */
export class JsonResponse implements Response {
  constructor(public json: any) { }

  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new JsonResponse(header["json"]);
  }

  pack(): Uint8Array {
    return packMessage({
      type: "json",
      json: this.json,
    });
  }

  toString(): string {
    return `JsonResponse: ${JSON.stringify(this.json)}`;
  }
}

export class ErrorResponse implements Response {
  constructor(public text: string) { }

  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new ErrorResponse(header["text"]);
  }

  pack(): Uint8Array {
    return packMessage({ type: "error", text: this.text });
  }

  toString(): string {
    return `ErrorResponse: ${this.text}`;
  }
}

export class EmptyResponse implements Response {
  static unpack(header: Record<string, any>, payload: Uint8Array) {
    return new EmptyResponse();
  }

  pack(): Uint8Array {
    return packMessage({ type: "empty" });
  }

  toString(): string {
    return `EmptyResponse`;
  }
}

/** A dictionary to map 'type' => function to unpack. */
const _responseTypes: Record<string, (header: Record<string, any>, payload: Uint8Array) => Response> = {
  empty: EmptyResponse.unpack,
  error: ErrorResponse.unpack,
  file: FileResponse.unpack,
  json: JsonResponse.unpack,
  link: LinkResponse.unpack,
  text: TextResponse.unpack,
};

/**
 * Unpacks a response from a combined packet.
 */
export function unpackResponse(data: Uint8Array): Response {
  const header =JSON.parse(splitMessageHeader(data));
  const payload = splitMessagePayload(data);

  const typeKey = header["type"];

  if (!_responseTypes[typeKey]) {
    throw new Error(`Unknown response type: ${typeKey}`);
  }

  return _responseTypes[typeKey](header, payload);
}

