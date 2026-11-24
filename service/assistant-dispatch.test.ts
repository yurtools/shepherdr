import {expect, test} from 'bun:test';
import {act} from './actions.ts';
import {Hub} from './hub.ts';

for (const role of ['coordinator', 'feature']) {
  test(`${role} message delivery uses its own turn while an owned worker stays active`, async () => {
    const hub = new Hub('/unused-fixture-hc');
    const owner = {address:'towner', state:'live', status:{state:'idle'}, argv:['codex'],
      labels:{'herdr.role':role, 'herdr.coordinator.space':'fixture-space',
        ...(role === 'feature' ? {'herdr.feature':'one'} : {})}};
    const worker = {address:'tworker', parent:'towner', state:'live', status:{state:'working'}, argv:['codex'],
      labels:{'herdr.role':'worker', 'herdr.task':'FIX-1', 'herdr.owner':'towner', 'herdr.task.space':'fixture-space',
        ...(role === 'feature' ? {'herdr.feature':'one'} : {})}};
    const other = {address:'tother', state:'live', status:{state:'idle'}, argv:['codex'],
      labels:{'herdr.role':'feature', 'herdr.feature':'two', 'herdr.coordinator.space':'fixture-space'}};
    hub.terminals = new Map([owner, worker, other].map(t => [t.address, t])) as any;
    let finish!: () => void;
    let workerEnded = false;
    const work = new Promise<void>(resolve => {finish = resolve}).then(() => {workerEnded = true});
    const calls:any[] = [];
    // Stand-in core transport only: use the actual Hub and service send action.
    (hub as any).client = {call:async (method:string, params:any) => {
      calls.push({method, params});
      expect(params.terminal).toBe('towner');
      expect(workerEnded).toBe(false);
      return {sent:true};
    }};
    try {
      const result:any = await act(hub, {type:'send', addr:'towner', text:'Can we talk while the build runs?', hold:true}, {} as any);
      expect(result.ok).toBe(true);
      expect(result.waiting).toBeUndefined();
      expect(calls).toEqual([{method:'terminal.send', params:{terminal:'towner', text:'Can we talk while the build runs?'}}]);
      expect(owner.status.state).toBe('idle');
      expect(worker.status.state).toBe('working');
      expect(workerEnded).toBe(false);
    } finally {finish(); await work;}
  });
}
