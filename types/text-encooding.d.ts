declare module "@kayahr/text-encoding" {
  export class TextEncoder {
    encode(input?: string): Uint8Array;
  }

  export class TextDecoder {
    constructor(label?: string, options?: { fatal?: boolean });
    decode(input?: ArrayBuffer | ArrayBufferView): string;
  }
}