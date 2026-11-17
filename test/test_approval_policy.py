import home_guard  # noqa: F401
import json, os, sys, tempfile, time, unittest
from pathlib import Path
from unittest import mock
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'mods/tasks/bin'))
from herdr_task import approvals as A
class ApprovalPolicy(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
  self.env=mock.patch.dict(os.environ,{'HERDR_APP_HOME':str(self.base/'app'),'HERDR_TASK_SETTINGS':str(self.base/'settings.json'),'HC_TERMINAL_ID':'worker'});self.env.start();self.addCleanup(self.env.stop)
  self.meta={'state':'live','argv':['env','CODEX_HOME='+str(self.base/'account'),'codex'],'cwd':str(self.base/'repo'),'labels':{'herdr.task.space':'space','herdr.task':'TASK-1','herdr.coordinator':'assistant'}}
  self.hc=mock.patch.object(A,'hc_get',return_value=self.meta);self.hc.start();self.addCleanup(self.hc.stop)
  self.req={'session_id':'session','cwd':str(self.base/'repo'),'tool_name':'Bash','tool_input':{'command':'git status --short'}}
  self.path=A.app_home()/'data/chat-asks/req/worker.1.json';A.write(self.path,self.req)
 def mode(self,mode):A.write(self.base/'settings.json',{'everywhere':{'approvals':{'mode':mode}}})
 def test_default_is_manual_and_never_answers_questions_or_plans(self):
  self.assertEqual(A.evaluate(self.path)['action'],'wait')
  for tool in ('AskUserQuestion','ExitPlanMode','request_user_input'):
   A.write(self.path,{**self.req,'tool_name':tool});self.assertEqual(A.evaluate(self.path)['action'],'wait')
   with self.assertRaisesRegex(ValueError,'Plans and questions'):A.grant(self.path)
 def test_exact_task_grant_is_account_project_and_task_bound(self):
  rule=A.grant(self.path);self.assertEqual(A.evaluate(self.path)['action'],'allow');ctx=A.request_context(self.path)[1]
  for key,value in [('account','/different-account'),('cwd','/different-project'),('task','TASK-2'),('space','other')]:self.assertFalse(A.matches(rule,self.req,{**ctx,key:value}),key)
  self.assertFalse(A.matches(rule,{**self.req,'tool_input':{'command':'git status --long'}},ctx))
 def test_prefix_matches_arguments_and_rejects_shell_smuggling_and_blanket_interpreters(self):
  rule=A.grant(self.path,scope='space',match='prefix',prefix='git status');ctx=A.request_context(self.path)[1]
  self.assertTrue(A.matches(rule,{**self.req,'tool_input':{'command':'git status --branch'}},ctx))
  for cmd in ['git statusx','git status; rm -rf /tmp/test','git status && echo hi','git status $(whoami)']:
   self.assertFalse(A.matches(rule,{**self.req,'tool_input':{'command':cmd}},ctx))
  A.write(self.path,{**self.req,'tool_input':{'command':'python3 -c pass'}})
  with self.assertRaisesRegex(ValueError,'arbitrary'):A.grant(self.path,match='prefix',prefix='python3 -c')
 def test_expiry_denial_precedence_and_revocation(self):
  rule=A.grant(self.path,decision='allow');deny=A.grant(self.path,decision='deny');self.assertEqual(A.evaluate(self.path)['action'],'deny')
  A.write(A.store()/'rules.json',[rule]);self.assertEqual(A.evaluate(self.path)['action'],'allow')
  rule['expires']=time.time()-1;A.write(A.store()/'rules.json',[rule]);self.assertEqual(A.evaluate(self.path)['action'],'wait')
 def test_manual_pauses_persistent_rules_but_remembering_activates_only_the_current_session(self):
  self.mode('rules');rule=A.grant(self.path);A.write(A.store()/'overrides.json',{});self.mode('manual');self.assertEqual(A.evaluate(self.path)['action'],'wait')
  A.grant(self.path);self.assertEqual(A.evaluate(self.path)['action'],'allow')
  ctx=A.request_context(self.path)[1];self.assertEqual(A.settings({**ctx,'task':'TASK-2','session':'other'})['mode'],'manual')
 def test_role_space_and_task_overrides_are_resolved(self):
  A.write(self.base/'settings.json',{'everywhere':{'approvals':{'mode':'rules','worker':'assistant'}},'spaces':{'space':{'approvals':{'worker':'codex-review'}}}})
  ctx=A.request_context(self.path)[1];self.assertEqual(A.settings(ctx)['mode'],'codex-review');self.assertEqual(A.settings({**ctx,'task_mode':'manual'})['mode'],'manual')
 def test_native_reviewer_is_released_only_when_the_actual_codex_launch_has_it(self):
  self.mode('codex-review');self.assertEqual(A.evaluate(self.path)['action'],'wait')
  self.path.with_suffix('.context').unlink();self.meta['argv']+=['-c','approvals_reviewer="auto_review"'];self.assertEqual(A.evaluate(self.path)['action'],'native')
 def test_native_launch_keeps_account_and_session_and_enforces_an_interactive_sandbox(self):
  argv=['env','CODEX_HOME=/account-two','codex','resume','--no-daemon','--dangerously-bypass-approvals-and-sandbox','--ask-for-approval','never','id']
  out=A.launch_argv(argv,'space','worker','/repo','codex-review');self.assertIn('CODEX_HOME=/account-two',out);self.assertIn('id',out);self.assertIn('approvals_reviewer="auto_review"',out);self.assertNotIn('--dangerously-bypass-approvals-and-sandbox',out);self.assertNotIn('never',out)
 def test_native_reviewer_never_broadens_an_existing_read_only_sandbox(self):
  out=A.launch_argv(['codex','--sandbox','read-only','--ask-for-approval','never'],'space','reviewer','/repo','codex-review');self.assertEqual(out[out.index('-s')+1],'read-only');self.assertIn('on-request',out)
 def test_switching_away_from_native_review_drops_the_previous_reviewer_flag(self):
  argv=['env','CODEX_HOME=/account-two','codex','-c','approvals_reviewer="auto_review"','resume','id']
  out=A.launch_argv(argv,'space','worker','/repo','manual');self.assertNotIn('approvals_reviewer="auto_review"',out);self.assertIn('approvals_reviewer="user"',out);self.assertIn('CODEX_HOME=/account-two',out);self.assertIn('id',out)
 def test_assistant_review_is_request_bound_idempotent_and_audited(self):
  self.mode('assistant')
  with mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')) as send:
   self.assertEqual(A.evaluate(self.path)['action'],'wait');A.evaluate(self.path);self.assertEqual(send.call_count,1)
  ticket=A.read(A.store()/'pending/worker.1.json')
  with self.assertRaisesRegex(ValueError,'designated'):A.decide(ticket['id'],ticket['token'],'allow','Allowed',terminal='worker')
  with self.assertRaisesRegex(ValueError,'designated'):A.decide(ticket['id'],'wrong','allow','Allowed',terminal='assistant')
  out=A.decide(ticket['id'],ticket['token'],'allow','Local read command',terminal='assistant');self.assertEqual(out['decision'],'allow')
  ans=A.read(A.app_home()/'data/chat-asks/ans/worker.1.json');self.assertEqual(ans['hookSpecificOutput']['decision']['behavior'],'allow');self.assertEqual(A.read(A.store()/'history.json')[-1]['source'],'assistant')
  with self.assertRaisesRegex(ValueError,'already been answered'):A.decide(ticket['id'],ticket['token'],'allow','Again',terminal='assistant')
 def test_changed_requests_cannot_reuse_an_assistant_ticket(self):
  self.mode('assistant')
  with mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')):A.evaluate(self.path)
  ticket=A.read(A.store()/'pending/worker.1.json');A.write(self.path,{**self.req,'tool_input':{'command':'git push'}})
  with self.assertRaisesRegex(ValueError,'changed'):A.decide(ticket['id'],ticket['token'],'allow','No',terminal='assistant')
 def test_task_flag_can_override_then_restore_inheritance(self):
  from herdr_task.settings import set_opts
  import argparse
  task={};set_opts(task,argparse.Namespace(approval_mode='assistant'));self.assertEqual(task['approval_mode'],'assistant')
  set_opts(task,argparse.Namespace(approval_mode='inherit'));self.assertNotIn('approval_mode',task)
 def test_delegated_answer_does_not_replace_an_existing_human_decision(self):
  self.mode('assistant')
  with mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')):A.evaluate(self.path)
  ticket=A.read(A.store()/'pending/worker.1.json');answer=A.app_home()/'data/chat-asks/ans/worker.1.json'
  A.write(answer,A.response('deny','By person')['response'])
  with self.assertRaisesRegex(ValueError,'already been answered'):A.decide(ticket['id'],ticket['token'],'allow','Late answer',terminal='assistant')
  self.assertEqual(A.read(answer)['hookSpecificOutput']['decision']['behavior'],'deny')
 def test_expired_delegation_waits_for_the_person_instead_of_repeating_reviews(self):
  self.mode('assistant')
  with mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')) as send:
   A.evaluate(self.path);ticket_path=A.store()/'pending/worker.1.json';ticket=A.read(ticket_path);ticket['expires']=time.time()-1;A.write(ticket_path,ticket)
   out=A.evaluate(self.path);self.assertIn('expired',out['reason']);self.assertEqual(send.call_count,1)
 def test_native_review_removes_aliases_and_inline_config_overrides(self):
  out=A.launch_argv(['codex','--yolo','--config=approval_policy="never"','--config=sandbox_mode="read-only"'],'space','worker','/repo','codex-review')
  self.assertNotIn('--yolo',out);self.assertFalse(any('never' in x for x in out));self.assertEqual(out[out.index('-s')+1],'read-only')
 def test_history_redacts_credentials_and_grants_do_not_save_them(self):
  A.write(self.path,{**self.req,'tool_input':{'command':'tool --token secret-value'}})
  with self.assertRaisesRegex(ValueError,'credentials'):A.grant(self.path)
  A.audit(self.req,A.request_context(self.path)[1],'allow','By user','user');self.assertTrue(A.read(A.store()/'history.json'))
class ApprovalEnhancements(unittest.TestCase):
 setUp=ApprovalPolicy.setUp
 def test_compound_exact_action_is_scoped_to_task_and_payload(self):
  req={**self.req,'tool_input':{'command':'git status && echo done'}};A.write(self.path,req)
  rule=A.grant(self.path);self.assertEqual(rule['match'],'request');ctx=A.request_context(self.path)[1]
  self.assertTrue(A.matches(rule,{**req,'session_id':'new-request-id'},ctx))
  self.assertFalse(A.matches(rule,{**req,'tool_input':{'command':'git status && git push'}},ctx))
  self.assertFalse(A.matches(rule,req,{**ctx,'task':'other'}))
  with self.assertRaisesRegex(ValueError,'plain command'):A.grant(self.path,scope='space')
 def test_quoted_shell_punctuation_is_literal_but_expansion_and_compounds_are_not(self):
  self.assertEqual(A.plain_command("echo 'a;b'"),['echo','a;b'])
  self.assertEqual(A.plain_command('echo "a|b"'),['echo','a|b'])
  for command in ['echo a;b','echo "$(id)"','echo `id`','git status > out']:
   self.assertIsNone(A.plain_command(command))
 def test_non_shell_action_can_be_remembered_exactly_for_one_task(self):
  req={**self.req,'tool_name':'apply_patch','tool_input':{'patch':'*** Add File: a\n+hello'}};A.write(self.path,req)
  rule=A.grant(self.path);self.assertEqual(rule['match'],'request');self.assertEqual(A.evaluate(self.path)['action'],'allow')
class FeatureNaming(unittest.TestCase):
 def test_only_the_feature_owner_can_name_its_own_record(self):
  helper=str(A.app_home()/'mods/workspace-launchers/bin/workspace-state')
  req={'tool_input':{'command':['python3',helper,'feature-name',json.dumps({'id':'one','name':'Browser tabs'})]}}
  self.assertTrue(A.own_feature_name(req,{'role':'feature','feature':'one'}))
  self.assertFalse(A.own_feature_name(req,{'role':'worker','feature':'one'}))
  self.assertFalse(A.own_feature_name(req,{'role':'feature','feature':'two'}))
if __name__=='__main__':unittest.main()

class ApprovalHistoryRules(unittest.TestCase):
 setUp=ApprovalPolicy.setUp
 mode=ApprovalPolicy.mode
 def history(self):
  ctx=A.request_context(self.path)[1];A.audit(self.req,ctx,'allow','Decided by person','user');return A.history_rows()[-1],ctx
 def test_completed_approval_keeps_exact_account_folder_and_task_without_replaying(self):
  row,ctx=self.history();self.path.unlink();self.path.with_suffix('.context').unlink()
  self.meta['cwd']='/different';self.meta['argv']=['env','CODEX_HOME=/other','codex']
  with mock.patch.object(A.subprocess,'run',side_effect=AssertionError('must not execute or inspect a current terminal')):
   info=A.history_inspect(row['id']);out=A.grant_history(row['id'],match='prefix',prefix='git status')
  rule=out['rule'];self.assertEqual(info['context']['cwd'],ctx['cwd']);self.assertEqual(rule['account'],ctx['account'])
  self.assertTrue(A.matches(rule,self.req,ctx));self.assertFalse(A.matches(rule,self.req,{**ctx,'account':'other'}))
  self.assertFalse(list((A.app_home()/'data/chat-asks/ans').glob('*')))
  self.assertEqual(A.history_rows()[-1]['source'],'user')
 def test_complex_historical_actions_remain_task_and_payload_bound(self):
  self.req={**self.req,'tool_input':{'command':'git status && echo done'}};A.write(self.path,self.req)
  row,ctx=self.history();rule=A.grant_history(row['id'])['rule'];self.assertEqual(rule['match'],'request')
  self.assertTrue(A.matches(rule,self.req,ctx));self.assertFalse(A.matches(rule,{**self.req,'tool_input':{'command':'git push'}},ctx))
  with self.assertRaisesRegex(ValueError,'plain command'):A.grant_history(row['id'],scope='space')
 def test_redacted_and_contextless_legacy_history_never_guess_a_rule(self):
  self.req={**self.req,'tool_input':{'command':'tool --token private-secret'}};A.write(self.path,self.req)
  row,_=self.history();self.assertNotIn('private-secret',json.dumps(row));self.assertNotIn('rule_seed',row)
  with self.assertRaisesRegex(ValueError,'context'):A.history_inspect(row['id'])
  A.write(A.store()/'history.json',[{'at':1,'key':'old','source':'user','command':'git status','account':'old'}])
  legacy=A.history_rows()[0];self.assertTrue(legacy['id'])
  with self.assertRaisesRegex(ValueError,'context'):A.grant_history(legacy['id'])
 def test_native_review_history_reports_handoff_without_claiming_an_allow(self):
  self.mode('codex-review');self.meta['argv']+=['-c','approvals_reviewer="auto_review"']
  self.assertEqual(A.evaluate(self.path)['action'],'native');row=A.history_rows()[-1]
  self.assertEqual(row['source'],'codex-review');self.assertEqual(row['decision'],'delegated')
