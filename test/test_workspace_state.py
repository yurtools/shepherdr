import home_guard  # noqa: F401
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
HELPER=ROOT/'mods/workspace-launchers/bin/workspace-state'
class WorkspaceState(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
 def call(self,command,payload=None,ok=True):
  r=subprocess.run([sys.executable,str(HELPER),command,json.dumps(payload or {})],env={**os.environ,'HERDR_APP_HOME':str(self.root)},capture_output=True,text=True)
  if ok:self.assertEqual(r.returncode,0,r.stdout+r.stderr)
  else:self.assertNotEqual(r.returncode,0)
  return json.loads(r.stdout)
 def test_edit_agent_preserves_other_accounts_and_quoted_arguments(self):
  self.root.joinpath('programs.json').write_text(json.dumps({'programs':{'secondary':{'name':'Account Two','run':['/account-two-wrapper']}}}))
  self.call('save-agent',{'id':'codex','name':'Codex','command':'codex --model "model name"'})
  d=json.loads((self.root/'programs.json').read_text())['programs'];self.assertEqual(d['secondary']['run'],['/account-two-wrapper']);self.assertEqual(d['codex']['run'],['codex','--model','model name'])
 def test_disable_and_remove_do_not_touch_authentication(self):
  auth=self.root/'auth.json';auth.write_text('private placeholder')
  self.call('save-agent',{'id':'codex','command':'codex'})
  self.call('hide-agent',{'id':'codex'});self.assertIn('codex',self.call('catalog')['hidden_agents'])
  self.call('hide-agent',{'id':'codex','enabled':True});self.assertNotIn('codex',self.call('catalog')['hidden_agents'])
  self.call('remove-agent',{'id':'codex'});self.assertEqual(auth.read_text(),'private placeholder')
 def test_chats_validate_urls_and_preserve_browser_profiles(self):
  for url in ['javascript:alert(1)','file:///etc/passwd','https://user:secret@example.org']:
   self.call('save-chat',{'name':'Invalid','url':url},ok=False)
  row=self.call('save-chat',{'name':'Chat','url':'example.org/chat','profile':'shared:personal'});self.assertEqual(row['url'],'https://example.org/chat')
  saved=self.call('catalog');self.assertIn(row,saved['chats']);self.assertEqual(row['profile'],'shared:personal')
 def test_features_retain_identity_account_and_session_across_calls(self):
  a=self.call('feature-create',{'space':'one','name':'A','settings':{'agent':'codex','profile':'secondary'}})
  b=self.call('feature-create',{'space':'one','name':'A'})
  self.assertNotEqual(a['id'],b['id'])
  self.call('feature-update',{'id':a['id'],'session':'saved-session','argv':['env','CODEX_HOME=/second','codex'],'home':'/second'})
  rec=self.call('feature-get',{'id':a['id']});self.assertEqual(rec['session'],'saved-session');self.assertEqual(rec['settings']['profile'],'secondary')
  self.assertEqual(len(self.call('features')['features']),2)
 def test_ai_title_never_overwrites_manual_rename(self):
  a=self.call('feature-create',{'space':'one','autoName':True})
  self.call('feature-update',{'id':a['id'],'name':'My title'})
  self.assertEqual(self.call('feature-name',{'id':a['id'],'name':'Late AI title'})['name'],'My title')
 def test_browser_navigation_preserves_closed_state_and_other_pages(self):
  a=self.call('browser-create',{'space':'one','url':'https://example.org/one'})
  b=self.call('browser-create',{'space':'one','url':'https://example.org/two'})
  self.call('browser-update',{'id':a['id'],'open':False})
  self.call('browser-update',{'id':a['id'],'url':'https://example.org/last'})
  rows=self.call('browsers')['browsers'];self.assertFalse(next(x for x in rows if x['id']==a['id'])['open']);self.assertEqual(next(x for x in rows if x['id']==b['id'])['url'],b['url'])
if __name__=='__main__':unittest.main()
