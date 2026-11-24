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
const back2 = h.backUrl("V", "A/T.md");
const u2 = new URL(h.unpinUrl(back2, back2));
assert.strictEqual(u2.searchParams.get("source"), "obsidian://open?vault=V&file=A%2FT.md");
assert.strictEqual(u2.searchParams.get("x-success"), back2);
// The source LivePin stores (the pin's x-success) must equal the unpin source exactly.
assert.strictEqual(new URL(h.pinUrl("x", back2)).searchParams.get("x-success"), u2.searchParams.get("source"));
const now = 1e12;
assert.strictEqual(h.isPinned({ a: now - 1000 }, "a", now), true);
assert.strictEqual(h.isPinned({ a: now - h.LIFETIME }, "a", now), false);
assert.strictEqual(h.isPinned({}, "a", now), false);
assert.deepStrictEqual(h.prune({ a: now, b: now - h.LIFETIME - 1 }, now), { a: now });
assert.strictEqual(h.firstImageLink("a ![[b.md]] ![[pics/Photo 1.PNG|200]] ![x](c.jpg)"), "pics/Photo 1.PNG");
assert.strictEqual(h.firstImageLink("![x](img/My%20Pic.jpeg) then ![[z.png]]"), "img/My Pic.jpeg");
assert.strictEqual(h.firstImageLink("![x](https://e.com/a.png) ![[local.webp]]"), "local.webp");
assert.strictEqual(h.firstImageLink("no images ![[note]]"), null);
assert.strictEqual(h.stripImages("Title\n![[a.png]]\n\n\n\nBody ![[doc]] ![x](b.jpg)"), "Title\n\nBody ![[doc]]");
assert.ok(h.pinUrl("T", "obsidian://open", "a+b/c=").includes("&img=a%2Bb%2Fc%3D&x-success="));
assert.ok(!h.pinUrl("T", "obsidian://open", null).includes("img="));
console.log("ALL PASSED");
