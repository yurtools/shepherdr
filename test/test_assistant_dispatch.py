"""Interactive owners dispatch; the scheduler owns waiting and bounded starts."""
import home_guard  # noqa: F401
import os
import sys
from pathlib import Path
import unittest
from unittest import mock
import test_herdr_task as task_tests
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "mods/tasks/bin"))
from herdr_task import launch as L
from herdr_task import queues


class DispatchQueue(unittest.TestCase):
    setUp = task_tests.Scheduled.setUp
    run_cmd = task_tests.Scheduled.run_cmd
    add = task_tests.Scheduled.add
    tick_at = task_tests.Scheduled.tick_at
    task = task_tests.Scheduled.task

    def test_repeated_dispatch_keeps_dependency_and_queue_position(self):
        self.add('Dependency')
        self.add('Long research', after='1')
        first = self.run_cmd(self.commands.cmd_start, id='2', parent='owner')
        queued_at = self.task(2)['queued_at']
        again = self.run_cmd(self.commands.cmd_start, id='2')
        self.assertTrue(first['queued'])
        self.assertTrue(again.get('queued'), 'repeat dispatch bypassed its dependency')
        self.assertEqual(self.started, [])
        self.assertEqual(self.task(2)['queued_at'], queued_at)
        self.assertEqual(self.task(2)['queue']['parent'], 'owner')

    def test_repeated_dispatch_obeys_capacity_until_scheduler_has_room(self):
        self.add('Long build')
        self.add('Remote monitoring')
        with mock.patch.object(queues, 'working', side_effect=lambda s, t: t['state'] == 'running'), \
                mock.patch.object(self.store_mod.Store, 'max_running', return_value=1):
            self.run_cmd(self.commands.cmd_start, id='1')
            self.assertTrue(self.run_cmd(self.commands.cmd_start, id='2')['queued'])
            again = self.run_cmd(self.commands.cmd_start, id='2')
            self.assertTrue(again.get('queued'), 'repeat dispatch exceeded the worker limit')
            self.assertEqual(len(self.started), 1)
            with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
                s.find(1)['state'] = 'done'
                s.dirty = True
            self.assertEqual(self.tick_at(2000000000000), ['APP-2'])
            self.assertEqual(len(self.started), 2)

    def test_feature_identity_is_saved_before_queueing_an_unowned_task(self):
        self.add('Dependency')
        self.add('Feature research', after='1')
        labels = {'herdr.role': 'feature', 'herdr.feature': 'one', 'herdr.coordinator.space': 'sp1'}
        with mock.patch.object(self.commands, 'caller_labels', return_value=labels):
            self.run_cmd(self.commands.cmd_start, id='2', parent='feature-owner')
        self.assertEqual(self.task(2).get('feature'), 'one')
        self.assertEqual(self.task(2)['queue']['parent'], 'feature-owner')
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(1)['state'] = 'done'
            s.dirty = True
        self.assertEqual(self.tick_at(2000000000000), ['APP-2'])
        self.assertEqual(self.task(2).get('feature'), 'one')
        self.assertEqual(self.started[-1][-1], 'feature-owner')

    def test_cancelled_queued_work_is_not_started_by_a_later_tick(self):
        self.add('Dependency')
        self.add('Research', after='1')
        self.run_cmd(self.commands.cmd_start, id='2')
        self.run_cmd(lambda args: self.commands.cmd_state(args, 'reopen'), id='2')
        self.assertEqual(self.task(2)['state'], 'todo')
        self.assertNotIn('queue', self.task(2))
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(1)['state'] = 'done'
            s.dirty = True
        self.assertEqual(self.tick_at(2000000000000), [])
        self.assertEqual(self.started, [])


class DispatchOwnership(unittest.TestCase):
    def owner(self, role='feature', feature='one', space='space'):
        return {'state': 'live', 'labels': {'herdr.role': role,
                'herdr.coordinator.space': space, **({'herdr.feature': feature} if feature else {})}}

    def resolve(self, parent, feature, rows, caller=None):
        def hc(*args):
            if args[0] == 'ls':
                return {'terminals': [{'address': addr, 'state': 'live'} for addr in rows]}
            return rows.get(args[1], {'state': 'gone'})
        with mock.patch.object(L, 'hc_json', side_effect=hc), \
                mock.patch.object(L, 'caller_labels', return_value=caller or {}), \
                mock.patch.dict(os.environ, {'HC_TERMINAL_ID': 'caller'}):
            return L.parent_for(parent, 'space', feature)

    def test_live_wrong_feature_parent_is_replaced_by_owning_assistant(self):
        self.assertEqual(self.resolve('wrong', 'one', {'wrong': self.owner(feature='two'),
                         'right': self.owner()}), 'right')

    def test_feature_worker_cannot_become_the_owner_on_resume(self):
        worker = self.owner(role='worker')
        self.assertEqual(self.resolve('caller', 'one', {'caller': worker, 'right': self.owner()},
                                     worker['labels']), 'right')

    def test_worker_with_legacy_template_metadata_is_not_a_space_owner(self):
        worker = self.owner(role='worker', feature=None)
        worker['template'] = 'assistant'
        self.assertIsNone(self.resolve('wrong', None, {'wrong': worker}))

    def test_missing_feature_owner_never_falls_back_to_another_space_or_feature(self):
        for rows in ({'wrong': self.owner(space='elsewhere')},
                     {'wrong': self.owner(feature='two')},
                     {'wrong': self.owner(role='coordinator', feature=None)}):
            self.assertIsNone(self.resolve('wrong', 'one', rows))

    def test_space_tasks_do_not_select_feature_assistants_or_other_spaces(self):
        rows = {'wrong': self.owner(), 'elsewhere': self.owner(role='coordinator', feature=None, space='other'),
                'right': self.owner(role='coordinator', feature=None)}
        self.assertEqual(self.resolve('wrong', None, rows), 'right')


class ReviewOwnership(unittest.TestCase):
    def test_feature_review_requires_both_space_and_feature(self):
        from herdr_task import approvals as A
        ctx = {'space': 'space', 'feature': 'one'}
        owner = {'state': 'live', 'labels': {'herdr.role': 'feature', 'herdr.feature': 'one',
                                           'herdr.coordinator.space': 'elsewhere'}}
        self.assertEqual(A.reviewer_type(owner, ctx), '')
        owner['labels']['herdr.coordinator.space'] = 'space'
        self.assertEqual(A.reviewer_type(owner, ctx), 'feature')

    def test_space_review_never_selects_a_feature_labelled_terminal(self):
        from herdr_task import approvals as A
        owner = {'state': 'live', 'labels': {'herdr.role': 'coordinator', 'herdr.feature': 'one',
                                           'herdr.coordinator.space': 'space'}}
        self.assertEqual(A.reviewer_type(owner, {'space': 'space'}), '')
