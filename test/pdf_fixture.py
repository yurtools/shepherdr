"""Small, nonprivate PDF fixtures using only the standard library."""
def pdf_bytes(pages=2, label='PDF preview'):
    objects = [b'', b'']
    kids = []
    for page in range(1, pages + 1):
        n = len(objects) + 1
        kids.append(f'{n} 0 R')
        text = f'{label} - Page {page}'.replace('(', '').replace(')', '')
        content = (f'0.10 0.35 0.65 rg 48 600 516 130 re f\n'
                   f'1 1 1 rg BT /F1 28 Tf 70 670 Td ({text}) Tj ET\n'
                   f'0.1 0.1 0.1 rg BT /F1 18 Tf 70 550 Td (Readable text and actual page graphics.) Tj ET\n'
                   f'0.85 0.4 0.15 rg 70 {180 + page % 4 * 40} 220 120 re f\n').encode()
        objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents {n+1} 0 R >>'.encode(),
                        f'<< /Length {len(content)} >>\nstream\n'.encode() + content + b'endstream'])
    objects[0] = b'<< /Type /Catalog /Pages 2 0 R >>'
    objects[1] = f'<< /Type /Pages /Count {pages} /Kids [{" ".join(kids)}] >>'.encode()
    out = b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(out)); out += f'{index} 0 obj\n'.encode() + obj + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()
    out += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    return out + f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
