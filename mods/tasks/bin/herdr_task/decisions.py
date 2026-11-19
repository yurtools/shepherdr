"""Review snapshots and attention preferences. No alternative completion path."""
import hashlib
import json
import os
from .base import Fail, git


def deferred(t):
    return t.get('state') == 'ready' and t.get('deferred_ready_at') is not None and t['deferred_ready_at'] == (t.get('ready_at') or 0)


def _decision(s, t):
    # Use the same authority as accept, never a summary or an old nothing_to_merge flag.
    from .commands import branch_tip, in_base, merged_here
    from .github import pr_view, on_github, github, github_unreachable, pr_for_branch
    wt = t.get('mode') == 'worktree' and bool(t.get('worktree'))
    tip = branch_tip(s, t) if wt else None
    base = t.get('base') or 'main'
    pr = t.get('pr')
    if wt and not pr and t.get('branch') and on_github(s.loc['folder']):
        repo = github(s)
        if not repo:
            raise Fail(github_unreachable(s) or "Could not read this GitHub repository. Refresh before accepting.")
        found = pr_for_branch(t, repo, strict=True)
        if found: pr = {'number': found['number'], 'repo': repo}
    effective = {**t, 'pr': pr}
    remote = pr_view(effective) if pr and wt and pr.get('repo') and pr.get('number') else None
    unknown = bool(pr and wt and not remote)
    merges = bool(wt and (unknown or (remote and remote.get('state') != 'MERGED') or
                          (not pr and not (merged_here(s, t) or in_base(s, t)))))
    # A missing branch/base must never look like evidence that the work was completed.
    ok, base_tip, _ = git(s.loc['folder'], 'rev-parse', '--verify', '--quiet', base) if wt else (True, None, '')
    data = {k: t.get(k) for k in ('id', 'created', 'state', 'ready_at', 'head', 'branch', 'worktree', 'mode', 'space', 'feature', 'summary', 'details', 'proof', 'ready_turns')}
    dirty = git(t['worktree'], 'status', '--porcelain', '--untracked-files=no')[1] if wt and os.path.isdir(t['worktree']) else ''
    data.update(dirty=dirty, folder=s.loc['folder'], tip=tip, base=base, base_tip=base_tip if ok else None,
                pr={k: pr.get(k) for k in ('repo', 'number', 'branch')} if pr else None,
                remote={k: remote.get(k) for k in ('state', 'headRefOid', 'baseRefName', 'baseRefOid')} if remote else None, merges=merges)
    reason = "Couldn't read the pull request. Refresh before accepting." if unknown else None
    if wt and (not tip or not ok): reason = 'Could not read the task branch or destination. Refresh before accepting.'
    if remote and remote.get('baseRefName') and remote['baseRefName'] != base:
        reason = 'The pull request destination changed. Ask the worker to update the task.'
    if remote and tip and remote.get('headRefOid') != tip:
        reason = 'The pull request and local branch differ. Ask the worker to push and say ready again.'
    if dirty: reason = 'The worker has uncommitted changes. Ask it to finish and say ready again.'
    if wt and t.get('head') and tip != t['head']: reason = 'The task branch changed after Ready. Ask the worker to say ready again.'
    token = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'merges': merges, 'destination': base if merges else None, 'decision_token': token, 'decision_error': reason, 'decision_basis': basis(data)}, data


def basis(data):
    return {'destination': data['base'], 'repo': (data.get('pr') or {}).get('repo'),
            'local': data.get('base_tip'), 'remote': (data.get('remote') or {}).get('baseRefOid')}


def decision(s, t):
    return _decision(s, t)[0]


def validate(s, t, expected, preceding=()):
    fresh, data = _decision(s, t)
    if fresh['decision_error']: raise Fail(fresh['decision_error'])
    if fresh['decision_token'] == expected: return fresh
    # Only advances proven to come from successful preceding selections in this batch may be
    # rewound for comparison. A new head, destination, unrelated base change or wait still refuses.
    receipts = {x.get('accept_receipt', {}).get('token'): x.get('accept_receipt') for x in s.data['tasks']}
    for token in reversed(preceding):
        receipt = receipts.get(token) or {}
        if receipt.get('accepted') not in ('github', 'merged'): continue
        before, after = receipt.get('before'), receipt.get('after')
        if not before or not after or basis(data) != after: continue
        if before['destination'] != after['destination'] or before['repo'] != after['repo']: continue
        data['base_tip'] = before['local']
        if data.get('remote'): data['remote']['baseRefOid'] = before['remote']
        compared = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        if compared == expected: return fresh
    raise Fail('This task changed since you reviewed it. Refresh and review its evidence again.')
