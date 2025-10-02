import { expect } from "chai";

import {
    ApiKey,
    base36Decode,
    base36Encode,
    base64CompressUuid,
    base64DecompressUuid,
    compressUuid,
    decompressUuid,
    encodeApiKey,
    parseApiKey,
} from "../api_keys";

describe("keys helpers", () => {
    describe("base36", () => {
        it("round-trips 0n", () => {
            const encoded = base36Encode(0n);
            expect(encoded).to.equal("0");
            expect(base36Decode(encoded)).to.equal(0n);
        });

        it("round-trips a large bigint", () => {
            const value = BigInt("0x1234567890abcdef1234567890abcdef");
            const encoded = base36Encode(value);
            expect(base36Decode(encoded)).to.equal(value);
        });

        it("rejects invalid characters", () => {
            expect(() => base36Decode("123!"))
                .to.throw(RangeError)
                .with.property("message")
                .that.includes("Invalid character");
        });
    });

    describe("uuid compression", () => {
        const uuid = "123e4567-e89b-12d3-a456-426614174000";

        it("compresses and decompresses UUIDs", () => {
            const compressed = compressUuid(uuid);
            expect(compressed).to.be.a("string");
            expect(decompressUuid(compressed)).to.equal(uuid);
        });

        it("compresses UUIDs using URL-safe base64 substitutions", () => {
            const base64Compressed = base64CompressUuid(uuid);
            expect(base64Compressed).to.match(/^[0-9A-Za-z._]+$/);
            expect(base64Compressed).to.not.include("=");
            expect(base64Compressed).to.not.include("+");
            expect(base64Compressed).to.not.include("/");
            expect(base64DecompressUuid(base64Compressed)).to.equal(uuid);
        });
    });

    describe("API key helpers", () => {
        const apiKey: ApiKey = {
            id: "123e4567-e89b-12d3-a456-426614174000",
            projectId: "0f1e2d3c-4b5a-6978-90ab-cdef12345678",
            secret: "super-secret-with-dashes",
        };

        it("round-trips API keys", () => {
            const encoded = encodeApiKey(apiKey);
            const parsed = parseApiKey(encoded);
            expect(parsed).to.deep.equal(apiKey);
        });

        it("throws when prefix is invalid", () => {
            expect(() => parseApiKey("invalid-key"))
                .to.throw(Error)
                .with.property("message")
                .that.includes("invalid api key");
        });

        it("throws when separators are invalid", () => {
            expect(() => parseApiKey("ma-one-two"))
                .to.throw(Error)
                .with.property("message")
                .that.includes("invalid api key");
        });
    });
});