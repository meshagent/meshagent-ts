/**
 * We'll keep a registry (similar to `_data_types` in Python)
 * mapping a `type` string to the corresponding DataType class.
 */
export const _dataTypes: Record<string, typeof DataType> = {};

/**
 * Abstract base class for DataTypes.
 */
export abstract class DataType {
  constructor(_?: any) {}

  /**
   * Convert this data type instance to a JSON object.
   */
  public abstract toJson(): Record<string, unknown>;

  /**
   * Factory method: parse a JSON representation to a concrete DataType.
   * Looks up the correct subclass in `_dataTypes`.
   */
  public static fromJson(data: any): DataType {
    const ctor = _dataTypes[data.type];

    if (!ctor) {
      throw new Error(`Unknown data type: ${data.type}`);
    }

    return ctor.fromJson(data);
  }
}

/**
 * IntDataType
 */
export class IntDataType extends DataType {
  constructor() {
    super();
  }

  public static override fromJson(data: any): IntDataType {
    if (data.type !== "int") {
      throw new Error(`Expected type 'int', got '${data.type}'`);
    }
    return new IntDataType();
  }

  public toJson(): Record<string, unknown> {
    return { type: "int" };
  }
}
_dataTypes["int"] = IntDataType;

/**
 * DateDataType
 */
export class DateDataType extends DataType {
  constructor() {
    super();
  }

  public static override fromJson(data: any): DateDataType {
    if (data.type !== "date") {
      throw new Error(`Expected type 'date', got '${data.type}'`);
    }
    return new DateDataType();
  }

  public toJson(): Record<string, unknown> {
    return { type: "date" };
  }
}
_dataTypes["date"] = DateDataType;

/**
 * FloatDataType
 */
export class FloatDataType extends DataType {
  constructor() {
    super();
  }

  public static override fromJson(data: any): FloatDataType {
    if (data.type !== "float") {
      throw new Error(`Expected type 'float', got '${data.type}'`);
    }
    return new FloatDataType();
  }

  public toJson(): Record<string, unknown> {
    return { type: "float" };
  }
}
_dataTypes["float"] = FloatDataType;

/**
 * VectorDataType
 */
export class VectorDataType extends DataType {
  public size: number;
  public elementType: DataType;

  constructor({ size, elementType }: { size: number; elementType: DataType }) {
    super();

    this.size = size;
    this.elementType = elementType;
  }

  public static override fromJson(data: any): VectorDataType {
    if (data.type !== "vector") {
      throw new Error(`Expected type 'vector', got '${data.type}'`);
    }
    return new VectorDataType({
      size: data.size,
      elementType: DataType.fromJson(data.element_type),
    });
  }

  public toJson(): Record<string, unknown> {
    return {
      type: "vector",
      size: this.size,
      element_type: this.elementType.toJson(),
    };
  }
}
_dataTypes["vector"] = VectorDataType;

/**
 * TextDataType
 */
export class TextDataType extends DataType {
  constructor() {
    super();
  }

  public static override fromJson(data: any): TextDataType {
    if (data.type !== "text") {
      throw new Error(`Expected type 'text', got '${data.type}'`);
    }
    return new TextDataType();
  }

  public toJson(): Record<string, unknown> {
    return { type: "text" };
  }
}
_dataTypes["text"] = TextDataType;

