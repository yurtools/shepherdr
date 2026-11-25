// Scan top-level Markdown fences without interpreting their contents. A longer
// fence (including an ordinary code example containing Mermaid) owns everything
// until its matching closing fence. Preserve raw text for ordinary Markdown
// and the person's literal messages; never treat an unclosed fence as a preview.
export function* fencedParts(value) {
  const text = String(value ?? '');
  const lines = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n|$)/gm;
  let at = 0, open = null, m;
  while ((m = lines.exec(text))) {
    const [raw, fence, info] = m;
    if (!open) {
      if (fence[0] === '`' && info.includes('`')) continue;
      if (m.index > at) yield { type: 'md', text: text.slice(at, m.index) };
      open = { at: m.index, start: m.index + raw.length, fence, lang: info.trim() };
    } else if (fence[0] === open.fence[0] && fence.length >= open.fence.length && !info.trim()) {
      const code = text.slice(open.start, m.index).replace(/\r?\n$/, '');
      at = m.index + raw.length;
      yield { type: 'code', lang: open.lang, code, raw: text.slice(open.at, at), closed: true };
      open = null;
    }
  }
  if (open) yield { type: 'code', lang: open.lang, code: text.slice(open.start), raw: text.slice(open.at), closed: false };
  else if (at < text.length) yield { type: 'md', text: text.slice(at) };
}

export const isMermaid = part => part.type === 'code' && part.lang.toLowerCase() === 'mermaid';

// Only Mermaid fences interrupt the original message renderer. In particular a
// user message remains literal text except for the diagram cards.
export function* mermaidParts(text) {
  let plain = '';
  for (const part of fencedParts(text)) {
    if (!isMermaid(part)) { plain += part.type === 'md' ? part.text : part.raw; continue; }
    if (plain) yield { type: 'md', text: plain };
    plain = '';
    yield part;
  }
  if (plain) yield { type: 'md', text: plain };
}
