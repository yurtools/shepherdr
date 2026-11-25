// Pure document rules shared by the native file tree, document pane and tests.
// The native host's guarded text API has a 1 MiB read limit. Keep full-buffer
// editing separate from file browsing. The same policy is sent to the Python
// reader on local/remote machines; there is no second set of disk limits.
export const PREVIEW = Object.freeze({
  editChars: 400000, editBytes: 1024 * 1024,
  sourceBytes: 32 * 1024,
  markdownChars: 32 * 1024, markdownLines: 500,
  highlightChars: 64 * 1024, highlightLines: 12000, highlightLineChars: 2048,
  csvBytes: 32 * 1024 * 1024, csvRows: 2000000, indexStride: 1024,
  recordBytes: 256 * 1024, pageRows: 40, pageCols: 16, cellChars: 160,
  timeout: 20000,
});
export const MAX_TEXT = PREVIEW.editChars;
// The native JS runtime need not provide Intl locale grouping.
export const formatCount = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const formatFileSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MiB (${formatCount(bytes)} bytes)` : `${formatCount(bytes)} bytes`;
export const EDIT_LIMIT = `Full-buffer editing is limited to ${formatCount(MAX_TEXT)} characters (UTF-16 units) and 1 MiB of UTF-8. Larger files have read-only previews.`;
export const TABLE_LIMIT = `Table preview supports UTF-8 files up to ${PREVIEW.csvBytes / 1024 / 1024} MiB and ${formatCount(PREVIEW.csvRows)} records. Source remains available.`;
export const SOURCE_CHANGED = 'File changed on disk. Reload preview.';
export function utf8Bytes(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const n = text.charCodeAt(++i);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return Infinity;
      bytes += 4;
    } else if (c >= 0xdc00 && c <= 0xdfff) return Infinity;
    else bytes += 3;
  }
  return bytes;
}
export function canEdit(text) {
  return typeof text === 'string' && text.length <= PREVIEW.editChars && !text.includes('\0') && utf8Bytes(text) <= PREVIEW.editBytes;
}
export function textExcerpt(text, chars, lines) {
  let end = Math.min(text.length, chars), count = 0;
  const breaks = /\r\n|[\r\n]/g;
  let match;
  const prefix = text.slice(0, end);
  while ((match = breaks.exec(prefix))) {
    if (++count >= lines) { end = match.index; break; }
  }
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]) && end < text.length) end--;
  return { text: text.slice(0, end), limited: end < text.length };
}
export const markdownExcerpt = text => textExcerpt(text, PREVIEW.markdownChars, PREVIEW.markdownLines);
export function language(path) {
  const name = path.split(/[\\/]/).pop().toLowerCase(), ext = name.split('.').pop();
  if (/^(dockerfile|containerfile)(\.|$)/.test(name)) return 'dockerfile';
  if (/^(\.bashrc|\.bash_profile|\.profile)$/.test(name)) return 'bash';
  return ({ sh: 'bash', bash: 'bash', zsh: 'bash', java: 'java', md: 'markdown', markdown: 'markdown',
    yml: 'yaml', yaml: 'yaml', tpl: 'gotmpl', gotmpl: 'gotmpl', ts: 'typescript', tsx: 'tsx', jsx: 'jsx',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript', html: 'html', htm: 'html', css: 'css', scss: 'css', xml: 'xml', xsd: 'xml', xsl: 'xml', svg: 'xml', sql: 'sql', tf: 'hcl', tfvars: 'hcl', hcl: 'hcl', json: 'json', py: 'python', rs: 'rust', jsonc: 'json', txt: 'text', csv: 'text', tsv: 'text' })[ext] ?? ext;
}
export function documentKind(path) {
  if (/\.pdf$/i.test(path)) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?|ico|heic|avif)$/i.test(path)) return 'image';
  if (/\.(docx|doc)$/i.test(path)) return 'docx';
  if (/\.(xlsx|xlsm|xltx|xls|xlsb)$/i.test(path)) return 'excel';
  return /\.(md|markdown)$/i.test(path) ? 'markdown' : /\.(csv|tsv)$/i.test(path) ? 'csv' : 'text';
}
export function fileLocation(space, roots = {}) {
  return { cwd: roots[space?.id] || space?.folder || null, on: space?.machine ?? null, space: space?.id ?? null };
}
export function saveState(doc, disk) {
  if (disk === doc.saved) return doc.text === doc.saved ? 'clean' : 'dirty';
  return doc.text === doc.saved ? 'reload' : 'conflict';
}
export function delimiterFor(text, path = '') {
  if (/\.tsv$/i.test(path)) return '\t';
  let quote = false, fieldStart = true; const count = { ',': 0, ';': 0, '\t': 0 };
  // The first *logical* record may itself contain quoted newlines.
  for (let i = text.startsWith('\uFEFF') ? 1 : 0; i < Math.min(text.length, PREVIEW.recordBytes); i++) {
    const c = text[i];
    if (quote) {
      if (c === '"' && text[i + 1] === '"') i++;
      else if (c === '"') quote = false;
    } else if (c === '"' && fieldStart) { quote = true; fieldStart = false; }
    else if (c === '\r' || c === '\n') break;
    else if (c in count) { count[c]++; fieldStart = true; }
    else fieldStart = false;
  }
  return Object.keys(count).sort((a, b) => count[b] - count[a])[0];
}

// For complete editable buffers (including unsaved changes), visit one record
// at a time, collecting only the requested slice. Larger disk files use the
// out-of-process indexed reader, never this or the native editor.
function visitCSV(text, delimiter, visit) {
  let row = [], cell = '', quote = false, afterQuote = false, started = false;
  let recordStart = 0;
  const begin = text.startsWith('\uFEFF') ? 1 : 0;
  const field = () => { row.push(cell); cell = ''; afterQuote = false; };
  const record = end => {
    if (utf8Bytes(text.slice(recordStart, end)) > PREVIEW.recordBytes) throw Error(`CSV record exceeds ${PREVIEW.recordBytes / 1024} KiB. Use Source or open the original.`);
    field(); const more = visit(row); row = []; started = false; recordStart = end; return more;
  };
  for (let i = begin; i < text.length; i++) {
    const c = text[i];
    if (i - recordStart > PREVIEW.recordBytes) throw Error(`CSV record exceeds ${PREVIEW.recordBytes / 1024} KiB. Use Source or open the original.`);
    started = true;
    if (quote) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quote = false; afterQuote = true; }
      else cell += c;
    } else if (c === delimiter) field();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (record(i + 1) === false) return;
    } else if (afterQuote) throw Error('Unexpected character after closing quote');
    else if (c === '"' && cell.length === 0) quote = true;
    else cell += c;
  }
  if (quote) throw Error('Unclosed quoted field');
  if (started) record(text.length);
}
export function csvPage(text, delimiter, start = 0, col = 0, pageRows = PREVIEW.pageRows, pageCols = PREVIEW.pageCols) {
  const data = { delimiter, row: start, col, rows: [], total: 0, cols: 0, clipped: false, limited: false, error: null };
  if (!canEdit(text)) return { ...data, error: EDIT_LIMIT };
  try {
    visitCSV(text, delimiter, row => {
      if (data.total >= PREVIEW.csvRows) { data.limited = true; return false; }
      data.cols = Math.max(data.cols, row.length);
      if (data.total >= start && data.total < start + pageRows) {
        data.rows.push(row.slice(col, col + pageCols).map(cell => {
          // Count Unicode codepoints like the helper, without expanding every
          // long cell into a second array. Never split a surrogate pair.
          let end = 0, count = 0;
          for (const ch of cell) { if (count++ === PREVIEW.cellChars) break; end += ch.length; }
          if (end < cell.length) { data.clipped = true; return cell.slice(0, end) + '…'; }
          return cell;
        }));
      }
      data.total++;
    });
  } catch (e) { data.error = String(e.message ?? e); data.rows = []; }
  return data;
}
// Compatibility for callers/tests that request a bounded leading table.
export function parseCSV(text, delimiter = ',', maxRows = PREVIEW.pageRows, maxCols = PREVIEW.pageCols) {
  const data = csvPage(text, delimiter, 0, 0, maxRows, maxCols);
  return { rows: data.rows, limited: data.limited || data.total > maxRows || data.cols > maxCols || data.clipped, error: data.error };
}
