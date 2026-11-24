"use strict";
const { Plugin, Notice, MarkdownView, Platform } = require("obsidian");

const MAX_CHARS = 2000; // LivePin keeps a title and up to 1,000 characters.
const LIFETIME = 8 * 60 * 60 * 1000; // iOS ends a Live Activity after 8 hours.

/** Removes a leading YAML frontmatter block. */
function stripFrontmatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");
}

/** Text sent to LivePin: first line is the title. */
function noteText(title, body) {
  const clean = stripFrontmatter(body).trim();
  const firstLine = clean.split(/\r?\n/, 1)[0].replace(/^#+\s*/, "").trim();
  // Skip the note name when the note already starts with it as a heading.
  const text = firstLine === title ? clean : (title + "\n" + clean).trim();
  return text.slice(0, MAX_CHARS);
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i;
const WIKI_EMBED = /!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
const MD_EMBED = /!\[[^\]]*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;

/** Link text of the first local image embedded in the text, or null. */
function firstImageLink(text) {
  const found = [];
  for (const re of [WIKI_EMBED, MD_EMBED]) {
    for (const m of text.matchAll(re)) {
      let link = m[1].trim();
      if (/^[a-z]+:/i.test(link)) continue; // web images aren't in the vault
      try { link = decodeURIComponent(link); } catch (e) { /* keep as written */ }
      if (IMAGE_EXT.test(link)) found.push({ index: m.index, link });
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found.length ? found[0].link : null;
}

/** Removes image embeds so they don't show as text on the Lock Screen. */
function stripImages(text) {
  return text.replace(WIKI_EMBED, (m, link) => (IMAGE_EXT.test(link.trim()) ? "" : m))
    .replace(MD_EMBED, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

function pinUrl(text, back, img) {
  return "livepin://pin?text=" + encodeURIComponent(text) + (img ? "&img=" + encodeURIComponent(img) : "") +
    "&x-success=" + encodeURIComponent(back);
}

const THUMB = 160; // px, longest side
const MAX_PREPARED = 5; // images per note thumbnailed ahead of time

/** Base64 JPEG thumbnail of a vault image, or null if it can't be decoded. */
async function thumbnail(bytes, ext) {
  const type = /jpe?g/i.test(ext) ? "image/jpeg" : "image/" + ext.toLowerCase();
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, THUMB / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75).split(",")[1] || null;
  } catch (e) {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** With a source, unpins only that note's card; without, every card. */
function unpinUrl(back, source) {
  return "livepin://unpin?" + (source ? "source=" + encodeURIComponent(source) + "&" : "") +
    "x-success=" + encodeURIComponent(back);
}

function backUrl(vault, path) {
  return "obsidian://open?vault=" + encodeURIComponent(vault) + (path ? "&file=" + encodeURIComponent(path) : "");
}

/** Pinned notes: { path: pinnedAt ms }. Entries older than 8 hours count as unpinned. */
function isPinned(pins, path, now) {
  const at = pins[path];
  return typeof at === "number" && now - at < LIFETIME;
}

function prune(pins, now) {
  for (const path of Object.keys(pins)) if (!isPinned(pins, path, now)) delete pins[path];
  return pins;
}

class LivePinPlugin extends Plugin {
  async onload() {
    const data = (await this.loadData()) || {};
    this.pins = prune(data.pins || {}, Date.now());
    this.buttons = new Map(); // MarkdownView -> header button
    // Thumbnails are made ahead of time: iOS only lets Obsidian open LivePin straight after a tap,
    // and decoding a photo after the tap took too long, so the image pin silently did nothing.
    this.thumbs = new Map(); // "path:mtime" -> base64 JPEG (or null if it can't be decoded)

    this.addCommand({
      id: "pin-note",
      name: "Pin note to Lock Screen",
      icon: "pin",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.file) return false;
        if (!checking) this.pin(view);
        return true;
      },
    });
    this.addCommand({
      id: "unpin",
      name: "Unpin everything from Lock Screen",
      icon: "pin-off",
      callback: () => {
        this.pins = {};
        this.save();
        this.open(unpinUrl(this.back()));
      },
    });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!file || file.extension !== "md") return;
      menu.addItem((item) => item.setTitle("Pin to Lock Screen").setIcon("pin").onClick(async () => {
        this.send(file, await this.app.vault.cachedRead(file), "");
      }));
    }));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, view) => {
      if (!view.file) return;
      menu.addItem((item) => item.setTitle("Pin to Lock Screen").setIcon("pin").onClick(() => this.pin(view)));
    }));

    // One-tap pin button in every note's header; highlighted while the note is pinned.
    const refresh = () => this.refreshButtons();
    const prepareActive = () => {
      const file = this.app.workspace.getActiveFile();
      if (file && file.extension === "md") this.prepare(file);
    };
    this.app.workspace.onLayoutReady(prepareActive);
    this.registerEvent(this.app.workspace.on("file-open", prepareActive));
    let timer = null;
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file !== this.app.workspace.getActiveFile()) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(prepareActive, 1500);
    }));
    this.app.workspace.onLayoutReady(refresh);
    this.registerEvent(this.app.workspace.on("layout-change", refresh));
    this.registerEvent(this.app.workspace.on("file-open", refresh));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (this.pins[oldPath] !== undefined) {
        this.pins[file.path] = this.pins[oldPath];
        delete this.pins[oldPath];
        this.save();
      }
      refresh();
    }));
    this.registerInterval(window.setInterval(refresh, 5 * 60 * 1000)); // clear expired highlights
  }

  onunload() {
    for (const button of this.buttons.values()) button.remove();
    this.buttons.clear();
  }

  refreshButtons() {
    const now = Date.now();
    const live = new Set();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      live.add(view);
      let button = this.buttons.get(view);
      if (!button) {
        button = view.addAction("pin", "Pin to Lock Screen", () => this.toggle(view));
        this.buttons.set(view, button);
      }
      const pinned = !!view.file && isPinned(this.pins, view.file.path, now);
      button.toggleClass("livepin-pinned", pinned);
      button.style.color = pinned ? "var(--interactive-accent)" : "";
      button.setAttribute("aria-label", pinned ? "Unpin from Lock Screen" : "Pin to Lock Screen");
    }
    for (const [view, button] of this.buttons) {
      if (!live.has(view)) { button.remove(); this.buttons.delete(view); }
    }
  }

  toggle(view) {
    if (!view.file) return;
    const path = view.file.path;
    if (isPinned(this.pins, path, Date.now())) {
      delete this.pins[path];
      this.save();
      this.refreshButtons();
      const back = this.back(path);
      this.open(unpinUrl(back, back));
    } else {
      this.pin(view);
    }
  }

  pin(view) {
    const selection = view.editor ? view.editor.getSelection() : "";
    this.send(view.file, view.editor ? view.editor.getValue() : view.data, selection);
  }

  /** Runs straight after the tap, without waiting, so iOS lets Obsidian open LivePin. */
  send(file, content, selection) {
    const source = selection.trim() ? selection : content;
    const text = noteText(file.basename, stripImages(source));
    const img = this.preparedImage(file, source);
    if (!this.open(pinUrl(text, this.back(file.path), img))) return;
    this.pins[file.path] = Date.now();
    this.save();
    this.refreshButtons();
  }

  key(target) {
    return target.path + ":" + target.stat.mtime;
  }

  /** Ready-made thumbnail of the first image in `text`, or null if it isn't ready yet. */
  preparedImage(file, text) {
    const link = firstImageLink(text);
    const target = link && this.app.metadataCache.getFirstLinkpathDest(link, file.path);
    if (!target) return null;
    const thumb = this.thumbs.get(this.key(target));
    if (thumb === undefined) this.prepare(file); // ready for the next tap
    return thumb || null;
  }

  /** Makes thumbnails for the first few images in a note, in the background. */
  async prepare(file) {
    if (!Platform.isIosApp) return;
    let text;
    try { text = await this.app.vault.cachedRead(file); } catch (e) { return; }
    const links = [];
    let rest = text;
    for (let link; links.length < MAX_PREPARED && (link = firstImageLink(rest)); ) {
      links.push(link);
      rest = rest.split(link).slice(1).join(link); // continue after this embed
    }
    for (const link of links) {
      const target = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
      if (!target || this.thumbs.has(this.key(target))) continue;
      let thumb = null;
      try { thumb = await thumbnail(await this.app.vault.readBinary(target), target.extension); } catch (e) { /* none */ }
      this.thumbs.set(this.key(target), thumb);
    }
    if (this.thumbs.size > 200) this.thumbs.clear();
  }

  back(path) {
    if (path === undefined) {
      const file = this.app.workspace.getActiveFile();
      path = file ? file.path : "";
    }
    return backUrl(this.app.vault.getName(), path);
  }

  open(url) {
    if (!Platform.isIosApp) {
      new Notice("LivePin works on iPhone only.");
      return false;
    }
    window.open(url);
    return true;
  }

  save() {
    return this.saveData({ pins: prune(this.pins, Date.now()) });
  }
}

module.exports = LivePinPlugin;
module.exports.helpers = { stripFrontmatter, noteText, firstImageLink, stripImages, pinUrl, unpinUrl, backUrl, isPinned, prune, LIFETIME };
