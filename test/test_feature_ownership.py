import home_guard  # noqa: F401
import os,sys,unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'mods/tasks/bin'))
from herdr_task import launch as L
class FeatureOwnership(unittest.TestCase):
 def test_live_feature_is_not_replaced_by_space_assistant(self):
  with mock.patch.object(L,'live_parent',return_value='feature-live'),mock.patch.object(L,'coordinator_in') as space:
   self.assertEqual(L.parent_for('feature-live','space','feature-id'),'feature-live');space.assert_not_called()
 def test_closed_feature_does_not_transfer_tasks_to_space_assistant(self):
  with mock.patch.object(L,'live_parent',return_value=None),mock.patch.object(L,'caller_labels',return_value={}),mock.patch.object(L,'hc_json',return_value={'terminals':[]}),mock.patch.object(L,'coordinator_in') as space:
   self.assertIsNone(L.parent_for('old','space','feature-id'));space.assert_not_called()
 def test_restarted_feature_is_found_by_durable_feature_id(self):
  def hc(*a):
   return {'terminals':[{'address':'new'}]} if a[0]=='ls' else {'state':'live','labels':{'herdr.feature':'feature-id','herdr.role':'feature'}}
  with mock.patch.object(L,'live_parent',return_value=None),mock.patch.object(L,'caller_labels',return_value={}),mock.patch.object(L,'hc_json',side_effect=hc):
   self.assertEqual(L.parent_for('old','space','feature-id'),'new')
if __name__=='__main__':unittest.main()
