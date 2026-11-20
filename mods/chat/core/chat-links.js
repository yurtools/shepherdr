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

// The native planner can yield even in one very long row. This recognizes exactly
// hasChatLink's case-sensitive URL prefix / nonempty Markdown label and body,
// retaining partial matches across UTF-16 slices. It never interprets a href.
export function chatLinkScan(text) {
 return {text:String(text??''),at:0,url:0,label:-1,paren:false,body:-1,result:/** @type {boolean|null} */ (null)};
}
export function scanChatLink(s,limit) {
 let count=0;
 while(s.at<s.text.length&&count<limit&&s.result===null){
  const i=s.at++,c=s.text[i];count++;
  if(c==='\n'){s.label=-1;s.paren=false;s.body=-1;}
  else {
   if(s.body>=0&&c===')'&&i>s.body)s.result=true;
   if(s.paren&&c==='('&&s.body<0)s.body=i+1;
   s.paren=false;
   if(c===']'){s.paren=s.label>=0&&i>s.label+1;s.label=-1;}
   else if(c==='['&&s.label<0)s.label=i;
  }
  const u=s.url;
  s.url=u===0?(c==='h'?1:0):u===1?(c==='t'?2:c==='h'?1:0):u===2?(c==='t'?3:c==='h'?1:0):u===3?(c==='p'?4:c==='h'?1:0):u===4?(c==='s'?5:c===':'?6:c==='h'?1:0):u===5?(c===':'?6:c==='h'?1:0):u===6?(c==='/'?7:c==='h'?1:0):(c==='/'?8:c==='h'?1:0);
  if(s.url===8)s.result=true;
 }
 if(s.result===null&&s.at===s.text.length)s.result=false;
 return count;
}
