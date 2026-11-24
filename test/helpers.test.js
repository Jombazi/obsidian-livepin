const assert = require("assert");
const Module = require("module");
const realLoad = Module._load;
Module._load = (name, ...rest) => name === "obsidian"
  ? { Plugin: class {}, Notice: class {}, MarkdownView: class {}, Platform: { isIosApp: true } }
  : realLoad(name, ...rest);
const { helpers: h } = require("../main.js");

assert.strictEqual(h.stripFrontmatter("---\ntags: [a]\n---\nBody"), "Body");
assert.strictEqual(h.stripFrontmatter("No frontmatter\n---\nx"), "No frontmatter\n---\nx");
assert.strictEqual(h.noteText("Shopping", "---\nx: 1\n---\nMilk\nEggs"), "Shopping\nMilk\nEggs");
assert.strictEqual(h.noteText("Shopping", "# Shopping\nMilk"), "# Shopping\nMilk");
assert.strictEqual(h.noteText("Trip", "Seat 12A"), "Trip\nSeat 12A");
assert.strictEqual(h.noteText("Empty", ""), "Empty");
assert.strictEqual(h.noteText("Long", "x".repeat(5000)).length, 2000);
const url = h.pinUrl("Hi\nthere & more", h.backUrl("My Vault", "A/Note 1.md"));
assert.strictEqual(url, "livepin://pin?text=Hi%0Athere%20%26%20more&x-success=obsidian%3A%2F%2Fopen%3Fvault%3DMy%2520Vault%26file%3DA%252FNote%25201.md");
const back = new URL(url).searchParams.get("x-success");
assert.strictEqual(new URL(back).searchParams.get("file"), "A/Note 1.md");
assert.strictEqual(h.unpinUrl("obsidian://open?vault=V"), "livepin://unpin?x-success=obsidian%3A%2F%2Fopen%3Fvault%3DV");
console.log("ALL PASSED");
