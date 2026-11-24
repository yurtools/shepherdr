import {projectFolder,saveProjectFolder} from './project-folder.js';
import { fileActions } from "./file-reference.js";
// Derived from Herdr files (Apache-2.0; LICENSE-herdr). This clone keeps the tree visible and opens a separate document pane.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, run, shared, setShared, appHome, pickFolder } from "herdr";

import * as fs from "fs/promises";
import { fileLocation } from "./core/documents.js";

function location() {
  return fileLocation(spaces().find(s => s.active), shared("workspace.roots") ?? {});
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    try { this.saved = new Map(JSON.parse(localStorage.getItem("tree-state") ?? "[]")); } catch { this.saved = new Map(); }
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    cx.spawn(async cx => {
      try { setShared("workspace.roots", JSON.parse(await fs.readFile(`${appHome()}/data/workspace-folders.json`, "utf8"))); } catch {}
      this.refresh(cx); cx.notify();
    });
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { this.watching = watchFolder(root); await this.watching; if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: new Set(this.folders), file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.file = null; this.watching?.cancel(); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      this.file = saved?.file ?? null;
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    this.saveTree(); cx.notify();
  }

  show(path, cx, another = false) {
    if (!path || !cx) return;
    this.file = path; this.saveTree();
    const space = spaces().find(s => s.active), tab = focused()?.tab ?? space?.tabs?.find(t => t.active)?.id;
    const target = !another && panes().find(p => p.tab === tab && p.mod === "workspace-document");
    if (target) {
      setShared("workspace.document.open", { pane: target.pane, file: `${this.root}/${path}`, root: this.root, space: space?.id, on: this.on, at: Date.now() });
      run("pane.focus", { pane: target.pane });
    } else {
      const anchor = panes().find(p => p.tab === tab && p.focused) ?? panes().find(p => p.tab === tab);
      const slot = `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const args = anchor ? { pane: anchor.pane, direction: "right", mod: "workspace-document", props: { file: `${this.root}/${path}`, root: this.root, space: space?.id, on: this.on, slot } }
        : { space: space?.id, name: path.split("/").pop(), mod: "workspace-document", props: { file: `${this.root}/${path}`, root: this.root, space: space?.id, on: this.on, slot } };
      cx.spawn(async cx => {
        try {
          const r = await exec("herdr-app", ["do", anchor ? "pane.split" : "tab.new", JSON.stringify(args)]);
          const out = JSON.parse(r.stdout || "{}");
          if (r.code !== 0 || !out.pane) throw new Error(out.error ?? r.stderr ?? "Document pane did not open");
          setShared("workspace.documents", { ...(shared("workspace.documents") ?? {}), [slot]: out.pane });
        } catch (e) { this.error = String(e.message ?? e); }
        cx.notify();
      });
    }
    cx.notify();
  }

  chooseRoot(cx) {
    const space = spaces().find(s => s.active);
    if (!space || space.machine) return;
    cx.spawn(async cx => {
      try {
        const expected=await projectFolder(space);
        const folder = await pickFolder({ prompt: "Project folder for this space" });
        if (!folder || spaces().find(s=>s.active)?.id!==space.id) return;
        await saveProjectFolder(space,folder,expected);
        this.error=null;this.refresh(cx);
      } catch(e) { this.error=String(e.message??e); }
      cx.notify();
    });
  }

  saveTree() {
    if (this.context) this.saved.set(this.context.key, { folders: [...this.folders], file: this.file });
    const states = [...this.saved].map(([key, value]) => [key, { ...value, folders: [...value.folders] }]);
    localStorage.setItem("tree-state", JSON.stringify(states));
  }
  close() { this.saveTree(); this.watching?.cancel(); }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .when(this.file === path && !entry.dir, el => el.bg(t.selected))
        .on_click((e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx, Boolean(e.modifiers?.shift)))
        .on_mouse_down("right", (e, cx) => { cx.stop_propagation(); fileActions({ file: `${this.root}/${path}`, root: this.root, on: this.on }, e.position); })
        .child(entry.dir ? svg(`mods/workspace-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/workspace-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme();
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        
        .child(div().font_semibold().child("Files"))
        .when(Boolean(this.file), el => el.child(div().id("another-document").px(5).text_size(11).cursor_pointer().text_color(t.muted).on_click((_e, cx) => this.show(this.file, cx, true)).child("+ Pane")))
        .child(div().id("project-folder").px(5).text_size(11).cursor_pointer().text_color(t.muted).on_click((_e, cx) => this.chooseRoot(cx)).child("Folder…"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.root?.split(/[\\/]/).pop() ?? "")))
      .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total"))));
  }
}
