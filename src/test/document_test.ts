import { expect } from "chai";

import {
  ChildProperty,
  Element,
  ElementType,
  MeshDocument,
  MeshSchema,
  SimpleValue,
  TextElement,
  ValueProperty,
} from "../index";

export const schema = new MeshSchema({
  rootTagName: "root",
  elements: [
    new ElementType({
      tagName: "root",
      description: "",
      properties: [
        new ValueProperty({ name: "hello", description: "", type: SimpleValue.string }),
        new ValueProperty({ name: "hi", description: "", type: SimpleValue.string }),
        new ValueProperty({ name: "test", description: "", type: SimpleValue.string }),
        new ChildProperty({
          name: "children",
          description: "",
          childTagNames: ["child", "text"]
        })
      ]
    }),
    new ElementType({
      tagName: "child",
      description: "",
      properties: [
        new ValueProperty({ name: "hello", description: "", type: SimpleValue.string }),
        new ValueProperty({ name: "hi", description: "", type: SimpleValue.string }),
        new ValueProperty({ name: "test", description: "", type: SimpleValue.string }),
        new ChildProperty({
          name: "children",
          description: "",
          childTagNames: ["child"]
        })
      ]
    }),
    new ElementType({
      tagName: "text",
      description: "",
      properties: [
        new ChildProperty({
          name: "children",
          description: "",
          childTagNames: ["child"]
        }),
        new ValueProperty({ name: "hello", description: "", type: SimpleValue.string }),
      ]
    })
  ]
});

// Helper to create a new MeshDocument
function createNewDoc(): MeshDocument {
  return new MeshDocument({schema});
}

describe("Document Test", () => {
  it("test_runtime", () => {
    const doc = createNewDoc();

    // root.append_child("child", {"hello": "world"})
    const element = doc.root.createChildElement("child", { hello: "world" });
    expect(element.tagName).to.equal("child");
    expect(element.getAttribute("hello")).to.equal("world");

    // e2 = element.append_child("child", {"hi": "there"})
    const e2 = element.createChildElement("child", { hi: "there" });
    expect(e2.getAttribute("hi")).to.equal("there");

    // e2.append_child("child", {"hello": "hi"})
    const e3 = e2.createChildElement("child", { hello: "hi" });
    expect(e3.getAttribute("hello")).to.equal("hi");

    // element["test"] = "test2"
    element.setAttribute("test", "test2");
    expect(element.getAttribute("test")).to.equal("test2");

    // element._remove_attribute("test")
    element.removeAttribute("test");
    expect(element.getAttribute("test")).to.be.undefined;
  });

  it("test_set_attribute", () => {
    const doc = createNewDoc();
    doc.root.setAttribute("test", "v1");
    expect(doc.root.getAttribute("test")).to.equal("v1");
  });

  it("test_insert_and_delete_element", () => {
    const doc = createNewDoc();
    const child = doc.root.createChildElement("child", { hello: "world" });
    expect(child.tagName).to.equal("child");
    expect(child.getAttribute("hello")).to.equal("world");

    // child.delete()
    child.delete();

    // Since there's no direct removal in our mock, we can test
    // that doc.root no longer sees the child or that we do something
    // in child.delete() to remove from parent's children array.
    // For now, let's just confirm we can remove it from parent's children array:
    expect(doc.root.getChildren()).to.be.empty;
  });

  it("test_update_attribute", () => {
    const doc = createNewDoc();
    const child = doc.root.createChildElement("child", { hello: "world" });
    child.setAttribute("hello", "mod");
    expect(child.getAttribute("hello")).to.equal("mod");
  });

  it("test_remove_attribute", () => {
    const doc = createNewDoc();
    const child = doc.root.createChildElement("child", { hello: "world" });
    child.setAttribute("hello", "mod");
    child.removeAttribute("hello");
    expect(child.getAttribute("hello")).to.be.undefined;
  });

  it("test_insert_extend_and_shrink_text_delta", () => {
    const doc = createNewDoc();
    const child = doc.root.createChildElement("text", { hello: "world" });
    expect(child.tagName).to.equal("text");
    expect(child.getAttribute("hello")).to.equal("world");

    const textEl = child.getChildren()[0] as TextElement;
    expect(textEl.delta.length).to.equal(0);

    // text.insert(0, "hello world")
    textEl.insert(0, "hello world");
    expect(textEl.delta.length).to.equal(1);
    expect(textEl.delta[0].insert).to.equal("hello world");

    // Insert again at 0
    textEl.insert(0, "hello world");
    expect(textEl.delta.length).to.equal(1);
    expect(textEl.delta[0].insert).to.equal("hello worldhello world");

    // text.delete(len("hello world"), len("hello world"))
    const lengthHelloWorld = "hello world".length;
    textEl.delete(lengthHelloWorld, lengthHelloWorld);
    expect(textEl.delta.length).to.equal(1);
    expect(textEl.delta[0].insert).to.equal("hello world");
  });

  it("test_format_text_deltas", () => {
    const doc = createNewDoc();
    const child = doc.root.createChildElement("text", { hello: "world" });
    const text = child.getChildren()[0] as TextElement;

    // Insert "hello world"
    text.insert(0, "hello world");

    // Format entire text with {"bold": true}
    text.format(0, "hello world".length, { bold: true });

    expect(text.delta.length).to.equal(1);
    expect(text.delta[0].insert).to.equal("hello world");
    expect(text.delta[0].attributes.bold).to.be.true;

    // format(0, 5, {"italic": true})
    text.format(0, 5, { italic: true });

    expect(text.delta.length).to.equal(2);
    expect(text.delta[0].insert).to.equal("hello");
    expect(text.delta[0].attributes.bold).to.be.true;
    expect(text.delta[0].attributes.italic).to.be.true;

    expect(text.delta[1].insert).to.equal(" world");
    expect(text.delta[1].attributes.bold).to.be.true;
    expect(text.delta[1].attributes.italic).to.be.undefined;

    // format(3,2, {"underline": true})
    text.format(3, 2, { underline: true });

    expect(text.delta.length).to.equal(3);
    // "hel", "lo", " world"
    expect(text.delta[0].insert).to.equal("hel");
    expect(text.delta[1].insert).to.equal("lo");
    expect(text.delta[2].insert).to.equal(" world");

    // Check attributes
    expect(text.delta[0].attributes.bold).to.be.true;
    expect(text.delta[0].attributes.italic).to.be.true;
    expect(text.delta[0].attributes.underline).to.be.undefined;
    expect(text.delta[1].attributes.underline).to.be.true;

    // format entire range with "strikethrough: true"
    text.format(0, "hello world".length, { strikethrough: true });

    // Now each run has strikethrough plus previous attributes
    expect(text.delta.length).to.equal(3);
    expect(text.delta[0].attributes.strikethrough).to.be.true;
    expect(text.delta[1].attributes.strikethrough).to.be.true;
    expect(text.delta[2].attributes.strikethrough).to.be.true;

    // format(1,1, {"dot": true})
    text.format(1, 1, { dot: true });
    expect(text.delta.length).to.equal(5);

    expect(text.delta[0].insert).to.equal("h");
    expect(text.delta[1].insert).to.equal("e");
    expect(text.delta[2].insert).to.equal("l");
  });

  it("test_delete_start_of_delta_text", () => {
    const doc = createNewDoc();
    const child = doc.root.createChildElement("text", { hello: "world" });
    const text = child.getChildren()[0] as TextElement;

    text.insert(0, "hello world");
    expect(text.delta.length).to.equal(1);
    expect(text.delta[0].insert).to.equal("hello world");

    // delete(0, len("hello "))
    text.delete(0, "hello ".length);
    expect(text.delta.length).to.equal(1);
    expect(text.delta[0].insert).to.equal("world");
  });

  it("test_delete_end_of_delta_text", () => {
    const doc = createNewDoc();
    const child = doc.root.createChildElement("text", { hello: "world" });
    const text = child.getChildren()[0] as TextElement;

    text.insert(0, "world");
    text.delete("world".length - 1, 1);
    expect(text.delta.length).to.equal(1);
    expect(text.delta[0].insert).to.equal("worl");
  });

  it("test_delete_center_of_delta_text", () => {
    const doc = createNewDoc();
    const child = doc.root.createChildElement("text", { hello: "world" });
    const text = child.getChildren()[0] as TextElement;

    text.insert(0, "worl");
    text.delete(2, 1); // remove the 'r'
    expect(text.delta.length).to.equal(1);
    expect(text.delta[0].insert).to.equal("wol");
  });

  it("test_insert_elements_at_positions", () => {
    const doc = createNewDoc();

    // Insert at end
    const child1 = doc.root.createChildElement("child", { hello: "world2" });
    expect(child1.tagName).to.equal("child");
    expect(child1.getAttribute("hello")).to.equal("world2");

    // Insert deep
    const child2 = child1.createChildElement("child", { hello: "world3" });
    expect(child2.tagName).to.equal("child");
    expect(child2.getAttribute("hello")).to.equal("world3");

    // Insert after deep
    const child3 = child1.createChildElement("child", { hello: "world4" });
    expect(child3.tagName).to.equal("child");
    expect(child3.getAttribute("hello")).to.equal("world4");

    // Equivalent to insert_child_after in Python
    const child5 = child1.createChildElementAfter(child2, "child", { hello: "world5" });
    const childrenOfChild1 = child1.getChildren().filter((c) => c instanceof Element) as Element[];
    expect(childrenOfChild1[1]).to.equal(child5);
    expect(child5.getAttribute("hello")).to.equal("world5");

    // Equivalent to insert_child_at(2, ...)
    const child6 = child1.createChildElementAt(2, "child", { hello: "world6" });
    const updatedChildren = child1.getChildren().filter((c) => c instanceof Element) as Element[];

    // Now the order is [child2, child5, child6, child3]
    expect(updatedChildren[2]).to.equal(child6);
    expect(child6.getAttribute("hello")).to.equal("world6");
  });
});
