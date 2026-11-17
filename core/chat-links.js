// Chat hrefs are navigation, never commands. Source locations use one-based lines/columns.
export function chatLink(href, folder = '') {
 let value=String(href??'').trim().replace(/^<|>$/g,'');
 if(/^https?:\/\//i.test(value))return {kind:'web',url:value};
 if(!value||value[0]==='#')return {kind:'unsupported'};
 if(/^file:/i.test(value)){
  const file=/^file:\/\/(?:localhost)?(\/.*)$/i.exec(value);
  if(!file)return {kind:'unsupported'};
  value=file[1];
 }else if(/^[a-z][\w+.-]*:/i.test(value)&&!/^[-\w.]+\.[\w]+:\d+(?::\d+)?$/.test(value))return {kind:'unsupported'};
 let line=null,column=null;
 const at=/(?:#L(\d+)(?:C(\d+))?(?:-L\d+(?:C\d+)?)?|:(\d+)(?::(\d+))?)$/.exec(value);
 if(at){line=Number(at[1]??at[3]);column=Number(at[2]??at[4]??1);value=value.slice(0,at.index);}
 else if(value.includes('#'))value=value.slice(0,value.indexOf('#'));
 try{value=decodeURIComponent(value);}catch{return {kind:'unsupported'};}
 if(value.includes('\0')||/[\r\n]/.test(value)||!value)return {kind:'unsupported'};
 if(!value.startsWith('/')){
  if(!folder||!folder.startsWith('/'))return {kind:'unsupported'};
  value=`${folder}/${value}`;
 }
 const parts=[];
 for(const part of value.split('/')){if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part);}
 const file='/'+parts.join('/');
 return {kind:'file',file,line:line>0?line:null,column:column>0?column:1};
}
export function sourceOffset(text,line,column=1) {
 const lines=String(text??'').split('\n'),index=Math.max(0,Math.min(lines.length-1,Math.trunc(Number(line)||1)-1));
 let offset=0;for(let i=0;i<index;i++)offset+=lines[i].length+1;
 return offset+Math.max(0,Math.min(lines[index].replace(/\r$/,'').length,Math.trunc(Number(column)||1)-1));
}
export function hasChatLink(text) {
 return /\[[^\]\n]+\]\([^\n]+\)|https?:\/\//.test(String(text??''));
}
