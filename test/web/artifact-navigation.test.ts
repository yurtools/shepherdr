import { expect, test } from 'bun:test';
const g = globalThis as any;
const listeners: Record<string, Function> = {};
const entries: { state: any; url: string }[] = [];
let at = -1;
const sent: any[] = [];
g.location = new URL('http://fixture.test/?place=B');
g.innerWidth = 1280; g.innerHeight = 800;
g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
g.sessionStorage = g.localStorage;
g.addEventListener = (name: string, fn: Function) => { listeners[name] = fn; };
g.removeEventListener = () => {};
g.document = { head: { innerHTML: '' }, visibilityState: 'visible', addEventListener() {}, documentElement: { style: {}, dataset: {} } };
g.window = g;
g.history = {
 state: null,
 replaceState(state: any, _: any, url: string) { if (at < 0) at = 0; entries[at] = { state, url }; this.state = state; g.location = new URL(url, g.location); },
 pushState(state: any, _: any, url: string) { entries.splice(++at); entries.push({ state, url }); this.state = state; g.location = new URL(url, g.location); },
 back() { if (at > 0) { const e = entries[--at]; this.state = e.state; g.location = new URL(e.url, g.location); queueMicrotask(() => listeners.popstate?.({ state: e.state })); } },
};
let socket: any;
g.WebSocket = class {
 static OPEN = 1; readyState = 1; onopen: any; onmessage: any; onclose: any;
 constructor() { socket = this; }
 send(text: string) { sent.push(JSON.parse(text)); }
 close() {}
};
const K = await import('../../web/src/kernel.ts');
const art = { id: 'proof-1234', title: 'Identical', place: 'A', v: 3, machine: undefined, versions: [{ n: 3 }, { n: 1 }] };
const snap: any = { host: 'fixture', user: 'Fixture', name: 'Fixture',
 places: ['A','B','vm/A'].map(id => ({ id, name: 'Identical', machine: id.startsWith('vm/') ? 'vm' : 'fixture', chat: `p:${id}`, tabs: [] })),
 machines: [{ machine: 'fixture', coreId: 'local-core', here: true, status: 'idle' }, { machine: 'vm', coreId: 'remote-core', status: 'idle' }],
 tasks: [], artifacts: [art, { ...art, place: 'vm/A', machine: 'vm' }], settings: [], asks: {}, needs: [], automations: {}, last: {}, read: {}, sections: [] };
const push = (snapshot: any) => socket.onmessage({ data: JSON.stringify({ type: 'snapshot', snapshot }) });

test('the real web kernel keeps owner, machine, history and pending requests independent of selection', async () => {
 K.connect(); push(snap);
 K.openArtifact(art.id, 1, null);
 expect(K.getState().ui.place).toBe('A');
 expect(K.getState().ui.viewer).toMatchObject({ artifact: '/proof-1234', v: 1, owner: 'A' });
 K.closeArtifact(); expect(K.getState().ui.place).toBe('A');
 g.history.back(); await Promise.resolve(); expect(K.getState().ui.place).toBe('B');
 expect(K.getState().ui.viewer).toBeNull();
 K.openArtifact(art.id, 1, 'vm');
 expect(K.getState().ui.place).toBe('vm/A');
 expect(K.getState().ui.viewer?.artifact).toBe('vm/proof-1234');
 K.goPlace('B'); expect(K.getState().ui.viewer).toBeNull();
 // A remote request arrives before that machine's artifacts; switching cancels it.
 push({ ...snap, artifacts: [art] }); K.openArtifact(art.id, 1, 'vm');
 expect(K.getState().ui.place).toBe('B'); K.goPlace('B'); push(snap);
 expect(K.getState().ui.viewer).toBeNull();
 // Without a switch, the late snapshot resolves the original request, never the local collision.
 push({ ...snap, artifacts: [art] }); K.openArtifact(art.id, 1, 'vm'); push(snap);
 expect(K.getState().ui.place).toBe('vm/A');
 expect(K.getState().ui.viewer?.artifact).toBe('vm/proof-1234');
 K.goPlace('B'); K.openArtifact(art.id, undefined, undefined, 'deleted-core');
 expect(K.getState().ui.place).toBe('B'); expect(K.getState().ui.viewer?.error).toContain('original machine');
 expect(sent.every(m => m.type === 'watch' || m.type === 'ping')).toBe(true);
});
