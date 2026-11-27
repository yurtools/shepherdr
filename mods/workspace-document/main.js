import { sourceOffset } from './core/chat-links.js';
import { fileActions, relativeFile } from "./file-reference.js";
import { highlighted } from "./highlight.js";
import { HIGHLIGHT_LANGUAGES } from "./core/syntax.js";
import { View, div } from "gpui-kit";
import { h_flex, v_flex, Editor, EditorState, TextView, Input, InputState } from "gpui-base";
import { run, setShared, props, panes, shared, focused, nextCommand, writeTextFile, appHome, theme, settings, exec, spaces, window as win } from "herdr";
import * as fs from "fs/promises";
import { PREVIEW, EDIT_LIMIT, TABLE_LIMIT, SOURCE_CHANGED, formatCount, formatFileSize, canEdit, csvPage, markdownExcerpt, language, documentKind, delimiterFor, saveState } from "./core/documents.js";
import { PdfPreview, pdfView } from './pdf-view.js';
import { PreviewReader } from './preview-reader.js';
import { DocumentFind, findBar, findCell, findMode, findSignature, searchTextView } from './find.js';
import { FIND, pageRanges } from './core/document-find.js';

let findKeysBound = false;

const textKind = doc => ['text', 'markdown', 'csv'].includes(doc.kind);
const completeBuffer = doc => textKind(doc) && !doc.source && typeof doc.saved === 'string' && typeof doc.text === 'string';
const pageStart = (value, total, stride) => Math.min(Math.max(0, Math.floor((total - 1) / stride) * stride), Math.max(0, Math.floor(value / stride) * stride));
const number = formatCount;

const documentId = doc => hash(`${doc.on ?? ''}:${doc.path}`);
function hash(value) { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
export default class Document extends View {
  init(_props, cx) {
    this.docs = new Map(); this.pane = localStorage.getItem("document-pane"); this.requestAt = shared("workspace.document.open")?.at;
    if (props()?.file) this.open(props().file, props().on ?? null, cx, props());
    if (!findKeysBound) {
      findKeysBound = true;
      try { cx.bind_keys(['Input', 'TextArea', 'Textarea'].flatMap(context => [
        { keystroke: 'enter', action: 'document_find_next', context: `document_find > ${context}` },
        { keystroke: 'shift-enter', action: 'document_find_prev', context: `document_find > ${context}` },
        { keystroke: 'escape', action: 'document_find_close', context: `document_find > ${context}` },
      ])); } catch {}
    }
    cx.timer.every(2500, cx => this.check(cx));
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (this.pane && focused()?.pane !== this.pane) continue;
        const doc = this.docs.get(this.active);
        if (!doc) continue;
        if (command === "find") this.openFind(doc, cx);
        if (command === "source" && textKind(doc)) this.mode(doc, false, cx);
        if (command === "highlight" && doc.kind === "text" && !doc.source) doc.highlight = true;
        if (command === "preview" && ["markdown", "csv"].includes(doc.kind)) this.mode(doc, true, cx);
        if (command === "save") this.save(doc, cx);
        if (command === "close-file") { const key = this.active; cx.spawn(cx => this.closeFile(key, cx)); }
        cx.notify();
      }
    });
  }
  draftPath(doc) { return `${appHome()}/data/document-drafts/${hash(`${doc.on ?? ''}:${doc.path}`)}.json`; }
  async draft(doc) {
    if (!completeBuffer(doc) || doc.on) return;
    const path = this.draftPath(doc), { text, saved, on } = doc;
    const work = (doc.draftWork ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (text !== saved) {
        await fs.mkdir(`${appHome()}/data/document-drafts`, { recursive: true });
        await fs.writeFile(path, JSON.stringify({ path: doc.path, on, text, saved }));
      } else { try { await fs.unlink(path); } catch {} }
    });
    doc.draftWork = work;
    await work;
  }
  open(path, on, cx, location = null) {
    const key = `${on ?? ''}:${path}`; this.selectFile(key,cx,false);
    if (this.docs.has(key)) { const doc=this.docs.get(key);if(doc.pdf)doc.pdf.load(cx);if(location?.line){doc.location=location;this.jump(doc);this.refreshFind(doc,cx);}else if(doc.find)cx.timer.after(0,()=>{if(this.docs.get(this.active)===doc)doc.find?.input.focus();});cx.notify(); return; }
    const doc = { path, on, kind: documentKind(path), saved: null, text: null, error: null, conflict: false, preview: /\.(md|markdown|csv|tsv|docx|xlsx|xlsm|xltx|xls|doc|xlsb)$/i.test(path) };
    if(location?.line)doc.location={line:location.line,column:location.column};
    doc.root = location?.root; doc.space = location?.space;
    this.docs.set(key, doc);
    if (doc.kind === 'pdf') { doc.pdf = new PdfPreview(path, { on });
      doc.pdf.onResult = (cx, changed) => { if (doc.find && (changed || doc.find.reloadPending)) {doc.find.reloadPending=false; this.refreshFind(doc,cx);} };
      doc.pdf.load(cx); return; }
    if (doc.kind === 'image') { doc.error = 'Image preview is not available in Files. Open the original in an image viewer.'; cx.notify(); return; }
    if (textKind(doc)) {
      doc.reader = new PreviewReader(path, on);
      this.loadText(doc, cx, true);
    } else {
      this.loadOffice(doc, cx);
    }
  }
  loadOffice(doc, cx) {
    doc.error = null; doc.loading = true; this.refreshFind(doc, cx);
    cx.spawn(async cx => {
      try {
        if (doc.on) throw new Error("Office previews currently support local files. Open a local copy to preview it.");
        const r = await exec('python3', [`${appHome()}/mods/workspace-document/bin/herdr-office`, doc.path], { timeout: 20000 });
        if (doc.closed) return;
        let out; try { out = JSON.parse(r.stdout); } catch { throw new Error(r.stderr || 'Office preview could not be read.'); }
        if (r.code !== 0 || out.error) throw new Error(out.error || 'Office preview could not be read.');
        doc.office = out; doc.notice = out.notice; doc.sheet = 0; doc.page = 0; doc.col = 0;
      } catch (e) { if (!doc.closed) doc.error = String(e.message ?? e); }
      finally { doc.loading = false; if (!doc.closed) { this.refreshFind(doc, cx); cx.notify(); } }
    });
  }
  reader(doc) { return doc.reader ??= new PreviewReader(doc.path, doc.on); }
  loadText(doc, cx, recover = false) {
    if (doc.closed || doc.closing || doc.loading || doc.saving || doc.tableBusy || doc.sourceBusy) return;
    const generation = doc.generation = (doc.generation ?? 0) + 1;
    doc.loading = true; doc.revision = (doc.revision ?? 0) + 1; this.refreshFind(doc, cx);
    cx.spawn(async cx => {
      try {
        const out = await this.reader(doc).open();
        if (doc.closed || generation !== doc.generation) return;
        let draft;
        if (recover && !doc.on) {
          try { draft = JSON.parse(await fs.readFile(this.draftPath(doc), 'utf8')); } catch {}
          if (doc.closed || generation !== doc.generation) return;
        }
        if (draft?.path === doc.path && draft.on === doc.on && typeof draft.text === 'string' && typeof draft.saved === 'string' && draft.text !== out.text) {
          this.applyDisk(doc, { text: draft.text }, cx);
          doc.saved = draft.saved; doc.bufferVersion = out.version;
          doc.conflict = draft.saved !== out.text; doc.recovered = true;
          doc.notice = doc.conflict ? 'Recovered unsaved draft. The disk version has changed.' : 'Recovered unsaved draft';
        } else {
          this.applyDisk(doc, out, cx);
          if (!recover && !doc.on) {
            // Explicitly discarding a draft can transition to read-only source.
            // Never let a partial source page overwrite or remove a draft implicitly.
            await doc.draftWork?.catch(() => {});
            try { await fs.unlink(this.draftPath(doc)); } catch {}
          }
        }
      } catch (e) {
        if (!doc.closed && generation === doc.generation) {
          if (doc.editor) doc.notice = `Cannot reload file: ${e.message ?? e}`;
          else doc.error = String(e.message ?? e);
        }
      } finally {
        if (!doc.closed && generation === doc.generation) {
          doc.loading = false;
          if (doc.source && doc.kind === 'csv' && doc.preview && !doc.table && !doc.tableError) this.loadTable(doc, cx);
          this.refreshFind(doc, cx); cx.notify();
        }
      }
    });
    cx.notify();
  }
  applyDisk(doc, out, cx) {
    doc.error = null; doc.conflict = false; doc.recovered = false; doc.stale = false; doc.staleReason = null;
    doc.table = null; doc.tableError = null; doc.bufferTable = null; doc.bufferText = null; doc.highlightText = null; doc.highlighted = null;
    doc.page = 0; doc.col = 0; doc.sourceError = null; doc.notice = null;
    doc.source = out.source ?? null; doc.bufferVersion = out.version;
    this.prepareJumpInputs(doc);
    if (doc.source) {
      doc.saved = doc.text = null; doc.highlight = false;
      doc.sourceSize = out.size; doc.sourceVersion = out.version;
      doc.markdownHead = doc.kind === 'markdown' ? out.source.text : null; doc.markdownMore = out.source.end < out.size;
      this.sourceEditor(doc);
      if (doc.location?.line) {
        doc.preview = false;
        doc.notice = 'Line links need a full editor buffer. Browse the read-only source pages instead.';
        delete doc.location;
      }
    } else {
      doc.markdownHead = null; doc.markdownMore = false;
      doc.saved = doc.text = out.text;
      if (doc.highlight === undefined) doc.highlight = doc.kind === 'text' && HIGHLIGHT_LANGUAGES.has(language(doc.path));
      this.editor(doc);
    }
  }
  sourceEditor(doc) {
    doc.editor?.release();
    doc.editor = EditorState.new({ value: doc.source.text, language: 'text', readonly: true, font_family: settings().font_family, font_size: 12.5 });
  }
  sourcePage(doc, page, cx, accept = () => true) {
    if (!doc.source || doc.sourceBusy || doc.loading || doc.stale || doc.closed || doc.closing) return;
    page = Math.max(0, Math.min(Math.floor(Math.max(0, doc.sourceSize - 1) / PREVIEW.sourceBytes), page));
    if (page === doc.source.page) return;
    const generation = doc.generation;
    doc.sourceBusy = true; doc.sourceError = null;
    cx.spawn(async cx => {
      try {
        const out = await this.reader(doc).call('source', { page, version: doc.sourceVersion });
        if (doc.closed || doc.closing || generation !== doc.generation || !accept()) return;
        doc.source = out.source; this.sourceEditor(doc);
      } catch (e) {
        if (!doc.closed && generation === doc.generation && (accept() || String(e.message ?? e) === SOURCE_CHANGED)) { doc.sourceError = String(e.message ?? e); if (doc.sourceError === SOURCE_CHANGED) { doc.stale = true; this.refreshFind(doc, cx); } }
      } finally { if (!doc.closed && generation === doc.generation) { doc.sourceBusy = false; this.pendingReveal(doc, cx); cx.notify(); } }
    });
    cx.notify();
  }
  loadTable(doc, cx, row = 0, col = 0, scan = true, accept = () => true) {
    if (!doc.source || doc.tableBusy || doc.loading || doc.stale || doc.closed || doc.closing) return;
    const generation = doc.generation, previous = doc.table;
    doc.tableBusy = true; doc.tableError = null;
    if (scan) doc.table = null;
    const earlier = this.tableWork;
    let release;
    this.tableWork = new Promise(resolve => { release = resolve; });
    cx.spawn(async cx => {
      try {
        await earlier;
        if (doc.closed || doc.closing || generation !== doc.generation) return;
        let out;
        if (scan) out = await this.reader(doc).call('scan', { version: doc.sourceVersion, delimiter: doc.delimiter ?? null });
        else {
          const checkpoint = Math.floor(row / PREVIEW.indexStride);
          out = await this.reader(doc).call('table', { version: doc.sourceVersion, delimiter: previous.delimiter,
            row, col, base: checkpoint * PREVIEW.indexStride, offset: previous.offsets[checkpoint] });
        }
        if (doc.closed || doc.closing || generation !== doc.generation || !accept()) return;
        doc.table = scan ? out : { ...previous, ...out };
        doc.page = doc.table.row; doc.col = doc.table.col;
      } catch (e) {
        if (!doc.closed && generation === doc.generation && (accept() || String(e.message ?? e) === SOURCE_CHANGED)) { doc.tableError = String(e.message ?? e); if (doc.tableError === SOURCE_CHANGED) { doc.stale = true; this.refreshFind(doc, cx); } }
      } finally { release(); if (!doc.closed && generation === doc.generation) { doc.tableBusy = false; if (scan && doc.preview) this.refreshFind(doc, cx); else this.pendingReveal(doc, cx); cx.notify(); } }
    });
    cx.notify();
  }
  mode(doc, preview, cx) {
    doc.preview = preview; doc.highlight = false;
    if (preview && doc.kind === 'csv' && doc.source && !doc.table && !doc.tableError) this.loadTable(doc, cx);
    this.refreshFind(doc, cx);
  }
  editor(doc) {
    if (doc.closed || !completeBuffer(doc)) return;
    doc.editor?.release(); const t = theme();
    doc.editor = EditorState.new({ value: doc.text, language: language(doc.path), readonly: Boolean(doc.on), font_family: settings().font_family, font_size: 12.5,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
    this.jump(doc);
    doc.editor.on('change', (_e, cx) => {
      doc.text = doc.editor.value(); doc.page = doc.col = 0; doc.bufferTable = null; this.refreshFind(doc, cx);
      const revision = doc.revision = (doc.revision ?? 0) + 1;
      cx.timer.after(400, cx => { if (doc.closed || doc.closing || revision !== doc.revision) return; cx.spawn(async cx => { try { await this.draft(doc); } catch (e) { doc.notice = `Draft could not be saved: ${e}`; } cx.notify(); }); });
      cx.notify();
    });
  }
  jump(doc) {
    if(!doc.location?.line||!doc.editor)return;
    if (doc.source) {
      doc.preview = false; doc.notice = 'Line links need a full editor buffer. Browse the read-only source pages instead.';
      delete doc.location; return;
    }
    const at=sourceOffset(doc.text,doc.location.line,doc.location.column);
    doc.highlight=false;doc.preview=false;
    doc.editor.set_selected_range({start:at,end:at});doc.editor.focus();delete doc.location;
  }
  check(cx) {
    const doc = this.docs.get(this.active);
    if (doc?.pdf) { doc.pdf.check(cx); return; }
    if (!doc || !textKind(doc) || doc.loading || doc.checking || doc.saving || doc.tableBusy || doc.sourceBusy || doc.stale || (!doc.source && !completeBuffer(doc))) return;
    const generation = doc.generation, expected = doc.saved;
    const current = () => !doc.closed && !doc.closing && generation === doc.generation && !doc.saving && expected === doc.saved;
    doc.checking = true;
    cx.spawn(async cx => {
      try {
        if (doc.source) {
          const out = await this.reader(doc).call('stat');
          if (current() && out.version !== doc.sourceVersion) { doc.stale = true; doc.notice = null; this.refreshFind(doc, cx); }
          return;
        }
        if (doc.bufferVersion) {
          const disk = await this.reader(doc).call('stat');
          if (!current() || disk.version === doc.bufferVersion) return;
        }
        const out = await this.reader(doc).open();
        if (!current()) return;
        if (out.source) {
          if (doc.text !== doc.saved) { doc.conflict = true; doc.notice = 'The disk file now exceeds the editing limit. Your draft is retained.'; }
          else { this.applyDisk(doc, out, cx); if (doc.kind === 'csv' && doc.preview) this.loadTable(doc, cx); this.refreshFind(doc, cx); }
          return;
        }
        const state = saveState(doc, out.text);
        if (state === 'reload') { this.applyDisk(doc, out, cx); this.refreshFind(doc, cx); }
        else if (state !== 'conflict') doc.bufferVersion = out.version;
        doc.conflict = state === 'conflict';
      } catch (e) {
        if (current()) {
          if (doc.source) { doc.stale = true; doc.staleReason = `Cannot verify file: ${e.message ?? e}. Reload preview.`; this.refreshFind(doc, cx); }
          else { doc.notice = `Cannot refresh file: ${e.message ?? e}`; doc.conflict = true; }
        }
      } finally { doc.checking = false; if (!doc.closed) cx.notify(); }
    });
  }
  save(doc, cx) {
    if (!completeBuffer(doc) || doc.on || doc.closed || doc.closing || doc.loading || doc.saving || doc.text === doc.saved || doc.conflict) return;
    if (!canEdit(doc.text)) {
      doc.notice = `${EDIT_LIMIT} Reduce the draft’s size before saving here.`;
      cx.spawn(async cx => { try { await this.draft(doc); } catch (e) { doc.notice = `Draft could not be saved: ${e}`; } cx.notify(); });
      cx.notify(); return;
    }
    doc.saving = true;
    cx.spawn(async cx => {
      const text = doc.text, expected = doc.saved;
      try { await writeTextFile(doc.path, text, expected); doc.saved = text; doc.bufferVersion = null; doc.notice = 'Saved'; doc.recovered = false; await this.draft(doc); }
      catch (e) { doc.conflict = true; doc.notice = `Not saved: ${e.message ?? e}`; await this.draft(doc).catch(() => {}); }
      finally { doc.saving = false; cx.notify(); }
    });
  }
  reload(doc, cx) {
    if (doc.pdf) { if(doc.find){doc.find.cancel();doc.find.query=doc.find.input.value().trim();doc.find.busy=!!doc.find.query;doc.find.reloadPending=true;} doc.pdf.load(cx); return; }
    if (textKind(doc)) { if (doc.reader?.unavailable) doc.reader = new PreviewReader(doc.path, doc.on); this.loadText(doc, cx); }
    else if (['docx', 'excel'].includes(doc.kind) && !doc.loading) this.loadOffice(doc, cx);
  }
  original(doc, cx) {
    if (doc.on) { cx.write_to_clipboard(doc.path); return; }
    cx.spawn(async cx => {
      try {
        const os = win()?.platform, opener = os === 'macos' ? 'open' : os === 'windows' ? 'explorer.exe' : 'xdg-open';
        const result = await exec(opener, [doc.path]);
        if (result.code) throw Error('Use Copy path to open the file in its usual app.');
      } catch (e) { if (!doc.closed) { doc.notice = `Could not open original: ${e.message ?? e}`; cx.notify(); } }
    });
  }
  async closeFile(key, cx) {
    const doc = this.docs.get(key);
    if (!doc || doc.closing) return;
    if (doc.saving) { doc.notice = 'File is saving. Close it after saving finishes.'; cx.notify(); return; }
    doc.closing = true; cx.notify();
    let paneToClose = null;
    try {
      if (doc.text !== null) await this.draft(doc);
      doc.closed = true; doc.revision = (doc.revision ?? 0) + 1;
      const keys = [...this.docs.keys()], at = keys.indexOf(key);
      this.docs.delete(key);
      if (this.active === key) this.selectFile(keys[at + 1] ?? keys[at - 1] ?? null,cx);
      doc.editor?.release(); doc.rowInput?.release(); doc.sourceInput?.release(); doc.find?.release();
      await doc.pdf?.dispose();
      // Closing this exact document pane is LAST: disposal cancels its pending calls.
      const slot=props()?.slot, candidates=panes().filter(p=>p.mod==='workspace-document');
      const ownPane=slot?shared('workspace.documents')?.[slot]:candidates.length===1?candidates[0].pane:null;
      if (!this.docs.size && ownPane && candidates.some(p=>p.pane===ownPane)) {
        const records = { ...(shared('workspace.documents') ?? {}) };
        for (const [slot, pane] of Object.entries(records)) if (pane === ownPane) delete records[slot];
        setShared('workspace.documents', records);
        localStorage.removeItem('document-pane');
        paneToClose = ownPane;
      }
    } catch (e) { doc.notice = `File could not be closed: draft could not be saved: ${e.message ?? e}`; }
    finally { doc.closing = false; if (!doc.closed && doc.find?.busy) this.refreshFind(doc,cx); cx.notify(); }
    if (paneToClose) run("pane.close", { pane: paneToClose });
  }
  selectFile(key, cx, focus = true) {
    const previous = this.docs.get(this.active);
    if (this.active !== key && previous?.find?.busy) {
      previous.find.cancel(); previous.find.paused = true;
    }
    this.active = key;
    const doc = this.docs.get(key);
    if (doc?.find?.paused) { doc.find.paused = false; this.refreshFind(doc,cx); }
    if (focus && doc?.find) cx.timer.after(0, () => { if (this.docs.get(this.active) === doc) doc.find?.input.focus(); });
  }
  openFind(doc, cx) {
    if (doc.closed || doc.closing) return;
    if (!doc.find) {
      doc.find = new DocumentFind(doc, cx => this.refreshFind(doc, cx), cx);
      doc.find.input.on('submit', (e,cx) => this.stepFind(doc,e.shift ? -1 : 1,cx));
    }
    cx.timer.after(0, () => { if (this.docs.get(this.active) === doc) doc.find?.input.focus(); });
    cx.notify();
  }
  closeFind(doc, cx) {
    const f = doc.find;
    if (!f) return;
    // Return to the retained editor, at the matched range (not a replacement).
    if (findMode(doc) === 'source' && !doc.highlight && doc.editor) {
      const hit = doc.source ? pageRanges(doc.source, f.current ? [f.current] : [])[0] : f.current;
      if (hit) doc.editor.set_selected_range({ start: hit.start, end: hit.end });
      cx.timer.after(0, () => { if (this.docs.get(this.active) === doc && !doc.find) doc.editor?.focus(); });
    }
    f.release(); doc.find = null;
    if ((findMode(doc)!=='source' || doc.highlight) && this.pane && this.docs.get(this.active)===doc)
      cx.timer.after(0,()=>{if(!doc.find && this.docs.get(this.active)===doc)run('pane.focus',{pane:this.pane});});
    cx.notify();
  }
  refreshFind(doc, cx) {
    const f = doc.find;
    if (!f || f.closed || doc.closed || doc.closing) return;
    const query = (f.input.value() ?? '').trim();
    f.cancel(); f.query = query;
    if (this.docs.get(this.active) !== doc) { f.paused = !!query; return; }
    if (!query) { cx.notify(); return; }
    if (query.length > FIND.queryChars) { f.error = `Find supports up to ${FIND.queryChars} characters.`; cx.notify(); return; }
    const serial = f.serial, signature = findSignature(doc);
    f.busy = true; cx.notify();
    // Coalesce typing; one bounded helper batch can be in flight per document.
    cx.timer.after(120, cx => {
      if (f.closed || f.serial !== serial || doc.find !== f || doc.closed) return;
      cx.spawn(async cx => {
        const earlier = this.findWork;
        let finish; this.findWork = new Promise(resolve => { finish = resolve; });
        try {
          await earlier;
          if (f.closed || f.serial !== serial || doc.find !== f || doc.closed) return;
          const result = await f.scan(query, serial, signature, this.reader(doc));
          if (!result || f.serial !== serial || doc.find !== f || doc.closed) {
            if (!result && f.serial === serial && doc.find === f && !doc.closed && !doc.closing) this.refreshFind(doc,cx);
            return;
          }
          Object.assign(f, result); f.busy = false;
          f.cells = new Map();
          for (const hit of f.hits) if (hit.row !== undefined) {
            const key = `${hit.sheet ?? ''}:${hit.row}:${hit.col}`;
            if (!f.cells.has(key)) f.cells.set(key, []);
            f.cells.get(key).push(hit);
          }
          this.revealFind(doc, cx);
        } catch (e) {
          if (doc.find === f && f.serial === serial && !doc.closed) {
            f.error = String(e.message ?? e); f.busy = false;
          }
        } finally { finish(); if (!doc.closed) cx.notify(); }
      });
    });
  }
  stepFind(doc, by, cx) {
    const f = doc.find;
    if (!f || f.busy || !f.hits.length || f.error) return;
    f.index = (f.index + by + f.hits.length) % f.hits.length;
    this.revealFind(doc, cx); cx.notify();
  }
  pendingReveal(doc, cx) {
    if (doc.find?.revealPending) this.revealFind(doc, cx);
  }
  revealFind(doc, cx) {
    const f = doc.find, hit = f?.current;
    if (!hit || f.busy || f.error || doc.closed || doc.stale) return;
    f.jump = true; f.revealPending = false;
    const serial = f.serial, index = f.index;
    const accept = () => doc.find === f && f.serial === serial && f.index === index && !doc.stale;
    switch (findMode(doc)) {
      case 'pdf':
        if (doc.pdf.page !== hit.page) { doc.pdf.page = hit.page; doc.pdf.load(cx); }
        break;
      case 'excel':
        doc.sheet = hit.sheet; doc.page = hit.row; doc.col = hit.col;
        break;
      case 'table':
        if (doc.source) {
          if (doc.tableBusy) { f.revealPending = true; break; }
          if (doc.table && (doc.table.row !== hit.row || doc.table.col !== hit.col)) this.loadTable(doc,cx,hit.row,hit.col,false,accept);
        } else { doc.page = hit.row; doc.col = hit.col; }
        break;
      case 'source':
        if (doc.sourceBusy) { f.revealPending = true; break; }
        if (doc.source && doc.source.page !== hit.page) this.sourcePage(doc,hit.page,cx,accept);
        break;
    }
  }
  hasTextFind(doc) {
    return Boolean(doc.find?.query && doc.find.hits.length && !doc.find.busy && !doc.find.error && !doc.stale);
  }
  fileTab(key, doc, t) {
    return h_flex().id(`tab-${hash(key)}`).h(26).flex_none().items_center().rounded(6)
      .bg(key === this.active ? t.selected : t.raised).text_color(t.foreground)
      .child(this.button(`select-${hash(key)}`, `${doc.path.split('/').pop()}${doc.text !== doc.saved ? ' •' : ''}`, key === this.active, cx => this.selectFile(key,cx), t))
      .child(this.button(`close-${hash(key)}`, doc.closing ? '…' : '×', false, cx => { cx.spawn(cx => this.closeFile(key, cx)); }, t));
  }
  button(id, text, selected, fn, t, enabled = true) {
    return div().id(id).h(26).px(8).flex_none().flex().items_center().rounded(6).text_size(12)
      .bg(selected ? t.selected : t.raised).text_color(enabled ? t.foreground : t.dim)
      .when(enabled, el => el.cursor_pointer().hover(s => s.bg(t.hover))).on_click((_e, cx) => { cx.stop_propagation(); if (enabled) fn(cx); cx.notify(); }).child(text);
  }
  officePreview(doc, t) {
    if (doc.kind === 'docx' && this.hasTextFind(doc)) return searchTextView(doc, t, documentId(doc));
    if (doc.kind === 'docx') return v_flex().flex_1().min_h(0)
      .when(doc.office.limited, el => el.child(div().p(8).text_color(t.blocked).child(doc.office.limitNotice ?? 'Word preview is limited. Open the original for the complete document.')))
      .child(div().id(`word-${documentId(doc)}`).flex_1().min_h(0).overflow_y_scrollbar().p(18)
        .child(TextView.markdown(`word-content-${documentId(doc)}`, doc.office.markdown || 'No readable text in this document.').selectable(true)));
    const sheets = doc.office.sheets, sheet = sheets[doc.sheet ?? 0];
    if (!sheet) return div().p(18).child('This workbook has no readable worksheets.');
    const page = doc.page ?? 0, col = doc.col ?? 0, totalCols = Math.max(1, ...sheet.rows.map(r => r.length)), cols = Math.min(PREVIEW.pageCols, totalCols-col);
    return v_flex().flex_1().min_h(0)
      .child(h_flex().h(34).flex_none().px(8).gap(4).overflow_x_scrollbar()
        .children(sheets.map((s, i) => this.button(`sheet-${i}`, s.name, i === doc.sheet, () => { doc.sheet = i; doc.page = 0; doc.col = 0; }, t))))
      .child(h_flex().h(32).flex_none().px(8).gap(5).items_center()
        .child(this.button('sheet-prev', '←', false, () => { doc.page = pageStart(page - PREVIEW.pageRows, sheet.rows.length, PREVIEW.pageRows); }, t, page > 0))
        .child(this.button('sheet-next', '→', false, () => { doc.page = pageStart(page + PREVIEW.pageRows, sheet.rows.length, PREVIEW.pageRows); }, t, page + PREVIEW.pageRows < sheet.rows.length))
        .child(div().text_size(11).child(`Rows ${sheet.rows.length ? page + 1 : 0}–${Math.min(sheet.rows.length, page + 40)} / ${sheet.rows.length}${sheet.formulas ? ' · saved formula values' : ''}`)))
      .child(h_flex().h(28).flex_none().px(8).gap(5).items_center()
        .child(this.button('sheet-col-prev', '←', false, () => { doc.col = pageStart(col - PREVIEW.pageCols, totalCols, PREVIEW.pageCols); }, t, col > 0))
        .child(div().text_size(11).child(`Columns ${col+1}–${Math.min(totalCols,col+cols)} / ${totalCols}`))
        .child(this.button('sheet-col-next', '→', false, () => { doc.col = pageStart(col + PREVIEW.pageCols, totalCols, PREVIEW.pageCols); }, t, col + PREVIEW.pageCols < totalCols)))
      .when(sheet.limited || doc.office.limited, el => el.child(div().p(8).text_size(11).text_color(t.blocked).child(doc.office.limitNotice ?? 'Workbook preview is limited. Open the original for complete data.')))
      .child(div().id(`sheet-scroll-${documentId(doc)}-${doc.sheet}-${page}-${col}`).flex_1().min_h(0).overflow_x_scrollbar().overflow_y_scrollbar()
        .child(v_flex().min_w(48 + cols * 160)
          .child(h_flex().h(26).flex_none().bg(t.raised).child(div().w(48)).children(Array.from({ length: cols }, (_, j) => div().w(160).px(9).text_size(11).child(this.columnName(col+j)))))
          .children(sheet.rows.slice(page, page + 40).map((row, i) => h_flex().min_h(30).flex_none().border_b(1).border_color(t.border)
            .child(div().w(48).flex_none().px(9).py(6).text_size(11).text_color(t.dim).child(String(page + i + 1)))
            .children(Array.from({ length: cols }, (_, j) => findCell(doc,page+i,col+j,doc.sheet,row[col+j],t)))))));
  }
  columnName(index) { let s = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
  csvData(doc) {
    if (doc.source) return doc.table;
    const delimiter = doc.delimiter ?? delimiterFor(doc.text, doc.path), row = doc.page ?? 0, col = doc.col ?? 0;
    if (!doc.bufferTable || doc.bufferText !== doc.text || doc.bufferTable.delimiter !== delimiter || doc.bufferTable.row !== row || doc.bufferTable.col !== col) {
      doc.bufferText = doc.text; doc.bufferTable = csvPage(doc.text, delimiter, row, col);
    }
    return doc.bufferTable;
  }
  tablePage(doc, row, col, cx) {
    const data = this.csvData(doc);
    if (!data || doc.tableBusy || doc.stale || data.error || doc.tableError) return;
    row = pageStart(row, data.total, PREVIEW.pageRows); col = pageStart(col, data.cols, PREVIEW.pageCols);
    if (doc.source) { if (row !== data.row || col !== data.col) this.loadTable(doc, cx, row, col, false); }
    else { doc.page = row; doc.col = col; }
  }
  delimiter(doc, value, cx) {
    if (doc.tableBusy || doc.stale) return;
    doc.delimiter = value; doc.page = 0; doc.col = 0; doc.bufferTable = null;
    if (doc.source) this.loadTable(doc, cx);
    this.refreshFind(doc, cx);
  }
  prepareJumpInputs(doc) {
    // Retained native state must be allocated in the load/event callback,
    // never while the native render tree is being built.
    for (const [kind, key, needed, placeholder] of [
      ['row', 'rowInput', doc.kind === 'csv', 'Row number'],
      ['source', 'sourceInput', Boolean(doc.source), 'Page number'],
    ]) {
      if (!needed || doc[key]) continue;
      const input = doc[key] = InputState.new({ placeholder });
      input.on('submit', (_e, cx) => this.goTo(doc, kind, cx));
    }
  }
  goTo(doc, kind, cx) {
    const raw = (kind === 'row' ? doc.rowInput : doc.sourceInput)?.value();
    if (!/^\d+$/.test(raw ?? '') || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) return;
    if (kind === 'row') this.tablePage(doc, Number(raw) - 1, doc.col ?? 0, cx);
    else this.sourcePage(doc, Number(raw) - 1, cx);
    cx.notify();
  }
  sourceView(doc, t, cx) {
    const source = doc.source, pages = Math.max(1, Math.ceil(doc.sourceSize / PREVIEW.sourceBytes)), enabled = !doc.sourceBusy && !doc.stale;
    return v_flex().flex_1().min_h(0)
      .child(h_flex().min_h(34).flex_none().px(8).gap(5).items_center().flex_wrap()
        .child(this.button('source-prev', '←', false, cx => this.sourcePage(doc, source.page - 1, cx), t, enabled && source.page > 0))
        .child(div().text_size(11).child(`Page ${number(source.page + 1)} / ${number(pages)} · bytes ${source.end > source.start ? number(source.start + 1) : '0'}–${number(source.end)} / ${number(doc.sourceSize)}`))
        .child(this.button('source-next', '→', false, cx => this.sourcePage(doc, source.page + 1, cx), t, enabled && source.end < doc.sourceSize))
        .child(Input.new(doc.sourceInput).w(95).text_size(12))
        .child(this.button('source-go', 'Go', false, cx => this.goTo(doc, 'source', cx), t, enabled)))
      .when(Boolean(doc.sourceError), el => el.child(div().p(8).text_color(t.blocked).child(doc.sourceError)))
      .child(doc.sourceBusy ? div().p(12).child('Loading source page…') : this.hasTextFind(doc) ? searchTextView(doc,t,documentId(doc)) : Editor.new(doc.editor).flex_1().min_h(0));
  }
  preview(doc, t, cx) {
    if (doc.office) return this.officePreview(doc, t);
    if (doc.kind === 'markdown') {
      if (this.hasTextFind(doc)) return searchTextView(doc,t,documentId(doc));
      const excerpt = markdownExcerpt(doc.source ? doc.markdownHead : doc.text);
      return v_flex().flex_1().min_h(0)
        .when(excerpt.limited || doc.markdownMore && doc.source, el => el.child(div().p(8).text_size(12).text_color(t.blocked).child(`Markdown preview shows at most ${number(PREVIEW.markdownChars)} characters and ${number(PREVIEW.markdownLines)} lines. Choose Source for the rest.`)))
        .child(div().id(`md-${documentId(doc)}`).flex_1().min_h(0).overflow_y_scrollbar().p(18).child(TextView.markdown(`markdown-${documentId(doc)}`, excerpt.text)));
    }
    const data = this.csvData(doc), error = doc.tableError ?? data?.error;
    const row = data?.row ?? 0, col = data?.col ?? 0, cols = data ? Math.min(PREVIEW.pageCols, Math.max(0, data.cols - col)) : 0;
    const enabled = Boolean(data && !error && !doc.tableBusy && !doc.stale);
    const go = (r, c, cx) => this.tablePage(doc, r, c, cx);
    return v_flex().flex_1().min_h(0)
      .child(h_flex().min_h(32).flex_none().px(8).gap(5).items_center().flex_wrap()
        .children([['Auto', null], ['Comma', ','], ['Tab', '\t'], ['Semicolon', ';']].map(([label, value]) => this.button(`delimiter-${label}`, label, (doc.delimiter ?? null) === value, cx => this.delimiter(doc, value, cx), t, !doc.tableBusy && !doc.stale)))
        .when(Boolean(data), el => el.child(div().text_size(11).text_color(t.dim).child(`Using ${data.delimiter === '\t' ? 'Tab' : data.delimiter === ';' ? 'Semicolon' : 'Comma'}`))))
      .when(Boolean(data && !error), el => el
        .child(h_flex().min_h(32).flex_none().px(8).gap(5).items_center().flex_wrap()
          .child(this.button('csv-first', '«', false, cx => go(0, col, cx), t, enabled && row > 0))
          .child(this.button('csv-prev', '←', false, cx => go(row - PREVIEW.pageRows, col, cx), t, enabled && row > 0))
          .child(div().text_size(12).child(`Rows ${data.total ? number(row + 1) : '0'}–${number(Math.min(data.total, row + PREVIEW.pageRows))} / ${number(data.total)}${data.limited ? '+' : ''}`))
          .child(this.button('csv-next', '→', false, cx => go(row + PREVIEW.pageRows, col, cx), t, enabled && row + PREVIEW.pageRows < data.total))
          .child(this.button('csv-last', '»', false, cx => go(data.total - 1, col, cx), t, enabled && row + PREVIEW.pageRows < data.total))
          .child(Input.new(doc.rowInput).w(100).text_size(12))
          .child(this.button('csv-go', 'Go', false, cx => this.goTo(doc, 'row', cx), t, enabled)))
        .child(h_flex().min_h(28).flex_none().px(8).gap(5).items_center().flex_wrap()
          .child(this.button('csv-col-first', '«', false, cx => go(row, 0, cx), t, enabled && col > 0))
          .child(this.button('csv-col-prev', '←', false, cx => go(row, col - PREVIEW.pageCols, cx), t, enabled && col > 0))
          .child(div().text_size(11).child(`Columns ${data.cols ? number(col + 1) : '0'}–${number(col + cols)} / ${number(data.cols)}`))
          .child(this.button('csv-col-next', '→', false, cx => go(row, col + PREVIEW.pageCols, cx), t, enabled && col + PREVIEW.pageCols < data.cols))
          .child(this.button('csv-col-last', '»', false, cx => go(row, data.cols - 1, cx), t, enabled && col + PREVIEW.pageCols < data.cols))))
      .when(Boolean(error), el => el.child(div().p(8).text_size(12).text_color(t.blocked).child(error)))
      .when(Boolean(data?.limited), el => el.child(div().px(8).py(4).text_size(11).text_color(t.blocked).child(TABLE_LIMIT)))
      .when(Boolean(data?.clipped), el => el.child(div().px(8).py(4).text_size(11).text_color(t.dim).child(`Long cells show their first ${PREVIEW.cellChars} characters with …. Source retains the original.`)))
      .child(doc.tableBusy ? div().p(16).child(doc.table ? 'Loading table page…' : 'Scanning records… You can switch to Source or close this file.') : error ? div().p(12).child('Choose Source to view the original text, or try a different delimiter.') : !data ? div().p(16).child('Loading table…') :
        div().id(`csv-scroll-${documentId(doc)}-${row}-${col}`).flex_1().min_h(0).overflow_x_scrollbar().overflow_y_scrollbar()
          .child(v_flex().min_w(56 + cols * 160)
            .child(h_flex().h(26).flex_none().bg(t.raised).child(div().w(56)).children(Array.from({ length: cols }, (_, j) => div().w(160).px(9).text_size(11).child(this.columnName(col + j)))))
            .children(data.rows.map((cells, i) => h_flex().id(`csv-row-${row + i}`).min_h(30).flex_none().bg(row + i === 0 ? t.raised : t.background).border_b(1).border_color(t.border)
              .child(div().w(56).flex_none().px(6).py(6).text_size(11).text_color(t.dim).child(number(row + i + 1)))
              .children(Array.from({ length: cols }, (_, j) => findCell(doc,row+i,col+j,undefined,cells[j],t)))))));
  }
  render(cx) {
    const own = shared("workspace.documents")?.[props()?.slot];
    if (own) this.pane = own;
    if (!this.pane && !props()?.slot) { const docs = panes().filter(p => p.mod === 'workspace-document'); if (docs.length === 1) this.pane = docs[0].pane; }
    if (this.pane) localStorage.setItem("document-pane", this.pane);
    const request = shared('workspace.document.open');
    if (this.pane && request?.pane === this.pane && request.at !== this.requestAt) { this.requestAt = request.at; cx.timer.after(0, cx => this.open(request.file, request.on ?? null, cx, request)); }
    const t = theme(), doc = this.docs.get(this.active);
    return v_flex().id('document').size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(h_flex().h(32).flex_none().overflow_x_scrollbar().gap(3).px(5).items_center().children([...this.docs].map(([key, d]) => this.fileTab(key, d, t))))
      .when(Boolean(doc), el => el.child(h_flex().min_h(38).flex_none().px(8).gap(6).items_center().flex_wrap()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(doc?.path ?? ''))
        .when(['docx','excel'].includes(doc?.kind) || Boolean(doc?.source) || Boolean(doc?.error && textKind(doc)), el => el.child(this.button('document-reload','Reload preview',false,cx=>this.reload(doc,cx),t,!doc.loading && !doc.sourceBusy && !doc.tableBusy)))
        .child(this.button('document-open-find', 'Find', Boolean(doc.find), cx => this.openFind(doc,cx), t))
        .child(this.button('document-copy-path', 'Copy path', false, cx => { const space=spaces().find(s=>s.active),root=doc.root??shared('workspace.roots')?.[space?.id]??space?.folder; cx.write_to_clipboard(relativeFile(root,doc.path)); }, t))
        .when(doc?.kind !== 'pdf' && Boolean(doc?.source || doc?.error || doc?.office), el => el.child(this.button('document-original', doc.on ? 'Copy remote path' : 'Open original', false, cx => this.original(doc, cx), t)))
        .child(this.button('document-reference', 'Reference in chat', false, () => { const space=spaces().find(s=>s.active); fileActions({ file:doc.path,on:doc.on,root:doc.root??shared('workspace.roots')?.[space?.id]??space?.folder },null,true); }, t))
        .when(doc?.kind === 'text' && !doc.source && HIGHLIGHT_LANGUAGES.has(language(doc?.path ?? '')), el => el.children(['Edit', 'Highlight'].map((label, i) => this.button(`code-${label}`, label, Boolean(doc.highlight) === Boolean(i), () => { doc.highlight = Boolean(i); }, t))))
        .when(['csv', 'markdown'].includes(doc?.kind), el => el.children(['Source', 'Preview'].map((label, i) => this.button(`mode-${label}`, label, doc.preview === Boolean(i), cx => this.mode(doc, Boolean(i), cx), t))))
        .when(doc && completeBuffer(doc) && !doc.on, el => el.child(this.button('save', doc?.saving ? 'Saving…' : 'Save', false, cx => this.save(doc, cx), t)))))
      .when(Boolean(doc?.find), el => el.child(findBar(doc.find,t,(by,cx)=>this.stepFind(doc,by,cx),cx=>this.closeFind(doc,cx))))
      .when(Boolean(doc?.conflict), el => el.child(h_flex().px(10).py(6).gap(8).items_center().bg(t.raised)
        .child(div().flex_1().text_size(12).child('File changed on disk. Your draft is retained.'))
        .child(this.button('reload', 'Discard draft and reload', false, cx => this.reload(doc, cx), t))))
      .when(Boolean(doc?.source) && !doc?.stale, el => el.child(div().px(10).py(4).text_size(11).text_color(t.dim).child(`${formatFileSize(doc.sourceSize)} · read only. ${EDIT_LIMIT}`)))
    .when(Boolean(doc?.stale), el => el.child(div().px(10).py(4).text_size(12).text_color(t.blocked).child(doc.staleReason ?? SOURCE_CHANGED)))
    .when(Boolean(doc?.notice) || doc?.recovered || doc?.on, el => el.child(div().px(10).py(4).text_size(11).text_color(t.dim).child(doc?.notice ?? (doc?.recovered ? 'Recovered unsaved draft' : 'Remote file · read only'))))
      .child(!doc ? div().p(16).child('Open a file from Files') : doc.closing ? div().p(16).child('Closing file…') : doc.pdf ? pdfView(doc.pdf, t, 'pdf', false, doc.find) : doc.loading ? div().p(16).child('Loading…') : doc.error ? div().p(16).child(doc.error) : doc.office ? this.officePreview(doc, t) : doc.preview && (doc.kind === 'csv' || doc.kind === 'markdown') && (doc.source || doc.editor) ? this.preview(doc, t, cx) : doc.source ? this.sourceView(doc, t, cx) : this.hasTextFind(doc) ? searchTextView(doc,t,documentId(doc)) : doc.highlight && doc.text !== null ? highlighted(doc, language(doc.path), t, documentId(doc)) : !doc.editor ? div().p(16).child('Loading…') : Editor.new(doc.editor).flex_1().min_h(0));
  }
  async close() { for (const doc of this.docs.values()) { doc.closed = true; if (doc.pdf) doc.pdf.closed = true; } for (const doc of this.docs.values()) { if (doc.text !== null) await this.draft(doc).catch(() => {}); doc.editor?.release(); doc.rowInput?.release(); doc.sourceInput?.release(); doc.find?.release(); await doc.pdf?.dispose(); } }
}
