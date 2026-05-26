import { expect } from "chai";

import { ToolContentSpec } from "../tool-content-type.js";

describe("tool_content_type_test", () => {
    it("accepts binary content specs", () => {
        const spec = ToolContentSpec.fromJson({
            types: ["binary"],
            stream: true,
            schema: {
                type: "object",
                properties: {
                    kind: { type: "string" },
                },
            },
        });

        expect(spec?.toJson()).to.deep.equal({
            types: ["binary"],
            stream: true,
            schema: {
                type: "object",
                properties: {
                    kind: { type: "string" },
                },
            },
        });
    });

    it("treats null schema as absent", () => {
        const spec = ToolContentSpec.fromJson({
            types: ["json"],
            schema: null,
        });

        expect(spec?.toJson()).to.deep.equal({
            types: ["json"],
            stream: false,
        });
    });
});
