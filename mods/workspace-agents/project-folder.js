// The persisted project root is authoritative even before Files has mounted.
import {appHome, exec, readTextFile, shared, setShared} from 'herdr';

export async function loadProjectRoots() {
  const text=await readTextFile(`${appHome()}/data/workspace-folders.json`);
  const roots=text==null?{}:JSON.parse(text);
  if(!roots||typeof roots!=='object'||Array.isArray(roots))throw new Error('Saved project folders could not be read.');
  if(JSON.stringify(shared('workspace.roots')??{})!==JSON.stringify(roots))setShared('workspace.roots',roots);
  return roots;
}

export async function projectFolder(space) {
  const roots=await loadProjectRoots();
  return roots[space?.id]||space?.folder||null;
}

export async function saveProjectFolder(space,folder,expected) {
  if(!space||space.machine||space.id.includes('/'))throw new Error('Folder editing currently supports local spaces.');
  const r=await exec('python3',[`${appHome()}/mods/shepherdr-settings/space-folder.py`,JSON.stringify({space:space.id,folder,expected})],{timeout:20000});
  let out;try{out=JSON.parse(r.stdout);}catch{throw new Error('Herdr could not save the project folder.');}
  if(r.code||out.error)throw new Error(out.error||'Herdr could not save the project folder.');
  setShared('workspace.roots',out.roots);
  return out.folder;
}
