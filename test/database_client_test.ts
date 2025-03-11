// test_database_mocha.ts

// import { describe, it, before, after } from "mocha";
import { expect } from "chai";

// Example placeholder type definitions and imports.
// Replace with the real imports from your project.
import {
    Protocol,
    RoomClient,
    IntDataType,
    TextDataType,
    FloatDataType,
    VectorDataType,
    WebSocketProtocolChannel,
    websocketProtocol,
} from "../src/index";

import { room } from "./utils";

describe("database_client_test", function () {
    // Increase timeout if needed for async operations (DB indexing, WebSocket connections, etc.)
    this.timeout(10000);

    let chan1: WebSocketProtocolChannel;
    let chan2: WebSocketProtocolChannel;

    let protocol1: Protocol;
    let protocol2: Protocol;

    let client1: RoomClient;
    let client2: RoomClient;

    before(async () => {
        chan1 = await websocketProtocol({roomName: room, participantName: 'client1'});
        chan2 = await websocketProtocol({roomName: room, participantName: 'client2'});

        protocol1 = new Protocol({channel: chan1});
        protocol2 = new Protocol({channel: chan2});

        client1 = new RoomClient({protocol: protocol1});
        client2 = new RoomClient({protocol: protocol2});

        // Start the clients
        await client1.start();
        await client2.start();
    });

    after(async () => {
        client1.dispose();
        client2.dispose();
    });

    it("test_list_tables_empty", async () => {
        const tables = await client1.database.listTables();

        expect(tables).to.deep.equal([], "Expected no tables initially");
    });

    it("test_create_table_with_schema", async () => {
        const tableName = "test_table_schema";

        // Create a table with a schema defining a single 'id' column.
        await client1.database.createTableWithSchema({
            name: tableName,
            schema: { id: new IntDataType() },
        });

        const tables = await client1.database.listTables();

        expect(tables.includes(tableName)).to.be.true;
    });

    it("test_drop_table", async () => {
        const tableName = "test_drop_table";

        // Create table from data
        await client1.database.createTableWithSchema({
            name: tableName,
            schema: { test: new IntDataType() },
        });

        let tables = await client1.database.listTables();
        expect(tables.includes(tableName)).to.be.true;

        // Drop the table
        await client1.database.dropTable({ name: tableName });

        tables = await client1.database.listTables();
        expect(tables.includes(tableName)).to.be.false;
    });

    it("test_insert_and_search", async () => {
        const tableName = "test_insert_search";

        // Create table with initial empty data.
        await client1.database.createTableWithSchema({
            name: tableName,
            schema: { id: new IntDataType(), name: new TextDataType() },
        });

        // Insert a record.
        const record = { id: 1, name: "Alice" };
        await client1.database.insert({
            table: tableName,
            records: [record],
        });

        // Search for the record.
        const results = await client1.database.search({
            table: tableName,
            where: { id: 1 },
        });

        // Expect results to include the record we inserted.
        const found = results.some((r: any) => r.name === "Alice");
        expect(found).to.be.true;
    });

    it("test_update_and_delete", async () => {
        const tableName = "test_update_delete";

        await client1.database.createTableWithSchema({
            name: tableName,
            schema: { id: new IntDataType(), name: new TextDataType() },
        });

        // Insert a record.
        const record = { id: 2, name: "Bob" };
        await client1.database.insert({
            table: tableName,
            records: [record],
        });

        // Update Bob's name to Robert.
        await client1.database.update({
            table: tableName,
            where: "id = 2",
            values: { name: "Robert" },
        });

        // Verify update.
        let results = await client1.database.search({
            table: tableName,
            where: { id: 2 },
        });

        const updated = results.some((r: any) => r.name === "Robert");
        expect(updated).to.be.true;

        // Delete the record.
        await client1.database.delete({
            table: tableName,
            where: "id = 2",
        });

        // Verify deletion.
        results = await client1.database.search({
            table: tableName,
            where: { id: 2 },
        });
        expect(results.length).to.equal(0, "Record should have been deleted");
    });

    it("test_merge", async () => {
        const tableName = "test_merge";

        await client1.database.createTableWithSchema({
            name: tableName,
            schema: { id: new IntDataType(), name: new TextDataType() },
        });

        const record1 = { id: 3, name: "Carol" };
        await client1.database.insert({
            table: tableName,
            records: [record1],
        });

        // Merge a record with the same 'id' but a different name.
        const recordMerge = { id: 3, name: "Caroline" };
        await client1.database.merge({
            table: tableName,
            on: "id",
            records: [recordMerge],
        });

        const results = await client1.database.search({
            table: tableName,
            where: { id: 3 },
        });
        const merged = results.some((r: any) => r.name === "Caroline");
        expect(merged).to.be.true;
    });

    it("test_optimize", async () => {
        const tableName = "test_optimize";

        await client1.database.createTableWithSchema({
            name: tableName,
            schema: {
                id: new IntDataType(),
                name: new TextDataType(),
            },
        });

        // Example "optimize" call. You might want to check some stats or status after.
        await client1.database.optimize(tableName);
        // Optionally check some status or stats if your implementation supports it.
    });

    it("test_create_indexes", async () => {
        const tableName = "test_indexes";

        await client1.database.createTableWithSchema({
            name: tableName,
            schema: {
                id: new IntDataType(),
                name: new TextDataType(),
                embedding: new VectorDataType({ size: 128, elementType: new FloatDataType() }),
            },
        });

        // Insert 1000 rows with random vector data
        const data: Array<Record<string, unknown>> = [];

        for (let i = 0; i < 1000; i++) {
            const vector: number[] = [];
            for (let j = 0; j < 128; j++) {
                vector.push(Math.random());
            }
            data.push({ id: i, name: "test", embedding: vector });
        }

        await client1.database.insert({ table: tableName, records: data });

        // Create a scalar index
        await client1.database.createScalarIndex({
            table: tableName,
            column: "id",
        });

        // Create a vector index
        await client1.database.createVectorIndex({
            table: tableName,
            column: "embedding",
        });

        // Create a full-text search index
        await client1.database.createFullTextSearchIndex({
            table: tableName,
            column: "name",
        });

        const indexes = await client1.database.listIndexes({ table: tableName });

        expect(indexes).to.have.property("indexes");
    });

    it("test_add_drop_columns", async () => {
        const tableName = "test_columns";

        // Create a table with one record.
        await client1.database.createTableFromData({
            name: tableName,
            data: [{ id: 1, name: "Dave" }],
        });

        // Add a new column 'email'.
        await client1.database.addColumns({
            table: tableName,
            newColumns: { email: "'hello'" },
        });

        // Verify we can still query; table should have the new column.
        let results = await client1.database.search({
            table: tableName,
            where: { id: 1 },
        });
        expect(results.length).to.equal(1, "Expected one record after adding column");

        // Drop the 'email' column.
        await client1.database.dropColumns({
            table: tableName,
            columns: ["email"],
        });

        const resultsAfter = await client1.database.search({
            table: tableName,
            where: { id: 1 },
        });

        if (resultsAfter.length > 0) {
            const record = resultsAfter[0];
            // Ensure the 'email' column was removed
            expect("email" in record).to.be.false;
        }
    });
});
