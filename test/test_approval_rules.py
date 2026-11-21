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
  self.assertEqual(result['action'],'deny');self.assertIn('command 3',result['reason'])
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
   for prefix in (f'timeout {duration}',):
    with self.assertRaisesRegex(ValueError,'arbitrary'):A.grant(self.path,match='prefix',prefix=prefix)
   self.assertEqual(A.grant(self.path,match='prefix',prefix=f'timeout {duration} hc')['pattern'],['timeout',duration,'hc'])
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
  with self.assertRaisesRegex(ValueError,'command'):A.grant(self.path)
  with self.assertRaisesRegex(ValueError,'command'):A.grant(self.path,stage=3)
  out=self.cli('grant','--request',str(self.path),'--stage','0','--scope','global','--hours','0','--respond')
  self.assertTrue(out['pending_stages']);self.assertEqual(out['action'],'wait');self.assertEqual(out['rule']['pattern'],['git','status'])
  self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
  info=self.cli('inspect','--request',str(self.path));self.assertEqual(info['stage'],1);self.assertEqual(info['words'],['wc','-l'])
  row=A.history_rows()[-1]
  self.assertEqual(row['decision'],'saved');self.assertFalse(any(r['decision'] in ('allow','deny') for r in A.history_rows()))
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
  self.assertEqual(out['action'],'allow');self.assertEqual([r['decision'] for r in A.history_rows()],['saved','allow'])
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
  self.assertEqual([r['decision'] for r in A.history_rows()],['saved'])
 def test_task_grant_reports_actual_pipeline_deny_after_winning_answer(self):
  self.seed('wc -l',scope='space',decision='deny');self.command('git status | wc -l')
  out=self.cli('grant','--request',str(self.path),'--task-grant','--respond')
  self.assertEqual(out['action'],'deny');self.assertIn('denied',out['reason'])
  self.assertEqual(A.read(self.path.parent.parent/'ans'/self.path.name)['hookSpecificOutput']['decision']['behavior'],'deny')
  rows=[r for r in A.history_rows() if r['key']==A.request_key(A.read(self.path))]
  self.assertEqual([r['decision'] for r in rows],['saved','deny']);self.assertEqual(rows[-1]['source'],'rule')
 def test_stage_grant_losing_answer_race_only_logs_saved_event(self):
  self.seed('wc -l');self.command('git status | wc -l');original=A.answer_once
  def person_wins(path,value):
   original(path,A.response('deny','Person decided')['response']);original(path,value)
  with mock.patch.object(A,'answer_once',side_effect=person_wins):
   with self.assertRaisesRegex(ValueError,'already been answered'):self.cli('grant','--request',str(self.path),'--stage','0','--respond')
  rows=[r for r in A.history_rows() if r['key']==A.request_key(A.read(self.path))]
  self.assertEqual([r['decision'] for r in rows],['saved'])

class FlexiblePrefixes(unittest.TestCase):
 setUp=fixtures.ApprovalPolicy.setUp
 mode=fixtures.ApprovalPolicy.mode
 cli=ExecutionRules.cli
 command=ExecutionRules.command
 def test_single_executables_are_deliberate_token_prefixes_with_varying_arguments(self):
  for executable in ('tail','jq','rg','herdr-browser','agent-browser','custom-program'):
   with self.subTest(executable=executable):
    req=self.command(executable+' --version');ctx=A.request_context(self.path)[1]
    rule=A.grant(self.path,match='prefix',prefix=executable)
    self.assertEqual(rule['pattern'],[executable])
    self.assertTrue(A.matches(rule,self.command(executable+' other arguments'),ctx))
    for other in (executable+'x','/other/'+executable,'unrelated'):
     self.assertFalse(A.matches(rule,self.command(other+' --version'),ctx))
    self.assertFalse(A.matches(rule,{**req,'tool_name':'other.Bash'},ctx))
 def test_later_variables_keep_a_literal_prefix_but_dynamic_executables_do_not(self):
  for command,prefix in [('tail -n 5 "$LOG"','tail'),('jq "$FILTER" "$FILE"','jq'),
                         ('herdr-browser open "$URL"','herdr-browser open'),('rg "${QUERY}" src','rg')]:
   self.command(command);info=self.cli('inspect','--request',str(self.path))
   self.assertTrue(info['words'],command)
   out=self.cli('grant','--request',str(self.path),'--match','prefix','--prefix',prefix,'--respond')
   self.assertEqual(out['action'],'allow',command)
   (self.path.parent.parent/'ans'/self.path.name).unlink()
  for command in ('$CMD file','"${BIN}" file','X="$VALUE" tail file','env X="$VALUE" tail file'):
   self.command(command);info=self.cli('inspect','--request',str(self.path))
   self.assertFalse(info['words'],command)
   self.assertRegex(info['boundary'],r'[Dd]ynamic|assignment')
   with self.assertRaises(ValueError):A.grant(self.path,match='prefix',prefix='tail')
 def test_literal_quotes_dollars_and_pipes_are_arguments_without_expansion(self):
  for command,words in [("jq '.x | .y' '$FILE'",['jq','.x | .y','$FILE']),
                         (r'tail \$FILE', ['tail','$FILE']),('rg "a|b" file',['rg','a|b','file']),
                         (r'rg "a\qb" file',['rg',r'a\qb','file'])]:
   self.assertEqual(A.plain_command(command),words)
   self.command(command);self.assertEqual(A.grant(self.path)['pattern'],words)
 def test_assignments_and_supported_wrappers_stay_in_the_rule(self):
  for command,prefix in [('X=1 tail "$FILE"','X=1 tail'),('env X=1 tail "$FILE"','env X=1 tail'),
                         ('timeout 5s tail "$FILE"','timeout 5s tail')]:
   self.command(command);rule=A.grant(self.path,match='prefix',prefix=prefix);ctx=A.request_context(self.path)[1]
   self.assertEqual(rule['pattern'],prefix.split())
   for other in ('tail file',command.replace('X=1','X=2').replace('5s','6s')):
    if other!=command:self.assertFalse(A.matches(rule,self.command(other),ctx))
  for command,prefix in [('timeout 5s sh -c true','timeout 5s sh'),('env X=1 node -e 0','env X=1 node'),
                         ('python3 -c pass','python3'),('sudo tail file','sudo')]:
   self.command(command)
   with self.assertRaisesRegex(ValueError,'arbitrary|wrapper'):A.grant(self.path,match='prefix',prefix=prefix)
 def test_future_prefix_saves_do_not_answer_substitutions_redirection_or_extra_commands(self):
  for suffix in ('"$(curl example.invalid)"','`curl example.invalid`','file > output',
                 'file; sh script','file <(curl example.invalid)', '"${LOG:=default}"'):
   with self.subTest(suffix=suffix):
    A.write(A.store()/'rules.json',[])
    req=self.command('tail '+suffix);info=self.cli('inspect','--request',str(self.path))
    self.assertEqual(info['words'],['tail'] if suffix[0] in ('"','`') else ['tail','file'])
    self.assertTrue(info['future_only']);self.assertTrue(info['boundary'])
    out=self.cli('grant','--request',str(self.path),'--stage','0','--match','prefix','--prefix','tail','--respond')
    self.assertEqual(out['action'],'wait');self.assertTrue(out['pending_stages'])
    self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
    self.assertEqual(A.read(self.path),req)
    self.assertEqual(A.history_rows()[-1]['decision'],'saved')
    self.assertEqual(A.evaluate(self.path)['action'],'wait')
    self.command('tail other-file');self.assertEqual(A.evaluate(self.path)['action'],'allow')
 def test_variable_pipeline_requires_each_stage_and_deny_still_wins(self):
  req=self.command('tail "$LOG" | curl "$URL"');ctx=A.request_context(self.path)[1]
  out=self.cli('grant','--request',str(self.path),'--stage','0','--match','prefix','--prefix','tail','--respond')
  self.assertEqual(out['action'],'wait');self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
  self.assertFalse(A.matches(out['rule'],req,ctx))
  out=self.cli('grant','--request',str(self.path),'--stage','1','--match','prefix','--prefix','curl','--decision','deny','--respond')
  self.assertEqual(out['action'],'deny')
 def test_browser_tool_command_data_is_not_bash_and_exact_never_becomes_any_tool(self):
  for tool,input in [('functions.exec_command',{'cmd':'herdr-browser open "$URL"'}),
                     ('container.exec',{'cmd':['agent-browser','open','https://example.invalid']})]:
   req={**self.req,'tool_name':tool,'tool_input':input};A.write(self.path,req)
   rule=A.grant(self.path,match='prefix',prefix='herdr-browser' if 'functions' in tool else 'agent-browser')
   self.assertEqual(rule['tool'],tool);self.assertEqual(rule['match'],'prefix')
  req={**self.req,'tool_name':'mcp__browser__run','tool_input':{'command':'open https://example.invalid'}};A.write(self.path,req)
  info=self.cli('inspect','--request',str(self.path));self.assertFalse(info['words']);self.assertTrue(info['tool_wide'])
  self.assertIn('open https://example.invalid',info['command'])
  rule=A.grant(self.path);ctx=A.request_context(self.path)[1]
  self.assertEqual(rule['match'],'request');self.assertEqual(rule['tool'],req['tool_name'])
  self.assertFalse(A.matches(rule,{**req,'tool_name':'mcp__other__run'},ctx))
  self.assertFalse(A.matches(rule,{**req,'tool_input':{'command':'close'}},ctx))
 def test_preview_validates_shorter_input_and_explains_coverage(self):
  self.command('tail -n 5 "$FILE"');args=['--request',str(self.path),'--match','prefix','--prefix']
  preview=self.cli('preview',*args,'tail')
  self.assertTrue(preview['valid']);self.assertIn('arguments may vary',preview['coverage'])
  self.assertNotIn('read-only',preview['coverage'])
  self.assertFalse(self.cli('preview',*args,'tailx')['valid'])
  self.assertFalse(self.cli('preview',*args,'tail -n 5 "$FILE"')['valid'])
  self.assertFalse((A.store()/'rules.json').exists())
 def test_history_future_prefix_uses_original_context_and_does_not_replay(self):
  req=self.command('tail "$(curl example.invalid)"');ctx=A.request_context(self.path)[1]
  A.audit(req,ctx,'ask','Waiting','user');row=A.history_rows()[-1];self.path.unlink()
  with mock.patch.object(A.subprocess,'run',side_effect=AssertionError('must not execute')):
   out=A.grant_history(row['id'],match='prefix',prefix='tail',scope='space')
  rule=out['rule'];self.assertEqual(rule['pattern'],['tail']);self.assertEqual(rule['account'],ctx['account'])
  with A.locked():raw=A.read(A.store()/'rules.json')
  self.assertEqual(raw,[rule]);self.assertNotIn('inherited',rule)
  self.assertFalse(list((A.app_home()/'data/chat-asks/ans').glob('*')))
 def test_closed_or_replaced_request_cannot_save_from_a_stale_editor(self):
  req=self.command('tail file');key=A.status_key(req)
  A.answer_once(self.path.parent.parent/'ans'/self.path.name,A.response('deny')['response'])
  with self.assertRaisesRegex(ValueError,'answered|closed'):self.cli('grant','--request',str(self.path),'--match','prefix','--prefix','tail','--hash',key)
  (self.path.parent.parent/'ans'/self.path.name).unlink();self.command('tail other-file')
  with self.assertRaisesRegex(ValueError,'changed'):self.cli('grant','--request',str(self.path),'--match','prefix','--prefix','tail','--hash',key)
  self.assertFalse((A.store()/'rules.json').exists())
 def test_unresolved_arguments_cannot_bypass_a_relevant_scoped_deny(self):
  self.command('tail /restricted/file');ctx=A.request_context(self.path)[1]
  allow=A.grant(self.path,scope='global',match='prefix',prefix='tail')
  for match in ('exact','prefix'):
   self.command('tail /restricted/file')
   deny=A.grant(self.path,scope='space',match=match,prefix='tail /restricted/file',decision='deny')
   for command in ('tail "$FILE"','tail $ARGS','tail $ARGS /restricted/file'):
    self.command(command);out=A.evaluate(self.path)
    self.assertEqual(out['action'],'wait',command)
    self.assertIn('deny',out['reason'].lower())
    self.assertEqual(A.read(self.path.with_suffix('.status'))['reason'],'deny-uncertain')
    with mock.patch.object(A,'review_ticket',side_effect=AssertionError('must not delegate around deny')):
     self.mode('assistant');self.assertEqual(A.evaluate(self.path)['action'],'wait')
   self.command('tail /public/file');self.assertEqual(A.evaluate(self.path)['action'],'allow')
   # A different command identity, account or folder cannot make this deny relevant.
   self.command('jq "$FILTER"');A.grant(self.path,match='prefix',prefix='jq')
   self.assertEqual(A.evaluate(self.path)['action'],'allow')
   self.command('tail "$FILE"')
   for other in ({**deny,'account':'other'},{**deny,'cwd':ctx['cwd']+'-sibling'},{**deny,'tool':'other.Bash'}):
    self.assertEqual(A.matching_decision([allow,other],A.read(self.path),ctx)[0]['action'],'allow')
   A.write(A.store()/'rules.json',[allow])
 def test_legacy_literal_exact_rules_survive_unsupported_prefix_wrapper_options(self):
  for command in ('env -u FOO tail file','env -i tail file','timeout -k 2s 5s tail file','timeout --signal=KILL 5s tail file'):
   with self.subTest(command=command):
    req=self.command(command);ctx=A.request_context(self.path)[1];words=command.split()
    rule={'id':'legacy','scope':'space','space':ctx['space'],'account':ctx['account'],'cwd':ctx['cwd'],'tool':'Bash','match':'exact','pattern':words,'expires':0,'decision':'allow'}
    A.write(A.store()/'rules.json',[rule]);self.mode('rules')
    self.assertEqual(A.request_stages(req),[words])
    self.assertTrue(A.matches(rule,req,ctx));self.assertEqual(A.evaluate(self.path)['action'],'allow')
    deny={**rule,'decision':'deny'};A.write(A.store()/'rules.json',[deny])
    self.assertEqual(A.evaluate(self.path)['action'],'deny')
    with A.locked():self.assertEqual(A.read(A.store()/'rules.json'),[deny])
    self.command(command+' || tail other-file')
    self.assertEqual(A.evaluate(self.path)['action'],'deny')
    self.command(command)
    info=self.cli('inspect','--request',str(self.path));self.assertTrue(info['stage_exact'][0]);self.assertFalse(info['prefix_available'])
    self.assertIn('wrapper',info['boundary'])
    self.assertEqual(A.grant(self.path)['match'],'exact')
    with self.assertRaisesRegex(ValueError,'wrapper'):A.grant(self.path,match='prefix',prefix=command)

class CommandChains(unittest.TestCase):
 setUp=fixtures.ApprovalPolicy.setUp
 mode=fixtures.ApprovalPolicy.mode
 cli=ExecutionRules.cli
 command=ExecutionRules.command
 def test_every_operator_requires_every_component_and_any_branch_deny_wins(self):
  for operator in ('|','&&','||',';','\n','|&'):
   with self.subTest(operator=operator):
    A.write(A.store()/'rules.json',[])
    req=self.command('tail "$FILE" '+operator+' curl "$URL"')
    first=self.cli('grant','--request',str(self.path),'--stage','0','--match','prefix','--prefix','tail','--respond')
    self.assertEqual(first['action'],'wait');self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
    self.assertFalse(self.cli('inspect','--request',str(self.path))['future_only'])
    second=self.cli('grant','--request',str(self.path),'--stage','1','--match','prefix','--prefix','curl','--respond')
    self.assertEqual(second['action'],'allow');(self.path.parent.parent/'ans'/self.path.name).unlink()
    self.command('curl /restricted');A.grant(self.path,scope='space',decision='deny')
    self.command('tail file '+operator+' curl /restricted');self.assertEqual(A.evaluate(self.path)['action'],'deny')
    # Old whole-request hashes must not bypass either component grants or denies.
    A.write(A.store()/'rules.json',[{**first['rule'],'match':'request','action_key':A.action_key(A.read(self.path))}])
    self.assertEqual(A.evaluate(self.path)['action'],'wait')
 def test_mixed_precedence_keeps_structure_and_checks_all_branches(self):
  command='tail file && jq . || curl URL; rg needle file |& wc -l\nprintf done'
  req=self.command(command);parsed=A.request_analysis(req)
  self.assertTrue(parsed['complete']);self.assertEqual(parsed['operators'],['&&','||',';','|&','\n'])
  self.assertEqual(len(parsed['stages']),6)
  for i,prefix in enumerate(('tail','jq','curl','rg','wc','printf')):
   self.cli('grant','--request',str(self.path),'--stage',str(i),'--match','prefix','--prefix',prefix)
  self.assertEqual(A.evaluate(self.path)['action'],'allow')
  self.command('curl URL');A.grant(self.path,decision='deny');self.command(command)
  self.assertEqual(A.evaluate(self.path)['action'],'deny')
 def test_valid_terminators_blank_lines_and_operator_continuations(self):
  for command in ('tail file;','tail file\n','\n\ntail file\n\n','\ntail file','tail file;\n\ncurl URL;\n',
                  'tail file &&\n\ncurl URL','tail file ||\ncurl URL','tail file |\ncurl URL','tail file |&\ncurl URL'):
   req=self.command(command);parsed=A.request_analysis(req)
   self.assertTrue(parsed['complete'],command)
   self.assertEqual([s['argv'][0] for s in parsed['stages']],['tail','curl'] if 'curl' in command else ['tail'])
 def test_malformed_chains_are_future_only_and_cannot_use_payload_hashes(self):
  for command in ('tail file &&','tail file ||','tail file |','tail file |&','tail file && || curl URL',
                  'tail file;;curl URL',';tail file','tail file | | curl URL','tail file & curl URL',
                  'tail file && (curl URL)','tail file\r\ncurl URL'):
   req=self.command(command);ctx=A.request_context(self.path)[1];parsed=A.request_analysis(req)
   self.assertFalse(parsed['complete'],command);self.assertTrue(parsed['boundary'])
   rule={'id':'legacy','scope':'task','space':ctx['space'],'task':ctx['task'],'account':ctx['account'],'cwd':ctx['cwd'],'tool':'Bash','match':'request','action_key':A.action_key(req),'decision':'allow','expires':0}
   A.write(A.store()/'rules.json',[rule]);self.mode('rules');self.assertEqual(A.evaluate(self.path)['action'],'wait',command)
 def test_quoted_and_escaped_operators_are_literal_arguments(self):
  self.assertEqual(A.shell_stages("printf '%s' 'a&&b||c;d|&e'"),[['printf','%s','a&&b||c;d|&e']])
  self.assertEqual(A.shell_stages(r'printf a\&\&b\;c\|\&d'),[['printf','a&&b;c|&d']])
  self.assertEqual(A.shell_stages('printf "line\nbreak"'),[['printf','line\nbreak']])
  self.assertEqual(A.shell_stages("bash -lc 'tail file && curl URL'"),[['tail','file'],['curl','URL']])
 def test_history_keeps_mixed_operators_and_creates_future_rules_without_replay(self):
  req=self.command('tail file && curl URL; jq . |& wc -l');ctx=A.request_context(self.path)[1]
  A.audit(req,ctx,'ask','Waiting','user');row=A.history_rows()[-1];self.path.unlink()
  with mock.patch.object(A.subprocess,'run',side_effect=AssertionError('must not replay')):
   info=A.history_inspect(row['id']);self.assertEqual(info['operators'],['&&',';','|&'])
   rule=A.grant_history(row['id'],stage=0,match='prefix',prefix='tail')['rule']
  self.assertEqual(rule['pattern'],['tail']);self.assertEqual(rule['account'],ctx['account'])
  self.assertFalse(list((A.app_home()/'data/chat-asks/ans').glob('*')))

if __name__=='__main__':unittest.main()
