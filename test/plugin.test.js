
const assert = require("assert");
const Module = require("module");
const realLoad = Module._load;
class Plugin {}
Module._load = (name, ...rest) => name === "obsidian"
  ? { Plugin, Notice: class {}, MarkdownView: class {}, Platform: { isIosApp: true } } : realLoad(name, ...rest);
const LivePin = require("../main.js");
const target = { path: "img/p.png", extension: "png", stat: { mtime: 5 } };
const p = new LivePin();
p.app = { metadataCache: { getFirstLinkpathDest: (l) => (l === "p.png" ? target : null) },
          vault: { getName: () => "V", cachedRead: async () => "x", readBinary: async () => new ArrayBuffer(1) },
          workspace: { getActiveFile: () => null, getLeavesOfType: () => [] } };
p.pins = {}; p.thumbs = new Map(); p.buttons = new Map(); p.saveData = async () => {};
const opened = [];
global.window = { open: (u) => opened.push(u) };
const file = { path: "A/T.md", basename: "T" };
// Not prepared yet: pins right away without the image.
p.send(file, "Line\n![[p.png]]", "");
assert.strictEqual(opened.length, 1); assert.ok(!opened[0].includes("img="));
// Prepared: same tap includes the image, still synchronous.
p.thumbs.set("img/p.png:5", "QUJD");
p.send(file, "Line\n![[p.png]]", "");
assert.strictEqual(opened.length, 2); assert.ok(opened[1].includes("&img=QUJD&"));
assert.ok(!decodeURIComponent(opened[1]).includes("![["));
console.log("PLUGIN OK");
