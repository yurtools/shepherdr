// Small, text-only subset of Mermaid flowcharts. The renderer accepts data,
// never Mermaid directives, HTML, CSS, callbacks, links or external resources.
// Dagre is the same pinned, DOM-free layout engine in both Chat clients.
import dagre from './vendor/dagre.js';

export const FLOW_LIMITS = Object.freeze({ source: 4000, nodes: 20, edges: 28, label: 100, extent: 3600, points: 240, sourceLines: 120, perMessage: 12 });
export const FLOW_WORDS = Object.freeze({
  source: 'Show source', preview: 'Show preview',
  incomplete: 'Preview waits for a closing fence.',
  unsupported: 'This Mermaid syntax is not supported in Chat. Edit or copy the source below.',
  invalid: 'Could not read this flowchart. Check the syntax or copy the source below.',
  large: 'This flowchart is too large to preview. Copy the source to view it elsewhere.',
  many: 'This message has too many diagrams to preview them all. Copy the source below.',
  scroll: 'Scroll to see the rest of the diagram.',
  shortened: 'Source display shortened. Copy gets the full source.',
});

const fail = reason => { throw reason; };
const space = s => s.replace(/^\s+/, '');
const SHAPES = [
  ['([', '])', 'pill'], ['((', '))', 'circle'], ['[[', ']]', 'subroutine'],
  ['[(', ')]', 'database'], ['{{', '}}', 'hexagon'], ['[', ']', 'rect'],
  ['(', ')', 'round'], ['{', '}', 'diamond'],
];
const ARROWS = [
  ['<-->', 'solid', true, true], ['-.->', 'dotted', true, false],
  ['==>', 'thick', true, false], ['-->', 'solid', true, false],
  ['-.-', 'dotted', false, false], ['===', 'thick', false, false],
  ['---', 'solid', false, false],
];

function label(value) {
  let s = value.trim();
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) fail('invalid');
    s = s.slice(1, -1);
  } else if (s.includes('"')) fail('invalid');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  if (s.length > FLOW_LIMITS.label) fail('large');
  if (/[<>\x00-\x09\x0b-\x1f]/.test(s)) fail('unsupported');
  if (!s.trim()) fail('invalid');
  return s;
}

// Split at semicolons/newlines only outside quoted labels, shapes and |edge labels|.
// No nesting of arbitrary expressions, JSON objects, or directives.
function statements(source) {
  const out = [];
  let st = '', quoted = false, pipe = false, shape = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (!quoted && !pipe && !shape && source.startsWith('%%', i)) {
      if (source.startsWith('%%{', i)) fail('unsupported');
      while (i + 1 < source.length && source[i + 1] !== '\n') i++;
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (!quoted) {
      if (shape && source.startsWith(shape, i)) {
        st += shape; i += shape.length - 1; shape = null; continue;
      }
      if (!shape && c === '|') pipe = !pipe;
      if (!shape && !pipe) {
        const found = SHAPES.find(s => source.startsWith(s[0], i));
        if (found) { shape = found[1]; st += found[0]; i += found[0].length - 1; continue; }
        if (c === '\n' || c === ';') {
          if (st.trim()) out.push(st.trim());
          st = ''; continue;
        }
      }
    }
    st += c;
  }
  if (quoted || shape || pipe) fail('invalid');
  if (st.trim()) out.push(st.trim());
  return out;
}

function parse(source) {
  if (source.length > FLOW_LIMITS.source) fail('large');
  const lines = statements(source.replace(/\r\n/g, '\n'));
  const header = /^(?:flowchart|graph)(?:\s+(TD|TB|BT|LR|RL))?\s*$/.exec(lines.shift() ?? '');
  if (!header) fail('unsupported');
  const nodes = new Map(), edges = [];
  function node(rest) {
    rest = space(rest);
    // A hyphen inside an identifier is fine, but not the beginning of an arrow.
    const id = /^[\p{L}\p{N}_][\p{L}\p{N}_]*(?:-[\p{L}\p{N}_]+)*/u.exec(rest)?.[0];
    if (!id || id.length > 100 || /^(?:click|style|class|classDef|linkStyle|subgraph|end|direction|accTitle|accDescr)$/i.test(id)) fail('unsupported');
    rest = space(rest.slice(id.length));
    const shape = SHAPES.find(s => rest.startsWith(s[0]));
    let entry = nodes.get(id);
    if (!entry) {
      if (nodes.size >= FLOW_LIMITS.nodes) fail('large');
      entry = { id, label: id, shape: 'rect' };
      nodes.set(id, entry);
    }
    if (shape) {
      let end = -1, quoted = false;
      for (let i = shape[0].length; i < rest.length; i++) {
        if (rest[i] === '"') quoted = !quoted;
        if (!quoted && rest.startsWith(shape[1], i)) { end = i; break; }
      }
      if (end < 0) fail('invalid');
      entry.label = label(rest.slice(shape[0].length, end));
      entry.shape = shape[2];
      rest = space(rest.slice(end + shape[1].length));
    }
    return { id, rest };
  }
  for (const line of lines) {
    let from = node(line);
    while (from.rest) {
      const arrow = ARROWS.find(a => from.rest.startsWith(a[0]));
      // Mermaid also allows "A -- words --> B".
      const alt = !arrow && /^--\s+(.+?)\s+-->\s*/.exec(from.rest);
      if (!arrow && !alt) fail('unsupported');
      const [token, style, end, start] = arrow || [alt[0], 'solid', true, false];
      let rest = space(from.rest.slice(token.length)), words = alt ? label(alt[1]) : '';
      if (rest.startsWith('|')) {
        const close = rest.indexOf('|', 1);
        if (close < 0 || words) fail('invalid');
        words = label(rest.slice(1, close)); rest = space(rest.slice(close + 1));
      }
      if (!rest) fail('invalid');
      const to = node(rest);
      if (edges.length >= FLOW_LIMITS.edges) fail('large');
      edges.push({ from: from.id, to: to.id, label: words, style, end, start });
      from = to;
    }
  }
  if (!nodes.size) fail('invalid');
  return { direction: !header[1] || header[1] === 'TD' ? 'TB' : header[1], nodes: [...nodes.values()], edges };
}

// Wrap at word boundaries when possible. Keep fixed, generous text metrics so
// the native and web drawings have the same boxes even with different fonts.
function labelLines(text, max = 19) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let chars = [...paragraph];
    while (chars.length > max) {
      const split = chars.slice(0, max + 1).lastIndexOf(' ');
      const n = split > max / 2 ? split : max;
      lines.push(chars.slice(0, n).join(''));
      chars = chars.slice(n);
      if (chars[0] === ' ') chars.shift();
    }
    lines.push(chars.join(''));
  }
  return lines;
}

export const FLOW_FONT = 13, FLOW_LINE = 18;
const textWidth = lines => Math.max(1, ...lines.map(s => [...s].reduce((n,c) => n + (c.codePointAt(0) > 255 ? 14 : 8), 0)));
const point = p => ({ x: p.x, y: p.y });
function shapePoint(n, p) {
  const dx = p.x - n.x, dy = p.y - n.y;
  if (!dx && !dy) return p;
  if (n.shape === 'diamond') {
    const scale = 1 / (Math.abs(dx) / (n.width / 2) + Math.abs(dy) / (n.height / 2));
    return { x: n.x + dx * scale, y: n.y + dy * scale };
  }
  if (n.shape === 'circle') {
    const scale = 1 / Math.hypot(dx / (n.width / 2), dy / (n.height / 2));
    return { x: n.x + dx * scale, y: n.y + dy * scale };
  }
  return p;
}

function layout(parsed) {
  // Internal numeric names are independent of identifiers in untrusted text.
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: parsed.direction, ranker: 'longest-path', nodesep: 26, ranksep: 46, edgesep: 16, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Map(parsed.nodes.map((n,i) => [n.id, String(i)]));
  parsed.nodes.forEach(n => {
    const lines = labelLines(n.label);
    let width = Math.max(74, textWidth(lines) + 28), height = Math.max(42, lines.length * FLOW_LINE + 20);
    if (n.shape === 'diamond') { width *= 1.65; height *= 1.8; }
    if (n.shape === 'circle') width = height = Math.hypot(width, height);
    if (n.shape === 'hexagon' || n.shape === 'subroutine') width += 20;
    if (n.shape === 'database') height += 12;
    g.setNode(ids.get(n.id), { ...n, lines, width, height });
  });
  parsed.edges.forEach((e,i) => {
    const lines = e.label ? labelLines(e.label, 15) : [];
    g.setEdge(ids.get(e.from), ids.get(e.to), { ...e, lines, width: lines.length ? textWidth(lines) + 8 : 0, height: lines.length * FLOW_LINE + (lines.length ? 6 : 0), labelpos: 'c' }, String(i));
  });
  // Use the fixed initial ordering rather than the iterative crossing
  // minimization heuristic. The bounded graph still gets routed by Dagre;
  // long restored conversations never pay for optimizing every crossing.
  dagre.layout(g,{disableOptimalOrderHeuristic:true});
  const nodes = g.nodes().map(id => g.node(id));
  const edges = g.edges().map(id => {
    const e = g.edge(id), points = e.points.map(point);
    points[0] = shapePoint(g.node(id.v), points[0]);
    points[points.length-1] = shapePoint(g.node(id.w), points[points.length-1]);
    return { ...e, points };
  });
  const { width, height } = g.graph();
  if (![width,height].every(v => Number.isFinite(v) && v > 0 && v <= FLOW_LIMITS.extent)) fail('large');
  if (nodes.some(n=>![n.x,n.y,n.width,n.height].every(Number.isFinite)) ||
    edges.some(e=>e.lines.length&&![e.x,e.y,e.width,e.height].every(Number.isFinite))) fail('invalid');
  if (edges.reduce((n,e)=>n+e.points.length,0)>FLOW_LIMITS.points ||
    edges.some(e => e.points.length<2 || e.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) fail('large');
  return { width, height, nodes, edges };
}

// The only retained data is a bounded cache of source strings and plain
// geometry. No DOM, files, callbacks, native paths or theme objects are cached.
const cache = new Map();
const CACHE_MAX = 96;
export function flowchart(source, closed = true) {
  if (!closed) return { error: FLOW_WORDS.incomplete };
  if (source.length > FLOW_LIMITS.source) return { error: FLOW_WORDS.large };
  if (cache.has(source)) {
    const found = cache.get(source); cache.delete(source); cache.set(source, found); return found;
  }
  let result;
  try { result = { drawing: layout(parse(source)) }; }
  catch (e) { result = { error: FLOW_WORDS[['large','unsupported','invalid'].includes(e)?e:'invalid'] }; }
  cache.set(source, result);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return result;
}

// Arrowheads are triangles, not executable SVG markers. Both surfaces draw the
// same immutable points with their own theme colors.
export function arrowTriangle(tip, previous) {
  const dx = tip.x - previous.x, dy = tip.y - previous.y, l = Math.hypot(dx, dy);
  if (!l) return [];
  const x = dx/l, y = dy/l;
  return [tip, { x: tip.x-9*x+4*y, y: tip.y-9*y-4*x }, { x: tip.x-9*x-4*y, y: tip.y-9*y+4*x }];
}
export function nodePolygon(n) {
  const x = n.x, y = n.y, w = n.width/2, h = n.height/2;
  if (n.shape === 'diamond') return [{x,y:y-h},{x:x+w,y},{x,y:y+h},{x:x-w,y}];
  if (n.shape === 'hexagon') return [{x:x-w+14,y:y-h},{x:x+w-14,y:y-h},{x:x+w,y},{x:x+w-14,y:y+h},{x:x-w+14,y:y+h},{x:x-w,y}];
  return [];
}
export const FLOW_VIEW_HEIGHT = 420;
export function fitFlowchart(drawing, width) {
  const scale = Math.max(0.85, Math.min(1, Math.max(1,width) / drawing.width));
  return { scale, width: Math.ceil(drawing.width*scale), height: Math.ceil(drawing.height*scale) };
}

export function chartSize(drawing, available) {
  const fit = fitFlowchart(drawing, available);
  const width = Math.min(available, fit.width);
  const height = Math.min(FLOW_VIEW_HEIGHT, fit.height);
  return { ...fit, viewportWidth: width, viewportHeight: height, scroll: fit.width > width || fit.height > height };
}

export function chartHeight(drawing, available) {
  const fit = chartSize(drawing, available);
  return fit.viewportHeight + (fit.scroll ? 22 : 0);
}

// Enormous unsupported diagrams must still copy in full, without creating
// thousands of native text children or huge browser layout work.
export function sourceForDisplay(code) {
  let text = code.slice(0,FLOW_LIMITS.source);
  if (/[\uD800-\uDBFF]$/.test(text)) text=text.slice(0,-1);
  text=text.split('\n').slice(0,FLOW_LIMITS.sourceLines).join('\n');
  return {text, shortened:text!==code};
}
