import { expect } from "chai";

import {
  ChildProperty,
  ElementType,
  MeshSchema,
  MeshSchemaValidationException,
  SimpleValue,
  ValueProperty,
} from "../schema.js";

type JsonSchemaNode = Record<string, any> | boolean;

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRef(ref: string, root: Record<string, any>): JsonSchemaNode | undefined {
  if (!ref.startsWith("#/$defs/")) {
    return undefined;
  }
  const name = ref.slice("#/$defs/".length);
  const defs = root["$defs"];
  return isRecord(defs) ? defs[name] : undefined;
}

function validateNode(schema: JsonSchemaNode, value: unknown, root: Record<string, any>): boolean {
  if (schema === true) {
    return true;
  }
  if (schema === false) {
    return false;
  }

  if (typeof schema["$ref"] === "string") {
    const resolved = resolveRef(schema["$ref"], root);
    return resolved !== undefined && validateNode(resolved, value, root);
  }

  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf)) {
    return anyOf.some((entry) => validateNode(entry, value, root));
  }

  const rawType = schema["type"];
  const types = Array.isArray(rawType) ? rawType : rawType === undefined ? [] : [rawType];
  if (types.length > 0 && !types.some((type) => {
    switch (type) {
      case "object":
        return isRecord(value);
      case "array":
        return Array.isArray(value);
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "string":
        return typeof value === "string";
      case "boolean":
        return typeof value === "boolean";
      case "null":
        return value === null;
      default:
        return true;
    }
  })) {
    return false;
  }

  if (isRecord(value)) {
    const required = Array.isArray(schema["required"]) ? schema["required"] : [];
    for (const key of required) {
      if (typeof key === "string" && !(key in value)) {
        return false;
      }
    }

    const properties = isRecord(schema["properties"]) ? schema["properties"] : {};
    for (const [key, entryValue] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (propertySchema === undefined) {
        if (schema["additionalProperties"] === false) {
          return false;
        }
        continue;
      }
      if (!validateNode(propertySchema, entryValue, root)) {
        return false;
      }
    }
  }

  if (Array.isArray(value)) {
    if (Array.isArray(schema["prefixItems"])) {
      for (let index = 0; index < value.length; index += 1) {
        const itemSchema = schema["prefixItems"][index] ?? schema["items"];
        if (!validateNode(itemSchema, value[index], root)) {
          return false;
        }
      }
      return true;
    }

    if (isRecord(schema["items"]) || typeof schema["items"] === "boolean") {
      return value.every((entry) => validateNode(schema["items"], entry, root));
    }
  }

  return true;
}

function validates(schema: Record<string, any>, value: unknown): boolean {
  return validateNode(schema, value, schema);
}

describe("schema_test", () => {
  it("validates tag names", () => {
    expect(() => {
      new MeshSchema({
        rootTagName: "sample2",
        elements: [new ElementType({ tagName: "sample", description: "test", properties: [] })],
      });
    }).to.throw(MeshSchemaValidationException);
  });

  it("validates value names", () => {
    expect(() => {
      const type = SimpleValue.fromString("bad");
      if (type == null) {
        throw new MeshSchemaValidationException("bad");
      }
      new MeshSchema({
        rootTagName: "sample",
        elements: [
          new ElementType({
            tagName: "sample",
            description: "test",
            properties: [new ValueProperty({ name: "string", description: "", type })],
          }),
        ],
      });
    }).to.throw(MeshSchemaValidationException);
  });

  it("validates child tag names", () => {
    expect(() => {
      new MeshSchema({
        rootTagName: "sample",
        elements: [
          new ElementType({
            tagName: "sample",
            description: "test",
            properties: [
              new ChildProperty({ name: "children", description: "", childTagNames: ["blah"] }),
            ],
          }),
        ],
      });
    }).to.throw(MeshSchemaValidationException);
  });

  it("requires properties", () => {
    const schema = new MeshSchema({
      rootTagName: "sample",
      elements: [
        new ElementType({
          tagName: "sample",
          description: "test",
          properties: [new ValueProperty({ name: "prop", description: "desc", type: SimpleValue.number })],
        }),
      ],
    }).toJson();

    expect(validates(schema, { sample: { prop: 1 } })).to.equal(true);
    expect(validates(schema, { smple: { test: 1 }, sample: 1 })).to.equal(false);
    expect(validates(schema, {})).to.equal(false);
  });

  it("validates nested schema objects", () => {
    const schema = new MeshSchema({
      rootTagName: "sample",
      elements: [
        new ElementType({
          tagName: "sample",
          description: "test",
          properties: [new ValueProperty({ name: "sample2", description: "desc", type: SimpleValue.number })],
        }),
      ],
    }).toJson();

    expect(validates(schema, { sample: { sample2: 1 } })).to.equal(true);
    expect(validates(schema, { sample: { sample2: "test" } })).to.equal(false);
  });

  it("validates nested array values", () => {
    const schema = new MeshSchema({
      rootTagName: "sample",
      elements: [
        new ElementType({
          tagName: "sample",
          description: "test",
          properties: [
            new ChildProperty({ name: "children", description: "desc", childTagNames: ["string_tag"] }),
          ],
        }),
        new ElementType({
          tagName: "string_tag",
          description: "",
          properties: [new ValueProperty({ name: "value", description: "", type: SimpleValue.string })],
        }),
      ],
    }).toJson();

    expect(validates(schema, { sample: { children: [{ string_tag: { value: "test" } }] } })).to.equal(true);
    expect(validates(schema, { sample: { children: {} } })).to.equal(false);
  });

  it("validates nested array objects", () => {
    const schema = new MeshSchema({
      rootTagName: "sample",
      elements: [
        new ElementType({
          tagName: "sample",
          description: "test",
          properties: [
            new ChildProperty({ name: "children", description: "desc", childTagNames: ["sample2"] }),
          ],
        }),
        new ElementType({
          tagName: "sample2",
          description: "desc2",
          properties: [new ValueProperty({ name: "prop", description: "desc", type: SimpleValue.number })],
        }),
      ],
    }).toJson();

    expect(validates(schema, { sample: { children: [{ sample2: { prop: 1 } }] } })).to.equal(true);
    expect(validates(schema, { sample: { children: [{}] } })).to.equal(false);
    expect(validates(schema, { sample: {} })).to.equal(false);
  });

  it("validates nested array multi objects", () => {
    const schema = new MeshSchema({
      rootTagName: "sample",
      elements: [
        new ElementType({
          tagName: "sample",
          description: "test",
          properties: [
            new ChildProperty({ name: "children", description: "desc", childTagNames: ["child1", "child2"] }),
          ],
        }),
        new ElementType({
          tagName: "child1",
          description: "child",
          properties: [new ValueProperty({ name: "prop", description: "desc", type: SimpleValue.number })],
        }),
        new ElementType({
          tagName: "child2",
          description: "child",
          properties: [new ValueProperty({ name: "prop", description: "desc", type: SimpleValue.string })],
        }),
      ],
    }).toJson();

    expect(validates(schema, {
      sample: {
        children: [
          { child1: { prop: 1 } },
          { child2: { prop: "test" } },
        ],
      },
    })).to.equal(true);
    expect(validates(schema, { sample: { children: [{ child1: "test" }] } })).to.equal(false);
    expect(validates(schema, { sample: {} })).to.equal(false);
  });

  it("round-trips schema json", () => {
    const schema = new MeshSchema({
      rootTagName: "sample",
      elements: [
        new ElementType({
          description: "test",
          tagName: "sample",
          properties: [
            new ChildProperty({ name: "children", description: "desc", childTagNames: ["child1", "child2"] }),
          ],
        }),
        new ElementType({
          tagName: "child1",
          description: "child",
          properties: [new ValueProperty({ name: "prop", description: "desc", type: SimpleValue.number })],
        }),
        new ElementType({
          tagName: "child2",
          description: "child",
          properties: [new ValueProperty({ name: "prop", description: "desc", type: SimpleValue.string })],
        }),
      ],
    });

    const json1 = schema.toJson();
    const json2 = MeshSchema.fromJson(json1).toJson();

    expect(json2).to.deep.equal(json1);
  });
});
