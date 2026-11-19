import { expect, test } from 'bun:test';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { argvFor, profileLaunch, resumeArgv, freshArgv, forkArgv } from './agents.js';

test('fresh default Codex clears an ambient named account through resume, recovery and fork', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-default-account-'));
  const codex = join(root, 'codex');
  writeFileSync(codex, '#!/bin/sh\nprintf "%s" "${CODEX_HOME:-default-account}|${OPENAI_API_KEY:-cleared}|${CODEX_SQLITE_HOME:-cleared}"\n');
  chmodSync(codex, 0o755);
  const base = argvFor({ agent: 'codex', fast: false, perm: 'read-only' }, { agent: null }).argv;
  const resumed = resumeArgv('codex', base, 'saved');
  for (const argv of [base, resumed, freshArgv('codex', resumed), forkArgv('codex', base, 'forked')]) {
    const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', env: { ...process.env, PATH: root + ':' + process.env.PATH,
      CODEX_HOME: '/synthetic/ambient-account', OPENAI_API_KEY: 'synthetic', CODEX_SQLITE_HOME: '/synthetic/database' } });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('default-account|cleared|cleared');
  }
});

test('an unresolved, wrong-agent, missing or malformed named account never produces default argv', () => {
  expect(() => argvFor({ agent: 'codex', profile: 'two' }, { agent: null })).toThrow('destination');
  for (const profiles of [[], [null], [{ id: 'two', agent: 'claude', home: '/synthetic/account' }],
    [{ id: 'two', agent: 'codex', home: 'relative' }], [{ id: 'two', agent: 'codex', home: '/bad\nhome' }], {}])
    expect(() => profileLaunch({ agent: 'codex', profile: 'two' }, profiles)).toThrow('unavailable');
  expect(() => profileLaunch({ agent: 'claude', profile: 'two' }, [{ id: 'two', agent: 'codex', home: '/synthetic/account' }])).toThrow('unavailable');
});

// Exercise the actual native save/resolution methods without initializing a settings mod.
const source = readFileSync(join(import.meta.dir, '../lib/coordinator.js'), 'utf8');
const layersSource = source.slice(source.indexOf('export function shepherdrLayers'), source.indexOf('// What applies in a scope:')).replace('export ', '');
const layers = new Function('machineOfSpace', layersSource + '; return shepherdrLayers;')(id => id.includes('/') ? id.split('/')[0] : 'local');
const resolveSource = source.slice(source.indexOf('export function shepherdrFor'), source.indexOf('// One app command,')).replace('export ', '');
const resolve = new Function('shepherdrLayers', 'SHEPHERDR_DEFAULTS', resolveSource + '; return shepherdrFor;')(layers, { tasks: {}, agents: {}, automations: {} });
const settingsSource = readFileSync(join(import.meta.dir, '../mods/shepherdr-settings/main.js'), 'utf8');
const setMethod = settingsSource.slice(settingsSource.indexOf('  set(key, field, value, cx) {'), settingsSource.indexOf('  // Reset:'));
const set = new Function('return ({' + setMethod + '}).set')();

test('native whole-role saves preserve explicit default, null inheritance, Feature independence and task fields', () => {
  const cfg = { everywhere: { worker: { agent: 'codex', profile: 'two', model: 'global', effort: 'high', fast: true, perm: 'full' },
    reviewer: { agent: 'claude', model: 'opus' }, tasks: { proof: true, merge: 'ask' } },
    spaces: { sp: { folder: '/old-root', feature: { agent: 'codex', profile: 'feature-account' }, tasks: { proof: false } } } };
  const view = { scope: 'sp', inherited: key => ({ value: cfg.everywhere[key] }),
    change: fn => fn(cfg), target: next => next.spaces.sp, layerOf: next => next.spaces.sp,
    drop: (own, key) => { delete own[key]; } };
  expect(resolve(cfg, 'sp').worker.profile).toBe('two');
  set.call(view, 'worker', null, { agent: 'codex', profile: null, model: null, fast: false, perm: 'read-only' }, {});
  expect(resolve(cfg, 'sp').worker).toEqual({ agent: 'codex', profile: null, model: null, fast: false, perm: 'read-only' });
  expect(resolve(cfg, 'sp').reviewer).toEqual(cfg.everywhere.reviewer);
  expect(resolve(cfg, 'sp').tasks).toEqual({ proof: false, merge: 'ask' });
  set.call(view, 'worker', null, cfg.everywhere.worker, {});
  expect(cfg.spaces.sp.worker).toBeUndefined();
  expect(resolve(cfg, 'sp').worker).toEqual(cfg.everywhere.worker);
  cfg.spaces.sp.worker = null;
  expect(resolve(cfg, 'sp').worker.profile).toBe('two');
  cfg.spaces.sp.worker = {};
  expect(resolve(cfg, 'sp').worker).toEqual({});
});

test('native named profile lookup uses only the requested destination and rejects a deleted home', async () => {
  const source = readFileSync(join(import.meta.dir, '../lib/agent.js'), 'utf8');
  const fn = source.slice(source.indexOf('export async function profilePick')).replace('export ', '');
  const calls = [];
  let present = true;
  const pick = new Function('profileLaunch', 'profiles', 'exec', fn + '; return profilePick;')(profileLaunch,
    async machine => { calls.push(['profiles', machine]); return [{ id: 'two', agent: 'codex', home: '/synthetic/destination-account' }]; },
    async (cmd, args, opts) => { calls.push([cmd, args, opts]); return { code: present ? 0 : 1 }; });
  const result = await pick({ agent: 'codex', profile: 'two' }, 'destination');
  expect(result.launch).toContain('CODEX_HOME=/synthetic/destination-account');
  expect(calls).toEqual([['profiles', 'destination'], ['test', ['-d', '/synthetic/destination-account'], { on: 'destination' }]]);
  present = false;
  await expect(pick({ agent: 'codex', profile: 'two' }, 'destination')).rejects.toThrow('unavailable');
});
