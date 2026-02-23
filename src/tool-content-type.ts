export type ToolContentType = "json" | "text" | "file" | "link" | "empty";

const SUPPORTED_TOOL_CONTENT_TYPES = new Set<ToolContentType>([
    "json",
    "text",
    "file",
    "link",
    "empty",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export class ToolContentSpec {
    public readonly types: ToolContentType[];
    public readonly stream: boolean;
    public readonly schema?: Record<string, unknown>;

    constructor({
        types,
        stream = false,
        schema,
    }: {
        types: ToolContentType[];
        stream?: boolean;
        schema?: Record<string, unknown>;
    }) {
        if (!Array.isArray(types) || types.length === 0) {
            throw new Error("ToolContentSpec.types must contain at least one supported type");
        }

        for (const type of types) {
            if (!SUPPORTED_TOOL_CONTENT_TYPES.has(type)) {
                throw new Error(`Unsupported tool content type: ${String(type)}`);
            }
        }
        this.types = [...types];
        this.stream = stream;
        this.schema = schema;
    }

    public toJson(): Record<string, unknown> {
        const value: Record<string, unknown> = {
            types: [...this.types],
            stream: this.stream,
        };
        if (this.schema !== undefined) {
            value["schema"] = this.schema;
        }
        return value;
    }

    public static fromJson(value: unknown): ToolContentSpec | undefined {
        if (value === null || value === undefined) {
            return undefined;
        }
        if (!isRecord(value)) {
            throw new Error("ToolContentSpec must be a JSON object");
        }

        const rawTypes = value["types"];
        if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
            throw new Error("ToolContentSpec.types must be a non-empty array");
        }

        const types: ToolContentType[] = rawTypes.map((item) => {
            if (typeof item !== "string") {
                throw new Error("ToolContentSpec.types values must be strings");
            }
            if (!SUPPORTED_TOOL_CONTENT_TYPES.has(item as ToolContentType)) {
                throw new Error(`Unsupported tool content type: ${item}`);
            }
            return item as ToolContentType;
        });

        const rawStream = value["stream"];
        const stream = typeof rawStream === "boolean" ? rawStream : false;
        const rawSchema = value["schema"];
        if (rawSchema !== undefined && !isRecord(rawSchema)) {
            throw new Error("ToolContentSpec.schema must be an object when provided");
        }
        const schema = rawSchema as Record<string, unknown> | undefined;
        return new ToolContentSpec({ types, stream, schema });
    }
}
