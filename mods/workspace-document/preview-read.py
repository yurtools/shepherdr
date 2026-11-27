"""Bounded file reads for the native Document pane (also sent to remote machines).

Policy comes from core/documents.js. A scan retains only sparse record offsets
and one page, not a second copy of the file. No cache or file writes are needed.
"""
import csv
import codecs
import io
import json
import os
import re
import stat
import sys


def version(s):
    return ':'.join(str(v) for v in (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns))


def regular(s):
    if not stat.S_ISREG(s.st_mode):
        raise ValueError('Preview requires a regular file.')
    return s


def source_page(f, size, page, policy):
    # Align both ends to the preceding UTF-8 character boundary. Adjacent pages
    # therefore cover every byte exactly once, including CRLF and a UTF-8 BOM.
    step = policy['sourceBytes']
    page = max(0, min(page, max(0, (size - 1) // step)))

    def boundary(at):
        for _ in range(3):
            f.seek(at)
            b = f.read(1)
            if not b or b[0] & 0xc0 != 0x80 or at == 0:
                break
            at -= 1
        return at

    start = boundary(page * step) if page else 0
    end = size if (page + 1) * step >= size else boundary((page + 1) * step)
    f.seek(start)
    data = f.read(end - start)
    if b'\0' in data:
        raise ValueError('Binary file. Open the original in an appropriate app.')
    return {'page': page, 'start': start, 'end': end, 'text': data.decode('utf-8')}


def source_open(f, size, policy):
    if size <= policy['editBytes']:
        data = f.read(policy['editBytes'] + 1)
        if len(data) == size:
            if b'\0' in data:
                raise ValueError('Binary file. Open the original in an appropriate app.')
            value = data.decode('utf-8')
            # JS counts UTF-16 code units, including two for supplementary codepoints.
            if len(value.encode('utf-16-le')) // 2 <= policy['editChars']:
                return {'text': value}
    return {'source': source_page(f, size, 0, policy)}


def detect(f, path, policy):
    if path.lower().endswith('.tsv'):
        return '\t'
    f.seek(0)
    # Only the first logical record matters. The record budget below also
    # bounds delimiter detection, even when a quote never closes.
    sample = f.read(policy['recordBytes']).decode('utf-8', errors='ignore')
    if sample.startswith('\ufeff'):
        sample = sample[1:]
    counts = {',': 0, ';': 0, '\t': 0}
    quoted, field_start = False, True
    i = 0
    while i < len(sample):
        ch = sample[i]
        if quoted:
            if ch == '"' and i + 1 < len(sample) and sample[i + 1] == '"':
                i += 1
            elif ch == '"':
                quoted = False
        elif ch == '"' and field_start:
            quoted, field_start = True, False
        elif ch in '\r\n':
            break
        elif ch in counts:
            counts[ch] += 1
            field_start = True
        else:
            field_start = False
        i += 1
    return max(counts, key=counts.get)


class RecordLines:
    """Feed csv.reader bounded physical lines, including embedded CR/LF.

    TextIOWrapper.readline (not its iterator) keeps tell/seek available. The
    logical byte budget is reset for each record, not for each physical line.
    A 256 KiB record also bounds the allocation of csv.reader for wide rows.
    """
    def __init__(self, stream, policy, first):
        self.stream = stream
        self.limit = policy['recordBytes']
        self.budget = self.limit
        self.remaining = policy['csvBytes']
        self.first = first

    def __iter__(self):
        return self

    def __next__(self):
        line = self.stream.readline(min(self.budget, self.remaining) + 1)
        if not line:
            raise StopIteration
        n = len(line.encode('utf-8'))
        if n > self.remaining:
            raise ValueError('CSV grew beyond the scan limit. Reload preview.')
        if n > self.budget:
            raise ValueError(f'CSV record exceeds {self.limit // 1024} KiB. Use Source or open the original.')
        self.remaining -= n
        self.budget -= n
        if '\0' in line:
            raise ValueError('CSV contains binary data (NUL).')
        if self.first:
            self.first = False
            if line.startswith('\ufeff'):
                line = line[1:]
                if not line:
                    raise StopIteration
        return line

    def record(self, reader):
        self.budget = self.limit
        return next(reader)


def display(row, col, policy):
    limit = policy['cellChars']
    cells = row[col: col + policy['pageCols']]
    return ([v[:limit] + '…' if len(v) > limit else v for v in cells],
            any(len(v) > limit for v in cells))


def table(f, path, size, request, policy):
    if size > policy['csvBytes']:
        raise ValueError(f'Table preview supports files up to {policy["csvBytes"] // (1024 * 1024)} MiB. Source can still be browsed.')
    scanning = request['op'] == 'scan'
    delimiter = request.get('delimiter') or detect(f, path, policy)
    if delimiter not in (',', ';', '\t'):
        raise ValueError('Unsupported delimiter.')
    offset = 0 if scanning else int(request['offset'])
    base = 0 if scanning else request['base']
    start = 0 if scanning else request['row']
    col = 0 if scanning else request['col']
    if not 0 <= base <= start < policy['csvRows'] or start - base >= policy['indexStride'] or col < 0:
        raise ValueError('Invalid table page.')
    f.seek(0)
    stream = io.TextIOWrapper(f, encoding='utf-8', newline='')
    try:
        stream.seek(offset)
        lines = RecordLines(stream, policy, base == 0)
        csv.field_size_limit(policy['recordBytes'])
        reader = csv.reader(lines, delimiter=delimiter, strict=True)
        rows, offsets = [], []
        total, cols, clipped, limited = base, 0, False, False
        while scanning or total < start + policy['pageRows']:
            if scanning and total % policy['indexStride'] == 0:
                # tell() can be an opaque, larger-than-JS-integer cookie.
                offsets.append(str(stream.tell()))
            try:
                row = lines.record(reader)
            except StopIteration:
                break
            if total == policy['csvRows']:
                limited = True
                break
            row = row or ['']
            cols = max(cols, len(row))
            if start <= total < start + policy['pageRows']:
                cells, shortened = display(row, col, policy)
                rows.append(cells)
                clipped |= shortened
            total += 1
        return {'delimiter': delimiter, 'row': start, 'col': col, 'rows': rows, 'clipped': clipped,
                **({'total': total, 'cols': cols, 'offsets': offsets, 'limited': limited} if scanning else {})}
    finally:
        stream.detach()  # caller still owns f for the version check

def find_request(request):
    query = request['query']
    if not isinstance(query, str) or not 0 < len(query) <= 256:
        raise ValueError('Find needs 1–256 characters.')
    limit = min(5000, max(1, int(request['limit'])))
    # Python's re.I additionally folds dotted and dotless I into ASCII I;
    # match the Unicode-simple literal folding used by JavaScript /giu.
    parts = {'i': '(?-i:[iI])', 'I': '(?-i:[iI])', 'İ': '(?-i:İ)', 'ı': '(?-i:ı)'}
    return re.compile(''.join(parts.get(ch, re.escape(ch)) for ch in query), re.I), limit


def source_find(f, size, req, policy):
    """Read at most 4 MiB plus one query of lookahead; continue at a UTF-8
    boundary, after any match crossing it. Never return duplicate matches."""
    pattern, limit = find_request(req)
    start = int(req.get('start', 0))
    if not 0 <= start <= size:
        raise ValueError('Invalid Find source offset.')
    f.seek(start)
    # Leave enough lookahead for the largest possible UTF-8 query.
    chunk = f.read(min(size - start, 4 * 1024 * 1024 + 1024 + 4))
    cutoff = min(len(chunk), 4 * 1024 * 1024)
    while cutoff < len(chunk) and chunk[cutoff] & 0xc0 == 0x80:
        cutoff += 1
    # Decode strict UTF-8; only an incomplete trailing lookahead character
    # may be deferred. The continuation is always a complete boundary.
    if b'\0' in chunk:
        raise ValueError('Binary file. Find is unavailable.')
    decoder = codecs.getincrementaldecoder('utf-8')()
    value = decoder.decode(chunk, final=start + len(chunk) >= size)
    hits, at, byte = [], 0, start
    for match in pattern.finditer(value):
        byte += len(value[at:match.start()].encode('utf-8'))
        at = match.start()
        if byte >= start + cutoff:
            break
        finish = byte + len(match[0].encode('utf-8'))
        if len(hits) == limit:
            return {'hits': hits, 'limited': True, 'done': True}
        # source_page assigns a character crossing a nominal boundary to
        # the next page, because the boundary is adjusted backwards.
        page = (byte + len(match[0][0].encode('utf-8')) - 1) // policy['sourceBytes']
        hits.append({'start': byte, 'end': finish, 'page': page})
    next_at = max(start + cutoff, hits[-1]['end'] if hits else 0)
    return {'hits': hits, 'next': next_at, 'done': next_at >= size}


def table_find(f, path, size, req, policy):
    pattern, limit = find_request(req)
    if size > policy['csvBytes']:
        raise ValueError('Table Find is limited to 32 MiB. Choose Source to search the original.')
    delimiter = req.get('delimiter') or detect(f, path, policy)
    if delimiter not in (',', ';', '\t'):
        raise ValueError('Unsupported delimiter.')
    base = int(req.get('row', 0))
    offset = int(req.get('offset', '0'))
    if not 0 <= base <= policy['csvRows']:
        raise ValueError('Invalid Find record offset.')
    stream = io.TextIOWrapper(f, encoding='utf-8', newline='')
    try:
        stream.seek(offset)
        lines = RecordLines(stream, policy, base == 0)
        csv.field_size_limit(policy['recordBytes'])
        reader = csv.reader(lines, delimiter=delimiter, strict=True)
        hits, row = [], base
        while row - base < 65536 and policy['csvBytes'] - lines.remaining < 4 * 1024 * 1024:
            try:
                record = lines.record(reader)
            except StopIteration:
                return {'hits': hits, 'done': True}
            if row >= policy['csvRows']:
                return {'hits': hits, 'done': True, 'limited': True}
            for col, cell in enumerate(record):
                for match in pattern.finditer(cell):
                    if len(hits) == limit:
                        return {'hits': hits, 'done': True, 'limited': True}
                    hit = {'row': row, 'col': col}
                    # The active snippet's offsets are UTF-16 for the UI.
                    # When no excerpt is needed, the prefix is at most 11 chars.
                    if match.start() < 12:
                        hit['start'] = len(cell[:match.start()].encode('utf-16-le')) // 2
                    if match.start() >= 12 or match.end() > policy['cellChars'] or len(cell) > policy['cellChars']:
                        left = max(0, match.start() - 2)
                        right = left + policy['cellChars']
                        hit['excerpt'] = ('…' if left else '') + cell[left:right] + ('…' if right < len(cell) else '')
                        hit['excerptOffset'] = len(cell[left:match.start()].encode('utf-16-le')) // 2 + bool(left)
                    hits.append(hit)
            row += 1
        return {'hits': hits, 'row': row, 'offset': str(stream.tell()), 'done': False}
    finally:
        stream.detach()


def read(request):
    path, policy = request['path'], request['policy']
    before = regular(os.stat(path))
    current = version(before)
    if request.get('version') and request['version'] != current:
        raise ValueError('File changed on disk. Reload preview.')
    op = request['op']
    if op == 'stat':
        return {'version': current, 'size': before.st_size}
    # O_NONBLOCK avoids hanging if the path is replaced with a FIFO between
    # stat and open. fstat/version checks reject replacements and racing writes.
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(fd, 'rb') as f:
        if version(regular(os.fstat(f.fileno()))) != current:
            raise ValueError('File changed on disk. Reload preview.')
        size = before.st_size
        if op == 'open':
            out = source_open(f, size, policy)
        elif op == 'source':
            out = {'source': source_page(f, size, request['page'], policy)}
        elif op == 'find-source':
            out = source_find(f, size, request, policy)
        elif op == 'find-table':
            out = table_find(f, path, size, request, policy)
        elif op in ('scan', 'table'):
            out = table(f, path, size, request, policy)
        else:
            raise ValueError('Unknown preview operation.')
        if version(os.fstat(f.fileno())) != current or version(os.stat(path)) != current:
            raise ValueError('File changed on disk. Reload preview.')
    return {**out, 'version': current, 'size': size}


if __name__ == '__main__':
    try:
        result = read(json.loads(sys.argv[1]))
        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))
    except (OSError, ValueError, csv.Error) as error:
        message = 'File is not valid UTF-8 text.' if isinstance(error, UnicodeDecodeError) else str(error)
        sys.stdout.buffer.write(json.dumps({'error': message}).encode('utf-8'))
        sys.exit(1)
