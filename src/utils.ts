// utils.ts

import { TextDecoder, TextEncoder } from "@kayahr/text-encoding";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export { decoder, encoder };

/**
 * Splits a message payload from a combined packet.
 * @param packet A data packet to split
 * @returns The Uint8Array payload after the header
 */
export function splitMessagePayload(packet: Uint8Array): Uint8Array {
    const dataView = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const headerSize = dataView.getUint32(4, false) + dataView.getUint32(0, false) * Math.pow(2, 32);

    return packet.subarray(8 + headerSize, packet.length);
}

/**
 * Splits a message header from a combined packet and decodes it as a UTF-8 string.
 * @param packet A data packet to split
 * @returns The decoded string header
 */
export function splitMessageHeader(packet: Uint8Array): string {
    const dataView = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const headerSize = dataView.getUint32(4, false) + dataView.getUint32(0, false) * Math.pow(2, 32);
    const payload = packet.subarray(8, 8 + headerSize);

    return decoder.decode(payload);
}

/**
 * Packs a request object and optional data into a single Uint8Array message.
 * @param request A JavaScript object with the request header
 * @param data Optional data packet to add
 * @returns The combined Uint8Array
 */
export function packMessage(request: Record<string, any>, data?: Uint8Array): Uint8Array {
    const jsonMessage = encoder.encode(JSON.stringify(request));
    const size = jsonMessage.length;

    const header = new Uint8Array(4 * 2);
    const dataView = new DataView(header.buffer);
    dataView.setUint32(0, (size & 0x000fffff00000000) / Math.pow(2, 32), false);
    dataView.setUint32(4, size & 0xffffffff, false);

    return mergeUint8Arrays(header, jsonMessage, data ?? new Uint8Array(0));
}

export function mergeUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
    const totalSize = arrays.reduce((acc, e) => acc + e.length, 0);
    const merged = new Uint8Array(totalSize);

    arrays.forEach((array, i, arrays) => {
        const offset = arrays
            .slice(0, i)
            .reduce((acc, e) => acc + e.length, 0);

        merged.set(array, offset);
    });

    return merged;
}

export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);

        reader.readAsArrayBuffer(blob);
    });
}
