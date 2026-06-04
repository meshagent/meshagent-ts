import { expect } from "chai";
import {
  Decimal,
  Dictionary,
  Field,
  Int32,
  LargeUtf8,
  List,
  Schema,
  Struct,
  Table,
  Utf8,
  tableFromIPC,
} from "apache-arrow";

import { RequiredTable, Requirement } from "../requirement.js";

function tableFromEncodedSchema(encoded: string): Table {
  const table = tableFromIPC(Uint8Array.from(Buffer.from(encoded, "base64")));
  if (table instanceof Promise) {
    throw new Error("unexpected async Arrow IPC result");
  }
  return table;
}

describe("requirements_test", () => {
  it("RequiredTable round-trips full Arrow schema fidelity", () => {
    const schema = new Schema(
      [
        new Field(
          "annotations",
          new List(
            new Field(
              "item",
              new Struct([
                new Field("key", new Utf8(), false, new Map([["role", "key"]])),
                new Field("value", new LargeUtf8(), true, new Map([["role", "value"]])),
              ]),
            ),
          ),
          true,
          new Map([["field", "annotations"]]),
        ),
        new Field("labels", new Dictionary(new Utf8(), new Int32(), 1, false)),
        new Field("amount", new Decimal(4, 20)),
      ],
      new Map([["schema", "required-table"]]),
    );
    const requirement = new RequiredTable({
      name: "records",
      namespace: ["team"],
      schema,
      scalarIndexes: ["amount"],
      fullTextSearchIndexes: ["annotations"],
      vectorIndexes: ["embedding"],
    });

    const encoded = requirement.toJson();
    const decoded = Requirement.fromJson(encoded);
    const encodedSchema = tableFromEncodedSchema(encoded["schema"] as string).schema;

    expect(decoded).to.be.instanceOf(RequiredTable);
    const decodedTable = decoded as RequiredTable;
    expect(decodedTable.name).to.equal("records");
    expect(decodedTable.namespace).to.deep.equal(["team"]);
    expect(decodedTable.scalarIndexes).to.deep.equal(["amount"]);
    expect(decodedTable.fullTextSearchIndexes).to.deep.equal(["annotations"]);
    expect(decodedTable.vectorIndexes).to.deep.equal(["embedding"]);
    expect(Object.fromEntries(decodedTable.schema.metadata)).to.deep.equal({ schema: "required-table" });
    expect(Object.fromEntries(encodedSchema.metadata)).to.deep.equal({ schema: "required-table" });

    const annotations = decodedTable.schema.fields[0];
    expect(annotations.name).to.equal("annotations");
    expect(Object.fromEntries(annotations.metadata)).to.deep.equal({ field: "annotations" });
    expect(annotations.type).to.be.instanceOf(List);

    const item = (annotations.type as List).children[0];
    const itemType = item.type as Struct;
    expect(itemType).to.be.instanceOf(Struct);
    expect(itemType.children[0].nullable).to.equal(false);
    expect(Object.fromEntries(itemType.children[0].metadata)).to.deep.equal({ role: "key" });
    expect(itemType.children[1].type).to.be.instanceOf(LargeUtf8);

    const labelsType = decodedTable.schema.fields[1].type as Dictionary;
    expect(labelsType).to.be.instanceOf(Dictionary);
    expect(labelsType.indices.bitWidth).to.equal(32);
    expect(labelsType.indices.isSigned).to.equal(true);
    expect(labelsType.dictionary).to.be.instanceOf(Utf8);

    const amountType = decodedTable.schema.fields[2].type as Decimal;
    expect(amountType).to.be.instanceOf(Decimal);
    expect(amountType.bitWidth).to.equal(128);
    expect(amountType.precision).to.equal(20);
    expect(amountType.scale).to.equal(4);
  });
});
