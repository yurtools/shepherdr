import home_guard  # noqa: F401
import contextlib, importlib.util, json, math, os, time, unittest
from unittest import mock
import test_approval_policy as fixtures
from herdr_task import approvals as A
ROOT=fixtures.ROOT

spec=importlib.util.spec_from_file_location('rule_ui',ROOT/'mods/chat/approval-policy.py')
UI=importlib.util.module_from_spec(spec);spec.loader.exec_module(UI)

class ExecutionRules(unittest.TestCase):
 setUp=fixtures.ApprovalPolicy.setUp
 mode=fixtures.ApprovalPolicy.mode
 def cli(self,*args):return UI.main(UI.parser().parse_args(list(args)))
 def command(self,command):
  req={**self.req,'tool_input':{'command':command}};A.write(self.path,req);return req
 def seed(self,command,**kwargs):
  self.command(command);return A.grant(self.path,**kwargs)
 def test_global_crosses_accounts_folders_spaces_tasks_and_sessions_without_changing_old_scopes(self):
  ctx=A.request_context(self.path)[1]
  other={**ctx,'account':'/account-two','cwd':'/another/project','space':'second','task':'TASK-2','session':'session-two'}
  for scope in ('task','space','account'):
   rule=A.grant(self.path,scope=scope)
   self.assertFalse(A.matches(rule,self.req,other),scope)
   self.assertFalse(A.matches(rule,self.req,{**ctx,'account':'/account-two'}),scope)
   self.assertFalse(A.matches(rule,self.req,{**ctx,'cwd':ctx['cwd']+'-sibling'}),scope)
   self.assertTrue(A.matches(rule,self.req,{**ctx,'cwd':ctx['cwd']+'/subdir'}),scope)
  global_rule=A.grant(self.path,scope='global',match='prefix',prefix='git status',hours=0)
  self.assertTrue(A.matches(global_rule,self.req,other))
  self.assertEqual([global_rule[k] for k in ('account','cwd','space','task','session')],['']*5)
  self.assertFalse(A.matches(global_rule,{**self.req,'tool_name':'other.Bash'},other))
  listed=self.cli('list','--space','second')['rows']
  self.assertEqual([r['id'] for r in listed if r.get('inherited')],[global_rule['id']])
  self.assertEqual(len([r for r in A.read(A.store()/'rules.json') if r['id']==global_rule['id']]),1)
 def test_local_deny_beats_global_allow_and_manual_and_role_modes_remain_authoritative(self):
  A.grant(self.path,scope='global',hours=0)
  denied=A.grant(self.path,scope='space',decision='deny')
  self.assertEqual(A.evaluate(self.path)['action'],'deny')
  A.write(A.store()/'overrides.json',{});self.mode('manual')
  self.assertEqual(A.evaluate(self.path)['action'],'wait')
  self.mode('rules');self.assertEqual(A.evaluate(self.path)['action'],'deny')
  A.write(A.store()/'rules.json',[r for r in A.rules() if r['id']!=denied['id']])
  self.assertEqual(A.evaluate(self.path)['action'],'allow')
  A.write(self.base/'settings.json',{'everywhere':{'approvals':{'mode':'rules'}},'spaces':{'space':{'approvals':{'worker':'manual'}}}})
  self.assertEqual(A.evaluate(self.path)['action'],'wait')
 def test_forever_is_json_zero_survives_reads_but_activation_lasts_at_most_a_day(self):
  now=time.time()
  with mock.patch.object(A.time,'time',return_value=now):
   rule=A.grant(self.path,scope='global',hours=0);ctx=A.request_context(self.path)[1]
  self.assertEqual(rule['expires'],0)
  self.assertEqual(A.read(A.store()/'rules.json')[-1]['expires'],0)
  self.assertEqual(A.read(A.store()/'overrides.json')[A.session_key(ctx)]['expires'],now+86400)
  with mock.patch.object(A.time,'time',return_value=now+86401):
   self.assertEqual(A.settings(ctx)['mode'],'manual')
   self.assertEqual(A.read(A.store()/'overrides.json'),{})
   self.assertEqual(A.evaluate(self.path)['action'],'wait')
   self.mode('rules');self.assertEqual(A.evaluate(self.path)['action'],'allow')
  self.assertEqual(A.rules()[-1]['expires'],0)
  for hours in (math.inf,math.nan,-1):
   with self.assertRaises(ValueError):A.grant(self.path,hours=hours)
 def test_task_quick_grant_and_year_grant_do_not_create_permanent_mode_overrides(self):
  now=time.time()
  with mock.patch.object(A.time,'time',return_value=now):
   short=A.grant(self.path,hours=24);ctx=A.request_context(self.path)[1]
   self.assertEqual(short['expires'],now+86400)
   year=A.grant(self.path,hours=8760)
   self.assertEqual(year['expires'],now+8760*3600)
   self.assertEqual(A.read(A.store()/'overrides.json')[A.session_key(ctx)]['expires'],now+86400)
 def test_expired_rules_are_deleted_on_evaluation_even_in_manual_mode_and_history_is_kept(self):
  now=time.time()
  with mock.patch.object(A.time,'time',return_value=now):
   expired=A.grant(self.path,hours=1);forever=A.grant(self.path,scope='global',hours=0)
  history=(A.store()/'history.json').read_bytes()
  A.write(A.store()/'overrides.json',{'expired':{'mode':'rules','expires':now+3600},'keep':{'mode':'manual','expires':now+99999}})
  with mock.patch.object(A.time,'time',return_value=now+3600):
   A.evaluate(self.path)
  self.assertEqual([r['id'] for r in A.read(A.store()/'rules.json')],[forever['id']])
  self.assertNotIn(expired['id'],json.dumps(A.read(A.store()/'rules.json')))
  self.assertEqual(list(A.read(A.store()/'overrides.json')),['keep'])
  self.assertEqual((A.store()/'history.json').read_bytes(),history)
 def test_ordinary_manager_read_prunes_without_a_save(self):
  rule=A.grant(self.path);rule['expires']=time.time()-1;A.write(A.store()/'rules.json',[rule])
  self.assertEqual(self.cli('list')['rows'],[])
  self.assertEqual(A.read(A.store()/'rules.json'),[])
 def test_cleanup_rereads_under_lock_and_preserves_a_concurrent_addition(self):
  rule=A.grant(self.path);dead={**rule,'id':'expired','expires':time.time()-1}
  A.write(A.store()/'rules.json',[dead]);original=A.locked
  @contextlib.contextmanager
  def interleave(*args,**kwargs):
   with original():A.write(A.store()/'rules.json',[dead,rule])
   with original(*args,**kwargs):yield
  with mock.patch.object(A,'locked',side_effect=interleave):self.assertEqual(A.rules(),[rule])
  self.assertEqual(A.read(A.store()/'rules.json'),[rule])
 def test_readonly_or_busy_cleanup_preserves_valid_rules_and_invalid_stores_are_never_overwritten(self):
  valid=A.grant(self.path);dead={**valid,'id':'dead','expires':time.time()-1}
  A.write(A.store()/'rules.json',[dead,valid]);before=(A.store()/'rules.json').read_bytes()
  for error in (PermissionError('read-only'),ValueError('busy')):
   with mock.patch.object(A,'locked',side_effect=error):
    self.assertEqual(A.rules(),[dead,valid]);self.assertTrue(A.matches(valid,self.req,A.request_context(self.path)[1]))
   self.assertEqual((A.store()/'rules.json').read_bytes(),before)
  A.write(A.store()/'rules.json',[valid])
  with mock.patch.object(A,'locked',side_effect=AssertionError('a valid read needs no writable lock')):self.assertEqual(A.rules(),[valid])
  (A.store()/'rules.json').write_text('{invalid')
  with self.assertRaises(ValueError):A.grant(self.path)
  self.assertEqual((A.store()/'rules.json').read_text(),'{invalid')
 @unittest.skipIf(os.geteuid()==0,'root can write to chmod read-only folders')
 def test_real_readonly_directory_needs_no_writable_lock_for_rule_reads(self):
  valid=A.grant(self.path);dead={**valid,'id':'dead','expires':time.time()-1}
  A.write(A.store()/'rules.json',[dead,valid]);before=(A.store()/'rules.json').read_bytes()
  os.chmod(A.store(),0o555)
  try:
   self.assertEqual(A.rules(),[dead,valid]);self.assertEqual((A.store()/'rules.json').read_bytes(),before)
   self.assertFalse((A.store()/'.lock').exists())
   self.assertEqual(self.cli('list')['rows'][0]['id'],valid['id'])
  finally:os.chmod(A.store(),0o700)
 def test_named_tool_any_arguments_is_explicit_exact_identity_and_coexists_with_exact_payload(self):
  tool='mcp__openmemory__openmemory_store_project'
  req={**self.req,'tool_name':tool,'tool_input':{'command':'not a shell command','content':'one'}};A.write(self.path,req)
  ctx=A.request_context(self.path)[1];info=self.cli('inspect','--request',str(self.path))
  self.assertIsNone(info['words']);self.assertTrue(info['tool_wide']);self.assertEqual(info['tool'],tool)
  exact=A.grant(self.path);broad=A.grant(self.path,scope='global',match='tool',hours=0)
  variant={**req,'tool_input':{'content':'two','metadata':{}}}
  self.assertTrue(A.matches(exact,req,ctx));self.assertFalse(A.matches(exact,variant,ctx));self.assertTrue(A.matches(broad,variant,ctx))
  for name in ('openmemory_store_project','mcp__other__openmemory_store_project',tool+'_other','AskUserQuestion','functions.request_user_input'):
   self.assertFalse(A.matches(broad,{**variant,'tool_name':name},ctx),name)
  A.write(self.path,variant);self.assertEqual(A.evaluate(self.path)['action'],'allow')
  A.grant(self.path,scope='space',match='tool',decision='deny');self.assertEqual(A.evaluate(self.path)['action'],'deny')
  with self.assertRaises(ValueError):A.grant(self.path,match='prefix',prefix='not a')
 def test_history_creates_global_forever_tool_rule_without_replaying_or_terminal_lookup(self):
  req={**self.req,'tool_name':'mcp__openmemory__openmemory_store_project','tool_input':{'content':'test'}}
  A.write(self.path,req);ctx=A.request_context(self.path)[1];A.audit(req,ctx,'allow','Person allowed','user')
  ident=A.history_rows()[-1]['id'];self.path.unlink();self.path.with_suffix('.context').unlink()
  with mock.patch.object(A.subprocess,'run',side_effect=AssertionError('no execution')):
   rule=self.cli('history-grant','--id',ident,'--scope','global','--match','tool','--hours','0')['rule']
  self.assertEqual((rule['scope'],rule['match'],rule['expires']),('global','tool',0))
  self.assertFalse(list((self.path.parent.parent/'ans').glob('*')))
 def test_helper_rejects_tool_wide_shell_and_question_or_plan_grants(self):
  with self.assertRaises(ValueError):A.grant(self.path,match='tool',scope='global')
  ctx=A.request_context(self.path)[1]
  for tool in (*A.QUESTION_TOOLS,'functions.request_user_input','functions.request_user_input_async'):
   req={**self.req,'tool_name':tool};A.write(self.path,req)
   with self.assertRaises(ValueError):A.grant(self.path,match='tool',scope='global')
   with self.assertRaises(ValueError):A.save_rule(ctx,tool,None,'hash','title',match='tool')

class PipelineRules(unittest.TestCase):
 setUp=fixtures.ApprovalPolicy.setUp
 mode=fixtures.ApprovalPolicy.mode
 command=ExecutionRules.command
 seed=ExecutionRules.seed
 cli=ExecutionRules.cli
 def test_two_and_three_stage_pipeline_requires_all_allows_and_preserves_payload(self):
  for cmd in ('git status --short','wc -l'):self.seed(cmd,scope='global',match='prefix',prefix=cmd,hours=0)
  req=self.command('git status --short | wc -l');key=A.request_key(req)
  self.assertEqual(A.evaluate(self.path)['action'],'allow')
  self.command('git status --short | wc -l | head -5')
  self.assertEqual(A.evaluate(self.path)['action'],'wait')
  self.assertEqual(A.read(self.path.with_suffix('.status'))['stage'],2)
  self.seed('head -5');self.command('git status --short | wc -l | head -5')
  self.assertEqual(A.evaluate(self.path)['action'],'allow')
  A.write(self.path,req);self.assertEqual(A.request_key(A.read(self.path)),key)
  self.assertEqual(A.read(self.path),req)
 def test_any_stage_deny_beats_global_allow_even_with_an_earlier_unmatched_stage(self):
  self.seed('git status',scope='global',match='prefix',prefix='git status')
  self.seed('head -5',scope='global',match='prefix',prefix='head -5')
  self.seed('head -5',scope='space',decision='deny')
  self.command('git status | wc -l | head -5');result=A.evaluate(self.path)
  self.assertEqual(result['action'],'deny');self.assertIn('stage 3',result['reason'])
 def test_literal_pipes_and_shell_wrappers_are_parsed_without_execution(self):
  samples={"printf '%s' 'a|b' | wc -c":[['printf','%s','a|b'],['wc','-c']],
           r'printf "%s" a\|b | wc -c':[['printf','%s','a|b'],['wc','-c']],
           "bash -lc 'git status | wc -l'":[['git','status'],['wc','-l']]}
  for value,stages in samples.items():self.assertEqual(A.shell_stages(value),stages,value)
  self.assertEqual(A.shell_stages(['/bin/sh','-c','git status | wc -l']),[['git','status'],['wc','-l']])
  self.assertEqual(A.shell_stages(['printf','a|b']),[['printf','a|b']])
  self.seed('git status');self.seed('wc -l')
  for value in ("bash -lc 'git status | wc -l'",['/bin/sh','-c','git status | wc -l']):
   self.command(value);self.assertEqual(A.evaluate(self.path)['action'],'allow')
 def test_unsupported_syntax_and_legacy_exact_payloads_cannot_bypass_stage_checks(self):
  rule=self.seed('git status',match='prefix',prefix='git status')
  ctx=A.request_context(self.path)[1]
  for value in ('git status | wc -l','git status || wc -l','git status | wc -l && echo done','git status; wc -l | head -5',
                'git status |','| git status','git status | | wc -l','git status |& wc -l',
                'git status | echo $(id)','git status | echo `id`','git status > out | wc -l',
                'git status | wc -l # comment','git status | echo *','git status | (wc -l)',
                'git status | echo "unterminated','git status | echo \\', 'git status\nwc -l | head -5'):
   req=self.command(value)
   legacy={**rule,'id':'legacy','match':'request','action_key':A.action_key(req)}
   A.write(A.store()/'rules.json',[rule,legacy])
   self.assertEqual(A.evaluate(self.path)['action'],'wait',value)
  self.assertEqual(A.shell_stages('git status | sh -c "echo a | wc -l"'),None)
 def test_legacy_exact_non_pipeline_payload_keeps_its_narrow_match(self):
  req=self.command('python3 -m unittest > results.txt');rule=A.grant(self.path)
  self.assertEqual(rule['match'],'request');self.assertEqual(A.evaluate(self.path)['action'],'allow')
  self.command('python3 -m unittest > different.txt');self.assertEqual(A.evaluate(self.path)['action'],'wait')
  # Literal punctuation is not a shell pipeline, even in legacy exact scripts.
  req=self.command("printf 'a|b' > results.txt");A.grant(self.path)
  self.assertEqual(A.evaluate(self.path)['action'],'allow')
 def test_literal_environment_prefix_and_interpreter_guards_behind_wrappers(self):
  rule=self.seed('GIT_TERMINAL_PROMPT=0 git status',scope='global',match='prefix',prefix='GIT_TERMINAL_PROMPT=0 git',hours=0)
  ctx=A.request_context(self.path)[1]
  for command in ('GIT_TERMINAL_PROMPT=0 git log',"bash -lc 'GIT_TERMINAL_PROMPT=0 git status'",['sh','-c','GIT_TERMINAL_PROMPT=0 git status']):
   self.command(command);self.assertEqual(A.evaluate(self.path)['action'],'allow',command)
  for command in ('GIT_TERMINAL_PROMPT=1 git status','git status'):
   self.assertFalse(A.matches(rule,self.command(command),ctx))
  for command,prefix in [('X=1 python3 -c pass','X=1 python3'),('X=1 python3 -c pass','X=1 python3 -c'),("bash -lc 'X=1 node -e 0'",'X=1 node -e'),('X=1 env sh -c true','X=1 env')]:
   self.command(command)
   with self.assertRaisesRegex(ValueError,'arbitrary'):A.grant(self.path,match='prefix',prefix=prefix)
  self.command("X=1 bash -lc 'git status'")
  with self.assertRaises(ValueError):A.grant(self.path,match='prefix',prefix='X=1 bash')
 def test_timeout_suggestions_include_the_underlying_command_and_never_a_blanket_wrapper(self):
  for duration in ('50','50s'):
   command=f'timeout {duration} hc wait task --timeout 600';self.command(command)
   info=self.cli('inspect','--request',str(self.path))
   self.assertEqual(info['suggested_prefix'],f'timeout {duration} hc wait')
   self.assertEqual(info['stage_prefixes'],[f'timeout {duration} hc wait'])
   rule=A.grant(self.path,match='prefix',prefix=f'timeout {duration} hc wait',hours=0)
   ctx=A.request_context(self.path)[1]
   self.assertTrue(A.matches(rule,self.command(f'timeout {duration} hc wait other'),ctx))
   self.assertFalse(A.matches(rule,self.command(f'timeout {duration} hc kill other'),ctx))
   self.command(command)
   for prefix in (f'timeout {duration}',f'timeout {duration} hc'):
    with self.assertRaisesRegex(ValueError,'arbitrary'):A.grant(self.path,match='prefix',prefix=prefix)
  self.command('GIT_TERMINAL_PROMPT=0 git status')
  self.assertEqual(self.cli('inspect','--request',str(self.path))['suggested_prefix'],'GIT_TERMINAL_PROMPT=0 git status')
  for command,prefix in [('timeout 50s bash -c true','timeout 50s bash'),('X=1 timeout 50s python3 -c pass','X=1 timeout 50s python3 -c'),("bash -lc 'timeout 50s node -e 0'",'timeout 50s node -e'),('timeout 50s sudo sh -c true','timeout 50s sudo sh'),('X=1 python3.12 -c pass','X=1 python3.12 -c')]:
   self.command(command)
   with self.assertRaisesRegex(ValueError,'arbitrary'):A.grant(self.path,match='prefix',prefix=prefix)
  for command in ("timeout 50s bash -lc 'git status | wc -l'",['timeout','50s','sh','-c','git status | wc -l'],"env sh -c 'git status | wc -l'",['env','sh','-c','git status | wc -l'],"timeout --signal=KILL 50s sh -c 'git status | wc -l'"):
   req=self.command(command)
   with self.assertRaisesRegex(ValueError,'unsupported'):A.grant(self.path)
   ctx=A.request_context(self.path)[1]
   A.write(A.store()/'rules.json',[{'id':'legacy','match':'request','action_key':A.action_key(req),'tool':'Bash','scope':'task','space':ctx['space'],'task':ctx['task'],'cwd':ctx['cwd'],'account':ctx['account'],'decision':'allow','expires':0}])
   self.assertEqual(A.evaluate(self.path)['action'],'wait')
 def test_unreadable_rules_or_settings_never_delegate_around_unseen_denies(self):
  for mode in ('assistant','codex-review','rules','manual'):
   with self.subTest(mode=mode):
    self.mode(mode);self.meta['argv']+=['-c','approvals_reviewer="auto_review"'];self.path.with_suffix('.context').unlink(missing_ok=True)
    A.store().mkdir(parents=True,exist_ok=True);(A.store()/'rules.json').write_text('{broken')
    with mock.patch.object(A,'review_ticket',side_effect=AssertionError('must not delegate')):
     self.assertEqual(A.evaluate(self.path)['action'],'wait')
     self.assertEqual(A.read(self.path.with_suffix('.status'))['reason'],'policy-error')
    A.write(A.store()/'rules.json',[]);(self.base/'settings.json').write_text('{broken')
    self.assertEqual(A.evaluate(self.path)['action'],'wait');self.assertEqual(A.read(self.path.with_suffix('.status'))['reason'],'policy-error')
 def test_selected_stage_creation_does_not_answer_other_stages_and_history_keeps_each_stage(self):
  req=self.command('git status | wc -l');key=A.request_key(req)
  with self.assertRaisesRegex(ValueError,'stage'):A.grant(self.path)
  with self.assertRaisesRegex(ValueError,'stage'):A.grant(self.path,stage=3)
  out=self.cli('grant','--request',str(self.path),'--stage','0','--scope','global','--hours','0','--respond')
  self.assertTrue(out['pending_stages']);self.assertEqual(out['pattern'],['git','status'])
  self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
  info=self.cli('inspect','--request',str(self.path));self.assertEqual(info['stage'],1);self.assertEqual(info['words'],['wc','-l'])
  row=A.history_rows()[-1]
  rule=self.cli('history-grant','--id',row['id'],'--stage','1','--scope','global','--hours','0')['rule']
  self.assertEqual(rule['pattern'],['wc','-l']);self.assertEqual(rule['expires'],0)
  self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
  self.assertEqual(A.evaluate(self.path)['action'],'allow');self.assertEqual(A.request_key(A.read(self.path)),key)
 def test_unmatched_pipeline_uses_existing_assistant_or_native_fallback_and_manual_pauses_rules(self):
  self.seed('git status');self.command('git status | wc -l');A.write(A.store()/'overrides.json',{})
  self.mode('assistant')
  with mock.patch.object(A,'review_ticket',return_value={'action':'wait','reason':'review'}) as review:
   self.assertEqual(A.evaluate(self.path)['reason'],'review');review.assert_called_once()
  self.mode('codex-review');self.path.with_suffix('.context').unlink();self.meta['argv']+=['-c','approvals_reviewer="auto_review"']
  self.assertEqual(A.evaluate(self.path)['action'],'native')
  self.seed('wc -l');self.command('git status | wc -l');A.write(A.store()/'overrides.json',{});self.mode('manual')
  self.assertEqual(A.evaluate(self.path)['action'],'wait')
 def test_task_quick_grant_remembers_each_pipeline_stage_for_one_day(self):
  req=self.command('git status | wc -l');before=time.time()
  out=self.cli('grant','--request',str(self.path),'--task-grant','--respond')
  self.assertFalse(out['pending_stages'])
  saved=A.rules();self.assertEqual([r['pattern'] for r in saved],[['git','status'],['wc','-l']])
  self.assertTrue(all(r['scope']=='task' and 86390<r['expires']-before<86410 for r in saved))
  self.assertEqual(A.read(self.path.parent.parent/'ans'/self.path.name)['hookSpecificOutput']['decision']['behavior'],'allow')
  self.assertEqual(A.read(self.path),req)
 def test_task_quick_grant_keeps_the_original_stages_when_request_changes_during_save(self):
  req=self.command('git status | wc -l');original=A.save_rule;calls=[]
  def save(*args,**kwargs):
   calls.append(args[2]);result=original(*args,**kwargs)
   self.command('git push | head -5');return result
  with mock.patch.object(A,'save_rule',side_effect=save):
   with self.assertRaisesRegex(ValueError,'closed or changed'):self.cli('grant','--request',str(self.path),'--task-grant','--respond')
  self.assertEqual(calls,[['git','status'],['wc','-l']])
  self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())

if __name__=='__main__':unittest.main()
