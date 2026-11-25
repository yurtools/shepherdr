import { appHome, exec, readTextFile } from 'herdr';
import * as fs from 'fs/promises';
import { PREVIEW, canEdit, EDIT_LIMIT } from './core/documents.js';

const missing = e => /not found|cannot start|not installed|no such file|ENOENT/i.test(String(e));
function unavailable() { return Object.assign(Error('Large previews need Python 3 on the file’s machine.'), { unavailable: true }); }

// The helper runs on the file's machine, not on the window's machine with a
// remote pathname. Only the source code, small parameters and bounded replies
// cross the connection. No installation, temporary copy, or persistent cache.
export class PreviewReader {
  constructor(path, on) { this.path = path; this.on = on; }
  async call(op, args = {}) {
    if (this.unavailable) throw unavailable();
    try { this.code ??= await fs.readFile(`${appHome()}/mods/workspace-document/preview-read.py`, 'utf8'); }
    catch (e) { if (missing(e)) { this.unavailable = true; throw unavailable(); } throw e; }
    const request = JSON.stringify({ path: this.path, op, policy: PREVIEW, ...args });
    const run = command => exec(command, ['-c', this.code, request], { on: this.on, timeout: PREVIEW.timeout });
    let r;
    if (this.python) r = await run(this.python);
    else {
      // Python 3 is named python on some Windows installations. Only retry a
      // missing/unusable interpreter, not errors returned by the reader.
      try { r = await run('python3'); } catch (e) { if (!missing(e)) throw e; }
      if (!r || (r.code && !r.stdout.trim().startsWith('{'))) {
        try { r = await run('python'); } catch (e) { if (!missing(e)) throw e; }
        if (!r || (r.code && !r.stdout.trim().startsWith('{'))) { this.unavailable = true; throw unavailable(); }
        this.python = 'python';
      } else this.python = 'python3';
    }
    let out;
    try { out = JSON.parse(r.stdout); } catch { throw Error('Preview reader did not return a complete response. Reload or open the original.'); }
    if (r.code || out.error) throw Error(out.error || 'Cannot read preview.');
    return out;
  }
  async open() {
    // The reader checks size BEFORE reading; only full, valid small UTF-8 files
    // can become editable buffers. On hosts without Python retain the native
    // text API's existing (1 MiB, complete-read-or-error) small-file behavior.
    try { return await this.call('open'); }
    catch (e) { if (!e.unavailable) throw e; }
    let text;
    try { text = await readTextFile(this.path, { on: this.on }); }
    catch (e) { throw Error(`${e.message ?? e}. Large previews need Python 3 on the file’s machine.`); }
    if (text === null) throw Error('File is no longer available');
    if (typeof text === 'string' && text.includes('\0')) throw Error('Binary file. Open the original in an appropriate app.');
    if (canEdit(text)) return { text };
    throw Error(`${EDIT_LIMIT} Larger previews need Python 3 on the file’s machine.`);
  }
}
