// requirement.ts

import { Schema, Table, tableFromIPC, tableToIPC } from "apache-arrow";

/**
 * Represents an error similar to the Python `RoomException`.
 * Adjust or replace with your actual error class if you have one.
 */
export class RoomException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomException";
  }
}

export class ForbiddenException extends RoomException {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenException";
  }
}

const globalScope = globalThis as typeof globalThis & {
  Buffer?: {
    from(data: Uint8Array | string, encoding?: string): { toString(encoding: string): string };
  };
  btoa?: (data: string) => string;
  atob?: (data: string) => string;
};

function bytesToBase64(bytes: Uint8Array): string {
  if (globalScope.Buffer) {
    return globalScope.Buffer.from(bytes).toString("base64");
  }

  if (!globalScope.btoa) {
    throw new Error("base64 encoding is not available in this runtime");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalScope.btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (globalScope.Buffer) {
    return Uint8Array.from(globalScope.Buffer.from(base64, "base64") as unknown as ArrayLike<number>);
  }

  if (!globalScope.atob) {
    throw new Error("base64 decoding is not available in this runtime");
  }

  const binary = globalScope.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function schemaToIPC(schema: Schema): Uint8Array {
  return tableToIPC(new Table(schema, []), "stream");
}

function schemaFromIPCBytes(data: Uint8Array): Schema {
  const table = tableFromIPC(data);
  if (table instanceof Promise) {
    throw new RoomException("unexpected async Arrow IPC result");
  }
  return table.schema;
}

/**
 * An abstract base class for different requirement types (similar to Python’s Requirement).
 */
export abstract class Requirement {
  public readonly name: string;

  constructor({name} : { name: string }) {
    this.name = name;
  }

  /**
   * Factory method to create a requirement from a JSON-like object.
   */
  public static fromJson(r: Record<string, any>): Requirement {
    if ("toolkit" in r) {
      return new RequiredToolkit({
        name: r["toolkit"],
        tools: r["tools"],
        participantName: r["participant_name"],
      });
    }

    if ("table" in r) {
      return RequiredTable.fromJson(r);
    }

    if ("schema" in r) {
      return new RequiredSchema({ name: r["schema"] });
    }

    throw new RoomException("invalid requirement json");
  }

  /**
   * Returns a JSON representation of this requirement.
   */
  public abstract toJson(): Record<string, any>;
}

/**
 * Requires a toolkit to be present for a tool to execute, optionally specifying a list of tools.
 */
export class RequiredToolkit extends Requirement {
  public readonly tools?: string[];
  public readonly participantName?: string;

  constructor({
    name,
    tools,
    participantName,
  }: {
    name: string;
    tools?: string[];
    participantName?: string;
  }) {
    super({name});

    this.tools = tools;
    this.participantName = participantName;
  }

  public toJson(): Record<string, any> {
    return {
      toolkit: this.name,
      tools: this.tools,
      participant_name: this.participantName,
    };
  }
}

/**
 * Requires a particular schema (i.e., "name" references a schema).
 */
export class RequiredSchema extends Requirement {
  constructor({ name }: { name: string }) {
    super({ name });
  }

  public toJson(): Record<string, any> {
    return {
      schema: this.name,
    };
  }
}

export class RequiredTable extends Requirement {
  public readonly schema: Schema;
  public readonly namespace?: string[];
  public readonly scalarIndexes?: string[];
  public readonly fullTextSearchIndexes?: string[];
  public readonly vectorIndexes?: string[];

  constructor({
    name,
    schema,
    namespace,
    scalarIndexes,
    fullTextSearchIndexes,
    vectorIndexes,
  }: {
    name: string;
    schema: Schema;
    namespace?: string[];
    scalarIndexes?: string[];
    fullTextSearchIndexes?: string[];
    vectorIndexes?: string[];
  }) {
    super({ name });
    this.schema = schema;
    this.namespace = namespace;
    this.scalarIndexes = scalarIndexes;
    this.fullTextSearchIndexes = fullTextSearchIndexes;
    this.vectorIndexes = vectorIndexes;
  }

  public static fromJson(r: Record<string, any>): RequiredTable {
    if (typeof r["table"] !== "string") {
      throw new RoomException("required table name must be a string");
    }
    if (typeof r["schema"] !== "string") {
      throw new RoomException("required table schema must be a base64 Arrow IPC schema");
    }

    return new RequiredTable({
      name: r["table"],
      schema: schemaFromIPCBytes(base64ToBytes(r["schema"])),
      namespace: Array.isArray(r["namespace"]) ? r["namespace"].map(String) : undefined,
      scalarIndexes: Array.isArray(r["scalar_indexes"]) ? r["scalar_indexes"].map(String) : undefined,
      fullTextSearchIndexes: Array.isArray(r["full_text_search_indexes"]) ? r["full_text_search_indexes"].map(String) : undefined,
      vectorIndexes: Array.isArray(r["vector_indexes"]) ? r["vector_indexes"].map(String) : undefined,
    });
  }

  public toJson(): Record<string, any> {
    return {
      table: this.name,
      schema: bytesToBase64(schemaToIPC(this.schema)),
      namespace: this.namespace,
      scalar_indexes: this.scalarIndexes,
      full_text_search_indexes: this.fullTextSearchIndexes,
      vector_indexes: this.vectorIndexes,
    };
  }
}
