// Parse Markdown BEFORE attaching search marks. We never insert syntax into
// the source (which changes code spans, emphasis, links, escaping and Copy).
// The native HTML TextView supports <mark color=...> on inline text runs.
import { Marked, Renderer } from './vendor/marked.js';
import ENTITY from './vendor/html-entities.js';
import { escapeHtml, findSpans, literalRanges, FIND_LIMITS, FIND_BLOCK } from './chat-find.js';

// Markdown's generated tags are not text. A block starts a new searchable
// run; nested inline styles don't. Quoted attributes may contain > and <.
const TAG = /<!--[\s\S]*?-->|<\/?[a-zA-Z][\w:-]*(?:"[^"]*"|'[^']*'|[^'">])*?>/g;

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (whole, name) => {
    if (name[0] !== '#') return Object.hasOwn(ENTITY,name) ? ENTITY[name] : whole;
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
  });
}

// Native's Markdown renderer does not run arbitrary HTML. Don't introduce new
// HTML behavior by switching to an HTML TextView while searching. Ordinary
// generated Markdown formatting is kept, and known safe inline tags survive.
const renderer = new Renderer();
renderer.html = ({ text }) => /^<\/?(?:strong|b|em|i|s|del|u|mark|br)\s*\/?\s*>$/i.test(text) ? text : '';
const parser = new Marked({ gfm: true, breaks: false, renderer });

export function markdownProjection(value) {
  const text = String(value ?? '');
  const source = text.slice(0, FIND_LIMITS.chars);
  // Bound pathological rows before parsing. The original row is still kept.
  try {return htmlProjection(parser.parse(source),text.length>source.length);}
  catch {return {html:'',parts:[],groups:[],limited:true};}
}

function htmlProjection(html,limited=false) {
  const parts = [], groups = []; let group = null, at = 0;
  const words = raw => {
    if (!raw) return;
    const decoded = decode(raw);
    if (!group && !decoded.trim()) { parts.push({ raw }); return; }
    if (!group) { group = { text: '', index: groups.length }; groups.push(group); }
    parts.push({ raw, text: decoded, group: group.index, offset: group.text.length });
    group.text += decoded;
  };
  for (const m of html.matchAll(TAG)) {
    words(html.slice(at, m.index));
    const tag = /^<\/?([\w:-]+)/.exec(m[0])?.[1];
    if (tag && FIND_BLOCK.test(tag)) group = null;
    parts.push({raw:m[0]}); at = m.index + m[0].length;
  }
  words(html.slice(at));
  return { html, parts, groups, limited };
}
/** @param {number} [limit] */
export function markdownRanges(projection, q, limit = FIND_LIMITS.matches) {
  const hits = []; let limited = projection.limited;
  for (const group of projection.groups) {
    if(hits.length>=limit){limited=true;break;}
    const got = literalRanges(group.text, q, Math.max(0, limit - hits.length));
    limited ||= got.limited;
    for (const r of got.ranges) hits.push({ ...r, part: group.index, text: group.text });
  }
  return { hits, limited };
}
export function markedHtml(projection, hits, colors, active = null) {
  const by = new Map();
  for (const h of hits) { if (!by.has(h.part)) by.set(h.part, []); by.get(h.part).push(h); }
  return projection.parts.map(p => {
    const ranges = by.get(p.group);
    if (!ranges) return p.raw;
    const spans=findSpans(p.text,ranges,p.offset);
    if(!spans.some(span=>span.match))return p.raw;
    return spans.map(span => {
      const text = escapeHtml(span.text);
      if (!span.match) return text;
      const color = span.match === active ? colors.active : colors.match;
      return `<mark color="${color}">${text}</mark>`;
    }).join('');
  }).join('');
}

// A tall native Markdown row can be navigated at real block boundaries. The
// lexer resolves reference links for the entire document first; serialize
// complete parsed blocks, not slices of raw markdown in the middle of a link,
// list, table or inline style. A single giant block still has the exact Find
// context readout (the native list has no offset-in-TextView scroll API).
export function markdownChunks(value, target=1100, q="") {
  const text=String(value??'');
  if(text.length<target||text.length>FIND_LIMITS.chars)return [];
  let tokens;try{tokens=parser.lexer(text);}catch{return [];}
  const out=[];
  // A single unformatted paragraph can be divided at word boundaries while
  // preserving its words and highlights. Avoid bisecting a literal match.
  const real=tokens.filter(t=>t.type!=='space');
  if(real.length===1&&real[0].type==='paragraph'&&real[0].tokens?.every(t=>t.type==='text'||t.type==='escape')){
    const full=htmlProjection(parser.parser(tokens)),plain=full.groups[0]?.text??'';
    if(plain.length<target)return [];
    const ranges=literalRanges(plain,q).ranges;let at=0,hit=0;
    while(at<plain.length){
      let end=Math.min(plain.length,at+target);
      if(end<plain.length){const space=plain.lastIndexOf(' ',end);if(space>at+target/2)end=space+1;if(/[\uD800-\uDBFF]/.test(plain[end-1]))end--;}
      while(hit<ranges.length&&ranges[hit].end<=end)hit++;
      if(hit<ranges.length&&ranges[hit].start<end)end=ranges[hit].end;
      const source=plain.slice(at,end);out.push({source,projection:htmlProjection(`<p>${escapeHtml(source)}</p>`)});at=end;
    }
    return out.length>1?out:[];
  }
  let group=[],length=0;
  const flush=()=>{
    if(!group.length)return;
    const source=group.map(t=>t.raw).join(''),html=parser.parser(group);
    if(html.trim())out.push({source,projection:htmlProjection(html)});
    group=[];length=0;
  };
  for(const token of tokens){
    if(length&&length+token.raw.length>target)flush();
    group.push(token);length+=token.raw.length;
  }
  flush();return out.length>1?out:[];
}
