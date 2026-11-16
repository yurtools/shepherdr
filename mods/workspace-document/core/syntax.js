// Small deterministic lexical highlighter for the source pane. It never evaluates source.
// Native editing remains available; this view guarantees colors without host grammar packages.
const COMMON = 'if else for while do switch case default break continue return try catch finally throw throws new class interface enum extends implements import export from as const let var function async await yield public private protected static final void package synchronized abstract native transient volatile instanceof this super true false null undefined nulls not and or in is def lambda with pass raise except elif None True False self async await nonlocal global assert del print echo fi then esac done local source select insert update delete into values create alter drop table join left right inner outer where group order by having limit offset union all distinct set begin end commit rollback grant revoke primary key references constraint index database schema use desc asc exists case when union view procedure declare language returns select case else cast count sum avg string number boolean type namespace readonly keyof infer typealias constructor get module require const resource data variable output provider terraform locals module dynamic provisioner connection depends_on count for_each lifecycle null sensitive default description validation required_version required_providers backend'.split(/\s+/);
const WORDS = new Set(COMMON);
export const HIGHLIGHT_LANGUAGES = new Set(['html','css','javascript','typescript','tsx','jsx','java','sql','bash','xml','json','yaml','gotmpl','helm','python','hcl','dockerfile']);
export function syntaxTokens(source, lang) {
 const sql = lang === 'sql', markup = ['html','xml','jsx','tsx'].includes(lang), hash = ['bash','python','yaml','hcl','dockerfile','helm','gotmpl'].includes(lang);
 const comments = [
  ...(markup ? ['<!--[\\s\\S]*?(?:-->|$)'] : []),
  ...(!['bash','python','yaml','json'].includes(lang) ? ['/\\*[\\s\\S]*?(?:\\*/|$)','//[^\\n]*'] : []),
  ...(sql ? ['--[^\\n]*'] : []), ...(hash ? ['#[^\\n]*'] : []),
 ];
 const common = /\{\{[\s\S]*?(?:\}\}|$)|(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`)|<\/?[A-Za-z][\w:.-]*|#[0-9a-fA-F]{3,8}\b|\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b[A-Za-z_$][\w$-]*\b|[{}()[\];,.<>:=+*/%!&|?~-]/;
 const re = new RegExp([...comments,common.source].join('|'),'g');
 const out=[]; let end=0, m;
 while ((m=re.exec(source))) {
  if (m.index>end) out.push({text:source.slice(end,m.index),kind:'plain'});
  const text=m[0], lower=text.toLowerCase(); let kind='plain';
  if (text.startsWith('<!--') || text.startsWith('/*') || text.startsWith('//') && !['bash','python'].includes(lang) || text.startsWith('--') && sql || text.startsWith('#') && hash) kind='comment';
  else if (text.startsWith('{{')) kind='keyword';
  else if (/^["'`]/.test(text)) kind='string';
  else if (/^<\/?[A-Za-z]/.test(text) && markup) kind='keyword';
  else if (/^\d/.test(text) || lang==='css' && /^#[\da-fA-F]+$/.test(text)) kind='number';
  else if (lang==='css' && /^[A-Za-z_-]/.test(text) && /^\s*:/.test(source.slice(re.lastIndex,re.lastIndex+30))) kind='keyword';
  else if (WORDS.has(sql ? lower : text) || lang==='dockerfile' && WORDS.has(lower)) kind='keyword';
  else if (/^[A-Za-z_$]/.test(text) && /^\s*\(/.test(source.slice(re.lastIndex,re.lastIndex+30))) kind='function';
  else if (/^[A-Z][A-Za-z0-9_]+$/.test(text)) kind='type';
  else if (/^[{}()[\];,.<>:=+*/%!&|?~-]$/.test(text)) kind='operator';
  out.push({text,kind}); end=re.lastIndex;
 }
 if(end<source.length)out.push({text:source.slice(end),kind:'plain'});
 return out;
}
export function highlightedLines(text, lang, limit=12000) {
 const lines=[[]]; let limited=false;
 for (const token of syntaxTokens(text,lang)) {
  const parts=token.text.split('\n');
  for(let i=0;i<parts.length;i++) {
   if(parts[i])lines[lines.length-1].push({kind:token.kind,text:parts[i].replace(/\t/g,'    ').replace(/\r$/,'')});
   if(i<parts.length-1){if(lines.length>=limit){limited=true;return{lines,limited};}lines.push([]);}
  }
 }
 return {lines,limited};
}
