import { encode as base64Encode, decode as base64Decode } from "base-64";

const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE36 = 36n;
const UUID_HEX_REGEX = /^[0-9a-f]{32}$/;

function toBigInt(value: bigint | number): bigint {
    if (typeof value === "bigint") {
        return value;
    }

    if (typeof value === "number") {
        if (!Number.isInteger(value)) {
            throw new TypeError("number must be an integer");
        }

        return BigInt(value);
    }

    throw new TypeError("number must be an integer");
}

export function base36Encode(value: bigint | number): string {
    const number = toBigInt(value);

    if (number < 0n) {
        throw new RangeError("number must be non-negative");
    }

    if (number === 0n) {
        return "0";
    }

    let current = number;
    let base36 = "";

    while (current > 0n) {
        const remainder = Number(current % BASE36);

        base36 = BASE36_ALPHABET[remainder] + base36;
        current /= BASE36;
    }

    return base36;
}

export function base36Decode(numberStr: string): bigint {
    const sanitized = numberStr.trim().toLowerCase();

    if (sanitized === "") {
        return 0n;
    }

    let result = 0n;

    for (const char of sanitized) {
        const value = BASE36_ALPHABET.indexOf(char);

        if (value === -1) {
            throw new RangeError(`Invalid character '${char}' for base36 encoding`);
        }

        result = result * BASE36 + BigInt(value);
    }

    return result;
}

function normalizeUuidHex(id: string): string {
    const trimmed = id.trim().toLowerCase().replace(/-/g, "");

    if (!UUID_HEX_REGEX.test(trimmed)) {
        throw new Error("invalid uuid format");
    }

    return trimmed;
}

function formatUuidFromHex(hex: string): string {
    return (
        `${hex.substring(0, 8)}-` +
        `${hex.substring(8, 12)}-` +
        `${hex.substring(12, 16)}-` +
        `${hex.substring(16, 20)}-` +
        `${hex.substring(20)}`
    );
}

function hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) {
        throw new Error("invalid hex string length");
    }

    const bytes = new Uint8Array(hex.length / 2);

    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }

    return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

const globalScope = globalThis as typeof globalThis & {
    btoa?: (data: string) => string;
    atob?: (data: string) => string;
    Buffer?: any;
};

function bytesToBase64(bytes: Uint8Array): string {
    if (globalScope.Buffer) {
        return globalScope.Buffer.from(bytes).toString("base64");
    }

    let binary = "";

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    if (globalScope.btoa) {
        return globalScope.btoa(binary);
    }

    return base64Encode(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    if (globalScope.Buffer) {
        const buffer = globalScope.Buffer.from(base64, "base64");

        return Uint8Array.from(buffer);
    }

    let binary: string;

    if (globalScope.atob) {
        binary = globalScope.atob(base64);
    } else {
        binary = base64Decode(base64);
    }

    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

export function compressUuid(guidString: string): string {
    const hex = normalizeUuidHex(guidString);
    const guidInt = BigInt(`0x${hex}`);

    return base36Encode(guidInt);
}

export function decompressUuid(compressedUuid: string): string {
    const guidInt = base36Decode(compressedUuid);
    const hex = guidInt.toString(16).padStart(32, "0");

    return formatUuidFromHex(hex);
}

export function base64CompressUuid(id: string): string {
    const hex = normalizeUuidHex(id);
    const bytes = hexToBytes(hex);

    const base64 = bytesToBase64(bytes)
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

    return base64.replace(/-/g, ".").replace(/=+$/g, "");
}

export function base64DecompressUuid(id: string): string {
    let base64 = id.replace(/\./g, "-");

    const paddingNeeded = base64.length % 4;

    if (paddingNeeded !== 0) {
        base64 += "=".repeat(4 - paddingNeeded);
    }

    base64 = base64.replace(/-/g, "+").replace(/_/g, "/");

    const bytes = base64ToBytes(base64);

    if (bytes.length !== 16) {
        throw new Error("invalid uuid length");
    }

    return formatUuidFromHex(bytesToHex(bytes));
}

export interface ApiKey {
    id: string;
    projectId: string;
    secret: string;
}

function splitApiKey(key: string): { idPart: string; projectPart: string; secret: string } {
    const rest = key.slice(3);
    const firstSeparator = rest.indexOf("-");

    if (firstSeparator === -1) {
        throw new Error("invalid api key");
    }

    const secondSeparator = rest.indexOf("-", firstSeparator + 1);

    if (secondSeparator === -1) {
        throw new Error("invalid api key");
    }

    const idPart = rest.slice(0, firstSeparator);
    const projectPart = rest.slice(firstSeparator + 1, secondSeparator);
    const secret = rest.slice(secondSeparator + 1);

    if (!idPart || !projectPart || secret === undefined) {
        throw new Error("invalid api key");
    }

    return { idPart, projectPart, secret };
}

export function parseApiKey(key: string): ApiKey {
    if (!key.startsWith("ma-")) {
        throw new Error("invalid api key");
    }

    const { idPart, projectPart, secret } = splitApiKey(key);

    return {
        id: base64DecompressUuid(idPart),
        projectId: base64DecompressUuid(projectPart),
        secret,
    };
}

export function encodeApiKey(key: ApiKey): string {
    return (
        "ma-" +
        base64CompressUuid(key.id) +
        "-" +
        base64CompressUuid(key.projectId) +
        "-" +
        key.secret
    );
}