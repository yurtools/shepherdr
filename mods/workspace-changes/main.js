// Multi-repository workspace panel. Diff rendering derived from Herdr Changes (Apache-2.0; LICENSE-herdr).
import { View, div } from 'gpui-kit';
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from 'gpui-base';
import { spaces, shared, exec, readTextFile, appHome, theme, settings } from 'herdr';
import { projectFolder } from './project-folder.js';

const current = () => {
  const space = spaces().find(s => s.active);
  return { space, key: JSON.stringify([space?.id, space?.machine, shared('workspace.roots')?.[space?.id] || space?.folder]) };
};
const fileKey = (root, path) => JSON.stringify([root, path]);
const untab = text => text.replace(/[^\t]*\t/g, s => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map(line => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: '@', text: line }; }
    const kind = line[0];
    if (kind === '-') return { kind, number: old++, text: untab(line.slice(1)) || ' ' };
    if (kind === '+') return { kind, number: next++, text: untab(line.slice(1)) || ' ' };
    if (kind === ' ') { old++; return { kind, number: next++, text: untab(line.slice(1)) || ' ' }; }
    return { kind: '', text: line };
  });
}

export default class WorkspaceChanges extends View {
  init(_props, cx) {
    this.repos = []; this.rows = []; this.roots = []; this.warnings = []; this.diffWidth = 300;
    this.drafts = {}; this.filter = ''; this.collapsed = new Set(); this.request = 0; this.previewRequest = 0;
    this.handle = cx.focus_handle(); this.input = InputState.new({ placeholder: 'Commit message' });
    this.input.on('change', (_e, cx) => { if (!this.restoring && this.filter) { this.drafts[this.filter] = this.input.value(); this.save(); } cx.notify(); });
    this.input.on('submit', (_e, cx) => this.commit(cx));
    this.refresh(cx, true);
    cx.timer.every(10000, cx => this.refresh(cx));
  }
  save() {
    if (!this.stateKey) return;
    localStorage.setItem(this.stateKey, JSON.stringify({ filter: this.filter, collapsed: [...this.collapsed], drafts: this.drafts }));
  }
  restore(key) {
    this.stateKey = `repositories:${key}`;
    let saved; try { saved = JSON.parse(localStorage.getItem(this.stateKey) || '{}'); } catch { saved = {}; }
    this.filter = typeof saved?.filter === 'string' ? saved.filter : '';
    this.collapsed = new Set(Array.isArray(saved?.collapsed) ? saved.collapsed : []);
    this.drafts = saved?.drafts && typeof saved.drafts === 'object' && !Array.isArray(saved.drafts) ? saved.drafts : {};
    this.restoreInput();
  }
  restoreInput() { this.restoring = true; this.input.set_value(this.drafts[this.filter] || ''); this.restoring = false; }
  async backend(context, command, payload = {}) {
    this.source ??= await readTextFile(`${appHome()}/mods/workspace-changes/repositories.py`);
    if (!this.source) throw new Error('Changes helper is missing; reinstall Yurherdr');
    const r = await exec('python3', ['-c', this.source, JSON.stringify({ command, folder: context.folder, ...payload })],
      { on: context.on, timeout: command === 'commit' ? 120000 : 45000 });
    let result; try { result = JSON.parse(r.stdout); } catch { throw new Error(r.stderr || 'Changes requires Python 3 and Git on the space machine'); }
    if (r.code || result.error) throw new Error(result.error || r.stderr || 'Changes operation failed');
    return result;
  }
  valid(context) { return this.context === context && current().key === context.key; }
  refresh(cx, force = false) {
    const { space, key } = current();
    if (this.context?.key !== key) {
      this.save(); this.context = { key, space, on: space?.machine ?? null };
      this.repos = []; this.roots = []; this.warnings = []; this.scanWarnings = []; this.open = null; this.setLines([]);
      this.loading = false; this.error = null; this.note = null; this.picker = false; this.scanned = 0;
      this.previewRequest++; this.restore(key);
    }
    if (!space || this.loading || this.busy) return;
    const context = this.context, request = ++this.request;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const folder = await projectFolder(space);
        // projectFolder publishes persisted roots; re-key before starting an operation on a changed root.
        if (!this.valid(context)) { if (this.context === context) this.loading = false; this.refresh(cx, true); return; }
        if (!folder) { this.error = 'No space folder'; return; }
        if (context.folder && context.folder !== folder) { this.open = null; this.setLines([]); this.scanned = 0; }
        context.folder = folder;
        const scan = force || !this.scanned || Date.now() - this.scanned > 60000;
        const data = await this.backend(context, 'snapshot', scan ? {} : { known: this.roots });
        if (!this.valid(context) || request !== this.request) return;
        if (scan) this.scanWarnings = data.discoveryWarnings || [];
        this.repos = data.repos.sort((a, b) => Number(Boolean(b.count)) - Number(Boolean(a.count)) || a.name.localeCompare(b.name));
        this.roots = data.roots; this.warnings = [...new Set([...this.scanWarnings, ...data.warnings])]; this.error = null;
        if (scan) this.scanned = Date.now();
        if (this.filter && !this.repos.some(r => r.root === this.filter)) { this.filter = ''; this.restoreInput(); this.save(); }
        if (this.open && !this.repos.some(r => r.root === this.open.root && r.files.some(f => f.path === this.open.path))) {
          this.open = null; this.previewRequest++; this.setLines([]);
        }
        if (this.open) await this.load(this.open, context, cx);
      } catch (e) { if (this.valid(context)) this.error = String(e); }
      finally { if (this.context === context && request === this.request) this.loading = false; cx.notify(); }
    });
    cx.notify();
  }
  select(root, cx) {
    if (this.busy) return;
    this.filter = root; this.restoreInput(); this.picker = false; this.note = null;
    if (this.open && root && this.open.root !== root) { this.open = null; this.previewRequest++; this.setLines([]); }
    this.save(); cx.notify();
  }
  setLines(lines) { this.rows = diffRows(lines); this.diffWidth = Math.max(300, ...this.rows.map(r => (r.text.length + 1) * 7 + 50)); }
  async load(file, context, cx) {
    const request = ++this.previewRequest;
    try {
      const data = await this.backend(context, 'diff', file);
      if (this.valid(context) && request === this.previewRequest && this.open?.root === file.root && this.open?.path === file.path) this.setLines(data.lines);
    } catch (e) { if (this.valid(context) && request === this.previewRequest) this.setLines([String(e)]); }
    cx.notify();
  }
  pick(root, path, cx) {
    const file = { root, path }; this.open = file; this.setLines(['Loading diff…']);
    const context = this.context; cx.spawn(cx => this.load(file, context, cx)); cx.notify();
  }
  commit(cx) {
    const context = this.context, root = this.filter, message = this.input.value().trim();
    if (!root || !message || this.busy || this.loading || this.error || !this.valid(context) || !this.repos.some(r => r.root === root && !r.error && r.count)) return;
    this.busy = true; this.note = null;
    cx.spawn(async cx => {
      try {
        const folder = await projectFolder(context.space);
        if (folder !== context.folder || !this.valid(context)) throw new Error('Space folder changed; refresh before committing');
        await this.backend(context, 'commit', { root, message, known: this.roots });
        if (this.valid(context)) {
          // A newer draft typed while a commit runs must survive completion.
          if ((this.drafts[root] || '').trim() === message) { delete this.drafts[root]; if (this.filter === root) this.restoreInput(); }
          this.note = 'Committed ' + root; this.save();
        }
      } catch (e) { if (this.valid(context)) this.note = 'Commit failed: ' + e; }
      finally { this.busy = false; this.refresh(cx, true); cx.notify(); }
    });
    cx.notify();
  }
  button(id, text, click, t, enabled = true) {
    return div().id(id).px(8).py(5).rounded(6).flex_none().bg(t.raised).text_color(enabled ? t.foreground : t.dim)
      .when(enabled, e => e.cursor_pointer().hover(s => s.bg(t.hover)).on_click(click)).child(text);
  }
  listRows() {
    const rows = [];
    for (const repo of this.repos.filter(r => !this.filter || r.root === this.filter)) {
      rows.push({ repo });
      if (!this.collapsed.has(repo.root)) {
        if (repo.error || !repo.count) rows.push({ repo, note: repo.error || 'No uncommitted changes' });
        for (const file of repo.files) rows.push({ repo, file });
      }
    }
    return rows;
  }
  rowKey(row) { return JSON.stringify([row.repo.root, row.file ? 'file' : row.note ? 'note' : 'repo', row.file?.path || '']); }
  activate(key, cx) {
    const row = this.listRows().find(r => this.rowKey(r) === key);
    if (!row || row.note) return;
    if (row.file) { this.pick(row.repo.root, row.file.path, cx); return; }
    if (this.collapsed.has(row.repo.root)) this.collapsed.delete(row.repo.root); else this.collapsed.add(row.repo.root);
    this.save(); cx.notify();
  }
  listRow(row, t, cx) {
    const { repo, file, note } = row;
    if (note) return div().h(28).px(14).text_size(11).text_color(t.dim).truncate().child(note);
    if (!file) return h_flex().h(28).gap(6).items_center().px(8).bg(t.raised)
      .child(div().flex_1().min_w(0).truncate().cursor_pointer()
        .child(`${this.collapsed.has(repo.root) ? '▸' : '▾'} ${repo.name === '.' ? repo.root.split(/[\\/]/).pop() : repo.name} · ${repo.branch} · ${repo.count} files`))
      .child(div().text_size(11).text_color(t.ansi2).child(`+${repo.files.reduce((n, f) => n + f.add, 0)}`))
      .child(div().text_size(11).text_color(t.ansi1).child(`−${repo.files.reduce((n, f) => n + f.del, 0)}`));
    return h_flex().id(fileKey(repo.root, file.path)).h(28).px(12).gap(8).items_center().cursor_pointer()
      .when(this.open?.root === repo.root && this.open?.path === file.path, e => e.bg(t.selected)).hover(s => s.bg(t.hover))
      .child(div().w(14).flex_none().text_color(file.status === 'A' ? t.ansi2 : file.status === 'D' || file.status === 'U' ? t.ansi1 : t.blocked).child(file.status))
      .child(div().flex_1().min_w(0).truncate().child(file.path))
      .when(file.add > 0, e => e.child(div().text_size(11).text_color(t.ansi2).child(`+${file.add}`)))
      .when(file.del > 0, e => e.child(div().text_size(11).text_color(t.ansi1).child(`−${file.del}`)));
  }
  diffRow({ kind, number, text }, t) {
    if (kind === '@') return div().w_full().h(20).px(12).truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).gap(10).when(kind === '+', e => e.bg(t.ansi2 + '18')).when(kind === '-', e => e.bg(t.ansi1 + '18'))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? '' : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }
  render(cx) {
    if (current().key !== this.context?.key) this.refresh(cx);
    const t = theme(), rows = this.listRows(), repo = this.repos.find(r => r.root === this.filter);
    const enabled = Boolean(repo?.count && !repo.error && !this.error && this.input.value().trim() && !this.loading && !this.busy);
    const visible = this.repos.filter(r => !this.filter || r.root === this.filter);
    const files = visible.flatMap(r => r.files), add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
    return v_flex().id('workspace-changes').size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(12).track_focus(this.handle)
      .child(h_flex().h(40).px(10).gap(8).items_center().flex_none()
        .child(div().font_semibold().child('Changes')).child(div().text_color(t.dim).child(`${visible.reduce((n, r) => n + r.count, 0)} files`))
        .child(div().flex_1()).child(div().text_color(t.ansi2).child(`+${add}`)).child(div().text_color(t.ansi1).child(`−${del}`))
        .child(this.button('changes-refresh', this.loading ? 'Refreshing…' : 'Refresh', (_e, cx) => this.refresh(cx, true), t, !this.loading && !this.busy)))
      .child(h_flex().px(10).pb(6).gap(6).items_center().flex_none()
        .child(div().flex_1().min_w(0).truncate().cursor_pointer().on_click((_e, cx) => { this.picker = !this.picker; cx.notify(); })
          .child(`${repo?.name || 'All repositories'} ▾`)).child(div().text_color(t.dim).child(`${this.repos.length} repositories`)))
      .when(this.picker, e => e.child(v_flex().id('changes-repositories').max_h(160).overflow_y_scroll().px(10).pb(6)
        .child(this.button('changes-all', 'All repositories', (_e, cx) => this.select('', cx), t, !this.busy))
        .children(this.repos.map(r => this.button(`repository-${r.root}`, `${r.name} · ${r.branch}`, (_e, cx) => this.select(r.root, cx), t, !this.busy)))))
      .when(Boolean(this.error || this.warnings.length), e => e.child(div().px(10).py(4).text_size(11).text_color(this.error ? t.ansi1 : t.dim).child(this.error || this.warnings.join(' · '))))
      .child(div().flex_1().min_h(54).max_h(Math.max(54, Math.min(300, rows.length * 28))).relative().border_b(1).border_color(t.border)
        .child(div().absolute().inset_0().child(v_virtual_list('changes-repo-files', rows.length, 28, i => this.rowKey(rows[i]),
          range => rows.slice(range.start, range.end).map(r => this.listRow(r, t, cx)))
          .on_item_click((key, cx) => this.activate(key, cx)).size_full()))
        .child(Scrollbar.vertical('changes-repo-files').viewport_from_layout().absolute().inset_0())
        .when(!rows.length, e => e.child(div().p(10).text_color(t.dim).child(this.loading ? 'Discovering repositories…' : this.error ? 'Unable to load repositories' : 'No repositories found in the space folder'))))
      .when(Boolean(this.open), e => e.child(div().px(10).py(4).text_size(11).text_color(t.dim).truncate().child(`${this.open.root} / ${this.open.path}`)))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? 'JetBrains Mono').text_size(11)
        .child(div().id('changes-repo-diff-x').size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list('changes-repo-diff', this.rows.length, 20, i => String(i),
            range => this.rows.slice(range.start, range.end).map(r => this.diffRow(r, t))).size_full())))
        .child(Scrollbar.vertical('changes-repo-diff').viewport_from_layout().absolute().inset_0())
        .when(!this.open, e => e.child(div().absolute().top(6).left(0).px(12).py(8).text_color(t.dim).child('Select a file to view its changes'))))
      .when(Boolean(this.note), e => e.child(div().px(10).py(4).text_size(11).child(this.note)))
      .when(Boolean(repo), e => e.child(div().px(10).py(4).text_size(11).text_color(t.dim).truncate().child('Commit all changes in: ' + repo.root)))
      .child(h_flex().p(10).gap(8).flex_none().border_t(1).border_color(t.border)
        .when(Boolean(repo), e => e.child(div().flex_1().min_w(0).h(32).px(8).flex().items_center().border_1().border_color(t.border).rounded(6)
          .on_mouse_down('left', (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
          .child(this.button('changes-commit', this.busy ? 'Committing…' : 'Commit', (_e, cx) => this.commit(cx), t, enabled)))
        .when(!repo, e => e.child(div().text_color(t.dim).child('Select a repository to commit'))));
  }
}
