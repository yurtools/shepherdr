import home_guard  # noqa: F401
import sys
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'mods/tasks/bin'))
from herdr_task import launch as L


class FeatureOwnership(unittest.TestCase):
    def owner(self):
        return {'state': 'live', 'labels': {'herdr.role': 'feature',
                'herdr.feature': 'feature-id', 'herdr.coordinator.space': 'space'}}

    def test_live_feature_is_not_replaced_by_space_assistant(self):
        with mock.patch.object(L, 'hc_json', return_value=self.owner()), \
                mock.patch.object(L, 'coordinator_in') as space:
            self.assertEqual(L.parent_for('feature-live', 'space', 'feature-id'), 'feature-live')
            space.assert_not_called()

    def test_closed_feature_does_not_transfer_tasks_to_space_assistant(self):
        with mock.patch.object(L, 'hc_json', return_value={'terminals': []}), \
                mock.patch.object(L, 'coordinator_in') as space:
            self.assertIsNone(L.parent_for('old', 'space', 'feature-id'))
            space.assert_not_called()

    def test_restarted_feature_is_found_by_durable_feature_id(self):
        def hc(*args):
            if args == ('get', 'old'):
                return {'state': 'gone'}
            return {'terminals': [{'address': 'new'}]} if args[0] == 'ls' else self.owner()
        with mock.patch.object(L, 'hc_json', side_effect=hc):
            self.assertEqual(L.parent_for('old', 'space', 'feature-id'), 'new')


if __name__ == '__main__':
    unittest.main()
