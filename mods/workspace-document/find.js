// Find is a transient view of one document, never an editor or saved draft.
// Native retained editors/TextViews expose no multi-range decoration API;
// while a query is present we paint a read-only, virtualized text surface.
import { div, svg } from 'gpui-kit';
import { h_flex, v_flex, v_virtual_list, Scrollbar, Input, InputState, VirtualListScrollHandle, ScrollHandle } from 'gpui-base';
import { settings } from 'herdr';
import { FIND, findRanges, findPattern, findCount, markedParts, pageRanges, cellExcerpt } from './core/document-find.js';
import { PREVIEW, canEdit, delimiterFor, visitCSV, markdownExcerpt } from './core/documents.js';
import { lexer } from './core/vendor/marked.js';
import { syntaxTokens, HIGHLIGHT_LANGUAGES } from './core/syntax.js';
import { language } from './core/documents.js';

const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®' };
const entities = value => value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (raw, name) => {
  if (name[0] !== '#') return named[name] ?? raw;
  const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : raw;
});

// Search the displayed text, not link URLs, fence delimiters, table separators
// or emphasis punctuation. Keep inline emphasis and block styling as runs.
// Raw HTML is not a native searchable DOM: only its textual fallback is used.
export function renderedText(markdown) {
  let text = ''; const runs = [];
  const add = (value, style = {}) => {
    if (!value) return;
    const start = text.length; text += value;
    runs.push({ start, end: text.length, ...style });
  };
  const walk = (tokens, style = {}) => {
    for (const token of tokens ?? []) {
      switch (token.type) {
        case 'space': add('\n'); break;
        case 'heading': walk(token.tokens, { ...style, bold: true }); add('\n'); break;
        case 'paragraph': walk(token.tokens, style); add('\n'); break;
        case 'strong': walk(token.tokens, { ...style, bold: true }); break;
        case 'em': walk(token.tokens, { ...style, italic: true }); break;
        case 'del': walk(token.tokens, { ...style, strike: true }); break;
        case 'link': walk(token.tokens, { ...style, link: true }); break;
        case 'image': add(entities(token.text ?? ''), style); break;
        case 'code': add(token.text, { ...style, code: true }); add('\n'); break;
        case 'codespan': add(token.text, { ...style, code: true }); break;
        case 'br': add('\n'); break;
        case 'hr': add('\n'); break;
        case 'checkbox': break;
        case 'list':
          token.items.forEach((item, i) => {
            add(token.ordered ? `${Number(token.start) + i}. ` : '• ', style);
            if (item.task) add(item.checked ? '☑ ' : '☐ ', style);
            walk(item.tokens, style); add('\n');
          }); break;
        case 'table':
          [token.header, ...token.rows].forEach((row, i) => {
            row.forEach((cell, col) => {
              if (col) add('\t│\t');
              walk(cell.tokens, { ...style, bold: i === 0 });
            }); add('\n');
          }); break;
        case 'blockquote': walk(token.tokens, { ...style, italic: true }); break;
        case 'html':
          if (/^<br\s*\/?\s*>$/i.test(token.text)) add('\n');
          else if (token.block) add(entities(token.text.replace(/<!--[\s\S]*?-->|<[^>]*>/g, '')), style);
          break;
        case 'text': case 'escape':
          if (token.tokens) walk(token.tokens, style);
          else add(entities(token.text ?? '').replace(/\n/g, ' '), style);
          break;
        default: if (token.tokens) walk(token.tokens, style); break;
      }
    }
  };
  walk(lexer(markdown, {gfm: true}));
  return { text, runs };
}

export function tableMatches(rows, query, limit = FIND.hits) {
  const hits = []; if (!query) return {hits, limited:false};
  const pattern = findPattern(query);
  for (const { row, cells, sheet } of rows) {
    for (let col = 0; col < cells.length; col++) {
      const value = String(cells[col] ?? '');
      if (!value) continue;
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(value))) {
        if (hits.length >= limit) return { hits, limited: true };
        const start = match.index, end = start + match[0].length;
        hits.push({ start, end, row, col, sheet, ...cellExcerpt(value, start, end) });
      }
    }
  }
  return { hits, limited: false };
}

function bufferTable(doc, query) {
  if (!canEdit(doc.text)) throw Error('Table preview exceeds the edit buffer limit. Choose Source.');
  const hits = []; let row = 0, limited = false;
  visitCSV(doc.text, doc.delimiter ?? delimiterFor(doc.text, doc.path), cells => {
    const found = tableMatches([{row: row++, cells}], query, FIND.hits - hits.length);
    hits.push(...found.hits);
    if (found.limited) { limited = true; return false; }
  });
  return { hits, limited };
}

export function findMode(doc) {
  return doc.pdf ? 'pdf' : doc.office ? doc.kind : doc.preview && doc.kind === 'csv' ? 'table' :
    doc.preview && doc.kind === 'markdown' ? 'markdown' : 'source';
}

export function findSignature(doc) {
  return [findMode(doc), doc.text, doc.sourceVersion, doc.office, doc.delimiter, doc.pdf?.result?.version, doc.stale, doc.loading, doc.error];
}
const same = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);

export class DocumentFind {
  constructor(doc, changed, cx) {
    this.doc = doc; this.hits = []; this.index = 0; this.query = ''; this.serial = 0;
    this.input = InputState.new({ placeholder: 'Find in document' });
    this.scroll = VirtualListScrollHandle.new();
    if(doc.pdf) this.pdfScroll = ScrollHandle.new();
    this.input.on('change', (_e, cx) => changed(cx));
  }
  get current() { return this.hits[this.index]; }
  cancel() {
    this.serial++; this.hits = []; this.index = 0; this.error = null;
    this.detail = null; this.cells = null; this.sourceText = null; this.rows = null; this.rowsText = null; this.pdfTarget = null; this.revealPending = false; this.busy = false; this.limited = false; this.rendered = null; this.version = null; this.jump = false;
  }
  release() { this.cancel(); this.closed = true; this.input.release(); this.scroll.release(); this.pdfScroll?.release(); }
  async scan(query, serial, signature, reader) {
    const doc = this.doc, mode = signature[0];
    const alive = () => !this.closed && !doc.closed && !doc.closing && doc.find === this &&
      this.serial === serial && same(signature, findSignature(doc));
    const start = Date.now();
    const result = { hits: [], limited: false, detail: null, version: null, rendered: null };
    if (doc.stale) throw Error('Reload the changed file before searching.');
    if (doc.loading || doc.pdf?.busy && !doc.pdf.result) throw Error('Preview is still loading.');
    if (doc.error) throw Error(doc.error);
    if (mode === 'source' && doc.source || mode === 'table' && doc.source || mode === 'pdf') {
      if (mode === 'table' && (!doc.table || doc.tableError)) throw Error(doc.tableError ?? 'Table is still scanning.');
      if (mode === 'pdf' && (!doc.pdf.result || doc.pdf.error)) throw Error(doc.pdf.error ?? 'PDF is still loading.');
      let next = { start: 0, row: 0, offset: '0', page: 1 };
      let hasText = false, complete = false, boxCount = 0;
      result.version = mode === 'pdf' ? doc.pdf.result.version : doc.sourceVersion;
      while (alive()) {
        if (Date.now() - start > FIND.timeMs) { result.limited = true; result.detail = 'Search stopped at the time limit. Results are partial.'; break; }
        let batch;
        try {
          const args = { query, limit: Math.max(1, FIND.hits - result.hits.length), version: result.version };
          batch = mode === 'pdf' ? await doc.pdf.call('find', { ...args, page: next.page, pages: doc.pdf.pages }) :
            mode === 'source' ? await reader.call('find-source', { ...args, start: next.start }) :
              await reader.call('find-table', { ...args, row: next.row, offset: next.offset, delimiter: doc.table.delimiter });
        } catch (e) {
          if (!result.hits.length || /changed on disk/i.test(String(e))) throw e;
          result.limited = true; result.detail = `Search stopped: ${e.message ?? e}. Results are partial.`; break;
        }
        if (!alive()) return null;
        hasText ||= Boolean(batch.hasText);
        const remaining = FIND.hits - result.hits.length;
        if (mode === 'pdf') {
          for (const hit of batch.hits.slice(0, remaining)) {
            if (boxCount + hit.boxes.length > 12000) { result.limited = true; break; }
            boxCount += hit.boxes.length; result.hits.push(hit);
          }
          if (result.limited) break;
        } else result.hits.push(...batch.hits.slice(0, remaining));
        if (batch.limited || batch.hits.length > remaining) { result.limited = true; break; }
        if (batch.done) { complete = true; break; }
        next = mode === 'pdf' ? { page: batch.next } : mode === 'source' ? { start: batch.next } : { row: batch.row, offset: batch.offset };
      }
      if (!alive()) return null;
      if (mode === 'pdf' && complete && !hasText) result.detail = 'No searchable text layer in this PDF. Image-only pages are not OCR scanned.';
      else if (mode === 'pdf') result.detail ??= 'Search covers extracted PDF text; highlights follow word boxes. Image-only text is not searched.';
      if (mode === 'table' && doc.table.limited) { result.limited = true; result.detail ??= 'Only indexed records are searchable. Choose Source for the rest.'; }
    } else if (mode === 'table') Object.assign(result, bufferTable(doc, query));
    else if (mode === 'excel') {
      function* rows() { for (let sheet = 0; sheet < doc.office.sheets.length; sheet++) for (let row = 0; row < doc.office.sheets[sheet].rows.length; row++) yield {sheet, row, cells: doc.office.sheets[sheet].rows[row]}; }
      Object.assign(result, tableMatches(rows(), query));
      if (doc.office.limited || doc.office.sheets.some(s => s.limited)) { result.limited = true; result.detail = 'Only the bounded workbook preview is searchable.'; }
    } else {
      let value = doc.text;
      if (mode === 'markdown' || mode === 'docx') {
        const excerpt = mode === 'markdown' ? markdownExcerpt(doc.source ? doc.markdownHead : doc.text) : {text: doc.office.markdown, limited: doc.office.limited};
        result.rendered = renderedText(excerpt.text ?? '');
        value = result.rendered.text;
        if (excerpt.limited || mode === 'markdown' && doc.source && doc.markdownMore) {
          result.limited = true;
          result.detail = mode === 'markdown' ? 'Only the bounded rendered preview is searchable. Choose Source for the entire file.' : 'Only the bounded Word content preview is searchable.';
        }
      }
      if (typeof value !== 'string') throw Error('No searchable text in this preview.');
      if (!result.rendered && value.length > PREVIEW.editChars) {
        value = value.slice(0, PREVIEW.editChars);
        if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0,-1);
        result.sourceText = value; result.limited = true; result.detail = 'Only the first 400,000 units of this oversized draft are searchable.';
      }
      if (!value.trim() && mode === 'docx') result.detail = 'No readable text in this Word content preview.';
      const found = findRanges(value, query);
      result.hits = found.hits; result.limited ||= found.limited;
    }
    if (!alive()) return null;
    if (result.limited) result.detail ??= 'Search is partial (preview or match limit reached).';
    result.hits.forEach((hit, index) => { hit.index = index; });
    return result;
  }
}

export function findBar(state, t, step, close) {
  const control = (id, icon, label, fn, enabled = true) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
    .accessibility_label(label).text_color(enabled ? t.foreground : t.dim)
    .when(enabled, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
    .on_click((_e,cx) => { cx.stop_propagation(); if (enabled) fn(cx); cx.notify(); })
    .child(svg(`mods/chat/${icon}.svg`).size(14));
  const action = fn => (_e,cx) => { fn(cx); cx.stop_propagation(); cx.notify(); };
  return v_flex().flex_none()
    .child(h_flex().id('document-find').min_h(40).px(8).gap(5).items_center().border_b(1).border_color(t.border)
      .key_context('document_find')
      .on_action('document_find_close', action(close))
      .on_action('document_find_next', action(cx => step(1,cx)))
      .on_action('document_find_prev', action(cx => step(-1,cx)))
      .child(svg('mods/chat/search.svg').size(14).flex_none().text_color(t.dim))
      .child(Input.new(state.input).flex_1().min_w(0).text_size(13).text_color(t.foreground))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(state.error ? 'Unavailable' : findCount(state)))
      .child(control('document-find-prev','chevron-up','Previous match (Shift+Enter)',cx => step(-1,cx),state.hits.length > 1 && !state.busy))
      .child(control('document-find-next','chevron-down','Next match (Enter)',cx => step(1,cx),state.hits.length > 1 && !state.busy))
      .child(control('document-find-close','x','Close Find (Escape)',close)))
    .when(Boolean(state.error || state.detail), el => el.child(div().px(8).py(3).text_size(11).text_color(state.error ? t.blocked : t.dim).child(state.error ?? state.detail)));
}

// Every row is bounded even for a single 400k-character minified line.
// Preserve UTF-16 offsets, including CR/LF and astral characters.
export function visualRows(text, columns = 64) {
  const rows = []; let start = 0, line = 1, first = true;
  while (start < text.length) {
    let end = Math.min(text.length, start + columns);
    for (let i = start; i < end; i++) if (text[i] === '\r' || text[i] === '\n') {
      end = i + (text[i] === '\r' && text[i+1] === '\n' ? 2 : 1); break;
    }
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end-1])) end = end === start+1 ? end+1 : end-1;
    const newline = /[\r\n]$/.test(text.slice(start,end));
    rows.push({start,end,line:first ? line : null}); start = end;
    first = newline;
    if (newline) line++;
  }
  return rows.length ? rows : [{start:0,end:0,line:1}];
}
function firstOverlap(list, start) {
  let lo=0,hi=list.length;
  while(lo<hi){const mid=(lo+hi)>>1; if(list[mid].end<=start)lo=mid+1;else hi=mid;}
  return lo;
}
const visible = (text, tone) => text.replace(/\r\n|[\r\n]/g,tone ? '↵' : '').replace(/\t/g,'    ').replace(/ /g,'\u00a0');

// Keep source tokens and search marks separate so Find does not rewrite code.
export function searchTextView(doc, t, id) {
  const f = doc.find, rich = f.rendered;
  const text = rich?.text ?? doc.source?.text ?? f.sourceText ?? doc.text ?? '';
  const hits = doc.source && !rich ? pageRanges(doc.source, f.hits) : f.hits;
  const current = hits.find(h => h.index === f.index);
  const lang = language(doc.path), mono = !rich, cols = Math.max(16, Math.min(100, Math.floor(((f.width ?? 560) - 68) / 8)));
  if (f.rowsText !== text || f.columns !== cols) {
    f.rowsText = text; f.columns = cols; f.rows = visualRows(text, cols);
    f.jump = true;
  }
  const rows = f.rows, list = `document-find-text-${id}`;
  if (f.jump && current) { f.scroll.scroll_to_item(Math.min(rows.length-1,firstOverlap(rows,current.start)), 'center'); f.jump = false; }
  const colors = {plain:t.foreground,keyword:t.ansi5,string:t.ansi2,comment:t.dim,number:t.ansi1,function:t.ansi4,type:t.ansi3,operator:t.ansi6};
  const render = ({start,end,line}) => {
    const local = [], value = text.slice(start,end);
    for (let i=firstOverlap(hits,start); i<hits.length && hits[i].start<end; i++) local.push(hits[i]);
    const styled = [];
    if (rich) {
      let at=start;
      for (let i=firstOverlap(rich.runs,start); i<rich.runs.length && rich.runs[i].start<end; i++) {
        const run=rich.runs[i], a=Math.max(start,run.start), b=Math.min(end,run.end);
        if(a>at)styled.push({start:at,end:a});styled.push({...run,start:a,end:b});at=b;
      }
      if(at<end)styled.push({start:at,end});
    } else if (HIGHLIGHT_LANGUAGES.has(lang)) {
      let at=start;
      for(const token of syntaxTokens(value,lang)){styled.push({start:at,end:at+token.text.length,kind:token.kind});at+=token.text.length;}
    } else styled.push({start,end});
    const row = h_flex().h(21).items_center().min_w(0).text_size(12.5)
      .when(mono,e=>e.font_family(settings().font_family ?? 'monospace'))
      .child(div().w(rich ? 12 : 48).flex_none().pr(8).text_right().text_color(t.dim).child(mono && line ? String(line) : ''));
    for (const style of styled) for (const part of markedParts(text.slice(style.start,style.end),local,current,style.start)) {
      row.child(div().flex_none().text_color(style.link ? t.accent : colors[style.kind] ?? t.foreground)
        .when(style.bold || part.tone===2,e=>e.font_medium())
        .when(style.italic,e=>e.italic())
        .when(style.code,e=>e.font_family(settings().font_family ?? 'monospace'))
        .when(part.tone===1,e=>e.bg(t.accent+'33'))
        .when(part.tone===2,e=>e.bg(t.accent).text_color(t.background))
        .child(visible(part.text,part.tone)));
    }
    return row;
  };
  return v_flex().flex_1().min_h(0)
    .child(div().px(8).py(3).text_size(11).text_color(t.dim).child(rich ? 'Find · rendered text and table contents. Close Find for the original layout.' : 'Find · read-only source. Close Find to return to the editor.'))
    .child(div().flex_1().min_h(0).overflow_x_scrollbar().on_size_change((size,cx)=>{if(f.width!==size.width){f.width=size.width;cx.notify();}})
      .child(div().relative().size_full().min_w(48+cols*8)
        .child(v_virtual_list(list, rows.length, 21, i=>String(i), range=>rows.slice(range.start,range.end).map(render)).track_scroll(f.scroll).size_full())
        .child(Scrollbar.vertical(list).absolute().inset_0())));
}

export function findCell(doc, row, col, sheet, value, t) {
  const f = doc.find, mode = findMode(doc);
  const hits = f && !f.busy && !f.error && ['table','excel'].includes(mode) ? f.cells?.get(`${sheet ?? ''}:${row}:${col}`) ?? [] : [];
  const current = hits.find(h => h.index === f.index);
  const shown = String(current?.excerpt ?? value ?? '');
  const cell = h_flex().w(160).flex_none().px(9).py(6).border_r(1).border_color(t.border).text_size(12).overflow_hidden().items_center()
    .when(hits.length>0,e=>e.bg(t.accent+'22'))
    .when(Boolean(current),e=>e.border_color(t.accent).accessibility_label(`Current match · ${shown}`));
  const show = text => text.replace(/\r\n|[\r\n]/g,' ↵ ').replace(/ /g,'\u00a0');
  if (!hits.length) return cell.child(div().min_w(0).truncate().child(show(shown)));
  // Cell coordinates identify the match even when the original displayed
  // value is clipped. The active cell shows a snippet beginning at the hit.
  const found = findRanges(shown,f.query).hits;
  const activeStart = current && (current.excerpt ? current.excerptOffset : current.start);
  let active = current && found.find(h=>h.start===activeStart);
  if (current && !active && activeStart < shown.length) {
    active = {start:activeStart,end:Math.min(shown.length,activeStart+f.query.length)};
    found.push(active); found.sort((a,b)=>a.start-b.start);
  }
  return cell.children(markedParts(shown,found,active).map(part=>div().flex_none()
    .when(part.tone===1,e=>e.bg(t.accent+'33'))
    .when(part.tone===2,e=>e.bg(t.accent).text_color(t.background).font_medium())
    .child(show(part.text))));
}
