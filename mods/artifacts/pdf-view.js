// Shared native PDF controller and visual surface for documents and recipe evidence.
// Uses only documented host image/size/exec APIs. No PDF bytes enter an EditorState.
import { div, image } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { appHome, exec, window as win } from 'herdr';

// A long recipe must not start a Poppler process for every PDF at once.
let rendering = Promise.resolve();
async function renderOne(pdf, extra) {
  const previous = rendering;
  let release; rendering = new Promise(resolve => { release = resolve; });
  try { await previous; if (pdf.closed) return null; return await pdf.call('render', extra); }
  finally { release(); }
}

export class PdfPreview {
  /** @param {string} path @param {{on?: string|null, helper?: string}} options */
  constructor(path, { on = null, helper = `${appHome()}/mods/workspace-document/pdf-render.py` } = {}) {
    this.path = path; this.on = on; this.helper = helper;
    this.unsupported = win()?.platform === 'windows';
    this.root = `${appHome()}/data/pdf-preview`;
    this.token = `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.page = 1; this.pages = 0; this.zoom = 1; this.fit = true;
    this.size = { width: 600, height: 600 };
  }
  async call(op, extra = {}) {
    const r = await exec('python3', [this.helper, JSON.stringify({ op, root: this.root, token: this.token, path: this.path, ...extra })], { timeout: 30000 });
    let data; try { data = JSON.parse(r.stdout); } catch { throw Error('PDF preview helper is unavailable. Open the original in a PDF app.'); }
    if (r.code || data.error) throw Error(data.error || 'PDF preview failed. Open the original in a PDF app.');
    return data;
  }
  load(cx) {
    if (this.closed) return;
    if (this.on) { this.error = 'Remote PDF previews are not available in the native pane. Open a local copy to preview it.'; cx.notify(); return; }
    if (this.unsupported) { this.error = 'Native PDF preview currently supports Linux and macOS with Python and Poppler. Use Open original on Windows.'; cx.notify(); return; }
    this.wanted = (this.wanted ?? 0) + 1;
    if (this.busy) return;
    this.busy = true; this.error = null;
    cx.spawn(async cx => {
      this.work = (async () => {
        while (!this.closed) {
          const revision = this.wanted, page = this.page;
          try {
            const data = await renderOne(this, { page, keep: this.result?.image.split('/').pop() });
            if (this.closed) break;
            if (revision !== this.wanted) continue;
            this.result = data; this.observedVersion = data.version; this.page = data.page; this.pages = data.pages; this.error = null;
          } catch (e) { if (!this.closed && revision === this.wanted) this.error = String(e.message ?? e); }
          if (revision === this.wanted) break;
        }
      })();
      try { await this.work; } finally { this.busy = false; if (!this.closed) cx.notify(); }
    });
    cx.notify();
  }
  check(cx) {
    if (this.closed || this.on || this.unsupported || this.busy || this.checking) return;
    this.checking = true;
    cx.spawn(async cx => {
      try { const out = await this.call('stat'); const previous = this.observedVersion; this.observedVersion = out.version; if (!this.closed && previous !== undefined && out.version !== previous) this.load(cx); }
      catch (e) { if (!this.closed) { this.error = String(e.message ?? e); cx.notify(); } }
      finally { this.checking = false; }
    });
  }
  turn(delta, cx) { this.page = Math.max(1, Math.min(this.pages || 1, this.page + delta)); this.load(cx); }
  async dispose() { this.closed = true; await this.work?.catch(() => {}); if (!this.on && !this.unsupported) await this.call('close').catch(() => {}); this.result = null; }
  async original(cx) {
    if (this.on) { cx.write_to_clipboard(this.path); return; }
    const os = win()?.platform;
    try {
      const r = os === 'macos' ? await exec('open', [this.path]) : os === 'windows' ? await exec('explorer.exe', [this.path]) : await exec('xdg-open', [this.path]);
      if (r.code) throw Error('Could not open the original. Use Copy path to open it in a PDF app.');
    } catch (e) { this.error = String(e.message ?? e); cx.notify(); }
  }
}

export function pdfView(pdf, t, id = 'pdf', embedded = false) {
  const button = (key, label, fn, enabled = true) => div().id(`${id}-${key}`).h(28).px(8).flex().items_center().rounded(5).text_size(12)
    .bg(t.raised).text_color(enabled ? t.foreground : t.dim)
    .when(enabled, e => e.cursor_pointer().hover(s => s.bg(t.hover)))
    .on_click((_e, cx) => { cx.stop_propagation(); if (enabled) fn(cx); cx.notify(); }).child(label);
  const data = pdf.result, size = pdf.size;
  const scale = data ? (pdf.fit ? Math.min((size.width - 24) / data.width, (size.height - 24) / data.height) : pdf.zoom / 2) : 1;
  const width = Math.max(1, Math.round((data?.width ?? 1) * scale)), height = Math.max(1, Math.round((data?.height ?? 1) * scale));
  return v_flex().id(id).min_w(0).min_h(0).when(embedded, e => e.h(540).flex_none()).when(!embedded, e => e.flex_1())
    .child(h_flex().flex_none().min_h(36).gap(4).px(6).items_center().flex_wrap()
      .child(button('prev', '←', cx => pdf.turn(-1, cx), pdf.page > 1))
      .child(div().text_size(12).child(`Page ${pdf.page} / ${pdf.pages || '…'}`))
      .child(button('next', '→', cx => pdf.turn(1, cx), pdf.page < pdf.pages))
      .child(button('out', '−', () => { pdf.fit = false; pdf.zoom = Math.max(.25, pdf.zoom / 1.25); }))
      .child(button('in', '+', () => { pdf.fit = false; pdf.zoom = Math.min(4, pdf.zoom * 1.25); }))
      .child(button('fit', pdf.fit ? 'Fit' : `${Math.round(pdf.zoom * 100)}% · Fit`, () => { pdf.fit = true; }))
      .child(button('reload', 'Reload', cx => pdf.load(cx)))
      .child(button('original', pdf.on ? 'Copy remote path' : 'Open original', cx => cx.spawn(cx => pdf.original(cx)))))
    .child(div().px(8).py(3).text_size(11).text_color(t.dim).child('PDF · read only'))
    .when(Boolean(pdf.error), e => e.child(div().p(10).text_size(12).text_color(t.blocked).child(pdf.error)))
    .child(div().id(`${id}-stage`).flex_1().min_h(0).min_w(0).overflow_x_scrollbar().overflow_y_scrollbar().bg(t.surface)
      .on_size_change((size, cx) => { if (size.width !== pdf.size.width || size.height !== pdf.size.height) { pdf.size = size; cx.notify(); } })
      .child(pdf.busy ? div().p(16).text_size(12).child('Rendering PDF page…') : data && !pdf.error
        ? div().p(12).child(image(data.image.startsWith(appHome() + '/') ? data.image.slice(appHome().length + 1) : data.image).w(width).h(height))
        : div().p(16).text_size(12).child(pdf.error ? (pdf.on ? 'Copy the remote path or open a local copy to preview it.' : 'Use Open original to view this file in a PDF app.') : 'Loading PDF…')));
}
