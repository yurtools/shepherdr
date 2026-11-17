import {div} from 'gpui-kit';
import {InputState,Input,v_flex,h_flex} from 'gpui-base';
import {pickFolder} from 'herdr';
import {spaces} from './live.js';
import {projectFolder,saveProjectFolder} from './project-folder.js';
import {button} from './ui.js';

export function initFolderEditor(view,cx) {
  view.projectFolderBox=InputState.new({placeholder:'Absolute project folder path'});
  view.projectFolderBox.on('change',(_e,cx)=>{if(view.projectFolderEditor){view.projectFolderEditor.error='';view.projectFolderEditor.notice='';}cx.notify();});
  resetFolderEditor(view,cx);
}

export function resetFolderEditor(view,cx) {
  const p=view.projectFolderEditor={scope:view.scope,loading:true,saving:false,saved:null,error:'',notice:''};
  view.projectFolderBox.set_value('');
  const space=spaces().find(s=>s.id===p.scope);
  if(!space){p.loading=false;return;}
  cx.spawn(async cx=>{try{
    const folder=await projectFolder(space);
    if(view.projectFolderEditor!==p)return;
    p.saved=folder;if(!view.projectFolderBox.value())view.projectFolderBox.set_value(folder??'');
  }catch(e){p.error=String(e.message??e);}finally{p.loading=false;cx.notify();}});
}

export function saveFolderEditor(view,cx) {
  const p=view.projectFolderEditor,space=spaces().find(s=>s.id===p?.scope);
  if(!space||space.machine||p.loading||p.saving||view.scope!==p.scope)return;
  const value=view.projectFolderBox.value();p.saving=true;p.error='';p.notice='';cx.notify();
  const run=async()=>{try {
    const folder=await saveProjectFolder(space,value,p.saved);
    delete view.folders[p.scope];await view.folderOf(p.scope);
    const ok=await view.apply(next=>{
      const own=((next.spaces??={})[p.scope]??={});own.folder=view.folders[p.scope]??folder;
    });
    p.saved=folder;
    if(view.projectFolderEditor===p){
      // Preserve edits typed while the save was running.
      if(view.projectFolderBox.value()===value)view.projectFolderBox.set_value(folder);
      if(!ok)throw new Error('Folder updated, but task settings could not be refreshed. Save again to retry.');
      p.notice='Folder saved. New sessions use it; running agents and existing Features keep their folders.';
    }
  } catch(e){p.error=String(e.message??e);}
  finally{p.saving=false;cx.notify();}};
  const promise=run();(view.folderWrites??=new Set()).add(promise);
  promise.finally(()=>view.folderWrites.delete(promise));
  return promise;
}

export function projectFolderEditor(view,t) {
  if(!view.scope)return div();
  const space=spaces().find(s=>s.id===view.scope),p=view.projectFolderEditor;
  if(!space||!p||p.scope!==view.scope)return div();
  const remote=Boolean(space.machine||space.id.includes('/'));
  if(remote)return v_flex().w_full().mb(20).gap(7)
    .child(div().text_size(13).font_medium().child('Project folder'))
    .child(div().text_size(12).text_color(t.dim).child(p.saved??space.folder??''))
    .child(div().text_size(12).text_color(t.dim).child('Folder editing is available for local spaces.'));
  return v_flex().id('space-project-folder').w_full().mb(20).gap(7)
    .child(div().text_size(13).font_medium().child('Project folder'))
    .child(div().text_size(12).text_color(t.dim).child(remote?'Folder editing is available for local spaces.':
      'Used by Files, new Assistants and new Features. Existing agents and Features keep their folders.'))
    .child(h_flex().w_full().items_center().gap(8)
      .child(div().flex_1().min_w(0).border_1().border_color(t.input).rounded(6).px(9).py(7)
        .child(Input.new(view.projectFolderBox).w_full().text_size(13)))
      .child(button('space-folder-browse','Browse…',{disabled:remote||p.loading||p.saving,onClick:(_e,cx)=>{
        const current=p;cx.spawn(async cx=>{try{const folder=await pickFolder({prompt:'Project folder for this space'});
          if(folder&&view.projectFolderEditor===current&&view.scope===current.scope)view.projectFolderBox.set_value(folder);
          }catch(e){if(view.projectFolderEditor===current)current.error=String(e.message??e);}cx.notify();});
      }}))
      .child(button('space-folder-save',p.saving?'Saving…':'Save folder',{kind:'primary',disabled:remote||p.loading||p.saving||!view.projectFolderBox.value().trim()||(!p.error&&view.projectFolderBox.value()===p.saved),
        onClick:(_e,cx)=>cx.spawn(cx=>saveFolderEditor(view,cx))})))
    .when(p.loading,el=>el.child(div().text_size(12).text_color(t.dim).child('Loading project folder…')))
    .when(Boolean(p.error),el=>el.child(div().text_size(12).text_color(t.blocked).child(p.error)))
    .when(Boolean(p.notice),el=>el.child(div().text_size(12).text_color(t.dim).child(p.notice)));
}
