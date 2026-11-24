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


def command(argv):
    try:
        # Output goes to a bounded file, not an unbounded PIPE held in the UI's memory.
        import tempfile
        with tempfile.TemporaryFile() as out:
            result = subprocess.run(argv, stdout=out, stderr=subprocess.DEVNULL,
                                    timeout=TIMEOUT, env={**os.environ, 'LC_ALL': 'C'},
                                    preexec_fn=limits if os.name == 'posix' else None)
            out.seek(0)
            text = out.read(65536).decode('utf8', 'replace')
        if result.returncode:
            raise ValueError('PDF could not be read. It may be password-protected, corrupt or unsupported. Open the original in a PDF app.')
        return text
    except FileNotFoundError:
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
