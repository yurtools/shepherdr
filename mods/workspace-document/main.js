import { fileActions, relativeFile } from "./file-reference.js";
import { highlighted } from "./highlight.js";
import { HIGHLIGHT_LANGUAGES } from "./core/syntax.js";
import { View, div } from "gpui-kit";
import { h_flex, v_flex, Editor, EditorState, TextView } from "gpui-base";
import { props, panes, shared, focused, nextCommand, readTextFile, writeTextFile, appHome, theme, settings, exec, spaces } from "herdr";
import * as fs from "fs/promises";
import { MAX_TEXT, language, documentKind, parseCSV, delimiterFor, saveState } from "./core/documents.js";

function hash(value) { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
export default class Document extends View {
  init(_props, cx) {
    this.docs = new Map(); this.pane = localStorage.getItem("document-pane"); this.requestAt = shared("workspace.document.open")?.at;
    if (props()?.file) this.open(props().file, props().on ?? null, cx);
    cx.timer.every(2500, cx => this.check(cx));
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (this.pane && focused()?.pane !== this.pane) continue;
        const doc = this.docs.get(this.active);
        if (!doc) continue;
        if (command === "source") { doc.preview = false; doc.highlight = false; }
        if (command === "highlight") doc.highlight = true;
        if (command === "preview" && doc.kind !== "text") doc.preview = true;
        if (command === "save") this.save(doc, cx);
        cx.notify();
      }
    });
  }
  draftPath(doc) { return `${appHome()}/data/document-drafts/${hash(`${doc.on ?? ''}:${doc.path}`)}.json`; }
  async draft(doc) {
    const path = this.draftPath(doc);
    if (doc.text !== doc.saved) { await fs.mkdir(`${appHome()}/data/document-drafts`, { recursive: true }); await fs.writeFile(path, JSON.stringify({ path: doc.path, on: doc.on, text: doc.text, saved: doc.saved })); }
    else { try { await fs.unlink(path); } catch {} }
  }
  open(path, on, cx) {
    const key = `${on ?? ''}:${path}`; this.active = key;
    if (this.docs.has(key)) { cx.notify(); return; }
    const doc = { path, on, kind: documentKind(path), saved: null, text: null, error: null, conflict: false, preview: /\.(md|markdown|csv|tsv|docx|xlsx|xlsm|xltx|xls|doc|xlsb)$/i.test(path) };
    this.docs.set(key, doc);
    cx.spawn(async cx => {
      try {
        if (doc.kind === 'docx' || doc.kind === 'excel') {
          if (on) throw new Error("Office previews currently support local files. Open a local copy to preview it.");
          const r = await exec('python3', [`${appHome()}/mods/workspace-document/bin/herdr-office`, path], { timeout: 20000 });
          let out; try { out = JSON.parse(r.stdout); } catch { throw new Error(r.stderr || 'Office preview could not be read.'); }
          if (r.code !== 0 || out.error) throw new Error(out.error || 'Office preview could not be read.');
          doc.office = out; doc.notice = out.notice; doc.text = doc.saved = out.markdown ?? ''; doc.sheet = 0;
          cx.notify(); return;
        }
        const text = await readTextFile(path, { on });
        if (text === null) throw new Error("File is no longer available");
        if (text.includes('\0')) throw new Error("Binary file. Office and binary previews are not available yet.");
        if (text.length > MAX_TEXT) throw new Error("File exceeds the 400,000-character editing limit");
        doc.saved = text; doc.text = text; doc.highlight = doc.kind === 'text' && HIGHLIGHT_LANGUAGES.has(language(path));
        try {
          const draft = JSON.parse(await fs.readFile(this.draftPath(doc), 'utf8'));
          if (draft.path === path && draft.on === on && typeof draft.text === 'string' && draft.text !== text) {
            doc.text = draft.text; doc.saved = draft.saved; doc.conflict = text !== draft.saved; doc.recovered = true;
          }
        } catch {}
        this.editor(doc);
      } catch (e) { doc.error = String(e.message ?? e); }
      cx.notify();
    });
  }
  editor(doc) {
    doc.editor?.release(); const t = theme();
    doc.editor = EditorState.new({ value: doc.text, language: language(doc.path), readonly: Boolean(doc.on), font_family: settings().font_family, font_size: 12.5,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
    doc.editor.on('change', (_e, cx) => {
      doc.text = doc.editor.value();
      const revision = doc.revision = (doc.revision ?? 0) + 1;
      cx.timer.after(400, cx => { if (revision !== doc.revision) return; cx.spawn(async cx => { try { await this.draft(doc); } catch (e) { doc.notice = `Draft could not be saved: ${e}`; } cx.notify(); }); });
      cx.notify();
    });
  }
  check(cx) {
    const doc = this.docs.get(this.active);
    if (!doc || doc.office || doc.saved === null || doc.checking || doc.saving) return;
    doc.checking = true;
    cx.spawn(async cx => {
      try {
        const disk = await readTextFile(doc.path, { on: doc.on });
        if (disk === null) { doc.conflict = true; doc.notice = 'File was removed'; return; }
        const state = saveState(doc, disk);
        if (state === 'reload') { doc.saved = disk; doc.text = disk; this.editor(doc); }
        doc.conflict = state === 'conflict';
      } catch (e) { doc.notice = `Cannot refresh file: ${e}`; }
      finally { doc.checking = false; cx.notify(); }
    });
  }
  save(doc, cx) {
    if (doc.on || doc.saving || doc.text === doc.saved || doc.conflict) return;
    doc.saving = true;
    cx.spawn(async cx => {
      const text = doc.text, expected = doc.saved;
      try { await writeTextFile(doc.path, text, expected); doc.saved = text; doc.notice = 'Saved'; doc.recovered = false; await this.draft(doc); }
      catch (e) { doc.conflict = true; doc.notice = `Not saved: ${e.message ?? e}`; await this.draft(doc).catch(() => {}); }
      finally { doc.saving = false; cx.notify(); }
    });
  }
  reload(doc, cx) {
    cx.spawn(async cx => {
      const disk = await readTextFile(doc.path, { on: doc.on }).catch(() => null);
      if (disk === null) { doc.notice = 'Cannot reload file'; cx.notify(); return; }
      doc.saved = disk; doc.text = disk; doc.conflict = false; doc.recovered = false; doc.notice = 'Reloaded'; this.editor(doc);
      await this.draft(doc).catch(() => {}); cx.notify();
    });
  }
  button(id, text, selected, fn, t) {
    return div().id(id).h(26).px(8).flex_none().flex().items_center().rounded(6).text_size(12)
      .bg(selected ? t.selected : t.raised).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); }).child(text);
  }
  officePreview(doc, t) {
    if (doc.kind === 'docx') return v_flex().flex_1().min_h(0)
      .when(doc.office.limited, el => el.child(div().p(8).text_color(t.blocked).child('Content preview truncated at 400,000 characters.')))
      .child(div().id(`word-${hash(doc.path)}`).flex_1().min_h(0).overflow_y_scrollbar().p(18)
        .child(TextView.markdown(`word-content-${hash(doc.path)}`, doc.office.markdown || 'No readable text in this document.').selectable(true)));
    const sheets = doc.office.sheets, sheet = sheets[doc.sheet ?? 0];
    if (!sheet) return div().p(18).child('This workbook has no readable worksheets.');
    const page = doc.page ?? 0, cols = Math.max(1, ...sheet.rows.map(r => r.length));
    return v_flex().flex_1().min_h(0)
      .child(h_flex().h(34).flex_none().px(8).gap(4).overflow_x_scrollbar()
        .children(sheets.map((s, i) => this.button(`sheet-${i}`, s.name, i === doc.sheet, () => { doc.sheet = i; doc.page = 0; }, t))))
      .child(h_flex().h(32).flex_none().px(8).gap(5).items_center()
        .child(this.button('sheet-prev', '←', false, () => { doc.page = Math.max(0, page - 40); }, t))
        .child(this.button('sheet-next', '→', false, () => { doc.page = Math.min(Math.max(0, sheet.rows.length - 1), page + 40); }, t))
        .child(div().text_size(11).child(`Rows ${sheet.rows.length ? page + 1 : 0}–${Math.min(sheet.rows.length, page + 40)} / ${sheet.rows.length}${sheet.formulas ? ' · saved formula values' : ''}`)))
      .when(sheet.limited || doc.office.limited, el => el.child(div().p(8).text_size(11).text_color(t.blocked).child('Preview limited to 500 rows, 100 columns, 100 sheets and 400,000 characters.')))
      .child(div().id(`sheet-scroll-${hash(doc.path)}-${doc.sheet}-${page}`).flex_1().min_h(0).overflow_x_scrollbar().overflow_y_scrollbar()
        .child(v_flex().min_w(48 + cols * 160)
          .child(h_flex().h(26).flex_none().bg(t.raised).child(div().w(48)).children(Array.from({ length: cols }, (_, j) => div().w(160).px(9).text_size(11).child(this.columnName(j)))))
          .children(sheet.rows.slice(page, page + 40).map((row, i) => h_flex().min_h(30).flex_none().border_b(1).border_color(t.border)
            .child(div().w(48).flex_none().px(9).py(6).text_size(11).text_color(t.dim).child(String(page + i + 1)))
            .children(Array.from({ length: cols }, (_, j) => div().w(160).flex_none().px(9).py(6).border_r(1).border_color(t.border).text_size(12).truncate().child(String(row[j] ?? '').replace(/\r?\n/g, ' ↵ '))))))));
  }
  columnName(index) { let s = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
  preview(doc, t) {
    if (doc.office) return this.officePreview(doc, t);
    if (doc.kind === 'markdown') return div().id(`md-${hash(doc.path)}`).flex_1().min_h(0).overflow_y_scrollbar().p(18).child(TextView.markdown(`markdown-${hash(doc.path)}`, doc.text));
    const delimiter = doc.delimiter ?? delimiterFor(doc.text, doc.path);
    if (doc.csvText !== doc.text || doc.csvDelimiter !== delimiter) { doc.csvText = doc.text; doc.csvDelimiter = delimiter; doc.csv = parseCSV(doc.text, delimiter); }
    const data = doc.csv;
    const cols = Math.max(1, ...data.rows.map(r => r.length));
    return v_flex().flex_1().min_h(0)
      .child(h_flex().h(32).px(8).gap(5).items_center().child(this.button('csv-prev', '←', false, () => { doc.page = Math.max(0, (doc.page ?? 0) - 40); }, t)).child(this.button('csv-next', '→', false, () => { doc.page = Math.min(Math.max(0, data.rows.length - 1), (doc.page ?? 0) + 40); }, t)).child(div().text_size(11).child(`${(doc.page ?? 0) + 1}–${Math.min(data.rows.length, (doc.page ?? 0) + 40)} / ${data.rows.length}`)).children([['Auto', null], ['Comma', ','], ['Tab', '\t'], ['Semicolon', ';']].map(([label, value]) => this.button(`delimiter-${label}`, label, (doc.delimiter ?? null) === value, () => { doc.delimiter = value; }, t))))
      .when(Boolean(data.error) || data.limited, el => el.child(div().p(8).text_size(12).text_color(t.blocked).child(data.error ?? 'Preview limited to 500 rows and 100 columns; Source retains the complete file.')))
      .child(div().id('csv-scroll').flex_1().min_h(0).overflow_x_scrollbar().overflow_y_scrollbar()
        .child(v_flex().min_w(cols * 160).children(data.rows.slice(doc.page ?? 0, (doc.page ?? 0) + 40).map((row, i) => h_flex().id(`csv-row-${i}`).min_h(30).flex_none().bg(i === 0 ? t.raised : t.background).border_b(1).border_color(t.border)
          .children(Array.from({ length: cols }, (_, j) => div().w(160).flex_none().px(9).py(6).border_r(1).border_color(t.border).text_size(12).when(i === 0, el => el.font_semibold()).truncate().child((row[j] ?? '').replace(/\r?\n/g, ' ↵ '))))))));
  }
  render(cx) {
    const own = shared("workspace.documents")?.[props()?.slot];
    if (own) this.pane = own;
    if (!this.pane && !props()?.slot) { const docs = panes().filter(p => p.mod === 'workspace-document'); if (docs.length === 1) this.pane = docs[0].pane; }
    if (this.pane) localStorage.setItem("document-pane", this.pane);
    const request = shared('workspace.document.open');
    if (this.pane && request?.pane === this.pane && request.at !== this.requestAt) { this.requestAt = request.at; cx.timer.after(0, cx => this.open(request.file, request.on ?? null, cx)); }
    const t = theme(), doc = this.docs.get(this.active);
    return v_flex().id('document').size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(h_flex().h(32).flex_none().overflow_x_scrollbar().gap(3).px(5).items_center().children([...this.docs].map(([key, d]) => this.button(`tab-${hash(key)}`, `${d.path.split('/').pop()}${d.text !== d.saved ? ' •' : ''}`, key === this.active, () => { this.active = key; }, t))))
      .when(Boolean(doc), el => el.child(h_flex().min_h(38).flex_none().px(8).gap(6).items_center().flex_wrap()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(doc?.path ?? ''))
        .when(['docx','excel'].includes(doc?.kind), el => el.child(this.button('office-reload','Reload preview',false,cx=>{this.docs.delete(`${doc.on??''}:${doc.path}`);this.open(doc.path,doc.on,cx);},t)))
        .child(this.button('document-copy-path', 'Copy path', false, cx => { const space=spaces().find(s=>s.active),root=shared('workspace.roots')?.[space?.id]??space?.folder; cx.write_to_clipboard(relativeFile(root,doc.path)); }, t))
        .child(this.button('document-reference', 'Reference in chat', false, () => { const space=spaces().find(s=>s.active); fileActions({ file:doc.path,on:doc.on,root:shared('workspace.roots')?.[space?.id]??space?.folder },null,true); }, t))
        .when(doc?.kind === 'text' && HIGHLIGHT_LANGUAGES.has(language(doc?.path ?? '')), el => el.children(['Edit', 'Highlight'].map((label, i) => this.button(`code-${label}`, label, Boolean(doc.highlight) === Boolean(i), () => { doc.highlight = Boolean(i); }, t))))
        .when(doc?.kind !== 'text' && !['docx', 'excel'].includes(doc?.kind), el => el.children(['Source', 'Preview'].map((label, i) => this.button(`mode-${label}`, label, doc.preview === Boolean(i), () => { doc.preview = Boolean(i); }, t))))
        .when(doc?.saved !== null && !doc?.on && !doc?.office, el => el.child(this.button('save', doc?.saving ? 'Saving…' : 'Save', false, cx => this.save(doc, cx), t)))))
      .when(Boolean(doc?.conflict), el => el.child(h_flex().px(10).py(6).gap(8).items_center().bg(t.raised)
        .child(div().flex_1().text_size(12).child('File changed on disk. Your draft is retained.'))
        .child(this.button('reload', 'Discard draft and reload', false, cx => this.reload(doc, cx), t))))
      .when(Boolean(doc?.notice) || doc?.recovered || doc?.on, el => el.child(div().px(10).py(4).text_size(11).text_color(t.dim).child(doc?.recovered ? 'Recovered unsaved draft' : doc?.notice ?? 'Remote file · read only')))
      .child(!doc ? div().p(16).child('Open a file from Files') : doc.error ? div().p(16).child(doc.error) : doc.office ? this.officePreview(doc, t) : doc.highlight && doc.text !== null ? highlighted(doc, language(doc.path), t, hash(doc.path)) : !doc.editor ? div().p(16).child('Loading…') : doc.preview && doc.kind !== 'text' ? this.preview(doc, t) : Editor.new(doc.editor).flex_1().min_h(0));
  }
  async close() { for (const doc of this.docs.values()) { if (doc.text !== null) await this.draft(doc).catch(() => {}); doc.editor?.release(); } }
}
