"use strict";
const { Plugin, Notice, MarkdownView } = require("obsidian");

const MAX_CHARS = 2000; // LivePin shows a title and about 300 characters.

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

function unpinUrl(back) {
  return "livepin://unpin?x-success=" + encodeURIComponent(back);
}

function backUrl(vault, path) {
  return "obsidian://open?vault=" + encodeURIComponent(vault) + (path ? "&file=" + encodeURIComponent(path) : "");
}

class LivePinPlugin extends Plugin {
  async onload() {
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
      name: "Unpin from Lock Screen",
      icon: "pin-off",
      callback: () => this.open(unpinUrl(this.back())),
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
  }

  pin(view) {
    const selection = view.editor ? view.editor.getSelection() : "";
    this.send(view.file, view.editor ? view.editor.getValue() : view.data, selection);
  }

  send(file, content, selection) {
    const text = selection.trim() ? noteText(file.basename, selection) : noteText(file.basename, content);
    this.open(pinUrl(text, this.back(file.path)));
  }

  back(path) {
    if (path === undefined) {
      const file = this.app.workspace.getActiveFile();
      path = file ? file.path : "";
    }
    return backUrl(this.app.vault.getName(), path);
  }

  open(url) {
    if (!require("obsidian").Platform.isIosApp) {
      new Notice("LivePin works on iPhone only.");
      return;
    }
    window.open(url);
  }
}

module.exports = LivePinPlugin;
module.exports.helpers = { stripFrontmatter, noteText, pinUrl, unpinUrl, backUrl };
