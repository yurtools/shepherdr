#!/usr/bin/env python3
"""Native UI/hook entry point for Shepherdr's approval policy; no requested action is executed."""
import argparse, json, os, sys, shutil
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'tasks/bin'))
try:
 from herdr_task import approvals as A
except ImportError:
 entry=shutil.which('herdr-task')
 if not entry:raise
 sys.path.insert(0,os.path.realpath(entry));from herdr_task import approvals as A

def parser():
 p=argparse.ArgumentParser();p.add_argument('command',choices=['evaluate','inspect','grant','history-inspect','history-grant','list','history','revoke','clear-history','review','decide','launch','override','record'])
 p.add_argument('--request');p.add_argument('--terminal');p.add_argument('--space',default='');p.add_argument('--role',default='agent');p.add_argument('--cwd',default='')
 p.add_argument('--scope',choices=['task','space','account'],default='task');p.add_argument('--match',choices=['exact','prefix'],default='exact');p.add_argument('--prefix');p.add_argument('--hours',type=float,default=1)
 p.add_argument('--id');p.add_argument('--token');p.add_argument('--decision',choices=['allow','deny','ask'],default='allow');p.add_argument('--reason',default='')
 p.add_argument('--respond',action='store_true');p.add_argument('--argv');p.add_argument('--mode',choices=[*A.MODES,'inherit']);return p

def main(a):
 if a.command=='history-inspect':return A.history_inspect(a.id)
 if a.command=='history-grant':return A.grant_history(a.id,a.scope,a.match,a.prefix,a.hours,a.decision)
 if a.command=='evaluate':return A.evaluate(a.request,a.terminal)
 if a.command=='inspect':
  req,ctx=A.request_context(a.request,a.terminal);words=A.plain_command((req.get('tool_input') or {}).get('command'))
  return {'context':ctx,'settings':A.settings(ctx),'command':A.summary(req),'words':words,'suggested_prefix':__import__('shlex').join((words or [])[:2]),'permission':A.is_permission(req)}
 if a.command=='grant':
  req,ctx=A.request_context(a.request,a.terminal)
  rule=A.grant(a.request,a.terminal,a.scope,a.match,a.prefix,a.hours,a.decision)
  if a.respond:
   fresh=A.read(a.request)
   if not fresh or A.request_key(fresh)!=A.request_key(req):raise ValueError('The request closed or changed before it could be answered.')
   answer=A.app_home()/'data/chat-asks/ans'/(Path(a.request).stem+'.json')
   A.answer_once(answer,A.response(a.decision,'Saved '+a.scope+' '+a.match+' rule','user-rule')['response'])
  return rule
 if a.command=='record':
  req,ctx=A.request_context(a.request,a.terminal);A.audit(req,ctx,a.decision,a.reason,'user');return {'ok':True}
 if a.command=='review':
  req,ctx=A.request_context(a.request,a.terminal)
  if not A.is_permission(req):raise ValueError('Plans and questions need a human answer.')
  return A.review_ticket(a.request,req,ctx,True)
 if a.command=='decide':return A.decide(a.id,a.token,a.decision,a.reason)
 if a.command in ('list','history'):
  if a.command=='history':return {'rows':A.history_rows(a.space)}
  rows=A.read(A.store()/('rules.json' if a.command=='list' else 'history.json'),[]) or []
  return {'rows':[r for r in rows if not a.space or r.get('space')==a.space or not r.get('space')][-500:]}
 if a.command in ('revoke','clear-history'):
  with A.locked():
   if a.command=='clear-history':A.write(A.store()/'history.json',[])
   else:A.write(A.store()/'rules.json',[r for r in A.read(A.store()/'rules.json',[]) or [] if r.get('id')!=a.id])
  return {'ok':True}
 if a.command=='launch':return {'argv':A.launch_argv(json.loads(a.argv or '[]'),a.space,a.role,a.cwd,a.mode)}
 if a.command=='override':
  req,ctx=A.request_context(a.request,a.terminal)
  with A.locked():
   rows=A.read(A.store()/'overrides.json',{}) or {};key=A.session_key(ctx)
   if a.mode=='inherit':rows.pop(key,None)
   elif a.mode in A.MODES:rows[key]={'mode':a.mode,'expires':__import__('time').time()+24*3600}
   else:raise ValueError('Choose an approval mode.')
   A.write(A.store()/'overrides.json',rows)
  return {'mode':a.mode}
if __name__=='__main__':
 try:print(json.dumps(main(parser().parse_args()),ensure_ascii=False))
 except Exception as e:print(json.dumps({'error':str(e)}));sys.exit(1)
