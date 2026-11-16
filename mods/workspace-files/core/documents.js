// Pure document rules shared by the native file tree, document pane and tests.
export const MAX_TEXT = 400000;
export function language(path) {
  const name = path.split(/[\\/]/).pop().toLowerCase(), ext = name.split('.').pop();
  if (/^(dockerfile|containerfile)(\.|$)/.test(name)) return 'dockerfile';
  if (/^(\.bashrc|\.bash_profile|\.profile)$/.test(name)) return 'bash';
  return ({ sh: 'bash', bash: 'bash', zsh: 'bash', java: 'java', md: 'markdown', markdown: 'markdown',
    yml: 'yaml', yaml: 'yaml', tpl: 'gotmpl', gotmpl: 'gotmpl', ts: 'typescript', tsx: 'tsx', jsx: 'jsx',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript', html: 'html', htm: 'html', css: 'css', scss: 'css', xml: 'xml', xsd: 'xml', xsl: 'xml', svg: 'xml', sql: 'sql', tf: 'hcl', tfvars: 'hcl', hcl: 'hcl', json: 'json', py: 'python', rs: 'rust', jsonc: 'json', txt: 'text', csv: 'text', tsv: 'text' })[ext] ?? ext;
}
export function documentKind(path) {
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
  const first = text.split(/\r?\n/, 1)[0];
  let quote = false; const count = { ',': 0, ';': 0, '\t': 0 };
  for (let i = 0; i < first.length; i++) {
    if (first[i] === '"') { if (quote && first[i + 1] === '"') i++; else quote = !quote; }
    else if (!quote && first[i] in count) count[first[i]]++;
  }
  return Object.keys(count).sort((a, b) => count[b] - count[a])[0];
}
export function parseCSV(text, delimiter = ',', maxRows = 500, maxCols = 100) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quote = false, limited = false;
  const field = () => { if (row.length < maxCols) row.push(cell); else limited = true; cell = ''; };
  const record = () => { field(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quote || cell.length === 0) quote = !quote;
      else cell += c;
    } else if (!quote && c === delimiter) field();
    else if (!quote && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record();
      if (rows.length >= maxRows) { limited ||= i < text.length - 1; break; }
    } else cell += c;
  }
  if (rows.length < maxRows && (cell || row.length)) record();
  return { rows, limited, error: quote && !limited ? 'Unclosed quoted field' : null };
}
