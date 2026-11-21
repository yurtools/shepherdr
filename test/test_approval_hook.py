import home_guard  # noqa: F401
import json, os, shutil, subprocess, tempfile, unittest, threading, time
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
class ApprovalHook(unittest.TestCase):
 def run_hook(self,mode,rules=None,command='git status --short',wait_reason=None):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);root=Path(self.tmp.name);app=root/'app';chat=app/'mods/chat';chat.mkdir(parents=True);(app/'mods/tasks').mkdir()
  (app/'mods/tasks/bin').symlink_to(ROOT/'mods/tasks/bin',target_is_directory=True)
  for name in ('ask-hook.sh','approval-policy.py','ask-end.py'):shutil.copy2(ROOT/'mods/chat'/name,chat/name)
  account=str(root/'account');repo=str(root/'repo');Path(repo).mkdir();bin=root/'bin';bin.mkdir()
  argv=['env','CODEX_HOME='+account,'codex']+(['-c','approvals_reviewer="auto_review"'] if mode=='codex-review' else [])
  meta={'state':'live','argv':argv,'cwd':repo,'status':'blocked','labels':{'herdr.task.space':'space','herdr.task':'TASK-1'}}
  (bin/'hc').write_text('#!/bin/sh\ncat <<\'DATA\'\n'+json.dumps(meta)+'\nDATA\n');(bin/'hc').chmod(0o755)
  # If the policy ever invokes an executable instead of inspecting text, leave
  # deterministic evidence. Neither parsing nor answering may run this program.
  (bin/'tail').write_text('#!/bin/sh\ntouch '+str(root/'executed')+'\n');(bin/'tail').chmod(0o755)
  settings=root/'settings.json';settings.write_text(json.dumps({'everywhere':{'approvals':{'mode':mode}}}))
  data=app/'data/approvals';data.mkdir(parents=True)
  if rules:(data/'rules.json').write_text(json.dumps([{**r,'account':account,'cwd':repo} for r in rules]))
  env={**os.environ,'PATH':str(bin)+os.pathsep+os.environ.get('PATH',''),'HERDR_APP_HOME':str(app),'HERDR_TASK_SETTINGS':str(settings),'HC_TERMINAL_ID':'testworker','HERDR_ASK_CHAINED':'1'}
  req={'session_id':'session','cwd':repo,'tool_name':'Bash','tool_input':{'command':command.replace('MARKER',str(root/'executed'))}}
  worker=None;self.wait_status=None
  if wait_reason:
   def answer_fixture():
    until=time.monotonic()+6
    while time.monotonic()<until:
     for p in (app/'data/chat-asks/req').glob('*.status'):
      try:status=json.loads(p.read_text())
      except (ValueError,OSError):continue
      if status.get('reason')!=wait_reason:continue
      self.wait_status=status;answer=app/'data/chat-asks/ans'/(p.stem+'.json');answer.parent.mkdir(parents=True,exist_ok=True)
      answer.write_text(json.dumps({'hookSpecificOutput':{'decision':{'behavior':'deny'}}}));return
     time.sleep(.01)
   worker=threading.Thread(target=answer_fixture);worker.start()
  result=subprocess.run(['sh',str(chat/'ask-hook.sh')],input=json.dumps(req),text=True,capture_output=True,env=env,timeout=12)
  if worker:worker.join(timeout=1)
  self.assertFalse((root/'executed').exists(),'policy executed pending command text')
  return result,app
 @unittest.skipUnless(shutil.which('jq'),'jq is required by the existing hook protocol')
 def test_native_review_hook_returns_no_decision_and_does_not_wait_for_a_human(self):
  result,app=self.run_hook('codex-review');self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout,'');self.assertFalse(list((app/'data/chat-asks/req').glob('*.json')));self.assertTrue(any('Codex Auto-review' in p.read_text() for p in (app/'data/chat-asks/end').iterdir()))
 @unittest.skipUnless(shutil.which('jq'),'jq is required by the existing hook protocol')
 def test_scoped_rule_produces_a_real_hook_allow_without_running_the_command(self):
  result,app=self.run_hook('rules',[{'id':'rule','scope':'space','space':'space','tool':'Bash','decision':'allow','match':'prefix','pattern':['git','status'],'expires':0}]);self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(json.loads(result.stdout)['hookSpecificOutput']['decision']['behavior'],'allow');history=json.loads((app/'data/approvals/history.json').read_text());self.assertEqual(history[-1]['source'],'rule')
  self.assertFalse(list((app/'data/chat-asks/req').iterdir()))
 @unittest.skipUnless(shutil.which('jq'),'jq is required by the existing hook protocol')
 def test_single_executable_rule_allows_variable_arguments_without_executing_them(self):
  rule={'id':'tail','scope':'space','space':'space','tool':'Bash','decision':'allow','match':'prefix','pattern':['tail'],'expires':0}
  result,app=self.run_hook('rules',[rule],command='tail "$FILE"')
  self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(json.loads(result.stdout)['hookSpecificOutput']['decision']['behavior'],'allow')
 @unittest.skipUnless(shutil.which('jq'),'jq is required by the existing hook protocol')
 def test_variable_cannot_bypass_deny_and_substitution_cannot_hide_an_action(self):
  allow={'id':'tail','scope':'space','space':'space','tool':'Bash','decision':'allow','match':'prefix','pattern':['tail'],'expires':0}
  deny={**allow,'id':'restricted','match':'exact','pattern':['tail','/restricted/file'],'decision':'deny'}
  for command,rules,reason in [('tail "$FILE"',[allow,deny],'deny-uncertain'),('tail "$(touch MARKER)"',[allow],'no-rule')]:
   result,app=self.run_hook('rules',rules,command=command,wait_reason=reason)
   self.assertIsNotNone(self.wait_status);self.assertEqual(result.returncode,0,result.stderr)
   self.assertEqual(json.loads(result.stdout)['hookSpecificOutput']['decision']['behavior'],'deny')
 @unittest.skipUnless(shutil.which('jq'),'jq is required by the existing hook protocol')
 def test_rule_deny_closes_and_cleans_status_without_a_transient_person_prompt(self):
  result,app=self.run_hook('rules',[{'id':'deny','scope':'space','space':'space','tool':'Bash','decision':'deny','match':'prefix','pattern':['git','status'],'expires':0}])
  self.assertEqual(json.loads(result.stdout)['hookSpecificOutput']['decision']['behavior'],'deny')
  self.assertFalse(list((app/'data/chat-asks/req').iterdir()))
