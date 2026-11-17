import home_guard  # noqa: F401
import json,sys,tempfile,unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mods/tasks/bin'))
from herdr_task import sessions

class WorkerLogSelection(unittest.TestCase):
 def test_task_resume_metadata_uses_the_main_rollout_not_a_guardian_fd(self):
  with tempfile.TemporaryDirectory() as folder:
   guardian=Path(folder)/'rollout-00000000-0000-0000-0000-000000000001.jsonl'
   worker=Path(folder)/'rollout-00000000-0000-0000-0000-000000000002.jsonl'
   for p,source in [(guardian,{'subagent':{'other':'guardian'}}),(worker,'cli')]:
    p.write_text(json.dumps({'type':'session_meta','payload':{'source':source}})+'\n')
   real=sessions.os.path.isdir
   with mock.patch.object(sessions,'kids',return_value=[]),mock.patch.object(sessions.os.path,'isdir',side_effect=lambda p:True if p=='/proc/42/fd' else real(p)),mock.patch.object(sessions.os,'listdir',return_value=['65','74']),mock.patch.object(sessions.os,'readlink',side_effect=lambda p:str(guardian if p.endswith('/65') else worker)):
    self.assertEqual(sessions.session_of(42),('00000000-0000-0000-0000-000000000002',str(worker)))
   self.assertEqual(sessions._start(str(guardian)),(None,''))
