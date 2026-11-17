import home_guard  # noqa: F401
import contextlib,io,json,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'mods/tasks/bin'))
from herdr_task import space_instructions as prompts
class SpaceInstructions(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.cfg={'everywhere':{'coordinator':{'agent':'codex'}},'spaces':{'a':{'folder':'/repo','instructions':{'coordinator':'Assistant A','feature':'Feature A','worker':'Worker A','reviewer':'Reviewer A'}},'b':{'folder':'/repo','instructions':{'worker':'Worker B','reviewer':'Reviewer B'}}}}
 def test_each_role_uses_only_the_selected_space_and_preserves_the_global_body(self):
  before=json.dumps(self.cfg)
  for role in prompts.ROLES:
   extra=prompts.space_instructions(role,'a',cfg=self.cfg);text=prompts.append_instructions('GLOBAL '+role,extra)
   self.assertTrue(text.startswith('GLOBAL '+role));self.assertIn(extra,text)
  self.assertEqual(prompts.space_instructions('worker','missing',cfg=self.cfg),'');self.assertEqual(prompts.space_instructions('worker','b',cfg=self.cfg),'Worker B');self.assertEqual(json.dumps(self.cfg),before)
 def test_no_addition_is_applied_without_an_unambiguous_space(self):
  s=SimpleNamespace(loc={'folder':'/repo'})
  self.assertEqual(prompts.space_instructions('worker',None,s,self.cfg),'')
  self.assertEqual(prompts.append_instructions('global\n','  '),'global\n')
 def test_worker_and_reviewer_additions_are_isolated_and_never_rewrite_global_templates(self):
  s=SimpleNamespace(path=str(self.root/'tasks.json'),loc={'folder':'/repo'});task={'id':7,'space':'a'}
  def load(role):return 'GLOBAL '+role+' ~/.config/herdr-core/templates/reviewer.md'
  with patch.object(prompts,'read_settings',return_value=self.cfg):
   a=prompts.worker_instructions(s,task,load=load);b=prompts.worker_instructions(s,{'id':8,'space':'b'},load=load)
  self.assertIn('Worker A',a);self.assertNotIn('Worker B',a);self.assertIn('Worker B',b)
  files=list(self.root.glob('*.reviewer.md'));self.assertEqual(len(files),2)
  bodies=[p.read_text() for p in files];self.assertTrue(any('Reviewer A' in x for x in bodies));self.assertTrue(any('Reviewer B' in x for x in bodies))
  self.assertIn('~/.config/herdr-core/templates/reviewer.md followed by',a)
  self.assertFalse(any('GLOBAL reviewer' in x for x in bodies),'the global prompt is read afresh by the reviewer, not snapshotted')
 def test_cli_composes_current_global_and_space_text_without_changing_the_file(self):
  path=self.root/'assistant.md';path.write_text('---\ncommand: codex\n---\nGLOBAL ONE\n')
  args=SimpleNamespace(role='coordinator',space='a',extra_only=False,json=True)
  with patch.object(prompts,'TEMPLATES',str(self.root)),patch.object(prompts,'read_settings',return_value=self.cfg):
   output=io.StringIO()
   with contextlib.redirect_stdout(output):prompts.cmd_instructions(args)
   text=json.loads(output.getvalue())['text'];self.assertLess(text.index('GLOBAL ONE'),text.index('Assistant A'));self.assertNotIn('command:',text)
   self.assertEqual(path.read_text(),'---\ncommand: codex\n---\nGLOBAL ONE\n')
