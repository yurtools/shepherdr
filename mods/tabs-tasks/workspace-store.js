import { appHome, exec } from 'herdr';
export async function workspaceCall(command, payload = {}) {
 const r = await exec('python3', [`${appHome()}/mods/workspace-launchers/bin/workspace-state`, command, JSON.stringify(payload)], { timeout: 20000 });
 let out; try { out=JSON.parse(r.stdout); } catch { throw new Error(r.stderr || 'Workspace data could not be read.'); }
 if(r.code || out.error) throw new Error(out.error || r.stderr); return out;
}

export function launcherAgents(known,catalog) {
 const merged=new Map((known??[]).map(row=>[row.key,row]));
 for(const row of catalog?.agents??[])merged.set(row.key,{...(merged.get(row.key)??{}),...row});
 return [...merged.values()];
}
