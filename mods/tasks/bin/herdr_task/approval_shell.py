"""A bounded, non-evaluating shell reader for approval rules.

Literal words, simple parameter references and ordinary pipelines are understood.
None marks a word whose value is dynamic, never a wildcard in a saved pattern.
At other syntax we retain only preceding complete literal words for a future rule;
the complete request cannot be covered by those words. No shell is ever invoked.
"""
import re

ASSIGNMENT = re.compile(r'^[A-Za-z_][A-Za-z_0-9]*=')
PARAMETER = re.compile(r'\$(?:[A-Za-z_][A-Za-z_0-9]*|\{[A-Za-z_][A-Za-z_0-9]*\})')
RESERVED = {'!', 'time', 'if', 'then', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'until', 'select', 'in', '{', '}'}
SHELLS = {'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'}
WRAPPERS = {'env', 'sudo', 'command', 'exec', 'eval', 'nohup', 'nice', 'stdbuf', 'xargs'}


def command_at(words):
 return next((i for i,w in enumerate(words) if not isinstance(w,str) or not ASSIGNMENT.match(w)),len(words))


def prefix_command_at(words):
 """Keep supported literal wrappers/assignments as part of the stored identity."""
 at=command_at(words)
 while at<len(words) and isinstance(words[at],str):
  name=words[at].split('/')[-1]
  if name=='timeout':
   if at+1>=len(words) or not isinstance(words[at+1],str) or not re.fullmatch(r'\d+(?:\.\d+)?[smhd]?',words[at+1]):return len(words)
   at+=2
   if at<len(words) and words[at]=='--':at+=1
  elif name=='env':
   at+=1
   if at<len(words) and words[at]=='--':at+=1
   at+=command_at(words[at:])
   if at<len(words) and isinstance(words[at],str) and words[at].startswith('-'):return len(words)
  else:break
 return at


def unsafe_prefix(words):
 at=prefix_command_at(words);effective=words[at:]
 if not effective or not isinstance(effective[0],str) or not effective[0]:return True
 name=effective[0].split('/')[-1]
 return (name in SHELLS|WRAPPERS|RESERVED or
         (re.fullmatch(r'python(?:[23](?:\.\d+)*)?',name) or name in ('node','nodejs','ruby','perl','php','lua','pwsh','powershell','bun','deno')) and
         (len(effective)<2 or not isinstance(effective[1],str) or effective[1].startswith('-')))


def lex(value):
 """Read words and operators without interpreting any command or expansion.
 Complete literal words before an unsupported boundary remain future-rule inputs.
 """
 groups=[[]];operators=[];terminator=''
 def result(boundary=''):return groups,operators,terminator,boundary
 if isinstance(value,list):
  if not value or not all(isinstance(w,str) and '\x00' not in w for w in value):return result('Invalid argument vector.')
  groups[0]=[(w,bool(ASSIGNMENT.match(w))) for w in value];return result()
 if not isinstance(value,str):return result('This tool has no supported shell command field.')
 word=[];quote=None;start=None;dynamic=False;i=0
 def finish(end):
  nonlocal word,start,dynamic
  if start is not None:groups[-1].append((None if dynamic else ''.join(word),bool(ASSIGNMENT.match(value[start:end]))))
  word=[];start=None;dynamic=False
 while i<len(value):
  c=value[i]
  if c in '\x00\r':return result('Control characters or CR need a separate decision.')
  if quote=="'":
   if c=="'":quote=None
   else:word.append(c)
   i+=1;continue
  if c=='\\':
   if start is None:start=i
   if i+1==len(value):return result('An unfinished escape prevents full command parsing.')
   if value[i+1] in '\n\r\x00':return result('Escaped line continuations need a separate decision.')
   if quote=='"' and value[i+1] not in '$`"\\':word.append(c);i+=1;continue
   word.append(value[i+1]);i+=2;continue
  if c=='$':
   if start is None:start=i
   parameter=PARAMETER.match(value,i)
   if parameter:dynamic=True;i=parameter.end();continue
   if value[i:i+2] in ('$(', '${', "$'", '$"') or i+1<len(value) and value[i+1] in '@*#?$!0123456789-':
    return result('Command substitution or unsupported parameter expansion needs a separate decision.')
   word.append(c);i+=1;continue
  if c=='`':return result('Command substitution needs a separate decision.')
  if quote=='"':
   if c=='"':quote=None
   else:word.append(c)
   i+=1;continue
  if c in ("'",'"'):
   if start is None:start=i
   quote=c;i+=1;continue
  operator=next((op for op in ('&&','||','|&','|',';','\n') if value.startswith(op,i)),None)
  if operator:
   finish(i)
   if not groups[-1]:
    if operator=='\n':i+=1;continue  # Blank lines and binary-operator continuations.
    return result('An empty component command or malformed operator cannot be covered.')
   groups.append([]);operators.append(operator);i+=len(operator);continue
  if c.isspace():finish(i);i+=1;continue
  if c in '&<>()':
   finish(i)
   return result('Redirection or process substitution needs a separate decision.' if c in '<>' else 'Background execution or shell grouping needs a separate decision.')
  if c in '{}*?[]~' or c=='#' and start is None:
   return result('Globbing, comments or other shell expansion needs a separate decision.')
  if start is None:start=i
  word.append(c);i+=1
 if quote:return result('An unfinished quote prevents full command parsing.')
 finish(i)
 if not groups[-1]:
  if operators and operators[-1] in (';','\n'):
   terminator=operators.pop();groups.pop()
  else:return result('An empty command or incomplete trailing operator cannot be covered.')
 return result()


def literal_prefix(value):
 groups,operators,terminator,boundary=lex(value)
 return [w for w,_ in groups[0]] if not boundary and not operators and not terminator and len(groups)==1 and all(w is not None for w,_ in groups[0]) else None


def possible_match(argv,pattern,prefix=False):
 """Conservative intersection with a deny, including unquoted field splitting.
 A dynamic word may yield zero or more tokens. This never produces an allow.
 """
 positions={0}
 for word in argv:
  if prefix and len(pattern) in positions:return True
  if word is None:
   positions=set(range(min(positions),len(pattern)+1))
  else:positions={i+1 for i in positions if i<len(pattern) and word==pattern[i]}
  if not positions:return False
 return len(pattern) in positions


def parse(value,depth=0):
 if depth>8:return {'stages':[],'complete':False,'boundary':'Shell wrapper nesting is too deep.'}
 groups,operators,terminator,boundary=lex(value);stages=[]
 for group in groups:
  argv=[w for w,_ in group];reason='';prefix_boundary='';at=0
  while at<len(group) and group[at][1]:
   if argv[at] is None:reason='A dynamic assignment must keep its literal value before a reusable executable can be identified.';break
   at+=1
  if not reason and (at>=len(argv) or argv[at] is None):reason='Dynamic or missing executable: choose a request with a known literal executable.'
  if not reason and (not argv[at] or argv[at].split('/')[-1] in RESERVED or ASSIGNMENT.match(argv[at])):reason='Shell command identity is ambiguous or reserved.'
  effective=prefix_command_at(argv)
  if not reason and effective<len(argv) and argv[effective] is None:reason='A dynamic executable or wrapper assignment cannot become a literal prefix.'
  if not reason and argv[at].split('/')[-1] in ('sh','bash','zsh'):
   if at or len(argv)!=3 or argv[1] not in ('-c','-lc') or argv[2] is None:
    reason='This shell wrapper cannot be resolved as one literal -c or -lc command.'
   else:
    inner=parse(argv[2],depth+1)
    if len(groups)>1 and len(inner['stages'])>1:reason='A nested command chain changes shell grouping and needs a separate decision.'
    else:
     stages.extend(inner['stages']);boundary=boundary or inner['boundary'];
     if len(groups)==1:operators=inner.get('operators',[]);terminator=terminator or inner.get('terminator','')
     continue
  words=[]
  if not reason:
   for w in argv:
    if w is None:break
    words.append(w)
   # env's assignment token can itself be dynamic, before its executable.
   if effective>=len(words):
    prefix_boundary='A dynamic executable, assignment or unsupported wrapper prevents a literal executable prefix.';words=[]
    # An unsupported prefix wrapper is still an ordinary literal argv. Preserve
    # old exact allow/deny rules; never confuse prefix eligibility with parsing.
    if any(w is None for w in argv):reason=prefix_boundary
  stages.append({'argv':argv,'words':words,'exact':not reason and all(w is not None for w in argv),'boundary':reason,'prefix_boundary':prefix_boundary})
  boundary=boundary or reason
 return {'stages':stages,'operators':operators,'terminator':terminator,'contains_chain':bool(operators or terminator or len(stages)>1),'complete':bool(stages) and not boundary,'boundary':boundary}
