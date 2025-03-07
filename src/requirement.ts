// requirement.ts

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

/**
 * An abstract base class for different requirement types (similar to Python’s Requirement).
 */
export abstract class Requirement {
  public readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Factory method to create a requirement from a JSON-like object.
   */
  public static fromJson(r: Record<string, any>): Requirement {
    if ("toolkit" in r) {
      return new RequiredToolkit({ name: r["toolkit"], tools: r["tools"] });
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

  constructor({ name, tools }: { name: string; tools?: string[] }) {
    super(name);
    this.tools = tools;
  }

  public toJson(): Record<string, any> {
    return {
      toolkit: this.name,
      tools: this.tools,
    };
  }
}

/**
 * Requires a particular schema (i.e., "name" references a schema).
 */
export class RequiredSchema extends Requirement {
  constructor({ name }: { name: string }) {
    super(name);
  }

  public toJson(): Record<string, any> {
    return {
      schema: this.name,
    };
  }
}
