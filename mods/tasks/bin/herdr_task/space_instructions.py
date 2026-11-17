"""Append-only space instructions; global templates are never modified here."""
import hashlib
import json
import os
import re
from .base import Fail
from .settings import read_settings, TEMPLATES, bare
ROLES=('coordinator','feature','worker','reviewer')
def space_instructions(role, space, s=None, cfg=None):
    role='coordinator' if role=='assistant' else role
    if role not in ROLES:return ''
    cfg=read_settings() if cfg is None else cfg
    spaces=cfg.get('spaces') if isinstance(cfg.get('spaces'),dict) else {}
    own=(spaces.get(space) or spaces.get(bare(space))) if space else None
    if not space and s:
        found=[v for v in spaces.values() if isinstance(v,dict) and v.get('folder')==s.loc['folder']]
        own=found[0] if len(found)==1 else None
    values=own.get('instructions') if isinstance(own,dict) else None
    value=values.get(role) if isinstance(values,dict) else None
    return value.strip() if isinstance(value,str) else ''
def append_instructions(body,extra):
    return body.rstrip()+'\n\n## Space-specific instructions\n\n'+extra.strip()+'\n' if extra and extra.strip() else body

def worker_instructions(s,task,space=None,load=None):
    from .templates import instructions
    instructions=load or instructions
    space=space or task.get('space') or (task.get('queue') or {}).get('space')
    body=append_instructions(instructions('worker'),space_instructions('worker',space,s))
    extra=space_instructions('reviewer',space,s)
    if extra:
        suffix=hashlib.sha256(str(space or '').encode()).hexdigest()[:10]
        path=f'{s.path}.{task["id"]}.{suffix}.reviewer.md'
        instructions('reviewer')  # ensure the global file exists, but keep reading it at review time
        text=append_instructions('',extra).lstrip()
        os.makedirs(os.path.dirname(path),exist_ok=True)
        tmp=f'{path}.{os.getpid()}.tmp'
        with open(tmp,'w',encoding='utf8') as f:f.write(text)
        os.replace(tmp,path)
        body=body.replace('~/.config/herdr-core/templates/reviewer.md','~/.config/herdr-core/templates/reviewer.md followed by '+path)
        body+='\n\nFor this task’s reviewer, read '+os.path.join(TEMPLATES,'reviewer.md')+' first, then append the space instructions from '+path+'. Keep the global file unchanged.\n'
    return body

def cmd_instructions(args):
    role='coordinator' if args.role=='assistant' else args.role
    extra=space_instructions(role,args.space)
    if args.extra_only:text=append_instructions('',extra).strip() if extra else ''
    else:
        name='assistant' if role=='coordinator' else role
        try:
            with open(os.path.join(TEMPLATES,name+'.md'),encoding='utf8') as f:body=f.read()
        except OSError as e:raise Fail(str(e))
        body=re.sub(r'^---\r?\n[\s\S]*?\r?\n---\r?\n?','',body,count=1)
        text=append_instructions(body.strip(),extra)
    print(json.dumps({'role':role,'space':args.space,'text':text}) if getattr(args,'json',False) else text)
