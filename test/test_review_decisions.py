"""Review decisions with real scratch stores/git and the existing fake hc/gh conventions."""
import home_guard  # noqa: F401
import json
import os
import subprocess
import sys
import unittest
from unittest import mock
import test_herdr_task as fixtures
BIN = fixtures.BIN
sys.path.insert(0, BIN)
from herdr_task import decisions, proof, github


class ReviewDecisions(unittest.TestCase):
    setUp, run_cmd, add, task = fixtures.Scheduled.setUp, fixtures.Scheduled.run_cmd, fixtures.Scheduled.add, fixtures.Scheduled.task

    def patch(self, obj, name, value):
        p = mock.patch.object(obj, name, value, create=True)
        p.start(); self.addCleanup(p.stop)

    def git(self, folder, *args):
        return subprocess.check_output(['git', '-C', folder, *args], text=True).strip()

    def ready(self, **fields):
        self.add('Reviewed output')
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            t = s.data['tasks'][-1]
            t.update(state='ready', ready_at=100, ready_turns={}, summary='Finished', **fields)
            s.dirty = True
            return t['id']

    def evidence(self, n):
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as s:
            return decisions.decision(s, s.find(n))

    def accept(self, n, token, preceding=None):
        return self.run_cmd(self.commands.cmd_accept, id=str(n), expect=token, after_accept=preceding)

    def no_live(self):
        self.patch(github, 'live_agents', lambda key: [])
        self.patch(github, 'live_helpers', lambda key: [])

    def branch(self, n):
        wt, branch = os.path.join(self.tmp, f'work{n}'), f'task{n}'
        self.git(self.folder, 'worktree', 'add', '-q', '-b', branch, wt, 'main')
        self.git(wt, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', f'work {n}')
        head = self.git(wt, 'rev-parse', 'HEAD')
        return dict(mode='worktree', worktree=wt, branch=branch, head=head, start=self.git(self.folder, 'rev-parse', 'main'), base='main')

    def test_later_reload_concurrent_metadata_restore_and_dependencies(self):
        n = self.ready(proof={'id': 'proof'}, pr={'number': 8}, branch='kept', feature='f1', space='sp1')
        before = self.task(n)
        self.run_cmd(self.commands.cmd_later, id=str(n))
        self.assertTrue(decisions.deferred(self.task(n)))
        # A separate store writer updates unrelated data after Later; neither update is lost.
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(n)['progress'] = {'text': 'CI metadata'}; s.dirty = True
        self.add('Blocked dependent', after=str(n))
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            from herdr_task.queues import waiting_for
            self.assertTrue(waiting_for(s, s.find(2)))
        t = self.task(n)
        self.assertTrue(decisions.deferred(t)); self.assertEqual(t['state'], 'ready')
        for key in ('branch', 'pr', 'proof', 'ready_at', 'agents'): self.assertEqual(t[key], before[key])
        self.assertNotIn('accepted_at', t); self.assertNotIn('done_at', t)
        self.run_cmd(self.commands.cmd_later, id=str(n), restore=True)
        self.assertFalse(decisions.deferred(self.task(n)))
        self.assertEqual(self.task(n)['progress']['text'], 'CI metadata')

    def test_later_never_hides_errors_and_repeated_ready_preserves_it(self):
        n = self.ready(mode='here')
        self.run_cmd(self.commands.cmd_later, id=str(n))
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            t = s.find(n); self.commands.finalize(s, t)
        self.assertTrue(decisions.deferred(self.task(n)))
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            t = s.find(n); t['attention'] = 'Checks failing'; t['attention_at'] = 1; s.dirty = True
        with self.assertRaises(self.Fail): self.run_cmd(self.commands.cmd_later, id=str(n))
        from herdr_task.agents import task_status
        self.assertEqual(task_status(self.task(n), [])[0], 'needs')
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            t = s.find(n); t['state'] = 'running'; self.commands.finalize(s, t)
        self.assertFalse(decisions.deferred(self.task(n)))
        self.assertEqual(self.task(n)['state'], 'ready')

    def test_mark_done_uses_finish_and_retry_is_idempotent(self):
        self.no_live(); n = self.ready(mode='here')
        token = self.evidence(n)['decision_token']
        self.assertFalse(self.evidence(n)['merges'])
        result = self.accept(n, token)
        self.assertEqual(result['state'], 'done'); self.assertIn('done_at', self.task(n))
        result = self.accept(n, token)
        self.assertTrue(result['replayed'])

    def test_stale_head_base_destination_and_worker_refuse_without_completion(self):
        self.no_live(); n = self.ready(**self.branch(1)); token = self.evidence(n)['decision_token']
        self.assertTrue(self.evidence(n)['merges'])
        self.git(self.folder, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'other base work')
        with self.assertRaisesRegex(self.Fail, 'changed since'): self.accept(n, token)
        self.assertEqual(self.task(n)['state'], 'ready'); self.assertNotIn('accepted_at', self.task(n))
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(n)['base'] = 'other'; s.dirty = True
        with self.assertRaises(self.Fail): self.accept(n, token)
        # A worker taking another turn is rejected before any completion path.
        self.patch(self.commands, 'busy_again', lambda *a: True)
        with self.assertRaisesRegex(self.Fail, 'working again'): self.accept(n, token)
        self.assertEqual(self.task(n)['state'], 'running')

    def test_local_merge_advances_base_only_once_and_next_selected_can_continue(self):
        self.no_live(); self.patch(self.commands, 'own_open_pr', lambda *a: None)
        n = self.ready(**self.branch(1)); a = self.evidence(n)
        # The next task includes the first task's commit; both were reviewed against the old main.
        fields = self.branch(2)
        # Use a clean fast-forward chain, equivalent to an ordinary sequential merge queue.
        self.git(fields['worktree'], 'reset', '--hard', 'task1')
        self.git(fields['worktree'], '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'second')
        fields['head'] = self.git(fields['worktree'], 'rev-parse', 'HEAD')
        m = self.ready(**fields); b = self.evidence(m)
        first = self.accept(n, a['decision_token']); self.assertEqual(first['state'], 'done')
        with self.assertRaisesRegex(self.Fail, 'changed since'): self.accept(m, b['decision_token'])
        second = self.accept(m, b['decision_token'], [a['decision_token']])
        self.assertEqual(second['state'], 'done')
        self.assertEqual(self.git(self.folder, 'rev-parse', 'main'), fields['head'])
        self.assertTrue(self.accept(n, a['decision_token'])['replayed'])

    def test_stale_head_and_changed_consequence_cannot_be_marked_done(self):
        self.no_live(); n = self.ready(**self.branch(1)); token = self.evidence(n)['decision_token']
        self.git(self.task(n)['worktree'], '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'more work')
        with self.assertRaisesRegex(self.Fail, 'branch changed'): self.accept(n, token)
        self.assertEqual(self.task(n)['state'], 'ready')
        self.assertNotIn('done_at', self.task(n))

    def github_batch(self):
        self.no_live()
        base = {'oid': self.git(self.folder, 'rev-parse', 'main')}
        states, heads, checks, calls = {}, {}, {}, []
        for i in range(1, 4):
            fields = self.branch(i); heads[i] = fields['head']; states[i] = 'OPEN'; checks[i] = 'SUCCESS'
            self.ready(**fields, pr={'number': i, 'repo': 'test/review'})
        def read(t):
            n = t['pr']['number']
            return {'state': states[n], 'headRefOid': heads[n], 'baseRefName': 'main', 'baseRefOid': base['oid'],
                    'mergeable': 'MERGEABLE', 'mergeStateStatus': 'CLEAN', 'statusCheckRollup': [
                        {'name': 'check', 'status': 'IN_PROGRESS'} if checks[n] == 'RUNNING' else {'name': 'check', 'conclusion': checks[n]}]}
        def gh(*args, **kw):
            self.assertEqual(args[:2], ('pr', 'merge'))
            n = int(args[2]); calls.append(n); states[n] = 'MERGED'; base['oid'] = f'merged-{n}'
            return True, '', ''
        for obj, name, value in [(github, 'pr_view', read), (self.commands, 'pr_view', read), (self.commands, 'gh', gh),
                                 (self.commands, 'watch_main', lambda *a: None), (self.commands, 'update_main', lambda *a: None),
                                 (self.commands, 'drop_branch', lambda *a: None), (self.commands, 'checks_missing', lambda *a: None),
                                 (self.commands, 'expected_checks', lambda *a: []), (self.commands, 'needs_approval', lambda v: False)]:
            self.patch(obj, name, value)
        return checks, calls

    def test_multiple_code_merges_continue_with_fresh_checks_after_each_base_advance(self):
        checks, calls = self.github_batch()
        tokens = [self.evidence(i)['decision_token'] for i in (1, 2, 3)]
        self.assertEqual(self.accept(1, tokens[0])['state'], 'done')
        self.assertEqual(self.accept(2, tokens[1], tokens[:1])['state'], 'done')
        # The third task must read checks again, rather than trusting its pre-batch success.
        checks[3] = 'RUNNING'
        result = self.accept(3, tokens[2], tokens[:2])
        self.assertEqual(result['accepted'], 'checks'); self.assertEqual(result['state'], 'ready')
        self.assertNotIn('done_at', self.task(3)); self.assertEqual(calls, [1, 2])
        self.assertTrue(self.accept(3, tokens[2], tokens[:2])['replayed'])
        self.assertEqual(calls, [1, 2])

    def test_failed_checks_and_unrelated_base_advances_still_refuse_in_batch(self):
        checks, calls = self.github_batch(); tokens = [self.evidence(i)['decision_token'] for i in (1, 2, 3)]
        self.accept(1, tokens[0]); checks[2] = 'FAILURE'
        with self.assertRaises(SystemExit): self.accept(2, tokens[1], tokens[:1])
        self.assertEqual(self.task(2)['state'], 'ready'); self.assertNotIn('done_at', self.task(2))
        # An independent local base advance cannot be attributed to the preceding selected PR.
        self.git(self.folder, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'unrelated')
        with self.assertRaisesRegex(self.Fail, 'changed since'): self.accept(3, tokens[2], tokens[:1])
        self.assertEqual(calls, [1])

    def test_two_concurrent_accepts_complete_once_and_preserve_other_task_updates(self):
        import multiprocessing
        self.no_live(); n = self.ready(mode='here'); self.add('Another task')
        token = self.evidence(n)['decision_token']; ctx = multiprocessing.get_context('fork'); results = ctx.Queue()
        def worker():
            try: results.put(self.accept(n, token))
            except Exception as e: results.put({'error': str(e)})
        workers = [ctx.Process(target=worker) for _ in range(2)]
        for p in workers: p.start()
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            s.find(2)['summary'] = 'Concurrent update'; s.dirty = True
        for p in workers: p.join(10); self.assertEqual(p.exitcode, 0)
        replies = [results.get(timeout=2) for _ in workers]
        self.assertEqual(sum(bool(x.get('replayed')) for x in replies), 1)
        self.assertTrue(all(x['state'] == 'done' for x in replies))
        self.assertEqual(self.task(2)['summary'], 'Concurrent update')

    def test_reading_evidence_does_not_save_live_session_or_progress_updates(self):
        n = self.ready(mode='here')
        self.patch(self.commands, 'refresh_sessions', lambda *a: self.fail('evidence mutated sessions'))
        self.patch(proof, 'artifacts_of', lambda *a: [])
        with self.store_mod.Store(self.store_mod.locate(self.folder), write=False) as s:
            path = s.path
        with open(path, 'rb') as f: before = f.read()
        shown = self.run_cmd(self.commands.cmd_show, id=str(n), evidence=True)
        self.assertIn('decision_token', shown['evidence'])
        with open(path, 'rb') as f: self.assertEqual(f.read(), before)

    def test_incomplete_worktree_evidence_never_offers_unprotected_completion(self):
        self.no_live(); n = self.ready(mode='worktree', branch='unrecorded')
        evidence = self.evidence(n)
        self.assertTrue(evidence['merges']); self.assertIn('not recorded', evidence['decision_error'])
        with self.assertRaisesRegex(self.Fail, 'not recorded'): self.accept(n, evidence['decision_token'])
        self.assertEqual(self.task(n)['state'], 'ready'); self.assertNotIn('done_at', self.task(n))

    def test_revised_report_ready_cycle_resurfaces_without_a_git_head(self):
        n = self.ready(mode='here'); self.run_cmd(self.commands.cmd_later, id=str(n))
        with self.store_mod.Store(self.store_mod.locate(self.folder)) as s:
            t = s.find(n); t['summary'] = 'A revised completed report'; self.commands.finalize(s, t)
        self.assertFalse(decisions.deferred(self.task(n)))
        self.assertEqual(self.task(n)['state'], 'ready')

    def test_worker_changes_during_pr_discovery_cannot_merge_through_local_path(self):
        self.no_live(); n = self.ready(**self.branch(1)); token = self.evidence(n)['decision_token']
        original = self.git(self.folder, 'rev-parse', 'main')
        def discovery(s, t):
            self.git(t['worktree'], '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'resumed during discovery')
            return None
        self.patch(self.commands, 'own_open_pr', discovery)
        with self.assertRaisesRegex(self.Fail, 'branch changed'): self.accept(n, token)
        self.assertEqual(self.git(self.folder, 'rev-parse', 'main'), original)
        self.assertEqual(self.task(n)['state'], 'ready'); self.assertNotIn('accepted_at', self.task(n))

    def test_lost_follow_up_read_preserves_success_receipt_and_normal_cleanup(self):
        self.no_live(); self.patch(self.commands, 'own_open_pr', lambda *a: None)
        n = self.ready(**self.branch(1)); t = self.task(n); token = self.evidence(n)['decision_token']
        real = decisions.decision
        def read(s, task):
            if task['state'] == 'done': raise self.Fail('Follow-up read unavailable')
            return real(s, task)
        self.patch(decisions, 'decision', read)
        result = self.accept(n, token)
        self.assertEqual(result['state'], 'done'); self.assertTrue(self.accept(n, token)['replayed'])
        self.assertFalse(os.path.exists(t['worktree']))
        self.assertEqual(self.git(self.folder, 'branch', '--list', t['branch']), '')
        self.assertEqual(self.git(self.folder, 'rev-parse', 'main'), t['head'])
