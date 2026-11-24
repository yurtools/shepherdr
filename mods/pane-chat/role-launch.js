// Role startup is independent of its view. Both lazy Chat and native Terminal openings use
// the same template, account resolution and approval launch policy.
import { appHome, exec, hc, knownAgents, shared, setShared } from 'herdr';
import { chatLabel, featureOwner, runningFeatureAssistant } from './core/spaces.js';
import { terminals } from './live.js';
import * as agent from './agent.js';
import { approvalArgv } from './approval.js';
import { readShepherdr } from './coordinator.js';
import { appendInstructions, spaceInstructions } from './core/instructions.js';
import { cleanCommand } from './core/clean-env.js';
import { asPerson } from './core/person.js';
import { FIND } from './core/session-find.js';

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
    // A launch claim is persisted with shared state. An old Feature claim may
    // predate a stopped core; let the authoritative lookup below settle it.
    if (prior.pending && !(spec.featureRecord && Date.now()-prior.at>300000)) {
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
      if (t?.state === 'live' && (!spec.featureRecord || runningFeatureAssistant({...t,address:prior.address},spec.featureRecord))) return prior.address;
      if (spec.featureRecord&&featureOwner({...t,address:prior.address},spec.featureRecord)&&Date.now()-prior.at<30000)
        throw new Error('The Feature Assistant may still be starting. Try again in a moment.');
      const gone = /not_found|no terminal|not found/i.test(`${r.stdout}\n${r.stderr}`);
      if ((!t || r.code) && !gone) throw new Error('Cannot check the previous role yet. Try opening it again once connected.');
    }
    if (roleStart(spec)?.token !== prior.token) return startRole(spec);
  }
  // Reserve before the first await: the old lazy Chat and the tab owner share this claim.
  const token = `${Date.now()}-${Math.random()}`;
  const hadPreviousStart = Boolean(prior?.address || prior?.pending || prior?.hadPreviousStart);
  setShared(STARTS, { ...(shared(STARTS) ?? {}), [key]: { token, pending: true, at: Date.now() } });
  try {
    const { address, started } = await launchRole(spec, hadPreviousStart);
    setShared(STARTS, { ...(shared(STARTS) ?? {}), [key]: { token, address, ...(started && !spec.featureRecord?.session ? { task: spec.task } : {}), at: Date.now() } });
    return address;
  } catch (error) {
    setShared(STARTS, { ...(shared(STARTS) ?? {}), [key]: { token, pending: !!error.uncertain, ...(spec.featureRecord&&(hadPreviousStart||error.hadPreviousStart)?{hadPreviousStart:true}:{}), error: String(error.message ?? error), at: Date.now() } });
    throw error;
  }
}
async function launchRole(spec, hadPreviousStart) {
  const { slot, space, folder, role, featureRecord: record } = spec;
  const machine = space?.machine ?? null;
  const existing = () => terminals().find(k => k.state === 'live' && k.labels?.['herdr.chat.slot'] === slot &&
    k.labels?.['herdr.role'] === role && (record ? k.labels?.['herdr.feature'] === record.id : !k.labels?.['herdr.feature']) &&
    (k.address.includes('/') ? k.address.split('/')[0] : null) === machine);
  // For a Feature, query the core, not the native snapshot or a saved receipt.
  // A resumed owner may have a different address or no slot label yet.
  const findExisting = async () => {
    if (!record) return existing();
    const addresses = new Set();
    for (const label of [`herdr.feature=${record.id}`,`herdr.chat.slot=${slot}`]) {
      const listed = await hc(['ls', '--json', '--label',label]);
      let all; try { all = JSON.parse(listed.stdout).terminals; } catch {}
      if (listed.code || !Array.isArray(all)) throw new Error('Cannot check the running Feature Assistant. Try again once connected.');
      for (const row of all) if (row.address&&!row.address.includes('/')) addresses.add(row.address);
    }
    const owners = [];
    for (const address of addresses) {
      const result = await hc(['get', address, '--json']);
      let terminal; try { terminal = JSON.parse(result.stdout); } catch {}
      if (result.code && /not_found|no terminal|not found/i.test(`${result.stdout}\n${result.stderr}`)) continue;
      if (result.code || !terminal) throw new Error('Cannot check the running Feature Assistant. Try again once connected.');
      const candidate = {...terminal,address};
      if (featureOwner(candidate,record)) owners.push(candidate);
      else if (candidate.state==='live'&&candidate.labels?.['herdr.chat.slot']===slot) {
        // Older explicit restarts kept the feature slot but dropped its role
        // and feature labels. Reclaim only a verified original conversation.
        const labels=candidate.labels;
        if (labels['herdr.role']||labels['herdr.feature']||labels['herdr.task']||
          (labels['herdr.coordinator.space']||labels['herdr.space'])!==record.space)
          throw new Error('A different agent holds this feature slot. Its conversation has not been replaced.');
        const repaired={...candidate,labels:{...labels,'herdr.role':'feature','herdr.feature':record.id}};
        if (runningFeatureAssistant(repaired,record)) {
          const kind=({'codex':'codex','claude':'claude','claude-code':'claude'})[candidate.status?.app??candidate.foreground?.name];
          const pid=candidate.foreground?.pid;
          if (!record.session||kind!==(record.kind??'codex')||!pid) throw new Error('Cannot verify the saved Feature Assistant session.');
          const found=await exec('sh',['-c',FIND,'chat',kind,String(pid)]);
          const session=agent.sessionOf(kind,found.stdout.trim().split('\n').pop());
          const defaults=await agent.defaults(kind,null,{pid});
          if (session!==record.session||kind==='codex'&&defaults.home!==record.home) throw new Error('The Feature Assistant session or account does not match its saved record.');
          repaired.restoreLabels=true;
        }
        owners.push(repaired);
      }
    }
    const running = owners.filter(k => runningFeatureAssistant(k,record));
    if (running.length > 1) throw new Error('More than one agent owns this feature. Resolve the duplicate before reopening it.');
    if (!running.length && owners.some(k => !k.foreground?.name)) throw new Error('The Feature Assistant may still be starting. Try again in a moment.');
    if (!running.length && !record.session && (owners.length || record.terminal || record.tab || record.pane || hadPreviousStart))
      throw Object.assign(new Error('This feature has no saved session to resume. Its conversation will not be replaced.'),{hadPreviousStart:true});
    if(running[0]?.restoreLabels){
      const result=await hc(['label',running[0].address,'herdr.role=feature',`herdr.feature=${record.id}`]);
      if(result.code)throw new Error('Could not restore the Feature Assistant identity.');
    }
    return running[0];
  };
  const found = await findExisting();
  if (found) return { address: found.address, started: false };
  const tpl = record?.session ? { name: null, words: '', done: async () => {} } : await roleTemplate(spec);
  try {
    // A lazy Chat may have completed its start while settings were being resolved.
    const started = await findExisting();
    if (started) return { address: started.address, started: false };
    const task = spec.task ?? featureTask(record, record?.context && !record.session ? 'Start this feature from the supplied context. Plan its work and coordinate the implementation.' : '');
    const labels = { 'herdr.chat.slot': slot, 'herdr.chat.origin': `slot:${slot}`, 'herdr.role': role,
      'herdr.coordinator.space': String(space.id).split('/').pop(),
      ...(spec.pane ? { 'herdr.chat': chatLabel(spec.pane) } : {}),
      ...(spec.tab ? { 'herdr.coordinator.tab': String(spec.tab).split('/').pop() } : {}), ...(record ? { 'herdr.feature': record.id } : {}) };
    // Resume uses the recorded account home, including an explicitly primary account.
    let resume = record?.session ? agent.resumeArgv(record.kind ?? 'codex', record.argv ?? ['codex', '--no-daemon'], record.session) : null;
    if (resume && (record.kind ?? 'codex') === 'codex') {
      if (!record.home?.startsWith('/')) throw new Error('This feature has no recorded account home.');
      if ((await exec('test',['-d',record.home])).code !== 0) throw new Error('The feature’s original account is unavailable. Its conversation has not been replaced.');
      const at = resume.findIndex(a => /(^|\/)codex$/.test(a));
      resume = [...agent.launchPrefix('codex', resume, record.home), ...resume.slice(at + 1)];
    }
    const r = await hc(['run', '--bg', '--json', '--no-parent', '--keep', ...(machine ? ['--on', machine] : []),
      ...(folder ? ['--cwd', folder] : []), ...Object.entries(labels).flatMap(([k, v]) => ['--label', `${k}=${v}`]),
      ...(resume ? ['--', ...resume] : [tpl.name, ...(task ? [task] : [])])]).catch(e => ({code:1,stdout:'',stderr:String(e.message??e)}));
    let out = {}; try { out = JSON.parse(r.stdout || '{}'); } catch {}
    let late = (!out.address || r.code) && (record ? null : existing());
    if ((!out.address || r.code) && !late) {
      // hc may have started the process despite timing out at folder trust. Ask the core;
      // a delayed native terminal list must never authorize another launch.
      const listed = await hc(['ls', '--json', ...(machine ? ['--on', machine] : [])]).catch(() => null);
      let all; try { all = JSON.parse(listed?.stdout ?? '').terminals; } catch {}
      if (!Array.isArray(all) || listed?.code) throw Object.assign(new Error(r.stderr || 'Cannot confirm whether the role started.'), {uncertain:true});
      try {
        late = record ? await findExisting() : all.find(k => k.state === 'live' && k.labels?.['herdr.chat.slot'] === slot && k.labels?.['herdr.role'] === role && !k.labels?.['herdr.feature']);
      } catch(error) { throw Object.assign(error,{uncertain:true}); }
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
