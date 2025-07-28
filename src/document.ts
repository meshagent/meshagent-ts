// document.ts

import { v4 as uuid } from "uuid";
import { MeshSchema, ElementType, ChildProperty } from "./schema";
import { EventEmitter } from "./event-emitter";

export interface RuntimeDocumentEvent {
  type: string;
  doc: RuntimeDocument;
}

/*
------------------------------------------------------------------
   Node
------------------------------------------------------------------
*/
export class RuntimeDocument extends EventEmitter<RuntimeDocumentEvent> {
  public readonly id: string;
  public readonly schema: MeshSchema;
  public readonly sendChanges: (changes: Record<string, any>) => void;
  public readonly sendChangesToBackend?: (msg: string) => void;

  // A stream of changes. In Dart, this was a StreamController.
  // Here we’ll maintain an array of subscribers for demonstration.
  private _changeSubscribers: Array<(data: Record<string, any>) => void> = [];

  constructor({id, schema, sendChanges, sendChangesToBackend}: {
    id: string;
    schema: MeshSchema;
    sendChanges: (changes: Record<string, any>) => void;
    sendChangesToBackend?: (msg: string) => void;
  }) {
    super();
    this.id = id;
    this.schema = schema;
    this.sendChanges = sendChanges;
    this.sendChangesToBackend = sendChangesToBackend;
  }

  listen(onData: (data: Record<string, any>) => void) {
    this._changeSubscribers.push(onData);

    return {
      unsubscribe: () => {
        const idx = this._changeSubscribers.indexOf(onData);

        if (idx >= 0) {
          this._changeSubscribers.splice(idx, 1);
        }
      },
    };
  }

  // The root element
  // We lazily instantiate so we can reference `this.schema.root`:
  private _root?: Element;

  get root(): Element {
    if (!this._root) {
      this._root = new Element({
        parent: null,
        tagName: this.schema.root.tagName,
        attributes: {},
        doc: this,
        elementType: this.schema.root,
      });
    }
    return this._root;
  }

  /**
   * Creates a node (Element or TextElement) from data that includes either
   * `element` or `text`. Used during rehydration of the doc from changes.
   */
  private _createNode(parent: Element | null, data: Record<string, any>): Node {
    if (data["element"] != null) {
      const elementData = data["element"];
      const tagName = elementData["tagName"] as string;
      const elementType = this.schema.element(tagName);

      const element = new Element({
        parent,
        tagName,
        attributes: (elementData["attributes"] as Record<string, any>) || {},
        doc: this,
        elementType,
      });

      if (elementData["children"] != null) {
        for (const child of elementData["children"]) {
          element.children.push(this._createNode(element, child));
        }
      }
      return element;
    } else if (data["text"] != null) {
      // It's a text node
      const delta = Array.isArray(data["text"]["delta"])
        ? (data["text"]["delta"] as Array<Record<string, any>>)
        : [];
      return new TextElement({
        parent: parent!,
        delta,
        doc: this,
      });
    } else {
      throw new Error("Unsupported node type");
    }
  }

  /**
   * Applies incoming changes from the server or another source.
   */
  public receiveChanges(message: Record<string, any>): void {
    console.log("Applying changes to doc:", JSON.stringify(message));

    const nodeID = message["target"] as string | undefined;
    const target = message["root"] === true ? this.root : this.root.getNodeByID(nodeID!);
    if (!target) {
      throw new Error(`Target node not found: ${nodeID}`);
    }

    // Process element deltas
    let retain = 0;
    const elements = message["elements"] as Array<Record<string, any>> || [];
    for (const delta of elements) {
      if (delta["retain"] != null) {
        retain += delta["retain"];
      }
      if (delta["insert"] != null) {
        for (const insert of delta["insert"] as Array<Record<string, any>>) {
          if (insert["element"] != null || insert["text"] != null) {
            target.children.splice(retain, 0, this._createNode(target, insert));
            retain++;
          } else {
            throw new Error("Unsupported element delta");
          }
        }
      } else if (delta["delete"] != null) {
        target.children.splice(retain, delta["delete"]);
        retain -= delta["delete"];
      }
    }

    // Process text deltas
    const text = message["text"] as Array<Record<string, any>> | undefined;
    if (text && text.length > 0) {
      if (target.tagName !== "text") {
        throw new Error("Node is not a text node: " + target.tagName);
      }
      const textNode = target.children[0] as TextElement;
      let retainInner = 0;
      let i = 0;
      let offset = 0;
      const targetDelta = textNode.delta;

      for (const delta of text) {
        if (delta["insert"] != null) {
          const insStr = delta["insert"] as string;
          if (i === targetDelta.length) {
            targetDelta.push({
              insert: insStr,
              attributes: delta["attributes"] ?? {},
            });
            i++;
            offset += insStr.length;
            retainInner += insStr.length;
          } else {
            const str = targetDelta[i]["insert"] as string;
            const pos = (retainInner - offset) | 0;

            targetDelta[i]["insert"] = str.slice(0, pos) + insStr + str.slice(pos);
            retainInner += insStr.length;
          }
        } else if (delta["delete"] != null) {
          let deleted = 0;
          while (delta["delete"] > deleted) {
            const remaining = delta["delete"] - deleted;
            const str = targetDelta[i]?.["insert"];
            if (typeof str !== "string") {
              break; // or error
            }

            if (retainInner > offset) {
              const startPos = (retainInner - offset) | 0;
              const start = str.slice(0, startPos);
              const end = str.slice(startPos);
              if (remaining >= end.length) {
                // Remove entire tail
                targetDelta[i]["insert"] = start;
                deleted += end.length;
                i++;
                offset += str.length;
              } else {
                targetDelta[i]["insert"] = start + end.slice(remaining);
                deleted += remaining;
              }
            } else if (remaining >= str.length) {
              deleted += str.length;
              targetDelta.splice(i, 1);
            } else {
              const start = str.slice(0, remaining);
              const end = str.slice(remaining);
              targetDelta[i]["insert"] = end;
              deleted += start.length;
            }
          }
        } else if (delta["attributes"] != null) {
          let formatted = 0;
          const retainVal = delta["retain"] ?? 0;
          while (retainVal > formatted) {
            const remaining = (retainVal - formatted) | 0;
            // Make sure attributes object exists
            if (!targetDelta[i]["attributes"]) {
              targetDelta[i]["attributes"] = {};
            }
            const str = targetDelta[i]["insert"] as string;
            const startPos = (retainInner - offset) | 0;
            const start = str.slice(0, startPos);
            const end = str.slice(startPos);

            if (retainInner > offset) {
              // Format the tail
              if (remaining >= end.length) {
                // Split the chunk
                targetDelta[i]["insert"] = start;
                targetDelta.splice(i + 1, 0, {
                  insert: end,
                  attributes: {
                    ...(targetDelta[i]["attributes"] as object),
                    ...(delta["attributes"] as object),
                  },
                });
                formatted += end.length;
                i += 2;
                offset += str.length;
              } else {
                targetDelta[i]["insert"] = start;
                const middle = end.slice(0, remaining);
                const tail = end.slice(remaining);
                targetDelta.splice(i + 1, 0, {
                  insert: middle,
                  attributes: {
                    ...(targetDelta[i]["attributes"] as object),
                    ...(delta["attributes"] as object),
                  },
                });
                targetDelta.splice(i + 2, 0, {
                  insert: tail,
                  attributes: { ...(targetDelta[i]["attributes"] as object) },
                });
                formatted += remaining;
                i += 3;
                offset += start.length + remaining;
              }
            } else if (remaining >= str.length) {
              // Format entire chunk
              formatted += str.length;
              Object.assign(targetDelta[i]["attributes"], delta["attributes"]);
              offset += str.length;
              i++;
            } else {
              // Format part of chunk from the front
              const startChunk = str.slice(0, remaining);
              const endChunk = str.slice(remaining);
              targetDelta[i]["insert"] = startChunk;
              targetDelta.push({
                insert: endChunk,
                attributes: { ...(targetDelta[i]["attributes"] as object) },
              });
              // Add the new attributes to the first part
              Object.assign(targetDelta[i]["attributes"], delta["attributes"]);
              formatted += remaining;
            }
          }
          retainInner += retainVal;
        } else if (delta["retain"] != null) {
          retainInner += delta["retain"];
          while (
            i < targetDelta.length &&
            retainInner > offset + (targetDelta[i]["insert"]?.length ?? 0)
          ) {
            offset += targetDelta[i]["insert"].length;
            i++;
          }
        }
      }
    }

    // Process attribute changes
    const attr = message["attributes"] as Record<string, any> | undefined;
    if (attr) {
      const setList = (attr["set"] as Array<Record<string, any>>) || [];
      for (const change of setList) {
        target.attributes[change["name"]] = change["value"];

        target.emit("updated", { type: "change", node: target });
      }

      const delList = (attr["delete"] as Array<string>) || [];
      for (const name of delList) {
        delete target.attributes[name];

        target.emit("updated", { type: "change", node: target });
      }
    }

    for (const sub of this._changeSubscribers) {
      sub(message);
    }

    this.emit("updated", { type: "change", doc: this});
  }
}

/*
------------------------------------------------------------------
   Node Base Class
------------------------------------------------------------------
*/

export interface NodeEvent {
    type: string;
    node: Node;
}

export class Node extends EventEmitter<NodeEvent> {
  parent: Element | null;
  doc: RuntimeDocument;

  constructor({parent, doc}: {
    parent: Element | null;
    doc: RuntimeDocument;
  }) {
    super();

    this.parent = parent;
    this.doc = doc;
  }
}

/*
------------------------------------------------------------------
   Element Class
------------------------------------------------------------------
*/
export class Element extends Node {
  tagName: string;
  attributes: Record<string, any>;
  elementType: ElementType;
  children: Node[] = [];

  constructor({parent, tagName, attributes, doc, elementType}: {
    parent: Element | null;
    tagName: string;
    attributes: Record<string, any>;
    doc: RuntimeDocument;
    elementType: ElementType;
  }) {
    super({ parent, doc });

    this.tagName = tagName;
    this.attributes = attributes;
    this.elementType = elementType;
  }

  public getNodeByID(id: string): Element | null {
    if (id === this.id) {
      return this;
    }
    for (const child of this.getChildren()) {
      if (child instanceof Element) {
        const found = child.getNodeByID(id);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  get id(): string | undefined {
    return this.getAttribute("$id");
  }

  public getAttribute(name: string): any {
    return this.attributes[name];
  }

  public setAttribute(name: string, value: any): void {
    this.doc.sendChanges({
      documentID: this.doc.id,
      changes: [
        {
          nodeID: this.id,
          setAttributes: { [name]: value },
        },
      ],
    });
  }

  public removeAttribute(name: string): void {
    this.doc.sendChanges({
      documentID: this.doc.id,
      changes: [
        {
          nodeID: this.id,
          removeAttributes: [name],
        },
      ],
    });
  }

  private _ensureChildValid(tagName: string): ElementType {
    const childName = this.elementType.childPropertyName;
    if (!childName) {
      throw new Error(`Children are not allowed on this element: ${this.tagName}`);
    }
    const childProp = this.elementType.property(childName) as ChildProperty;
    if (!childProp.isTagAllowed(tagName)) {
      throw new Error(`Cannot add ${tagName} to ${this.tagName}`);
    }
    return this.doc.schema.element(tagName);
  }

  private _validateElementAttributes(elType: ElementType, attributes: Record<string, any>): void {
    // Just ensure each attribute is defined in the schema. If property(...) not found, it throws.
    for (const k of Object.keys(attributes)) {
      elType.property(k); // may throw if not in schema
    }
  }

  public createChildElement(tagName: string, attributes: Record<string, any>, opts?: { id?: string }): Element {
    const childElementType = this._ensureChildValid(tagName);
    this._validateElementAttributes(childElementType, attributes);

    const newId = opts?.id ?? uuid();
    const elementData: Record<string, any> = {
      name: tagName,
      attributes: {
        $id: newId,
        ...attributes,
      },
      children: this._defaultChildren(tagName),
    };
    this.doc.sendChanges({
      documentID: this.doc.id,
      changes: [
        {
          nodeID: this.id,
          insertChildren: {
            children: [{ element: elementData }],
          },
        },
      ],
    });
    return this.getNodeByID(newId)!;
  }

  public createChildElementAt(
    index: number,
    tagName: string,
    attributes: Record<string, any>,
    opts?: { id?: string }
  ): Element {
    const childElementType = this._ensureChildValid(tagName);
    this._validateElementAttributes(childElementType, attributes);

    const newId = opts?.id ?? uuid();
    const elementData: Record<string, any> = {
      name: tagName,
      attributes: {
        $id: newId,
        ...attributes,
      },
      children: this._defaultChildren(tagName),
    };
    this.doc.sendChanges({
      documentID: this.doc.id,
      changes: [
        {
          nodeID: this.id,
          insertChildren: {
            index,
            children: [{ element: elementData }],
          },
        },
      ],
    });
    return this.getNodeByID(newId)!;
  }

  public createChildElementAfter(
    element: Element,
    tagName: string,
    attributes: Record<string, any>,
    opts?: { id?: string }
  ): Element {
    const childElementType = this._ensureChildValid(tagName);
    this._validateElementAttributes(childElementType, attributes);

    if (element.parent?.id !== this.id) {
      throw new Error("Element does not belong to this node");
    }
    const newId = opts?.id ?? uuid();
    const elementData: Record<string, any> = {
      name: tagName,
      attributes: {
        $id: newId,
        ...attributes,
      },
      children: this._defaultChildren(tagName),
    };
    this.doc.sendChanges({
      documentID: this.doc.id,
      changes: [
        {
          nodeID: this.id,
          insertChildren: {
            after: element.id,
            children: [{ element: elementData }],
          },
        },
      ],
    });
    return this.getNodeByID(newId)!;
  }

  private _defaultChildren(tagName: string): Array<Record<string, any>> {
    if (tagName === "text") {
      return [
        {
          text: { delta: [] },
        },
      ];
    }
    return [];
  }

  public delete(): void {
    this.doc.sendChanges({
      documentID: this.doc.id,
      changes: [
        {
          nodeID: this.id,
          delete: {},
        },
      ],
    });
  }

  public getChildren(): Node[] {
    return this.children;
  }

  public appendJson(json: Record<string, any>): Element {
    const name = tagNameFromJson(json);
    const attrs = attributesFromJson(json);
    const elType = this.doc.schema.element(name);

    if (elType.childPropertyName && attrs.hasOwnProperty(elType.childPropertyName)) {
      // This property might represent an array of children
      const childArr = attrs[elType.childPropertyName];
      delete attrs[elType.childPropertyName];
      const elem = this.createChildElement(name, attrs);
      if (Array.isArray(childArr)) {
        for (const c of childArr) {
          elem.appendJson(c);
        }
      }
      return elem;
    } else {
      // Just create the child element with these attributes
      return this.createChildElement(name, attrs);
    }
  }
}

/*
------------------------------------------------------------------
   TextElement
------------------------------------------------------------------
*/
export class TextElement extends Node {
  delta: Array<Record<string, any>>;

  public constructor({ parent, delta, doc }: {
    parent: Element;
    delta: Array<Record<string, any>>;
    doc: RuntimeDocument;
  }) {
    super({ parent, doc });
    this.delta = delta;
  }

  public insert(index: number, text: string, attributes?: Record<string, any>): void {
    this.doc.sendChanges({
      documentID: this.doc.id,
      changes: [
        {
          nodeID: this.parent?.id,
          insertText: {
            index,
            text,
            attributes: attributes ?? {},
          },
        },
      ],
    });
  }

  public format(from: number, length: number, attributes: Record<string, any>): void {
    this.doc.sendChanges({
      documentID: this.doc.id,
      changes: [
        {
          nodeID: this.parent?.id,
          formatText: {
            from,
            length,
            attributes,
          },
        },
      ],
    });
  }

  public delete(index: number, length: number): void {
    this.doc.sendChanges({
      documentID: this.doc.id,
      changes: [
        {
          nodeID: this.parent?.id,
          deleteText: {
            index,
            length,
          },
        },
      ],
    });
  }
}

/*
------------------------------------------------------------------
   Utility Functions
------------------------------------------------------------------
*/

/**
 * Extracts the tag name from a JSON object that must have exactly one key.
 */
export function tagNameFromJson(json: Record<string, any>): string {
  const keys = Object.keys(json);
  if (keys.length !== 1) {
    throw new Error("JSON element must have a single key");
  }
  return keys[0];
}

/**
 * Extracts attributes from a JSON object that must have exactly one key,
 * where the key's value must be an object.
 */
export function attributesFromJson(json: Record<string, any>): Record<string, any> {
  const keys = Object.keys(json);
  if (keys.length !== 1) {
    throw new Error("JSON element must have a single key");
  }
  const val = json[keys[0]];
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    return { ...val };
  } else {
    throw new Error("JSON element value must be an object");
  }
}
