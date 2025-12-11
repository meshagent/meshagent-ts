/*
------------------------------------------------------------------
   MeshSchemaValidationException
------------------------------------------------------------------
*/
export class MeshSchemaValidationException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeshSchemaValidationException";
  }
}

/* ------------------------------------------------------------------
   SimpleValue (Enum)
------------------------------------------------------------------ */
export enum SimpleValue {
  number = "number",
  string = "string",
  nullValue = "null",
  boolean = "boolean",
}

export namespace SimpleValue {
  export function fromString(val: string): SimpleValue | null {
    switch (val) {
      case "number":
        return SimpleValue.number;
      case "string":
        return SimpleValue.string;
      case "null":
        return SimpleValue.nullValue;
      case "boolean":
        return SimpleValue.boolean;
      default:
        return null;
    }
  }
}

/* ------------------------------------------------------------------
   ElementProperty (abstract)
------------------------------------------------------------------ */
export abstract class ElementProperty {
  public readonly name: string;
  public readonly description?: string;

  constructor({name, description}: {
      name: string;
      description?: string;
  }) {
    this.name = name;
    this.description = description;
  }

  abstract validate(schema: MeshSchema): void;
  abstract toJson(): Record<string, any>;
}

/* ------------------------------------------------------------------
   ValueProperty
------------------------------------------------------------------ */
export class ValueProperty extends ElementProperty {
  public readonly type: SimpleValue;
  public readonly enumValues?: any[];
  public readonly required: boolean;

  constructor({name, description, type, enumValues, required = false}: {
    name: string;
    description?: string;
    type: SimpleValue;
    enumValues?: any[];
    required?: boolean;
  }) {
    super({name, description});

    this.type = type;
    this.enumValues = enumValues;
    this.required = required;
  }

  validate(_: MeshSchema): void {
    // In Dart, there was no extra validation needed beyond ensuring
    // type is one of the SimpleValue members.
    // Here, we trust the enum. If you wish, you can add checks.
  }

  toJson(): Record<string, any> {
    let propertyJson: Record<string, any>;

    if (this.enumValues) {
      propertyJson = {
        type: this.type,
        enum: this.enumValues,
      };
    } else if (this.required) {
      propertyJson = {
        type: this.type,
      };
    } else {
      propertyJson = {
        type: [this.type, "null"],
      };
    }

    if (this.description) {
      propertyJson.description = this.description;
    }

    return {
      [this.name]: propertyJson,
    };
  }
}

/* ------------------------------------------------------------------
   ChildProperty
------------------------------------------------------------------ */
export class ChildProperty extends ElementProperty {
  private readonly _childTagNames: string[];
  public readonly ordered: boolean;

  constructor({name, description, childTagNames, ordered = false}: {
    name: string;
    description?: string;
    childTagNames: string[];
    ordered?: boolean;
  }) {
    super({name, description});

    this._childTagNames = childTagNames;
    this.ordered = ordered;
  }

  validate(schema: MeshSchema): void {
    for (const item of this._childTagNames) {
      // ensure there is an element that matches
      schema.element(item);
    }
  }

  isTagAllowed(tagName: string): boolean {
    return this._childTagNames.includes(tagName);
  }

  get childTagNames(): string[] {
    return this._childTagNames;
  }

  toJson(): Record<string, any> {
    const base: Record<string, any> = {};
    if (this.description) {
      base["description"] = this.description;
    }

    if (this.ordered) {
      // ordered means prefixItems
      return {
        [this.name]: {
          ...base,
          type: "array",
          prefixItems: this._childTagNames.map((p) => ({ $ref: `#/$defs/${p}` })),
          items: false,
        },
      };
    } else {
      // not ordered means anyOf
      return {
        [this.name]: {
          ...base,
          type: "array",
          items: {
            anyOf: this._childTagNames.map((p) => ({ $ref: `#/$defs/${p}` })),
          },
        },
      };
    }
  }
}

/* ------------------------------------------------------------------
   ElementType
------------------------------------------------------------------ */
export class ElementType {
  private readonly _tagName: string;
  private readonly _properties: ElementProperty[];
  private readonly _description?: string;
  private readonly _propertyLookup: Map<string, ElementProperty> = new Map();
  private _childPropertyName?: string;

  constructor(params: {
    tagName: string;
    description?: string;
    properties: ElementProperty[];
  }) {
    this._tagName = params.tagName;
    this._description = params.description;
    // Make a shallow copy to avoid external mutation
    this._properties = [...params.properties];

    for (const p of this._properties) {
      if (p instanceof ChildProperty) {
        if (this._childPropertyName) {
          throw new MeshSchemaValidationException("Only one child property is allowed");
        }
        this._childPropertyName = p.name;
      }
      if (this._propertyLookup.has(p.name)) {
        throw new MeshSchemaValidationException(`Duplicate property ${p.name}`);
      }
      this._propertyLookup.set(p.name, p);
    }
  }

  static fromJson(json: Record<string, any>): ElementType {
    // The method logic follows the logic from the Dart code's "factory ElementType.fromJson"
    const description = json["description"] as string | undefined;
    const propertiesMap = json["properties"] as Record<string, any>;
    if (!propertiesMap || Object.keys(propertiesMap).length === 0) {
      throw new MeshSchemaValidationException("Invalid schema json: no properties found");
    }

    // The first entry in the "properties" object is the tagName
    const [tagName, typeJson] = Object.entries(propertiesMap)[0];
    if (!typeJson || typeof typeJson !== "object") {
      throw new MeshSchemaValidationException("typeJson must be an object");
    }

    const innerProps = (typeJson as Record<string, any>)["properties"] as Record<
      string,
      any
    >;
    const resultProps: ElementProperty[] = [];

    for (const [propName, pVal] of Object.entries(innerProps)) {
      const pMap = pVal as Record<string, any>;
      const propDescription = pMap["description"] as string | undefined;
      const pType = pMap["type"];

      let required = true;
      let pTypeValue: string;

      if (Array.isArray(pType) && pType.length > 0) {
        pTypeValue = pType[0];
        required = false;
      } else {
        pTypeValue = pType as string;
      }

      if (pTypeValue === "array") {
        // Distinguish between prefixItems (ordered) and items.anyOf
        if (pMap["prefixItems"]) {
          // ordered
          const prefixItems = pMap["prefixItems"] as Array<Record<string, any>>;
          const childTagNames: string[] = [];
          for (const refObj of prefixItems) {
            const refStr = refObj["$ref"] as string;
            const prefix = "#/$defs/";
            const childTagName = refStr.startsWith(prefix)
              ? refStr.substring(prefix.length)
              : refStr;
            childTagNames.push(childTagName);
          }
          resultProps.push(
            new ChildProperty({
              name: propName,
              description: propDescription,
              childTagNames,
              ordered: true,
            })
          );
        } else if (
          pMap["items"] &&
          typeof pMap["items"] === "object" &&
          pMap["items"]["anyOf"]
        ) {
          // unordered
          const anyOf = pMap["items"]["anyOf"] as Array<Record<string, any>>;
          const childTagNames: string[] = [];
          for (const refObj of anyOf) {
            const refStr = refObj["$ref"] as string;
            const prefix = "#/$defs/";
            const childTagName = refStr.startsWith(prefix)
              ? refStr.substring(prefix.length)
              : refStr;
            childTagNames.push(childTagName);
          }
          resultProps.push(
            new ChildProperty({
              name: propName,
              description: propDescription,
              childTagNames,
              ordered: false,
            })
          );
        } else {
          throw new MeshSchemaValidationException("Invalid array type encountered");
        }
      } else {
        // handle ValueProperty
        const valTypeStr = pTypeValue;
        const valType = SimpleValue.fromString(valTypeStr);
        if (!valType) {
          throw new MeshSchemaValidationException(`Invalid value type: ${valTypeStr}`);
        }

        const enumVal = pMap["enum"] as any[] | undefined;
        resultProps.push(
          new ValueProperty({
            name: propName,
            description: propDescription,
            type: valType,
            enumValues: enumVal,
            required,
          })
        );
      }
    }

    return new ElementType({ tagName, description, properties: resultProps });
  }

  toJson(): Record<string, any> {
    const props: Record<string, any> = {};
    const required: string[] = [];

    for (const p of this._properties) {
      required.push(p.name);
      const pJson = p.toJson();
      // pJson looks like { p.name : { ... } }
      // so let's get the first key
      // and insert into props
      const propValue = pJson[p.name];
      props[p.name] = propValue;
    }

    return {
      type: "object",
      additionalProperties: false,
      description: this._description,
      required: [this._tagName],
      properties: {
        [this._tagName]: {
          type: "object",
          additionalProperties: false,
          required,
          properties: props,
        },
      },
    };
  }

  validate(schema: MeshSchema): void {
    for (const p of this._properties) {
      p.validate(schema);
    }
  }

  get childPropertyName(): string | undefined {
    return this._childPropertyName;
  }
  get tagName(): string {
    return this._tagName;
  }
  get description(): string | undefined {
    return this._description;
  }
  get properties(): ElementProperty[] {
    return this._properties;
  }

  property(name: string): ElementProperty {
    const found = this._propertyLookup.get(name);
    if (!found) {
      throw new Error(`Property is not in schema: ${name}`);
    }
    return found;
  }
}

/*
------------------------------------------------------------------
   MeshSchema
------------------------------------------------------------------
*/
export class MeshSchema {
  private readonly _rootTagName: string;
  private readonly _elements: ElementType[];
  public readonly elementsByTagName: Record<string, ElementType> = {};

  constructor(params: { rootTagName: string; elements: ElementType[] }) {
    const { rootTagName, elements } = params;
    this._rootTagName = rootTagName;
    this._elements = elements;

    for (const t of elements) {
      if (this.elementsByTagName[t.tagName]) {
        throw new MeshSchemaValidationException(`${t.tagName} was found more than once`);
      }
      this.elementsByTagName[t.tagName] = t;
    }

    if (!this.elementsByTagName[rootTagName]) {
      throw new MeshSchemaValidationException(`${rootTagName} was not found in tags`);
    }

    this.validate();
  }

  static fromJson(json: Record<string, any>): MeshSchema {
    const elements: ElementType[] = [];

    const rootTagRef = json["$root_tag_ref"] as string;
    const prefix = "#/$defs/";
    const rootTagName = rootTagRef.startsWith(prefix)
      ? rootTagRef.substring(prefix.length)
      : rootTagRef;

    const defs = json["$defs"] as Record<string, any>;

    for (const elementJson of Object.values(defs)) {
      elements.push(ElementType.fromJson(elementJson as Record<string, any>));
    }

    return new MeshSchema({ rootTagName, elements });
  }

  toJson(): Record<string, any> {
    const defs: Record<string, any> = {};
    for (const t of this._elements) {
      defs[t.tagName] = t.toJson();
    }

    const rootElementJson = this.root.toJson();
    // We'll merge the rootElementJson into our result:
    const result: Record<string, any> = {
      "$root_tag_ref": `#/$defs/${this._rootTagName}`,
      "$defs": defs,
    };

    // Merge rootElementJson into result
    for (const [k, v] of Object.entries(rootElementJson)) {
      result[k] = v;
    }

    return result;
  }

  element(name: string): ElementType {
    const el = this.elementsByTagName[name];
    if (!el) {
      throw new MeshSchemaValidationException(`Element not found: ${name}`);
    }
    return el;
  }

  validate(): void {
    for (const e of this._elements) {
      e.validate(this);
    }
  }

  get root(): ElementType {
    return this.elementsByTagName[this._rootTagName];
  }

  get elements(): ElementType[] {
    return this._elements;
  }
}
