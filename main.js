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

function pinUrl(text, back) {
  return "livepin://pin?text=" + encodeURIComponent(text) + "&x-success=" + encodeURIComponent(back);
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

  send(file, content, selection) {
    const text = selection.trim() ? noteText(file.basename, selection) : noteText(file.basename, content);
    if (!this.open(pinUrl(text, this.back(file.path)))) return;
    this.pins[file.path] = Date.now();
    this.save();
    this.refreshButtons();
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
module.exports.helpers = { stripFrontmatter, noteText, pinUrl, unpinUrl, backUrl, isPinned, prune, LIFETIME };
