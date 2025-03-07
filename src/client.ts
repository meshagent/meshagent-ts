import { v4 as uuid } from "uuid";

interface ElementData {
  tagName: string;
  attributes: Record<string, any>;
  children: Array<XmlElement | XmlText>;
}

interface TextData {
  delta: any; // Adjust type for your "delta" format if needed
}

// ─────────────────────────────────────────────────────────────────────────────
// XmlElement
// ─────────────────────────────────────────────────────────────────────────────

export class XmlElement {
  private _data: ElementData;
  private _parent: XmlElement | null;
  private _doc: ClientXmlDocument;

  constructor(
    parent: XmlElement | null,
    { tagName, attributes }: { tagName: string; attributes: Record<string, any> },
    doc: ClientXmlDocument
  ) {
    this._data = {
      tagName,
      attributes,
      children: [],
    };
    this._parent = parent;
    this._doc = doc;
  }

  /**
   * Recursively searches for the node with the given ID in the subtree
   */
  public getNodeByID(id: string): XmlElement | XmlText | null {
    if (id === this.id) {
      return this;
    }

    for (const child of this.getChildren()) {
      if (child instanceof XmlElement) {
        const found = child.getNodeByID(id);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  /**
   * Returns the '$id' attribute value (if any)
   */
  get id(): string | undefined {
    return this.getAttribute("$id");
  }

  get doc(): ClientXmlDocument {
    return this._doc;
  }

  get data(): ElementData {
    return this._data;
  }

  get tagName(): string {
    return this._data.tagName;
  }

  get parent(): XmlElement | null {
    return this._parent;
  }

  public getAttribute(name: string): any {
    return this._data.attributes[name];
  }

  public setAttribute(name: string, value: any): void {
    this.doc.sendChanges({
      documentID: this.doc.id,
      changes: [
        {
          nodeID: this.id,
          setAttributes: {
            [name]: value,
          },
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

  public createChildElement(tagName: string, attributes: Record<string, any>): XmlElement | XmlText | null {
    const newId = uuid();
    const elementData = {
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
            children: [
              {
                element: elementData,
              },
            ],
          },
        },
      ],
    });

    // Use the newly created '$id'
    return this.getNodeByID(newId);
  }

  public createChildElementAt(
    index: number,
    tagName: string,
    attributes: Record<string, any>
  ): XmlElement | XmlText | null {
    const newId = uuid();
    const elementData = {
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
            index: index,
            children: [
              {
                element: elementData,
              },
            ],
          },
        },
      ],
    });

    return this.getNodeByID(newId);
  }

  public createChildElementAfter(
    element: XmlElement | XmlText,
    tagName: string,
    attributes: Record<string, any>
  ): XmlElement | XmlText | null {
    if (element instanceof XmlElement) {
      if (element.parent?.id !== this.id) {
        throw new Error("Element does not belong to this node");
      }
    } else {
      // If it's a XmlText, we check its parent’s ID
      if (element.parent?.id !== this.id) {
        throw new Error("Text does not belong to this node");
      }
    }

    const newId = uuid();
    const elementData = {
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
            children: [
              {
                element: elementData,
              },
            ],
          },
        },
      ],
    });

    return this.getNodeByID(newId);
  }

  /**
   * Returns default children for certain tagNames, e.g. "text" nodes
   */
  protected _defaultChildren(tagName: string): any[] {
    if (tagName === "text") {
      return [
        {
          text: {
            delta: [],
          },
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

  public getChildren(): Array<XmlElement | XmlText> {
    return this._data.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// XmlText
// ─────────────────────────────────────────────────────────────────────────────

export class XmlText {
  private _data: TextData;
  public parent: XmlElement;
  public doc: ClientXmlDocument;

  constructor(parent: XmlElement, data: TextData, doc: ClientXmlDocument) {
    this._data = data;
    this.parent = parent;
    this.doc = doc;
  }

  get delta(): any {
    return this._data.delta;
  }

  public insert(index: number, text: string, attributes?: Record<string, any>): void {
    this.doc.sendChanges({
      documentID: this.doc.id,
      changes: [
        {
          nodeID: this.parent.id,
          insertText: {
            index: index,
            text: text,
            attributes: attributes,
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
          nodeID: this.parent.id,
          formatText: {
            from: from,
            length: length,
            attributes: attributes,
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
          nodeID: this.parent.id,
          deleteText: {
            index: index,
            length: length,
          },
        },
      ],
    });
  }

  /**
   * If you'd like, you can add an `id` property to align with XmlElement
   */
  get id(): string | undefined {
    return this.parent?.id;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ClientXmlDocument
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of the function that sends changes to the server or elsewhere */
type SendChangesFn = (message: any) => void;

/** Simplified shape of a single element-insert or text-insert. */
interface InsertElementData {
  element?: {
    name: string;
    attributes: Record<string, any>;
    children: any[];
  };
  text?: {
    delta: any;
  };
}

/** Shape of the "receiveChanges" message. Adjust to match your data structure. */
interface ReceiveChangesMessage {
  target: string;
  root: boolean;
  elements: Array<{
    retain?: number;
    insert?: InsertElementData[];
    delete?: number;
  }>;
  text: Array<{
    insert?: string;
    delete?: number;
    attributes?: Record<string, any>;
    retain?: number;
  }>;
  attributes: {
    set: Array<{ name: string; value: any }>;
    delete: string[];
  };
}

export class ClientXmlDocument {
  private _root: XmlElement;
  private _id: string;
  sendChanges: SendChangesFn;

  constructor({
    id,
    sendChanges,
  }: {
    id: string;
    sendChanges: SendChangesFn;
  }) {
    this._root = new XmlElement(null, { tagName: "root", attributes: {} }, this);
    this.sendChanges = sendChanges;
    this._id = id;
  }

  get id(): string {
    return this._id;
  }

  get root(): XmlElement {
    return this._root;
  }

  /**
   * Creates a node from raw data, either an element or a text node.
   */
  _createNode(parent: XmlElement, data: InsertElementData): XmlElement | XmlText {
    if (data.element) {
      const element = new XmlElement(parent, {
        tagName: data.element.name,
        attributes: data.element.attributes,
      }, this);

      if (data.element.children) {
        for (const child of data.element.children) {
          (element as XmlElement).data.children.push(this._createNode(element, child));
        }
      }
      return element;
    } else if (data.text) {
      return new XmlText(parent, data.text, this);
    } else {
      throw new Error("Unsupported " + JSON.stringify(data));
    }
  }

  /**
   * Processes incoming changes and updates the in-memory document structure.
   */
  receiveChanges(message: ReceiveChangesMessage): void {
    const nodeID = message.target;
    const target = message.root ? this.root : this.root.getNodeByID(nodeID);

    if (!target) {
      throw new Error(`Target node ${nodeID} not found in document`);
    }

    // Process element deltas
    let retain = 0;
    for (const delta of message.elements) {
      if (delta.retain) {
        retain += delta.retain;
      }
      if (delta.insert) {
        for (const insertItem of delta.insert) {
          // Insert an element or text node
          const newNode = this._createNode(target as XmlElement, insertItem);
          (target as XmlElement).data.children.splice(retain, 0, newNode);
          retain++;
        }
      } else if (typeof delta.delete === "number") {
        (target as XmlElement).data.children.splice(retain, delta.delete);
        retain -= delta.delete;
      }
    }

    // Process text deltas
    if (message.text.length !== 0) {
      // If the target is not a text node, error out
      if ((target as XmlElement).tagName !== "text") {
        throw new Error(`Node is not a text node: ${(target as XmlElement).tagName}`);
      }
      const textNode = (target as XmlElement).data.children[0] as XmlText;
      let i = 0;
      let offset = 0;
      const targetDelta = textNode.delta;
      if (!targetDelta) {
        throw new Error("Text node is missing delta");
      }

      for (const delta of message.text) {
        if (delta.insert) {
          // Inserting text at the current position
          if (i === targetDelta.length) {
            targetDelta.push({
              insert: delta.insert,
              attributes: delta.attributes ?? {},
            });
            i++;
            offset += delta.insert.length;
            retain += delta.insert.length;
          } else {
            // Insert into existing chunk
            const str = targetDelta[i].insert;
            targetDelta[i].insert =
              str.slice(0, retain - offset) +
              delta.insert +
              str.slice(retain - offset);
            retain += delta.insert.length;
          }
        } else if (typeof delta.delete === "number") {
          // Deleting text
          let deleted = 0;
          while (delta.delete > deleted) {
            const remaining = delta.delete - deleted;

            if (retain > offset) {
              // Delete the tail of current chunk
              const str = targetDelta[i].insert;
              const start = str.slice(0, retain - offset);
              const end = str.slice(retain - offset);

              if (remaining >= end.length) {
                targetDelta[i].insert = start;
                deleted += end.length;
                i++;
                offset += str.length;
              } else {
                targetDelta[i].insert = start + end.slice(remaining);
                deleted += remaining;
              }
            } else if (remaining >= targetDelta[i].insert.length) {
              deleted += targetDelta[i].insert.length;
              offset += targetDelta[i].insert.length;
              targetDelta.splice(i, 1);
            } else {
              // Delete front portion of chunk
              const str = targetDelta[i].insert;
              const start = str.substr(0, remaining);
              const end = str.slice(remaining);
              targetDelta[i].insert = end;
              deleted += start.length;
            }
          }
        } else if (delta.attributes) {
          // Formatting text
          let formatted = 0;
          while (delta.retain && delta.retain > formatted) {
            const remaining = delta.retain - formatted;
            if (retain > offset) {
              // Format the tail of the current chunk
              const str = targetDelta[i].insert;
              const start = str.slice(0, retain - offset);
              const end = str.slice(retain - offset);

              if (remaining >= end.length) {
                targetDelta[i].insert = start;
                targetDelta.splice(i + 1, 0, {
                  insert: end,
                  attributes: {
                    ...targetDelta[i].attributes,
                    ...delta.attributes,
                  },
                });
                formatted += end.length;
                i += 2; // Move past the newly inserted chunk
                offset += str.length;
              } else {
                targetDelta[i].insert = start;
                targetDelta.splice(i + 1, 0, {
                  insert: end.slice(0, remaining),
                  attributes: {
                    ...targetDelta[i].attributes,
                    ...delta.attributes,
                  },
                });
                targetDelta.splice(i + 2, 0, {
                  insert: end.slice(remaining),
                  attributes: { ...targetDelta[i].attributes },
                });
                formatted += remaining;
                i += 3;
                offset += start.length + remaining;
              }
            } else if (
              delta.retain - formatted >= targetDelta[i].insert.length
            ) {
              // Format entire chunk
              formatted += targetDelta[i].insert.length;
              Object.assign(targetDelta[i].attributes, delta.attributes);
              offset += targetDelta[i].insert.length;
              i++;
            } else {
              // Format begins at chunk start
              const str = targetDelta[i].insert;
              const start = str.substr(0, remaining);
              const end = str.slice(remaining);
              targetDelta[i].insert = start;
              targetDelta.push({
                insert: end,
                attributes: { ...targetDelta[i].attributes },
              });
              Object.assign(targetDelta[i].attributes, delta.attributes);
              formatted += remaining;
            }
          }
          if (delta.retain) {
            retain += delta.retain;
          }
        } else if (typeof delta.retain === "number") {
          // Just move the cursor forward
          retain += delta.retain;
          while (
            i < targetDelta.length &&
            retain > offset + targetDelta[i]?.insert.length
          ) {
            offset += targetDelta[i].insert.length;
            i++;
          }
        }
      }
    }

    // Process attribute changes
    for (const change of message.attributes.set) {
      (target as XmlElement).data.attributes[change.name] = change.value;
    }
    for (const name of message.attributes.delete) {
      delete (target as XmlElement).data.attributes[name];
    }
  }
}
