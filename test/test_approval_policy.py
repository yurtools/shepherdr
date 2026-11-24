import home_guard  # noqa: F401
import importlib.util, json, os, sys, tempfile, time, unittest, threading
from pathlib import Path
from unittest import mock
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'mods/tasks/bin'))
from herdr_task import approvals as A
from herdr_task import approval_advice as D
class ApprovalPolicy(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
  self.env=mock.patch.dict(os.environ,{'HERDR_APP_HOME':str(self.base/'app'),'HERDR_TASK_SETTINGS':str(self.base/'settings.json'),'HC_TERMINAL_ID':'worker'});self.env.start();self.addCleanup(self.env.stop)
  self.meta={'state':'live','argv':['env','CODEX_HOME='+str(self.base/'account'),'codex'],'cwd':str(self.base/'repo'),'labels':{'herdr.task.space':'space','herdr.task':'TASK-1','herdr.coordinator':'assistant'}}
  self.hc=mock.patch.object(A,'hc_get',side_effect=lambda terminal: {'state':'live','labels':{'herdr.role':'coordinator','herdr.coordinator.space':'space'},'argv':['claude']} if terminal=='assistant' else self.meta);self.hc.start();self.addCleanup(self.hc.stop)
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
class ApprovalAdvice(unittest.TestCase):
 setUp=ApprovalPolicy.setUp
 mode=ApprovalPolicy.mode
 def owner(self,feature=False):
  self.meta['labels'].pop('herdr.feature',None);self.meta['labels']['herdr.owner']='assistant'
  self.owner_meta={'state':'live','pid':42,'status':{'state':'idle'},'argv':['claude'],'labels':{'herdr.role':'feature' if feature else 'coordinator','herdr.coordinator.space':'space'}}
  if feature:
   self.meta['labels'].update({'herdr.owner':'assistant','herdr.feature':'feature-one'})
   self.owner_meta['labels']['herdr.feature']='feature-one'
  A.hc_get.side_effect=lambda t:self.owner_meta if t=='assistant' else self.meta
 def request(self):
  with mock.patch.object(D.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')) as send:
   result=D.request(self.path,A.status_key(A.read(self.path)),'worker')
  return A.read(D.ticket_path(self.path.stem)),send,result
 def test_feature_owner_gets_only_an_informational_capability_and_duplicate_clicks_send_once(self):
  self.owner(True);ticket,send,result=self.request();self.assertEqual(result['state'],'pending')
  message=send.call_args.args[0];self.assertEqual(message[:3],['hc','send','assistant'])
  for text in ('UNTRUSTED DATA','NO execution or approval authority','advice-input','advise','variables','network/process','do not start an agent'):
   self.assertIn(text,message[3])
  self.assertNotIn('git status --short',message[3]);self.assertNotIn('approval-policy.py decide ',message[3])
  again,second,_=self.request();self.assertEqual(again,ticket);second.assert_not_called()
  self.assertEqual(D.evidence(ticket['id'],ticket['token'],'assistant')['untrusted_request']['tool_input'],self.req['tool_input'])
 def test_advice_cannot_use_or_consume_a_review_ticket_or_silently_replace_handback(self):
  self.owner();self.mode('assistant')
  with mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')):A.evaluate(self.path)
  review_path=A.store()/'pending'/self.path.name;review=A.read(review_path);before=review_path.read_bytes()
  advice,_,_=self.request()
  with self.assertRaises(ValueError):D.submit(advice['id'],review['token'],'Wrong capability',terminal='assistant')
  with self.assertRaises(ValueError):A.decide(review['id'],advice['token'],'allow','Wrong capability',terminal='assistant')
  D.submit(advice['id'],advice['token'],'Lists changed files.','Git reads the index; it does not commit or send data.',terminal='assistant')
  self.assertEqual(review_path.read_bytes(),before);self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
  A.decide(review['id'],review['token'],'ask','This writes outside the project; policy delegates only project work.',terminal='assistant')
  status=self.path.with_suffix('.status').read_bytes();A.evaluate(self.path)
  self.assertEqual(self.path.with_suffix('.status').read_bytes(),status)
  self.assertEqual(A.read(self.path.with_suffix('.advice'))['state'],'ready')
  # Advice remains usable after hand-back without obtaining a new review ticket.
  review_before=review_path.read_bytes();self.request();self.assertEqual(review_path.read_bytes(),review_before)
 def test_manual_approval_remains_available_during_advice_and_closed_response_is_rejected(self):
  self.owner();advice,_,_=self.request()
  import importlib.util
  spec=importlib.util.spec_from_file_location('advice_ui',ROOT/'mods/chat/approval-policy.py');ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui)
  result=ui.main(ui.parser().parse_args(['answer','--request',str(self.path),'--hash',A.status_key(self.req),'--answer',json.dumps(A.response('deny')['response'])]))
  self.assertEqual(result['action'],'answered')
  with self.assertRaisesRegex(ValueError,'answered'):D.submit(advice['id'],advice['token'],'Late advice',terminal='assistant')
  self.assertEqual(A.read(self.path.parent.parent/'ans'/self.path.name)['hookSpecificOutput']['decision']['behavior'],'deny')
 def test_advice_does_not_change_rules_settings_modes_history_or_pending_request(self):
  for mode in ('manual','codex-review','assistant'):
   with self.subTest(mode=mode):
    self.owner();self.mode(mode);A.write(A.store()/'rules.json',[]);A.write(A.store()/'overrides.json',{});A.write(A.store()/'history.json',[])
    files=[self.path,self.base/'settings.json',*[A.store()/n for n in ('rules.json','overrides.json','history.json')]]
    before={p:p.read_bytes() for p in files};D.ticket_path(self.path.stem).unlink(missing_ok=True)
    ticket,_,_=self.request();D.submit(ticket['id'],ticket['token'],'Reads Git state.',terminal='assistant')
    self.assertEqual({p:p.read_bytes() for p in files},before);self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
    self.assertFalse((A.store()/'pending'/self.path.name).exists())
 def test_unknown_offline_busy_wrong_space_and_self_owners_never_receive_advice(self):
  for case in ('offline','busy','blocked','wrong-space','wrong-feature','self','shell','unknown-state','no-process'):
   with self.subTest(case=case):
    self.owner(True);self.path.with_suffix('.context').unlink(missing_ok=True);D.ticket_path(self.path.stem).unlink(missing_ok=True)
    if case=='offline':self.owner_meta['state']='gone'
    elif case in ('busy','blocked'):self.owner_meta['status']['state']='working' if case=='busy' else 'blocked'
    elif case=='wrong-space':self.owner_meta['labels']['herdr.coordinator.space']='other'
    elif case=='wrong-feature':self.owner_meta['labels']['herdr.feature']='other'
    elif case=='shell':self.owner_meta['argv']=['bash']
    elif case=='unknown-state':self.owner_meta.pop('status')
    elif case=='no-process':self.owner_meta.pop('pid')
    else:self.meta['labels']['herdr.owner']='worker'
    ticket,send,result=self.request();send.assert_not_called();self.assertIn(result['state'],('busy','unavailable'))
  self.owner();self.meta['labels'].pop('herdr.coordinator',None);self.meta['labels'].pop('herdr.owner',None);self.path.with_suffix('.context').unlink();D.ticket_path(self.path.stem).unlink()
  with mock.patch.object(D.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{"terminals":[]}')) as calls:
   self.assertEqual(D.request(self.path,A.status_key(self.req))['state'],'unavailable');self.assertEqual(calls.call_args.args[0],['hc','ls','--json'])
 def test_wrong_sender_expiry_replacement_closure_replay_and_owner_restart_cannot_publish(self):
  for case in ('sender','expired','replacement','closed','replay','owner-restarted','different-role','different-space','different-feature','context'):
   with self.subTest(case=case):
    self.owner();A.write(self.path,self.req);self.path.with_suffix('.context').unlink(missing_ok=True);D.ticket_path(self.path.stem).unlink(missing_ok=True)
    ticket,_,_=self.request();public=self.path.with_suffix('.advice').read_bytes()
    if case=='expired':ticket['expires']=time.time()-1;A.write(D.ticket_path(ticket['id']),ticket)
    elif case=='replacement':A.write(self.path,{**self.req,'session_id':'new-session','tool_input':{'command':'git push'}})
    elif case=='closed':self.path.unlink()
    elif case=='replay':self.path.unlink();A.write(self.path,self.req)
    elif case=='owner-restarted':self.owner_meta['pid']=43
    elif case=='different-role':self.owner_meta['labels']['herdr.role']='worker'
    elif case=='different-space':self.owner_meta['labels']['herdr.coordinator.space']='other'
    elif case=='different-feature':self.owner_meta['labels']['herdr.feature']='another-feature'
    elif case=='context':A.write(self.path.with_suffix('.context'),{**ticket['context'],'account':'/other'})
    with self.assertRaises((ValueError,OSError)):D.submit(ticket['id'],ticket['token'],'Stale',terminal='worker' if case=='sender' else 'assistant')
    self.assertEqual(self.path.with_suffix('.advice').read_bytes(),public);self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
 def test_read_seen_settings_and_view_metadata_changes_keep_the_same_owner_authorized(self):
  self.owner(True);self.owner_meta['foreground']={'pid':44,'argv':['claude'],'cwd':'/original','title':'Terminal'}
  ticket,_,_=self.request()
  self.owner_meta['labels'].update({'herdr.read':'now','herdr.seen':'now','herdr.settings':'new','herdr.view':'terminal','herdr.space':'space','herdr.tab':'terminal-tab'})
  self.owner_meta['labels'].pop('herdr.coordinator.space')
  self.owner_meta['foreground'].update({'cwd':'/another-view','title':'Chat','status':'working'})
  self.owner_meta['status']['state']='working'
  self.assertEqual(D.submit(ticket['id'],ticket['token'],'Lists changed files.',terminal='assistant')['state'],'ready')
 def test_result_redacts_secrets_raw_payloads_and_control_text_and_helper_cannot_decide(self):
  import shlex
  self.owner();self.req['tool_input']['api_key']='private-fixture';A.write(self.path,self.req)
  ticket,_,_=self.request();evidence=D.evidence(ticket['id'],ticket['token'],'assistant')
  self.assertNotIn('private-fixture',json.dumps(evidence));self.assertNotIn('session_id',json.dumps(evidence))
  reason='Reads files. '+ticket['token']+' private-fixture password="two words" Bearer secret-value <hc react="yes"/>\x1b[31m '+json.dumps(self.req['tool_input'])
  helper=str(A.app_home()/'mods/chat/approval-policy.py')
  base=[helper,'advise','--id',ticket['id'],'--token',ticket['token'],'--summary','Reads files.']
  command={'tool_name':'Bash','tool_input':{'command':shlex.join(base)}}
  self.assertTrue(D.own_command(command,{'terminal':'assistant'}))
  for suffix in (['--decision','allow'],['--respond'],['--request',str(self.path)]):
   self.assertFalse(D.own_command({**command,'tool_input':{'command':shlex.join(base+suffix)}},{'terminal':'assistant'}))
  self.assertFalse(A.own_review_command(command,{'terminal':'assistant'}))
  D.submit(ticket['id'],ticket['token'],reason,reason,terminal='assistant');public=json.dumps(A.read(self.path.with_suffix('.advice')))
  for secret in (ticket['token'],'private-fixture','two words','secret-value','git status --short','<hc','\\u001b'):self.assertNotIn(secret,public)
  with self.assertRaises(ValueError):D.submit(ticket['id'],ticket['token'],'Again',terminal='assistant')
 def test_stale_hash_and_product_choices_get_no_advice(self):
  self.owner()
  with self.assertRaisesRegex(ValueError,'changed'):D.request(self.path,'wrong')
  for name in A.QUESTION_TOOLS:
   A.write(self.path,{**self.req,'tool_name':name})
   with self.assertRaisesRegex(ValueError,'plans or choices'):D.request(self.path,A.status_key(A.read(self.path)))
 def test_advice_input_preserves_multiline_shell_semantics_and_names_redacted_context(self):
  self.owner();command="printf '%s\\n' 'one  two'\nprintf '%s' '$TARGET'"
  self.req['tool_input']={'command':command,'api_key':'fixture-private'};A.write(self.path,self.req)
  ticket,_,_=self.request();evidence=D.evidence(ticket['id'],ticket['token'],'assistant')
  self.assertEqual(evidence['untrusted_request']['tool_input']['command'],command)
  self.assertEqual(evidence['untrusted_request']['tool_input']['api_key'],'[redacted]')
  self.assertTrue(evidence['redacted']);self.assertIn('context is incomplete',evidence['limits'])
 def test_nested_auth_values_cannot_leak_into_advice_evidence_or_public_results(self):
  self.owner();self.req['tool_input']={'command':'echo private-array-fixture','credentials':{'values':['private-array-fixture']}};A.write(self.path,self.req)
  ticket,_,_=self.request();self.assertNotIn('private-array-fixture',json.dumps(D.evidence(ticket['id'],ticket['token'],'assistant')))
  D.submit(ticket['id'],ticket['token'],'Unknown value private-array-fixture',terminal='assistant')
  self.assertNotIn('private-array-fixture',json.dumps(A.read(self.path.with_suffix('.advice'))))
 def test_click_during_owner_lookup_is_deduped_and_expired_advice_can_be_retried(self):
  self.owner();A.request_context(self.path,'worker');observed=[]
  def lookup(terminal):
   if terminal=='assistant' and not observed:
    observed.append(D.request(self.path,A.status_key(self.req),'worker')['state'])
   return self.owner_meta if terminal=='assistant' else self.meta
  A.hc_get.side_effect=lookup
  ticket,send,_=self.request();self.assertEqual(observed,['processing']);self.assertEqual(send.call_count,1)
  ticket['expires']=time.time()-1;A.write(D.ticket_path(ticket['id']),ticket)
  replacement,send,_=self.request();self.assertNotEqual(replacement['token'],ticket['token']);self.assertEqual(send.call_count,1)
  with self.assertRaises(ValueError):D.submit(ticket['id'],ticket['token'],'Expired response',terminal='assistant')
 def test_fast_advice_survives_a_delivery_error_without_creating_a_review(self):
  self.owner()
  def deliver(*args,**kwargs):
   ticket=A.read(D.ticket_path(self.path.stem));D.submit(ticket['id'],ticket['token'],'Reads project files.',terminal='assistant')
   return mock.Mock(returncode=1,stdout='')
  with mock.patch.object(D.subprocess,'run',side_effect=deliver):self.assertEqual(D.request(self.path,A.status_key(self.req),'worker')['state'],'ready')
  self.assertEqual(A.read(self.path.with_suffix('.advice'))['state'],'ready');self.assertFalse((A.store()/'pending'/self.path.name).exists())
 def test_own_advice_helper_is_informational_without_reading_or_changing_policy(self):
  import shlex
  self.owner();self.mode('codex-review');ticket,_,_=self.request()
  helper=str(A.app_home()/'mods/chat/approval-policy.py')
  child=A.app_home()/'data/chat-asks/req/assistant.child.json'
  A.write(child,{'session_id':'owner-session','cwd':self.req['cwd'],'tool_name':'Bash','tool_input':{'command':shlex.join([helper,'advise','--id',ticket['id'],'--token',ticket['token'],'--summary','Reads files.'])}})
  with mock.patch.object(A,'settings',side_effect=AssertionError('Advice control must not evaluate approval policy')):
   result=A.evaluate(child,'assistant')
  self.assertEqual(result['source'],'advice-control');self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
  self.assertEqual(A.read(D.ticket_path(ticket['id']))['status'],'pending')

class ApprovalEnhancements(unittest.TestCase):
 setUp=ApprovalPolicy.setUp
 def test_redirected_exact_action_is_scoped_to_task_and_payload(self):
  req={**self.req,'tool_input':{'command':'git status > report.txt'}};A.write(self.path,req)
  rule=A.grant(self.path);self.assertEqual(rule['match'],'request');ctx=A.request_context(self.path)[1]
  self.assertTrue(A.matches(rule,{**req,'session_id':'new-request-id'},ctx))
  self.assertFalse(A.matches(rule,{**req,'tool_input':{'command':'git status > other-report.txt'}},ctx))
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

class ApprovalLifecycle(unittest.TestCase):
 setUp=ApprovalPolicy.setUp
 mode=ApprovalPolicy.mode
 def state(self):return A.read(self.path.with_suffix('.status'))
 def test_poll_in_flight_cannot_erase_an_assistant_handback(self):
  ticket,reviewer=self.review()
  entered=threading.Event();resume=threading.Event();errors=[]
  def lookup(terminal):
   if threading.current_thread().name=='approval-poll':
    entered.set()
    if not resume.wait(5):raise AssertionError('poll was not resumed')
   return reviewer
  def poll():
   try:A.evaluate(self.path)
   except Exception as e:errors.append(e)
  A.hc_get.side_effect=lookup
  thread=threading.Thread(target=poll,name='approval-poll');thread.start()
  try:
   self.assertTrue(entered.wait(5))
   A.decide(ticket['id'],ticket['token'],'ask','This writes outside the project; policy delegates only project work.',terminal='assistant')
  finally:resume.set();thread.join(5)
  self.assertFalse(thread.is_alive());self.assertEqual(errors,[])
  self.assertEqual(self.state()['state'],'person')
  self.assertIn('outside the project',self.state()['review_reason'])
  self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
 def review(self,mode='assistant',kind='feature',delivery=0):
  self.mode(mode)
  if kind=='feature':self.meta['labels'].update({'herdr.feature':'feature-one','herdr.owner':'assistant'})
  else:
   for key in ('herdr.feature','herdr.owner'):self.meta['labels'].pop(key,None)
  worker=self.meta.copy()
  reviewer={'state':'live','labels':{'herdr.role':kind if kind=='feature' else 'coordinator','herdr.coordinator.space':'space',**({'herdr.feature':'feature-one'} if kind=='feature' else {})}}
  A.hc_get.side_effect=lambda terminal:reviewer if terminal=='assistant' else worker
  with mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=delivery,stdout='{}')):
   if mode=='manual':
    req,ctx=A.request_context(self.path);A.review_ticket(self.path,req,ctx,True)
   else:A.evaluate(self.path)
  return A.read(A.store()/'pending'/self.path.name),reviewer
 def test_new_request_is_checking_during_policy_work_then_becomes_manual_or_unmatched(self):
  def metadata(terminal):
   self.assertEqual(self.state()['state'],'checking');return self.meta
  A.hc_get.side_effect=metadata
  A.evaluate(self.path);self.assertEqual(self.state()['reason'],'manual')
  A.hc_get.side_effect=None;self.mode('rules');A.evaluate(self.path)
  self.assertEqual(self.state()['reason'],'no-rule');self.assertEqual(self.state()['request_hash'],A.status_key(self.req))
 def test_feature_and_space_reviews_use_only_authoritative_reviewer_types(self):
  for kind in ('feature','space'):
   with self.subTest(kind=kind):
    self.path.with_suffix('.context').unlink(missing_ok=True)
    (A.store()/'pending'/self.path.name).unlink(missing_ok=True)
    ticket,_=self.review(kind=kind);self.assertEqual(self.state()['state'],'assistant');self.assertEqual(self.state()['reviewer'],kind)
    public=json.dumps(self.state());self.assertNotIn(ticket['token'],public);self.assertNotIn('tool_input',public);self.assertNotIn(self.req['tool_input']['command'],public)
 def test_explicit_review_in_manual_mode_updates_and_survives_later_hook_evaluation(self):
  self.meta['labels'].update({'herdr.feature':'feature-one','herdr.owner':'assistant'})
  A.evaluate(self.path);self.assertEqual(self.state()['state'],'person')
  ticket,_=self.review('manual');self.assertEqual(self.state()['state'],'assistant')
  with mock.patch.object(A.subprocess,'run',side_effect=AssertionError('must not redeliver')):A.evaluate(self.path)
  self.assertEqual(self.state()['state'],'assistant')
  A.decide(ticket['id'],ticket['token'],'ask','Please decide',terminal='assistant')
  A.evaluate(self.path);self.assertEqual(self.state()['reason'],'assistant-asked')
  self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
 def test_failed_delivery_recovers_on_later_evaluation_without_a_new_person_prompt(self):
  ticket,_=self.review(delivery=1);self.assertEqual(ticket['status'],'unavailable');self.assertEqual(self.state()['reason'],'review-unavailable')
  with mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')) as send:
   A.evaluate(self.path);A.evaluate(self.path);self.assertEqual(send.call_count,1)
  self.assertEqual(self.state()['state'],'assistant');self.assertEqual(A.read(A.store()/'pending'/self.path.name)['status'],'pending')
  self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
 def test_reviewer_disappearing_recovers_but_expired_review_stays_with_person(self):
  ticket,reviewer=self.review();reviewer['state']='gone';A.evaluate(self.path);self.assertEqual(self.state()['reason'],'review-unavailable')
  reviewer['state']='live';A.evaluate(self.path);self.assertEqual(self.state()['state'],'assistant')
  ticket['expires']=time.time()-1;A.write(A.store()/'pending'/self.path.name,ticket)
  with mock.patch.object(A.subprocess,'run',side_effect=AssertionError('expired review must not redeliver')):A.evaluate(self.path)
  self.assertEqual(self.state()['reason'],'review-expired')
 def test_policy_read_errors_leave_person_status_and_questions_get_no_status(self):
  (self.base/'settings.json').write_text('{bad json');A.evaluate(self.path);self.assertEqual(self.state()['reason'],'policy-error')
  with mock.patch.object(A,'settings',side_effect=OSError('private error details')):
   with self.assertRaises(OSError):A.evaluate(self.path)
  self.assertNotIn('private error details',json.dumps(self.state()))
  self.path.with_suffix('.status').unlink()
  for tool in ('AskUserQuestion','ExitPlanMode','request_user_input'):
   A.write(self.path,{**self.req,'tool_name':tool});A.evaluate(self.path);self.assertIsNone(self.state())
 def test_native_unavailable_and_stale_or_closed_request_status(self):
  self.mode('codex-review');A.evaluate(self.path);self.assertEqual(self.state()['reason'],'native-unavailable')
  before=self.state();A.write(self.path,{**self.req,'tool_input':{'command':'different'}})
  A.status(self.path,self.req,'assistant',reviewer='feature');self.assertEqual(self.state(),before)
  self.path.unlink();A.status(self.path,self.req,'checking');self.assertEqual(self.state(),before)
 def test_hook_answer_claim_rejects_a_closed_native_handoff_and_preserves_manual_takeover(self):
  import importlib.util
  spec=importlib.util.spec_from_file_location('approval_ui',ROOT/'mods/chat/approval-policy.py');ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui)
  args=ui.parser().parse_args(['evaluate','--request',str(self.path),'--respond'])
  def closed(*_,**kwargs):self.path.unlink();return {'action':'native'}
  with mock.patch.object(A,'evaluate',side_effect=closed):
   with self.assertRaisesRegex(ValueError,'changed or closed'):ui.main(args)
  self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
  A.write(self.path,self.req);answer=self.path.parent.parent/'ans'/self.path.name
  A.answer_once(answer,A.response('deny','The person decided')['response'])
  with mock.patch.object(A,'evaluate',return_value={'action':'native'}):
   with self.assertRaisesRegex(ValueError,'already been answered'):ui.main(args)
  self.assertEqual(A.read(answer)['hookSpecificOutput']['decision']['behavior'],'deny')
  self.assertFalse((self.path.parent.parent/'end'/self.path.stem).exists())
 def test_unreadable_saved_rules_explain_the_manual_fallback_without_changing_mode(self):
  self.mode('rules');folder=A.store();folder.mkdir(parents=True,exist_ok=True);(folder/'rules.json').write_text('{bad')
  self.assertEqual(A.evaluate(self.path)['action'],'wait');self.assertEqual(self.state()['reason'],'policy-error')
 def test_manual_takeover_audits_only_after_winning_the_answer(self):
  import importlib.util
  spec=importlib.util.spec_from_file_location('approval_ui',ROOT/'mods/chat/approval-policy.py');ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui)
  args=ui.parser().parse_args(['answer','--request',str(self.path),'--hash',A.status_key(self.req),'--answer',json.dumps(A.response('allow')['response']),'--reason','Allowed in Chat'])
  A.request_context(self.path);self.assertEqual(ui.main(args)['action'],'answered')
  self.assertEqual(A.history_rows()[-1]['source'],'user')
  with self.assertRaisesRegex(ValueError,'already been answered'):ui.main(args)
  self.assertEqual(len(A.history_rows()),1)
 def test_native_handoff_losing_to_a_person_is_not_recorded_as_sent(self):
  import importlib.util
  spec=importlib.util.spec_from_file_location('approval_ui',ROOT/'mods/chat/approval-policy.py');ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui)
  self.mode('codex-review');self.meta['argv']+=['-c','approvals_reviewer="auto_review"']
  args=ui.parser().parse_args(['evaluate','--request',str(self.path),'--respond'])
  original=A.answer_once
  def person_wins(path,value):
   original(path,A.response('deny','Person decided')['response']);original(path,value)
  with mock.patch.object(A,'answer_once',side_effect=person_wins):
   with self.assertRaisesRegex(ValueError,'already been answered'):ui.main(args)
  self.assertEqual(A.history_rows(),[])
class AssistantReviewRegression(unittest.TestCase):
 setUp=ApprovalPolicy.setUp
 mode=ApprovalPolicy.mode
 def ui(self,*args):
  import importlib.util
  spec=importlib.util.spec_from_file_location('approval_ui',ROOT/'mods/chat/approval-policy.py');ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui)
  return ui.main(ui.parser().parse_args(list(args)))
 def delegate(self,mode='rules',during=None):
  self.mode(mode);req,ctx=A.request_context(self.path)
  original=A.hc_get.side_effect
  def lookup(terminal):
   if during:during()
   return {'state':'live','labels':{'herdr.role':'coordinator','herdr.coordinator.space':'space'},'argv':['claude']}
  A.hc_get.side_effect=lookup
  try:
   with mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')) as send:
    out=self.ui('review','--request',str(self.path),'--terminal','worker')
   return out,A.read(A.store()/'pending'/self.path.name),send
  finally:A.hc_get.side_effect=original
 def test_poll_during_explicit_review_lookup_does_not_restore_no_rule(self):
  observed=[]
  def poll():
   # No recursive reviewer lookup: the ticket must describe processing already.
   with mock.patch.object(A,'hc_get',return_value={'state':'live','labels':{'herdr.role':'coordinator','herdr.coordinator.space':'space'}}):A.evaluate(self.path)
   observed.append(A.read(self.path.with_suffix('.status'))['state'])
  self.delegate(during=poll)
  self.assertTrue(observed);self.assertNotIn('person',observed)
 def test_uncertain_review_publishes_its_specific_reason_on_the_card(self):
  _,ticket,_=self.delegate()
  A.decide(ticket['id'],ticket['token'],'ask','The destination is outside the project. Please choose.',terminal='assistant')
  A.evaluate(self.path)
  status=A.read(self.path.with_suffix('.status'))
  self.assertEqual(status['reason'],'assistant-asked');self.assertIn('outside the project',status.get('review_reason',''))
  self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
 def test_allow_writes_an_assistant_outcome_for_only_the_original_hook(self):
  _,ticket,send=self.delegate('manual')
  A.decide(ticket['id'],ticket['token'],'allow','Read-only inspection needed for this task.',terminal='assistant')
  end=self.path.parent.parent/'end'/self.path.stem
  self.assertTrue(end.exists(),'Assistant decisions must publish an outcome for the card')
  self.assertIn('Allowed by Assistant',end.read_text());self.assertIn('Read-only inspection',end.read_text())
  self.assertEqual(len(list((self.path.parent.parent/'ans').glob('*'))),1)
  self.assertEqual(A.history_rows()[-1]['source'],'assistant')
  self.assertEqual(send.call_count,1);self.assertEqual(send.call_args.args[0][:3],['hc','send','assistant'])
 def test_review_prompt_demands_independent_judgment_and_complete_submission(self):
  self.req['tool_input']['command']='git status | wc -l';A.write(self.path,self.req)
  _,ticket,send=self.delegate()
  prompt=send.call_args.args[0][-1]
  self.assertIn('No saved allow rule is required',prompt)
  self.assertIn('every component command',prompt);self.assertIn('before going quiet',prompt)
  self.assertIn(json.dumps(self.req,ensure_ascii=False),prompt)
  self.assertEqual(ticket['context']['task'],'TASK-1')
 def test_explicit_review_does_not_delegate_around_an_unreadable_policy(self):
  self.mode('manual');(self.base/'settings.json').write_text('{broken')
  with mock.patch.object(A.subprocess,'run',side_effect=AssertionError('must not delegate')):
   self.ui('review','--request',str(self.path),'--terminal','worker')
  self.assertEqual(A.read(self.path.with_suffix('.status'))['reason'],'policy-error')
 def test_scripts_pipelines_and_named_tools_review_without_prefix_or_rule_grants(self):
  cases=[('Bash',{'command':'git status | wc -l'}),('Bash',{'command':'python3 -c "print(1)" > report.txt'}),('mcp__fixture__inspect',{'command':'this is tool data','path':'project'})]
  for i,(tool,value) in enumerate(cases):
   for mode in ('manual','rules','assistant'):
    for decision in ('allow','deny','ask'):
     with self.subTest(tool=tool,mode=mode,decision=decision):
      self.path=A.app_home()/f'data/chat-asks/req/worker.{i}.{mode}.{decision}.json'
      self.req={**self.req,'tool_name':tool,'tool_input':value};A.write(self.path,self.req)
      A.write(A.store()/'rules.json',[])
      with A.locked():before=A.read(A.store()/'rules.json')
      _,ticket,send=self.delegate(mode)
      A.decide(ticket['id'],ticket['token'],decision,'Safe local inspection.' if decision=='allow' else 'The destination needs your choice.',terminal='assistant')
      with A.locked():self.assertEqual(A.read(A.store()/'rules.json'),before)
      self.assertEqual(A.settings(ticket['context'])['mode'],mode)
      answer=self.path.parent.parent/'ans'/self.path.name
      if decision=='ask':
       self.assertFalse(answer.exists());A.evaluate(self.path);self.assertEqual(A.read(self.path.with_suffix('.status'))['reason'],'assistant-asked')
      else:
       self.assertEqual(A.read(answer),A.response(decision,'The destination needs your choice.' if decision=='deny' else '')['response'])
       with self.assertRaisesRegex(ValueError,'already been answered'):A.decide(ticket['id'],ticket['token'],'allow','Again',terminal='assistant')
      self.assertEqual(A.history_rows()[-1]['source'],'assistant');self.assertEqual(send.call_count,1)
 def test_double_click_during_lookup_reuses_processing_ticket_and_sends_once(self):
  seen=[]
  def click():
   if not seen:
    seen.append(None);seen[0]=self.ui('review','--request',str(self.path),'--terminal','worker')
  _,ticket,send=self.delegate(during=click)
  self.assertEqual(send.call_count,1);self.assertTrue(seen);self.assertEqual(ticket['status'],'pending')
 def test_saved_denies_and_later_policy_failures_cannot_be_overridden(self):
  self.mode('manual');A.grant(self.path,decision='deny');A.write(A.store()/'overrides.json',{})
  with mock.patch.object(A.subprocess,'run',side_effect=AssertionError('deny must not delegate')):
   result=self.ui('review','--request',str(self.path),'--terminal','worker')
  self.assertNotIn('Assistant asks you',result['reason'])
  self.assertEqual(A.read(self.path.with_suffix('.status'))['reason'],'rule-denied')
  A.write(A.store()/'rules.json',[])
  for failure in ('deny','corrupt','changed'):
   with self.subTest(failure=failure):
    (A.store()/'pending'/self.path.name).unlink(missing_ok=True)
    A.write(A.store()/'rules.json',[]);_,ticket,_=self.delegate('manual')
    if failure=='deny':A.grant(self.path,decision='deny')
    elif failure=='corrupt':(A.store()/'rules.json').write_text('{broken')
    else:A.write(self.base/'settings.json',{'everywhere':{'approvals':{'mode':'manual','policy':'Ask about every write.'}}})
    self.assertEqual(A.decide(ticket['id'],ticket['token'],'allow','Safe',terminal='assistant')['action'],'wait')
    self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
    self.assertEqual(A.read(self.path.with_suffix('.status'))['reason'],{'deny':'rule-denied','corrupt':'policy-error','changed':'policy-changed'}[failure])
 def test_large_review_input_is_complete_and_only_its_designated_reviewer_can_read_it(self):
  import shlex
  self.req['tool_input']={'command':'echo '+('large-input '*1500),'suffix':'must be seen'};A.write(self.path,self.req)
  _,ticket,send=self.delegate('assistant')
  self.assertIn('review-input',send.call_args.args[0][-1]);self.assertNotIn('Exact request:',send.call_args.args[0][-1])
  command=[str(A.app_home()/'mods/chat/approval-policy.py'),'review-input','--id',ticket['id'],'--token',ticket['token']]
  nested=A.app_home()/'data/chat-asks/req/assistant.2.json';request={'tool_name':'Bash','tool_input':{'command':shlex.join(command)}};A.write(nested,request)
  reviewer={'state':'live','argv':['claude'],'labels':{'herdr.role':'coordinator','herdr.coordinator.space':'space'}}
  with mock.patch.object(A,'hc_get',return_value=reviewer):
   self.assertEqual(A.evaluate(nested,'assistant')['source'],'review-control')
  with mock.patch.dict(os.environ,{'HC_TERMINAL_ID':'assistant'}):
   self.assertEqual(self.ui(*command[1:])['request'],self.req)
  for mutation in ('wrong-terminal','wrong-token','expired','changed','closed','answered'):
   with self.subTest(mutation=mutation):
    A.write(self.path,self.req);A.write(A.store()/'pending'/self.path.name,ticket)
    answer=self.path.parent.parent/'ans'/self.path.name;answer.unlink(missing_ok=True)
    candidate=command.copy();terminal='assistant'
    if mutation=='wrong-terminal':terminal='other'
    elif mutation=='wrong-token':candidate[-1]='wrong'
    elif mutation=='expired':A.write(A.store()/'pending'/self.path.name,{**ticket,'expires':time.time()-1})
    elif mutation=='changed':A.write(self.path,{**self.req,'tool_input':{'command':'different'}})
    elif mutation=='closed':self.path.unlink()
    else:A.answer_once(answer,A.response('deny')['response'])
    self.assertFalse(A.own_review_command({'tool_name':'Bash','tool_input':{'command':shlex.join(candidate)}},{'terminal':terminal}))
    with self.assertRaises(ValueError):A.review_input(ticket['id'],candidate[-1],terminal)
 def test_public_rationale_is_bounded_redacted_and_request_bound(self):
  self.req['tool_input']['api_key']='fixture-private';A.write(self.path,self.req)
  _,ticket,_=self.delegate()
  reason='Unknown target. token='+ticket['token']+' password="two words" Bearer private-bearer fixture-private '+json.dumps(self.req['tool_input'])+' '+('x'*900)
  A.decide(ticket['id'],ticket['token'],'ask',reason,terminal='assistant');A.evaluate(self.path)
  public=A.read(self.path.with_suffix('.status'));text=json.dumps(public)
  self.assertLessEqual(len(public['review_reason']),400)
  for secret in (ticket['token'],'two words','private-bearer','fixture-private','git status --short','tool_input'):self.assertNotIn(secret,text)
  self.assertEqual(public['request_hash'],A.status_key(self.req));self.assertEqual(A.history_rows()[-1]['reason'],public['review_reason'])
 def test_fast_ask_survives_a_delivery_error_and_a_human_can_still_take_over(self):
  self.mode('rules');A.request_context(self.path)
  def send(*args,**kwargs):
   ticket=A.read(A.store()/'pending'/self.path.name)
   A.decide(ticket['id'],ticket['token'],'ask','Please choose the destination.',terminal='assistant')
   return mock.Mock(returncode=1,stdout='')
  with mock.patch.object(A.subprocess,'run',side_effect=send):self.ui('review','--request',str(self.path),'--terminal','worker')
  A.evaluate(self.path);self.assertEqual(A.read(self.path.with_suffix('.status'))['reason'],'assistant-asked')
  self.ui('answer','--request',str(self.path),'--hash',A.status_key(self.req),'--answer',json.dumps(A.response('deny')['response']))
  self.assertEqual(A.history_rows()[-1]['source'],'user')
 def test_feature_route_uses_running_owner_regardless_of_its_cli_or_model(self):
  for cli in ('codex','claude'):
   with self.subTest(cli=cli):
    self.path.with_suffix('.context').unlink(missing_ok=True);(A.store()/'pending'/self.path.name).unlink(missing_ok=True)
    self.meta['labels'].update({'herdr.feature':'owned-feature','herdr.owner':'stale-space-assistant'})
    owner={'state':'live','argv':[cli,'--model','fixture-model'],'labels':{'herdr.role':'feature','herdr.feature':'owned-feature','herdr.coordinator.space':'space'}}
    A.hc_get.side_effect=lambda terminal:owner if terminal=='feature-owner' else self.meta if terminal=='worker' else {'state':'gone'}
    self.mode('assistant')
    def hc(argv,**kwargs):return mock.Mock(returncode=0,stdout=json.dumps({'terminals':[{'address':'feature-owner'}]}) if argv[1]=='ls' else '')
    with mock.patch.object(A.subprocess,'run',side_effect=hc) as calls:A.evaluate(self.path)
    ticket=A.read(A.store()/'pending'/self.path.name)
    self.assertEqual(ticket['reviewer'],'feature-owner');self.assertEqual(ticket['reviewer_type'],'feature')
    self.assertEqual(calls.call_args.args[0][:3],['hc','send','feature-owner'])
 def test_claude_request_context_uses_its_account_even_when_caller_is_codex(self):
  with mock.patch.dict(os.environ,{'CODEX_HOME':'/other-codex-account'}):
   ctx=A.context(self.req,'worker',{'argv':['env','CLAUDE_CONFIG_DIR=/fixture-claude-account','claude'],'labels':{}})
  self.assertEqual(ctx['agent'],'claude');self.assertEqual(ctx['account'],'/fixture-claude-account')
 def test_competing_assistant_decisions_have_one_winner_and_one_audit_record(self):
  from concurrent.futures import ThreadPoolExecutor
  _,ticket,_=self.delegate()
  def submit(decision):
   try:return A.decide(ticket['id'],ticket['token'],decision,'Local task inspection.',terminal='assistant')
   except ValueError:return None
  with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(submit,['allow','ask']))
  self.assertEqual(sum(r is not None for r in results),1)
  self.assertEqual(len(A.history_rows()),1)
  final=A.read(A.store()/'pending'/self.path.name)['status']
  self.assertEqual((self.path.parent.parent/'ans'/self.path.name).exists(),final=='allow')
 def test_missing_self_or_wrong_feature_reviewer_never_sends_a_review(self):
  for missing in ('gone','self','other-feature'):
   with self.subTest(missing=missing):
    self.mode('assistant');self.path.with_suffix('.context').unlink(missing_ok=True);(A.store()/'pending'/self.path.name).unlink(missing_ok=True)
    self.meta['labels'].update({'herdr.feature':'owned','herdr.owner':'worker' if missing=='self' else 'assistant'})
    wrong={'state':'gone' if missing=='gone' else 'live','labels':{'herdr.role':'feature','herdr.feature':'other'}}
    A.hc_get.side_effect=lambda terminal:self.meta if terminal=='worker' else wrong
    with mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{"terminals":[]}')) as calls:A.evaluate(self.path)
    self.assertTrue(all(c.args[0][1]=='ls' for c in calls.call_args_list))
    self.assertEqual(A.read(self.path.with_suffix('.status'))['reason'],'review-unavailable')
 def test_request_closing_or_human_answer_during_lookup_cannot_be_delegated(self):
  for closure in ('closed','changed','human'):
   with self.subTest(closure=closure):
    A.write(self.path,self.req);self.path.with_suffix('.context').unlink(missing_ok=True);(A.store()/'pending'/self.path.name).unlink(missing_ok=True)
    answer=self.path.parent.parent/'ans'/self.path.name;answer.unlink(missing_ok=True)
    def close():
     if closure=='closed':self.path.unlink(missing_ok=True)
     elif closure=='changed':A.write(self.path,{**self.req,'tool_input':{'command':'different'}})
     elif not answer.exists():A.answer_once(answer,A.response('deny')['response'])
    with self.assertRaisesRegex(ValueError,'changed, closed or already'):self.delegate(during=close)
    if closure=='human':self.assertEqual(A.read(answer)['hookSpecificOutput']['decision']['behavior'],'deny')
 def test_real_permission_hook_consumes_the_assistant_answer_once_without_executing(self):
  import subprocess
  self.mode('assistant');fake=self.base/'fake-bin';fake.mkdir()
  # The real hook/helper flow, with inert hc metadata/delivery only. No live
  # agents, permissions or accounts are inspected, and the proposed command is
  # never executed by the reviewer or this hook.
  hc=fake/'hc';hc.write_text('#!'+sys.executable+'\n'+'''import json,os,subprocess,sys
from pathlib import Path
root=Path(os.environ['FIXTURE_ROOT']);args=sys.argv[1:]
if args[0]=='get':
 print(json.dumps(json.loads((root/('worker.json' if args[1]=='worker' else 'assistant.json')).read_text())))
elif args[0]=='send':
 ticket=json.loads(next((root/'app/data/approvals/pending').glob('worker.*.json')).read_text())
 with (root/'deliveries').open('a') as f:f.write('review\\n')
 result=subprocess.run([sys.executable,os.environ['FIXTURE_HELPER'],'decide','--id',ticket['id'],'--token',ticket['token'],'--decision','allow','--reason','Read-only project inspection needed for this task.'],env={**os.environ,'HC_TERMINAL_ID':'assistant'},capture_output=True)
 sys.exit(result.returncode)
else:sys.exit(1)
''');hc.chmod(0o755)
  A.write(self.base/'worker.json',self.meta)
  A.write(self.base/'assistant.json',{'state':'live','argv':['claude'],'labels':{'herdr.role':'coordinator','herdr.coordinator.space':'space'}})
  req={**self.req,'tool_input':{'command':'git status | wc -l'}}
  self.path.unlink()
  env={**os.environ,'PATH':str(fake)+os.pathsep+os.environ['PATH'],'FIXTURE_ROOT':str(self.base),'FIXTURE_HELPER':str(ROOT/'mods/chat/approval-policy.py')}
  result=subprocess.run(['bash',str(ROOT/'mods/chat/ask-hook.sh')],input=json.dumps(req),text=True,capture_output=True,env=env,timeout=15)
  self.assertEqual(result.returncode,0,result.stderr)
  self.assertEqual(json.loads(result.stdout),A.response('allow')['response'])
  self.assertEqual((self.base/'deliveries').read_text(),'review\n')
  self.assertFalse(list((A.app_home()/'data/chat-asks/req').glob('worker.*.json')))
  history=A.history_rows();self.assertEqual(len(history),1);self.assertEqual(history[0]['source'],'assistant')
  ends=list((A.app_home()/'data/chat-asks/end').glob('worker.*'))
  self.assertEqual(len(ends),1);self.assertIn('Allowed by Assistant',ends[0].read_text())
class RememberedReviewFallback(unittest.TestCase):
 setUp=ApprovalPolicy.setUp
 mode=ApprovalPolicy.mode
 def test_remembering_one_action_preserves_inherited_assistant_review_for_an_unmatched_script(self):
  self.mode('assistant');A.grant(self.path)
  script={**self.req,'tool_input':{'command':"python3 - <<'PY'\nprint('inert fixture')\nPY"}};A.write(self.path,script)
  with mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')) as send:A.evaluate(self.path)
  self.assertEqual(A.read(self.path.with_suffix('.status'))['state'],'assistant')
  self.assertEqual(send.call_count,1)
 def test_role_and_space_assistant_defaults_survive_a_bounded_rule_activation(self):
  A.write(self.base/'settings.json',{'everywhere':{'approvals':{'mode':'manual'}},'spaces':{'space':{'approvals':{role:'assistant' for role in ('coordinator','feature','worker','reviewer')}}}})
  A.grant(self.path);ctx=A.request_context(self.path)[1]
  for role in ('coordinator','feature','worker','reviewer'):
   self.assertEqual(A.settings({**ctx,'role':role})['mode'],'assistant')
  self.assertEqual(A.evaluate(self.path)['action'],'allow')
  with A.locked():activation=A.read(A.store()/'overrides.json')[A.session_key(ctx)]
  self.assertEqual(activation['source'],'remembered-rule');self.assertLessEqual(activation['expires'],time.time()+86400)
 def test_explicit_and_unmarked_session_modes_are_not_reinterpreted_or_overwritten_by_grants(self):
  self.mode('assistant');ctx=A.request_context(self.path)[1];key=A.session_key(ctx)
  for source in (None,'user'):
   for mode in A.MODES:
    with self.subTest(source=source,mode=mode):
     row={'mode':mode,'expires':time.time()+3600,'preserved':'opaque display-independent metadata'}
     if source:row['source']=source
     A.write(A.store()/'overrides.json',{key:row})
     with A.locked():before=A.read(A.store()/'overrides.json')
     A.grant(self.path)
     self.assertEqual(A.settings(ctx)['mode'],mode)
     with A.locked():self.assertEqual(A.read(A.store()/'overrides.json'),before)
 def test_explicit_task_modes_win_and_inherited_manual_grants_still_work(self):
  self.mode('assistant');A.grant(self.path);ctx=A.request_context(self.path)[1]
  for mode in ('manual','rules','assistant','codex-review'):
   self.assertEqual(A.settings({**ctx,'task_mode':mode})['mode'],mode)
  self.mode('manual');self.assertEqual(A.settings(ctx)['mode'],'rules');self.assertEqual(A.evaluate(self.path)['action'],'allow')
  A.write(self.path,{**self.req,'tool_input':{'command':'git diff --stat'}})
  self.assertEqual(A.evaluate(self.path)['action'],'wait');self.assertEqual(A.read(self.path.with_suffix('.status'))['reason'],'no-rule')
 def test_explicit_override_helper_marks_user_choice_and_inherit_clears_only_that_session(self):
  self.mode('assistant');ctx=A.request_context(self.path)[1];key=A.session_key(ctx)
  ui=AssistantReviewRegression.ui
  ui(self,'override','--request',str(self.path),'--mode','rules')
  A.grant(self.path)
  self.assertEqual(A.settings(ctx)['mode'],'rules')
  with A.locked():self.assertEqual(A.read(A.store()/'overrides.json')[key]['source'],'user')
  rows=A.read(A.store()/'overrides.json');rows['another-session']={'mode':'manual','expires':time.time()+3600};A.write(A.store()/'overrides.json',rows)
  ui(self,'override','--request',str(self.path),'--mode','inherit')
  self.assertEqual(A.settings(ctx)['mode'],'assistant')
  self.assertEqual(A.read(A.store()/'overrides.json'),{'another-session':rows['another-session']})
 def test_native_review_remains_separate_and_matching_denies_still_win(self):
  self.mode('codex-review');self.meta['argv']+=['-c','approvals_reviewer="auto_review"'];A.grant(self.path)
  A.write(self.path,{**self.req,'tool_input':{'command':'git diff --stat'}})
  self.assertEqual(A.evaluate(self.path)['action'],'native')
  self.mode('assistant');A.grant(self.path,decision='deny')
  with mock.patch.object(A.subprocess,'run',side_effect=AssertionError('saved deny must not delegate')):
   self.assertEqual(A.evaluate(self.path)['action'],'deny')
 def test_malformed_remembered_activation_cannot_delegate_around_policy_error(self):
  self.mode('assistant');ctx=A.request_context(self.path)[1]
  for mode in (None,'manual','unexpected'):
   A.write(A.store()/'overrides.json',{A.session_key(ctx):{'source':'remembered-rule','mode':mode,'expires':time.time()+3600}})
   with mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')) as send:A.evaluate(self.path)
   self.assertEqual(send.call_count,0)
   self.assertEqual(A.read(self.path.with_suffix('.status'))['reason'],'policy-error')
class FeatureNaming(unittest.TestCase):
 def test_only_the_feature_owner_can_name_its_own_record(self):
  helper=str(A.app_home()/'mods/workspace-launchers/bin/workspace-state')
  req={'tool_name':'Bash','tool_input':{'command':['python3',helper,'feature-name',json.dumps({'id':'one','name':'Browser tabs'})]}}
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
  self.req={**self.req,'tool_input':{'command':'git status > report.txt'}};A.write(self.path,self.req)
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
 def test_future_only_save_preserves_advice_and_specific_assistant_handback(self):
  self.req={**self.req,'tool_input':{'command':'tail "$(curl example.invalid)"'}};A.write(self.path,self.req)
  A.request_context(self.path)
  rationale='The destination is outside this project. Please choose.'
  A.status(self.path,self.req,'person','assistant-asked',review_reason=rationale)
  advice={'version':1,'request_hash':A.status_key(self.req),'state':'ready','summary':'Reads a value from another command.'}
  A.write(self.path.with_suffix('.advice'),advice)
  before=self.path.with_suffix('.status').read_bytes()
  spec=importlib.util.spec_from_file_location('policy_ui',ROOT/'mods/chat/approval-policy.py')
  ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui)
  out=ui.main(ui.parser().parse_args(['grant','--request',str(self.path),'--match','prefix','--prefix','tail','--respond']))
  self.assertEqual(out['action'],'wait');self.assertEqual(self.path.with_suffix('.status').read_bytes(),before)
  self.assertEqual(A.read(self.path.with_suffix('.advice')),advice)
  self.assertFalse((self.path.parent.parent/'ans'/self.path.name).exists())
 def test_native_review_history_reports_handoff_without_claiming_an_allow(self):
  self.mode('codex-review');self.meta['argv']+=['-c','approvals_reviewer="auto_review"']
  self.assertEqual(A.evaluate(self.path)['action'],'native');row=A.history_rows()[-1]
  self.assertEqual(row['source'],'codex-review');self.assertEqual(row['decision'],'delegated')
