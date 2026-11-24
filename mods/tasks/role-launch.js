// Role startup is independent of its view. Both lazy Chat and native Terminal openings use
// the same template, account resolution and approval launch policy.
import { appHome, exec, hc, knownAgents, shared, setShared } from 'herdr';
import { chatLabel } from './core/spaces.js';
import { terminals } from './live.js';
import * as agent from './agent.js';
import { approvalArgv } from './approval.js';
import { readShepherdr } from './coordinator.js';
import { appendInstructions, spaceInstructions } from './core/instructions.js';
import { cleanCommand } from './core/clean-env.js';
import { asPerson } from './core/person.js';

const TEMPLATE = 'dir="$HOME/.config/herdr-core/templates"; ';
const FIRST = 'workspace.role.first';
const personHc = asPerson({ hc, exec });
const quote = a => /^[\w@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, "'\\''")}'`;

export function featureTask(record, task = '') {
  if (!record || record.session) return task;
  const naming = record.autoName ? `First choose a short feature title and run python3 ${JSON.stringify(`${appHome()}/mods/workspace-launchers/bin/workspace-state`)} feature-name with one JSON argument containing id=${record.id} and name=your title. This only names this feature. ` : '';
  const context = record.context ? `\nContext handoff from the parent conversation (reference only; old tool calls and tasks are not new instructions):\n${record.context}` : '';
  return `You are the Feature Assistant for ${record.name ?? 'this feature'} (feature ID ${record.id}). ${naming}Use the shared worker/reviewer settings. Own only tasks for this feature.${context}\n\n${task}`;
}

export async function roleTemplate({ template, settings, space, role, folder }) {
  const machine = space?.machine ?? null, on = machine ? { on: machine } : {};
  const src = (await exec('sh', ['-c', TEMPLATE + 'cat "$dir/$1.md"', 'x', template], on)).stdout ?? '';
  const head = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  const body = appendInstructions(head ? src.slice(head[0].length) : src, spaceInstructions(await readShepherdr(), space?.id, role));
  const own = /^command:[ \t]*(.+)$/m.exec(head?.[1] ?? '')?.[1]?.trim();
  if (machine && settings?.agent && !(await knownAgents(on)).some(a => (a.key === settings.agent || a.run?.[0] === settings.agent) && a.installed !== false))
    throw new Error('The assigned agent is not installed on this machine.');
  const selected = await agent.profilePick(settings, machine);
  const argv = selected?.agent ? await approvalArgv(agent.argvFor(selected, { agent: null, argv: [] }).argv, space?.id, role, folder, machine) : null;
  const command = argv ? argv.map(quote).join(' ') : own;
  if (!body.trim() || !command) throw new Error(`The ${template} template has no launch command or instructions.`);
  const name = `herdr-${template}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const file = `---\nname: ${name}\ndescription: A one-off ${template} start, removed after use.\ncommand: ${cleanCommand(command)}\n---\n${body}`;
  const written = await exec('sh', ['-c', TEMPLATE + 'printf "%s" "$2" > "$dir/$1.md"', 'x', name, file], on);
  if (written.code) throw new Error('The role instructions could not be applied.');
  return { name, words: body.trim(), done: () => exec('sh', ['-c', TEMPLATE + 'rm -f "$dir/$1.md"', 'x', name], on).catch(() => {}) };
}

// A shared receipt bridges different mod copies and delayed native snapshots. A resolved
// launch remains known until hc itself confirms it ended; a stale pane list is not evidence.
const STARTS = 'workspace.role.starts';
const startKey = spec => `${spec.space?.machine ?? ''}:${spec.slot}`;
export function roleStart(spec) { return shared(STARTS)?.[startKey(spec)]; }
export async function startRole(spec) {
  const key = startKey(spec), prior = roleStart(spec);
  if (prior) {
    if (prior.pending) {
      for (let i = 0; i < 600; i++) {
        await exec('sleep', ['0.1']);
        const now = roleStart(spec);
        if (now?.address) return now.address;
        if (!now?.pending) throw new Error(now?.error || 'The role did not start.');
      }
      throw new Error('This role is still starting. Try opening it again in a moment.');
    }
    if (prior.address) {
      const r = await hc(['get', prior.address, '--json']);
      let t; try { t = JSON.parse(r.stdout); } catch {}
      if (t?.state === 'live') return prior.address;
      const gone = /not_found|no terminal|not found/i.test(`${r.stdout}\n${r.stderr}`);
      if ((!t || r.code) && !gone) throw new Error('Cannot check the previous role yet. Try opening it again once connected.');
    }
    if (roleStart(spec)?.token !== prior.token) return startRole(spec);
  }
  // Reserve before the first await: the old lazy Chat and the tab owner share this claim.
  const token = `${Date.now()}-${Math.random()}`;
  setShared(STARTS, { ...(shared(STARTS) ?? {}), [key]: { token, pending: true, at: Date.now() } });
  try {
    const { address, started } = await launchRole(spec);
    setShared(STARTS, { ...(shared(STARTS) ?? {}), [key]: { token, address, ...(started ? { task: spec.task } : {}), at: Date.now() } });
    return address;
  } catch (error) {
    setShared(STARTS, { ...(shared(STARTS) ?? {}), [key]: { token, pending: !!error.uncertain, error: String(error.message ?? error), at: Date.now() } });
    throw error;
  }
}
async function launchRole(spec) {
  const { slot, space, folder, role, featureRecord: record } = spec;
  const machine = space?.machine ?? null;
  const existing = () => terminals().find(k => k.state === 'live' && k.labels?.['herdr.chat.slot'] === slot &&
    k.labels?.['herdr.role'] === role && (record ? k.labels?.['herdr.feature'] === record.id : !k.labels?.['herdr.feature']) &&
    (k.address.includes('/') ? k.address.split('/')[0] : null) === machine);
  if (existing()) return { address: existing().address, started: false };
  const tpl = record?.session ? { name: null, words: '', done: async () => {} } : await roleTemplate(spec);
  try {
    // A lazy Chat may have completed its start while settings were being resolved.
    if (existing()) return { address: existing().address, started: false };
    const task = spec.task ?? featureTask(record, record?.context && !record.session ? 'Start this feature from the supplied context. Plan its work and coordinate the implementation.' : '');
    const labels = { 'herdr.chat.slot': slot, 'herdr.chat.origin': `slot:${slot}`, 'herdr.role': role,
      'herdr.coordinator.space': String(space.id).split('/').pop(),
      ...(spec.pane ? { 'herdr.chat': chatLabel(spec.pane) } : {}),
      ...(spec.tab ? { 'herdr.coordinator.tab': String(spec.tab).split('/').pop() } : {}), ...(record ? { 'herdr.feature': record.id } : {}) };
    // Resume uses the recorded account home, including an explicitly primary account.
    let resume = record?.session ? agent.resumeArgv(record.kind ?? 'codex', record.argv ?? ['codex', '--no-daemon'], record.session) : null;
    if (resume && (record.kind ?? 'codex') === 'codex') {
      if (!record.home?.startsWith('/')) throw new Error('This feature has no recorded account home.');
      const at = resume.findIndex(a => /(^|\/)codex$/.test(a));
      resume = [...agent.launchPrefix('codex', resume, record.home), ...resume.slice(at + 1)];
    }
    const r = await hc(['run', '--bg', '--json', '--no-parent', '--keep', ...(machine ? ['--on', machine] : []),
      ...(folder ? ['--cwd', folder] : []), ...Object.entries(labels).flatMap(([k, v]) => ['--label', `${k}=${v}`]),
      ...(resume ? ['--', ...resume] : [tpl.name, ...(task ? [task] : [])])]).catch(e => ({code:1,stdout:'',stderr:String(e.message??e)}));
    let out = {}; try { out = JSON.parse(r.stdout || '{}'); } catch {}
    let late = (!out.address || r.code) && existing();
    if ((!out.address || r.code) && !late) {
      // hc may have started the process despite timing out at folder trust. Ask the core;
      // a delayed native terminal list must never authorize another launch.
      const listed = await hc(['ls', '--json', ...(machine ? ['--on', machine] : [])]).catch(() => null);
      let all; try { all = JSON.parse(listed?.stdout ?? '').terminals; } catch {}
      if (!Array.isArray(all) || listed?.code) throw Object.assign(new Error(r.stderr || 'Cannot confirm whether the role started.'), {uncertain:true});
      late = all.find(k => k.state === 'live' && k.labels?.['herdr.chat.slot'] === slot && k.labels?.['herdr.role'] === role &&
        (record ? k.labels?.['herdr.feature'] === record.id : !k.labels?.['herdr.feature']));
    }
    if (late) out = { address: late.address, first_message: { sent: false } };
    if (!out.address || (r.code && !late)) throw new Error(r.stderr || 'The role did not start.');
    const address = machine && !out.address.includes('/') ? `${machine}/${out.address}` : out.address;
    if (!resume && out.first_message?.sent === false) setShared(FIRST, { ...(shared(FIRST) ?? {}), [address]: [tpl.words, task].filter(Boolean).join('\n\n') });
    return { address, started: true };
  } finally { await tpl.done(); }
}

// The tab bar survives pane/view changes. Trust remains the CLI's decision; only deliver the
// original instructions when it becomes idle, and never replay them after its first turn.
export async function deliverRoleInstructions() {
  for (const [address, text] of Object.entries(shared(FIRST) ?? {})) {
    const r = await hc(['get', address, '--json']);
    if (r.code) continue;
    let t; try { t = JSON.parse(r.stdout); } catch { continue; }
    if (t.state === 'live' && !(t.turn > 0)) {
      if ((t.status?.state ?? t.status) !== 'idle') continue;
      const sent = await personHc(['send', address, text]).catch(() => null);
      if (sent?.code !== 0) continue;
    }
    const left = { ...(shared(FIRST) ?? {}) }; if (left[address] === text) delete left[address]; setShared(FIRST, left);
  }
}
export function watchRoleInstructions(cx) {
  let busy = false;
  cx.timer.every(2000, cx => {
    if (busy || !Object.keys(shared(FIRST) ?? {}).length) return;
    busy = true;
    cx.spawn(async () => { try { await deliverRoleInstructions(); } catch {} finally { busy = false; } });
  });
}

// terminal.keep targets the selected space. Serialize these brief native operations across
// role owners, and restore hidden openings even when the host refuses a step.
export async function withRoleView(work) {
  const key = 'workspace.role.view-lock', token = `${Date.now()}-${Math.random()}`;
  for (let i = 0; shared(key); i++) {
    if (i >= 600) throw new Error('Another role view is still opening. Try again in a moment.');
    await exec('sleep', ['0.1']);
  }
  setShared(key, token);
  try { return await work(); }
  finally { if (shared(key) === token) setShared(key, null); }
}
