"""Local, read-only PDF rasterization. No shell, network, extraction or document writes.

Uses the installed Poppler CLI, one page per subprocess, with time/memory/output limits.
The caller owns a private cache session and removes it on close; old abandoned sessions
are reaped on the next render. This helper also travels with published recipe artifacts.
"""
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import sys
import time

MAX_FILE = 128 * 1024 * 1024
MAX_EDGE = 2000
TIMEOUT = 12


def limits():
    # Poppler runs outside the UI process. POSIX limits also bound hostile page contents.
    try:
        import resource
    except ImportError:
        return
    for kind, value in ((resource.RLIMIT_CPU, 10), (resource.RLIMIT_AS, 768 * 1024 * 1024), (resource.RLIMIT_FSIZE, 20 * 1024 * 1024)):
        try:
            resource.setrlimit(kind, (value, value))
        except (ValueError, OSError):
            pass


def command(argv, output_limit=65536):
    try:
        # Output goes to a bounded file, not an unbounded PIPE held in the UI's memory.
        import tempfile
        with tempfile.TemporaryFile() as out:
            result = subprocess.run(argv, stdout=out, stderr=subprocess.DEVNULL,
                                    timeout=TIMEOUT, env={**os.environ, 'LC_ALL': 'C'},
                                    preexec_fn=limits if os.name == 'posix' else None)
            out.seek(0)
            raw = out.read(output_limit + 1)
            if len(raw) > output_limit:
                raise ValueError('PDF text exceeds the preview output limit.')
            text = raw.decode('utf8', 'replace')
        if result.returncode:
            raise ValueError('PDF could not be read. It may be password-protected, corrupt or unsupported. Open the original in a PDF app.')
        return text
    except FileNotFoundError:
        if argv[0] == 'pdftotext':
            raise ValueError('PDF Find needs Poppler pdftotext on this computer.')
        raise ValueError('PDF preview needs Poppler (pdfinfo and pdftoppm) on this computer. Open the original in a PDF app.')
    except subprocess.TimeoutExpired:
        raise ValueError('This PDF page took too long to preview. Try another page or open the original in a PDF app.')


def fingerprint(path):
    s = path.stat()
    if not stat.S_ISREG(s.st_mode):
        raise ValueError('PDF is not a regular file.')
    if s.st_size > MAX_FILE:
        raise ValueError('PDF preview is limited to 128 MiB. Open the original in a PDF app.')
    return f'{s.st_dev}:{s.st_ino}:{s.st_size}:{s.st_mtime_ns}:{s.st_ctime_ns}'


def search(path, version, req):
    """Poppler's word boxes are in the same rotated MediaBox coordinate
    system used by pdftoppm. Normalize them before crossing into the UI."""
    import xml.etree.ElementTree as ET
    query = req['query']
    if not isinstance(query, str) or not 0 < len(query) <= 256:
        raise ValueError('Find needs 1–256 characters.')
    if req.get('version') != version:
        raise ValueError('PDF changed on disk. Reload preview.')
    limit = min(5000, max(1, int(req['limit'])))
    start = max(1, int(req['page']))
    stop = min(start + 7, int(req['pages']), 100000)
    if stop < start:
        raise ValueError('Invalid PDF Find page.')
    try:
        info = command(['pdfinfo', '-f', str(start), '-l', str(stop), '-box', str(path)])
        raw = command(['pdftotext', '-f', str(start), '-l', str(stop), '-bbox-layout',
                       '-enc', 'UTF-8', str(path), '-'], 8 * 1024 * 1024)
    except ValueError as e:
        raise ValueError(f'PDF text extraction unavailable on pages {start}–{stop}: {e}') from e
    # pdftotext emits XHTML with a fixed public DTD. ElementTree does not
    # resolve external entities; reject internal entity definitions outright.
    if '<!ENTITY' in raw:
        raise ValueError('Unsupported PDF text output.')
    root = ET.fromstring(raw)
    ns = '{http://www.w3.org/1999/xhtml}'
    pages = list(root.iter(ns + 'page'))
    if len(pages) != stop - start + 1:
        raise ValueError('PDF text extraction did not return every requested page.')
    # Poppler emits rotated word coordinates but unrotated page width/height
    # in bbox XML on some versions. Use MediaBox dimensions and rotation
    # explicitly, matching pdftoppm's default (not CropBox).
    rotation = {int(n): int(r) % 360 for n, r in re.findall(r'^Page\s+(\d+)\s+rot:\s+(-?\d+)', info, re.M)}
    media = {}
    for line in info.splitlines():
        m = re.match(r'^Page\s+(\d+)\s+MediaBox:\s+(.*)$', line)
        if m:
            x1, y1, x2, y2 = map(float, m[2].split())
            media[int(m[1])] = (x2 - x1, y2 - y1)
    hits, has_text, box_count = [], False, 0
    parts = {'i': '(?-i:[iI])', 'I': '(?-i:[iI])', 'İ': '(?-i:İ)', 'ı': '(?-i:ı)'}
    pattern = re.compile(''.join(parts.get(ch, re.escape(ch)) for ch in query), re.I)
    for page, el in enumerate(pages, start):
        if page not in rotation or page not in media:
            raise ValueError('PDF page geometry is unavailable.')
        width, height = media[page]
        if rotation[page] in (90, 270):
            width, height = height, width
        if not (width > 0 and height > 0):
            raise ValueError('Invalid PDF text dimensions.')
        words, parts, at = [], [], 0
        for w in el.iter(ns + 'word'):
            text = ''.join(w.itertext())
            if not text:
                continue
            if parts:
                parts.append(' '); at += 1
            x1, y1, x2, y2 = (float(w.get(k)) for k in ('xMin', 'yMin', 'xMax', 'yMax'))
            # A word may extend outside the page. Clip to the visible image.
            rect = [max(0, min(1, v)) for v in (x1 / width, y1 / height, x2 / width, y2 / height)]
            words.append((at, at + len(text), rect))
            parts.append(text); at += len(text)
        has_text |= bool(words)
        first = 0
        for m in pattern.finditer(''.join(parts)):
            while first < len(words) and words[first][1] <= m.start():
                first += 1
            boxes = []
            for j in range(first, len(words)):
                a, b, box = words[j]
                if a >= m.end():
                    break
                if b > m.start():
                    boxes.append(box)
            if len(hits) == limit or box_count + len(boxes) > 12000:
                if fingerprint(path) != version:
                    raise ValueError('PDF changed on disk. Reload preview.')
                return {'hits': hits, 'limited': True, 'done': True, 'hasText': has_text, 'version': version}
            hits.append({'page': page, 'boxes': boxes}); box_count += len(boxes)
    if fingerprint(path) != version:
        raise ValueError('PDF changed on disk. Reload preview.')
    return {'hits': hits, 'next': stop + 1, 'done': stop >= int(req['pages']), 'hasText': has_text, 'version': version}


def preview(req):
    root = Path(req['root']).absolute()
    token = req['token']
    if not re.fullmatch(r'[a-zA-Z0-9-]{8,100}', token):
        raise ValueError('Invalid PDF cache session.')
    cache = root / token
    if req['op'] == 'close':
        if cache.is_dir() and not cache.is_symlink():
            shutil.rmtree(cache)
        return {}
    path = Path(req['path']).absolute()
    version = fingerprint(path)
    if req['op'] == 'stat':
        return {'version': version}
    if req['op'] == 'find':
        return search(path, version, req)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    for old in root.iterdir():
        if old.is_dir() and not old.is_symlink() and re.fullmatch(r'[a-zA-Z0-9-]{8,100}', old.name) and time.time() - old.stat().st_mtime > 86400:
            shutil.rmtree(old, ignore_errors=True)
    if not cache.exists() and len(list(root.iterdir())) >= 32:
        raise ValueError('Too many PDF previews are open. Close a preview and retry.')
    cache.mkdir(mode=0o700, exist_ok=True)
    if cache.is_symlink():
        raise ValueError('Invalid PDF cache folder.')
    os.utime(cache, None)
    info = command(['pdfinfo', str(path)])
    if re.search(r'^Encrypted:\s+yes', info, re.M):
        raise ValueError('Password-protected PDFs cannot be previewed here. Open the original in a PDF app.')
    match = re.search(r'^Pages:\s+(\d+)', info, re.M)
    if not match or not 1 <= int(match[1]) <= 100000:
        raise ValueError('PDF page count is unsupported. Open the original in a PDF app.')
    pages = int(match[1])
    page = min(pages, max(1, int(req.get('page', 1))))
    # Keep only the last successful page while its replacement is being rendered.
    for old in cache.glob('*.png'):
        if old.name != req.get('keep'):
            old.unlink()
    import uuid
    output = cache / uuid.uuid4().hex
    image = output.with_suffix('.png')
    try:
        command(['pdftoppm', '-f', str(page), '-l', str(page), '-singlefile',
                 '-scale-to', str(MAX_EDGE), '-png', str(path), str(output)])
        with image.open('rb') as f:
            header = f.read(24)
        if header[:8] != b'\x89PNG\r\n\x1a\n':
            raise ValueError('PDF renderer produced no readable page.')
        width, height = struct.unpack('>II', header[16:24])
        if not (0 < width <= MAX_EDGE and 0 < height <= MAX_EDGE):
            raise ValueError('PDF page exceeds preview dimensions.')
        if fingerprint(path) != version:
            raise ValueError('PDF changed while rendering. Reload the preview.')
        return {'version': version, 'pages': pages, 'page': page,
                'image': str(image), 'width': width, 'height': height}
    except Exception:
        image.unlink(missing_ok=True)
        raise


if __name__ == '__main__':
    try:
        print(json.dumps(preview(json.loads(sys.argv[1]))))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
