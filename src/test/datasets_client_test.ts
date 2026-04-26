// test_datasets_mocha.ts

// import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { Table, tableFromArrays } from "apache-arrow";

// Example placeholder type definitions and imports.
// Replace with the real imports from your project.
import {
    RoomClient,
    websocketProtocol,
} from "../index";

import { room, getConfig } from "./utils";

function tableForRows(rows: Array<Record<string, unknown>>): Table {
    const columns: Record<string, unknown[]> = {};
    for (const row of rows) {
        for (const [name, value] of Object.entries(row)) {
            if (!columns[name]) {
                columns[name] = [];
            }
            columns[name].push(value);
        }
    }
    return tableFromArrays(columns);
}

function tablesContainValue(tables: Table[], column: string, value: unknown): boolean {
    return tables.some((table) => {
        const vector = table.getChild(column);
        if (vector == null) {
            return false;
        }
        for (let index = 0; index < table.numRows; index += 1) {
            if (vector.get(index) === value) {
                return true;
            }
        }
        return false;
    });
}

describe("datasets_client_test", function (this: Mocha.Suite) {
    // Increase timeout if needed for async operations (DB indexing, WebSocket connections, etc.)
    this.timeout(30000);

    let client1: RoomClient;
    let client2: RoomClient;

    before(async () => {
        const config = getConfig();

        const protocolFactory1 = await websocketProtocol({ roomName: room, participantName: 'client1', ...config });
        const protocolFactory2 = await websocketProtocol({ roomName: room, participantName: 'client2', ...config });

        client1 = new RoomClient({ protocolFactory: protocolFactory1 });
        client2 = new RoomClient({ protocolFactory: protocolFactory2 });

        // Start the clients
        await client1.start();
        await client2.start();
    });

    after(async () => {
        client1.dispose();
        client2.dispose();
    });

    it("test_list_tables_empty", async () => {
        const tables = await client1.datasets.listTables();

        expect(tables).to.deep.equal([], "Expected no tables initially");
    });

    it("test_create_table_with_schema", async () => {
        const tableName = "test_table_schema";

        // Create a table with a schema defining a single 'id' column.
        const table = tableForRows([{ id: 0 }]);
        await client1.datasets.createTableWithSchema({
            name: tableName,
            schema: table.schema,
        });

        const tables = await client1.datasets.listTables();

        expect(tables.includes(tableName)).to.be.true;
    });

    it("test_drop_table", async () => {
        const tableName = "test_drop_table";

        // Create table from data
        const table = tableForRows([{ test: 0 }]);
        await client1.datasets.createTableWithSchema({
            name: tableName,
            schema: table.schema,
        });

        let tables = await client1.datasets.listTables();
        expect(tables.includes(tableName)).to.be.true;

        // Drop the table
        await client1.datasets.dropTable({ name: tableName });

        tables = await client1.datasets.listTables();
        expect(tables.includes(tableName)).to.be.false;
    });

    it("test_insert_and_search", async () => {
        const tableName = "test_insert_search";

        // Create table with initial empty data.
        const schemaTable = tableForRows([{ id: 0, name: "" }]);
        await client1.datasets.createTableWithSchema({
            name: tableName,
            schema: schemaTable.schema,
        });

        // Insert a record.
        await client1.datasets.insert({
            table: tableName,
            records: tableForRows([{ id: 1, name: "Alice" }]),
        });

        // Search for the record.
        const results = await client1.datasets.search({
            table: tableName,
            where: { id: 1 },
        });

        // Expect results to include the record we inserted.
        const found = tablesContainValue(results, "name", "Alice");
        expect(found).to.be.true;
    });

    it("test_update_and_delete", async () => {
        const tableName = "test_update_delete";

        const schemaTable = tableForRows([{ id: 0, name: "" }]);
        await client1.datasets.createTableWithSchema({
            name: tableName,
            schema: schemaTable.schema,
        });

        // Insert a record.
        await client1.datasets.insert({
            table: tableName,
            records: tableForRows([{ id: 2, name: "Bob" }]),
        });

        // Update Bob's name to Robert.
        await client1.datasets.update({
            table: tableName,
            where: "id = 2",
            values: { name: "Robert" },
        });

        // Verify update.
        let results = await client1.datasets.search({
            table: tableName,
            where: { id: 2 },
        });

        const updated = tablesContainValue(results, "name", "Robert");
        expect(updated).to.be.true;

        // Delete the record.
        await client1.datasets.delete({
            table: tableName,
            where: "id = 2",
        });

        // Verify deletion.
        results = await client1.datasets.search({
            table: tableName,
            where: { id: 2 },
        });
        expect(results.length).to.equal(0, "Record should have been deleted");
    });

    it("test_merge", async () => {
        const tableName = "test_merge";

        const schemaTable = tableForRows([{ id: 0, name: "" }]);
        await client1.datasets.createTableWithSchema({
            name: tableName,
            schema: schemaTable.schema,
        });

        await client1.datasets.insert({
            table: tableName,
            records: tableForRows([{ id: 3, name: "Carol" }]),
        });

        // Merge a record with the same 'id' but a different name.
        await client1.datasets.merge({
            table: tableName,
            on: "id",
            records: tableForRows([{ id: 3, name: "Caroline" }]),
        });

        const results = await client1.datasets.search({
            table: tableName,
            where: { id: 3 },
        });
        const merged = tablesContainValue(results, "name", "Caroline");
        expect(merged).to.be.true;
    });

    it("test_optimize", async () => {
        const tableName = "test_optimize";

        const schemaTable = tableForRows([{ id: 0, name: "" }]);
        await client1.datasets.createTableWithSchema({
            name: tableName,
            schema: schemaTable.schema,
        });

        // Example "optimize" call. You might want to check some stats or status after.
        await client1.datasets.optimize(tableName);
        // Optionally check some status or stats if your implementation supports it.
    });

    it("test_create_indexes", async () => {
        const tableName = "test_indexes";

        const schemaTable = tableForRows([{ id: 0, name: "test", embedding: Array.from({ length: 128 }, () => 0) }]);
        await client1.datasets.createTableWithSchema({
            name: tableName,
            schema: schemaTable.schema,
        });

        // Insert 1000 rows with random vector data
        const data: Array<Record<string, unknown>> = [];

        for (let i = 0; i < 1000; i++) {
            const vector: number[] = [];

            for (let j = 0; j < 128; j++) {
                vector.push(Math.random());
            }

            data.push({
                id: i,
                name: "test",
                embedding: vector,
            });
        }

        await client1.datasets.insert({
            table: tableName,
            records: tableForRows(data),
        });

        // Create a scalar index
        await client1.datasets.createScalarIndex({
            table: tableName,
            column: "id",
        });

        // Create a vector index
        await client1.datasets.createVectorIndex({
            table: tableName,
            column: "embedding",
        });

        // Create a full-text search index
        await client1.datasets.createFullTextSearchIndex({
            table: tableName,
            column: "name",
        });

        const indexes = await client1.datasets.listIndexes({ table: tableName });

        expect(indexes).to.be.an("array");
        expect(indexes.map((index) => index.name).sort()).to.deep.equal([
            "embedding_idx",
            "id_idx",
            "name_idx",
        ]);
    });

    it("test_add_drop_columns", async () => {
        const tableName = "test_columns";

        // Create a table with one record.
        await client1.datasets.createTableFromData({
            name: tableName,
            data: tableForRows([{ id: 1, name: "Dave" }]),
        });

        // Add a new column 'email'.
        await client1.datasets.addColumns({
            table: tableName,
            newColumns: { email: "'hello'" },
        });

        // Verify we can still query; table should have the new column.
        let results = await client1.datasets.search({
            table: tableName,
            where: { id: 1 },
        });
        expect(results.length).to.equal(1, "Expected one record after adding column");

        // Drop the 'email' column.
        await client1.datasets.dropColumns({
            table: tableName,
            columns: ["email"],
        });

        const resultsAfter = await client1.datasets.search({
            table: tableName,
            where: { id: 1 },
        });

        if (resultsAfter.length > 0) {
            expect(resultsAfter[0].getChild("email")).to.equal(null);
        }
    });
});
