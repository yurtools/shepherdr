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
 p=argparse.ArgumentParser();p.add_argument('command',choices=['advice','advice-input','advise','evaluate','answer','status-error','inspect','preview','grant','history-inspect','history-preview','history-grant','list','history','revoke','clear-history','review','review-input','decide','launch','override','record'])
 p.add_argument('--summary',default='');p.add_argument('--detail',default='')
 p.add_argument('--request');p.add_argument('--terminal');p.add_argument('--space',default='');p.add_argument('--role',default='agent');p.add_argument('--cwd',default='')
 p.add_argument('--scope',choices=['task','space','account','global'],default='task');p.add_argument('--match',choices=['exact','prefix','tool'],default='exact');p.add_argument('--prefix');p.add_argument('--hours',type=float,default=1);p.add_argument('--stage',type=int)
 p.add_argument('--id');p.add_argument('--token');p.add_argument('--decision',choices=['allow','deny','ask'],default='allow');p.add_argument('--reason',default='')
 p.add_argument('--respond',action='store_true');p.add_argument('--task-grant',action='store_true');p.add_argument('--hash');p.add_argument('--answer');p.add_argument('--argv');p.add_argument('--mode',choices=[*A.MODES,'inherit']);return p

def main(a):
 if a.command in ('advice','advice-input','advise'):
  from herdr_task import approval_advice as advice
  if a.command=='advice':return advice.request(a.request,a.hash,a.terminal)
  if a.command=='advice-input':return advice.evidence(a.id,a.token)
  return advice.submit(a.id,a.token,a.summary,a.detail)
 if a.command=='history-inspect':return A.history_inspect(a.id)
 if a.command=='history-preview':return A.preview_rule(A.history_inspect(a.id),a.match,a.prefix,a.stage)
 if a.command=='history-grant':return A.grant_history(a.id,a.scope,a.match,a.prefix,a.hours,a.decision,a.stage)
 if a.command=='status-error':
  req=A.read(a.request)
  if isinstance(req,dict) and A.is_permission(req):A.status(a.request,req,'person','policy-error')
  return {'ok':True}
 if a.command in ('evaluate','answer'):
  req=A.read(a.request)
  if not isinstance(req,dict):raise ValueError('This request closed.')
  out=A.evaluate(a.request,a.terminal,audit_decision=not a.respond) if a.command=='evaluate' else {'action':'answer'}
  if a.command=='answer' or a.respond and out['action'] in ('allow','deny','native'):
   if A.read(a.request)!=req or a.command=='answer' and A.status_key(req)!=a.hash:raise ValueError('This request changed or closed.')
   ctx=A.request_context(a.request,a.terminal or Path(a.request).stem.split('.')[0])[1] if A.is_permission(req) else None
   answer=Path(a.request).parent.parent/'ans'/Path(a.request).name
   value=a.answer if a.command=='answer' else '' if out['action']=='native' else out['response']
   A.answer_once(answer,value)
   reason=a.reason if a.command=='answer' else 'Sent to Codex Auto-review · final result not reported' if out['action']=='native' else out.get('reason','Approval policy decision')
   if reason:
    end=Path(a.request).parent.parent/'end'/Path(a.request).stem;end.parent.mkdir(parents=True,exist_ok=True);end.write_text(reason+'\n')
   if ctx:
    try:
     if a.command=='evaluate':A.audit_result(req,ctx,out)
     else:
      decision=json.loads(value).get('hookSpecificOutput',{}).get('decision',{}).get('behavior')
      if decision in ('allow','deny'):A.audit(req,ctx,decision,'Decided by the person in Chat','user')
    except (ValueError,OSError):pass
   return {'action':'answered'}
  return out
 if a.command in ('inspect','preview'):
  req,ctx=A.pending_request(a.request,a.terminal,a.hash)
  info=A.inspect_request(req,ctx)
  return A.preview_rule(info,a.match,a.prefix,a.stage) if a.command=='preview' else {**info,'settings':A.settings(ctx)}
 if a.command=='grant':
  req,ctx=A.pending_request(a.request,a.terminal,a.hash)
  if a.task_grant:rule=A.grant_task(a.request,a.terminal)
  else:rule=A.grant(a.request,a.terminal,a.scope,a.match,a.prefix,a.hours,a.decision,a.stage,a.hash)
  # Saving is distinct from answering. Evaluate every action and deny without
  # delegating the newly saved, potentially partial rule to an Assistant.
  saved=A.rules()
  if saved is None:raise ValueError('Approval rules could not be read. The request is still waiting.')
  result,_=A.matching_decision(saved,req,ctx)
  covered=result and result['action'] in ('allow','deny');answered=False
  if a.respond:
   fresh=A.read(a.request)
   if not fresh or A.request_key(fresh)!=A.request_key(req):raise ValueError('The request closed or changed before it could be answered.')
   A.pending_request(a.request,a.terminal,A.status_key(req))
   if covered:
    answer=Path(a.request).parent.parent/'ans'/Path(a.request).name
    A.answer_once(answer,result['response']);answered=True
    try:A.audit_result(req,ctx,result)
    except (OSError,ValueError):pass
   else:
    old=A.read(Path(a.request).with_suffix('.status')) or {}
    # A partial save is not a new review outcome. Retain the exact request's
    # specific hand-back explanation; Advice lives in its separate sidecar.
    if result or old.get('request_hash')!=A.status_key(req) or old.get('state')!='person':
     A.waiting(a.request,req,'deny-uncertain' if result else 'rule-partial','Rule saved for future matches. This request still needs your decision.')
  pending=not covered
  action=result['action'] if answered else 'wait' if pending else 'saved'
  reason='Rule saved for future matches. This request is still waiting: '+(result['reason'] if result else A.request_analysis(req)['boundary'] or 'Other component commands need approval.') if pending else 'Request denied by a matching saved rule.' if answered and action=='deny' else 'Every action in this request is covered by saved rules.' if answered else 'Rule saved for future requests.'
  return {**rule,'rule':rule,'action':action,'pending_stages':pending,'reason':reason}
 if a.command=='record':
  req,ctx=A.request_context(a.request,a.terminal);A.audit(req,ctx,a.decision,a.reason,'user');return {'ok':True}
 if a.command=='review':
  req,ctx=A.request_context(a.request,a.terminal)
  if a.hash and a.hash!=A.status_key(req):raise ValueError('This request changed. Refresh before asking for review.')
  if not A.is_permission(req):raise ValueError('Plans and questions need a human answer.')
  return A.review_ticket(a.request,req,ctx,True)
 if a.command=='decide':return A.decide(a.id,a.token,a.decision,a.reason)
 if a.command=='review-input':
  _,ticket,req=A.review_input(a.id,a.token)
  return {'request':req,'context':ticket['context'],'policy':A.settings(ticket['context']).get('policy')}
 if a.command in ('list','history'):
  if a.command=='history':return {'rows':A.history_rows(a.space)}
  rows=A.rules()
  if rows is None:raise ValueError('Approval rules could not be read.')
  return {'rows':[{**r,'inherited':bool(a.space and r.get('scope')=='global')} for r in rows if not A.expired(r,__import__('time').time()) and (not a.space or r.get('scope')=='global' or r.get('space')==a.space or not r.get('space'))][-500:]}
 if a.command in ('revoke','clear-history'):
  with A.locked():
   if a.command=='clear-history':A.write(A.store()/'history.json',[])
   else:A.write(A.store()/'rules.json',[r for r in A.for_update('rules.json',[]) if r.get('id')!=a.id])
  return {'ok':True}
 if a.command=='launch':return {'argv':A.launch_argv(json.loads(a.argv or '[]'),a.space,a.role,a.cwd,a.mode)}
 if a.command=='override':
  req,ctx=A.request_context(a.request,a.terminal)
  with A.locked():
   rows=A.for_update('overrides.json',{});key=A.session_key(ctx)
   if a.mode=='inherit':rows.pop(key,None)
   elif a.mode in A.MODES:rows[key]={'mode':a.mode,'source':'user','expires':__import__('time').time()+24*3600}
   else:raise ValueError('Choose an approval mode.')
   A.write(A.store()/'overrides.json',rows)
  return {'mode':a.mode}
if __name__=='__main__':
 a=parser().parse_args()
 try:print(json.dumps(main(a),ensure_ascii=False))
 except Exception as e:
  if a.command in ('evaluate','review'):
   req=A.read(a.request)
   if isinstance(req,dict) and A.is_permission(req):
    try:A.status(a.request,req,'person','policy-error')
    except OSError:pass
  print(json.dumps({'error':str(e)}));sys.exit(1)
