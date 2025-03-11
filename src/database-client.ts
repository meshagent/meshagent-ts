import { RoomClient } from "./room-client";
import { JsonResponse } from "./response";
import { DataType } from "./data-types";

/**
 * A literal type for controlling table creation mode.
 */
export type CreateMode = "create" | "overwrite" | "create_if_not_exists";

/**
 * A client for interacting with the 'database' extension on the room server.
 */
export class DatabaseClient {
  private room: RoomClient;

  /**
   * @param room The RoomClient used to send requests.
   */
  constructor({room}: {room: RoomClient}) {
    this.room = room;
  }

  /**
   * List all tables in the database.
   * @returns A promise resolving to an array of table names.
   */
  public async listTables(): Promise<string[]> {
    const response = await this.room.sendRequest("database.list_tables", {}) as JsonResponse;

    // Safely extract tables from response JSON
    return response?.json?.tables ?? [];
  }

  /**
   * Private helper for creating a table.
   *
   * @param name The table name.
   * @param data Optional initial data (array/object).
   * @param schema Optional schema definition as a record of column->DataType.
   * @param mode "create", "overwrite", or "create_if_not_exists" (default: "create").
   */
  private async createTable({ name, data, schema, mode = "create" }: {
    name: string;
    data?: any;
    schema?: Record<string, DataType>;
    mode?: CreateMode;
  }): Promise<void> {
    let schemaDict: Record<string, any> | undefined;

    if (schema) {
      schemaDict = {};
      for (const [key, value] of Object.entries(schema)) {
        schemaDict[key] = value.toJson();
      }
    }

    const payload: Record<string, any> = {
      name,
      data,
      schema: schemaDict,
      mode,
    };

    await this.room.sendRequest("database.create_table", payload);
  }

  /**
   * Create a new table with a specific schema.
   *
   * @param name The table name.
   * @param schema Optional schema definition.
   * @param data Optional initial data.
   * @param mode Controls creation behavior (default: "create").
   */
  public async createTableWithSchema({ name, schema, data, mode = "create" }: {
    name: string;
    schema?: Record<string, DataType>;
    data?: Array<Record<string, any>>;
    mode?: CreateMode;
  }): Promise<void> {
    return this.createTable({ name, schema, data, mode });
  }

  /**
   * Create a table from initial data, optionally specifying a mode.
   *
   * @param name Table name.
   * @param data Array of records to initialize the table with.
   * @param mode "create", "overwrite", or "create_if_not_exists".
   */
  public async createTableFromData({ name, data, mode = "create" }: {
    name: string;
    data?: Array<Record<string, any>>;
    mode?: CreateMode;
  }): Promise<void> {
    return this.createTable({ name, data, mode });
  }

  /**
   * Drop (delete) a table by name.
   *
   * @param name The table name.
   * @param ignoreMissing If true, ignore if table doesn't exist.
   */
  public async dropTable({ name, ignoreMissing = false }: {
    name: string;
    ignoreMissing?: boolean;
  }): Promise<void> {
    await this.room.sendRequest("database.drop_table", { name, ignoreMissing });
  }

  /**
   * Add new columns to an existing table.
   *
   * @param table Table name.
   * @param newColumns A record of { columnName: defaultValueExpression }.
   */
  public async addColumns({ table, newColumns }: {
    table: string;
    newColumns: Record<string, string>;
  }): Promise<void> {
    await this.room.sendRequest("database.add_columns", {
        table,
        new_columns: newColumns
    });
  }

  /**
   * Drop columns from an existing table.
   *
   * @param table Table name.
   * @param columns List of column names to drop.
   */
  public async dropColumns({ table, columns }: {
    table: string;
    columns: string[];
  }): Promise<void> {
    await this.room.sendRequest("database.drop_columns", { table, columns });
  }

  /**
   * Insert new records into a table.
   *
   * @param table Table name.
   * @param records The record(s) to insert.
   */
  public async insert({ table, records }: {
    table: string;
    records: Array<Record<string, any>>;
  }): Promise<void> {
    await this.room.sendRequest("database.insert", { table, records });
  }

  /**
   * Update existing records in a table.
   *
   * @param table Table name.
   * @param where SQL WHERE clause (e.g. "id = 123").
   * @param values Key/value pairs for direct updates.
   * @param valuesSql Key/value pairs for SQL-based expressions (e.g. {"col2": "col2 + 1"}).
   */
  public async update({ table, where, values, valuesSql }: {
    table: string;
    where: string;
    values?: Record<string, any>;
    valuesSql?: Record<string, string>;
  }): Promise<void> {
    const payload = {
      table,
      where,
      values,
      valuesSql,
    };
    await this.room.sendRequest("database.update", payload);
  }

  /**
   * Delete records from a table.
   *
   * @param table Table name.
   * @param where SQL WHERE clause (e.g. "id = 123").
   */
  public async delete({ table, where }: {
    table: string;
    where: string;
  }): Promise<void> {
    await this.room.sendRequest("database.delete", { table, where });
  }

  /**
   * Merge (upsert) records into a table.
   *
   * @param table Table name.
   * @param on The column name to match on (e.g. "id").
   * @param records The record(s) to merge.
   */
  public async merge({ table, on, records }: {
    table: string;
    on: string;
    records: any;
  }): Promise<void> {
    await this.room.sendRequest("database.merge", { table, on, records });
  }

  /**
   * Search for records in a table.
   *
   * @param table Table name.
   * @param text Optional search text.
   * @param vector Optional vector for similarity search.
   * @param where A filter clause (SQL string) or values to match.
   * @param limit Max results to return.
   * @param select Specific columns to select.
   * @returns A list of matching records.
   */
  public async search({ table, text, vector, where, limit, select }: {
    table: string;
    text?: string;
    vector?: number[];
    where?: string | Record<string, any>;
    limit?: number;
    select?: string[];
  }): Promise<Array<Record<string, any>>> {
    let whereClause = where;
    // If 'where' is an object, convert to "key = value" AND-joined string.
    if (where && typeof where === "object" && !Array.isArray(where)) {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(where)) {
        // Escape or JSON-stringify the value
        parts.push(`${key} = ${JSON.stringify(value)}`);
      }
      whereClause = parts.join(" AND ");
    }

    const payload: Record<string, any> = {
      table,
      where: whereClause,
      text,
    };
    if (limit !== undefined) {
      payload.limit = limit;
    }
    if (select !== undefined) {
      payload.select = select;
    }
    if (vector !== undefined) {
      payload.vector = vector;
    }

    const response = await this.room.sendRequest("database.search", payload);
    if (response instanceof JsonResponse) {
      if (response?.json?.results) {
        return response.json.results;
      }
    }
    return [];
  }

  /**
   * Optimize (compact/prune) a table.
   *
   * @param table Table name.
   */
  public async optimize(table: string): Promise<void> {
    await this.room.sendRequest("database.optimize", { table });
  }

  /**
   * Create a vector index on a given column.
   *
   * @param table Table name.
   * @param column Vector column name.
   */
  public async createVectorIndex({ table, column }: {
    table: string;
    column: string;
  }): Promise<void> {
    await this.room.sendRequest("database.create_vector_index", { table, column });
  }

  /**
   * Create a scalar index on a given column.
   *
   * @param table Table name.
   * @param column Column name.
   */
  public async createScalarIndex({ table, column }: {
    table: string;
    column: string;
  }): Promise<void> {
    await this.room.sendRequest("database.create_scalar_index", { table, column });
  }

  /**
   * Create a full-text search index on a given text column.
   *
   * @param table Table name.
   * @param column Text column name.
   */
  public async createFullTextSearchIndex({ table, column }: {
    table: string;
    column: string;
  }): Promise<void> {
    await this.room.sendRequest("database.create_full_text_search_index", { table, column });
  }

  /**
   * List all indexes on a table.
   *
   * @param table Table name.
   * @returns An object containing index information.
   */
  public async listIndexes({ table }: { table: string }): Promise<Record<string, any>> {
    const response = await this.room.sendRequest("database.list_indexes", { table }) as JsonResponse;

    return response?.json ?? {};
  }
}
