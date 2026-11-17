// Native Herdr exposes status as a word; hc get exposes { app, state }.
export function terminalState(terminal) {
  return typeof terminal?.status === 'string' ? terminal.status
    : terminal?.status?.state ?? terminal?.report?.state ?? null;
}
export function featureActivity(record, terminals) {
  if(record.status==='completed')return {state:'done',label:'Completed',workers:0};
  const members=terminals.filter(k=>k.state==='live'&&k.labels?.['herdr.feature']===record.id);
  const owner=members.find(k=>k.labels?.['herdr.role']==='feature');
  const workers=members.filter(k=>k!==owner&&k.labels?.['herdr.task']);
  const blocked=members.some(k=>terminalState(k)==='blocked');
  const working=members.some(k=>terminalState(k)==='working');
  const active=workers.filter(k=>['working','blocked'].includes(terminalState(k))).length;
  const state=blocked?'blocked':working?'working':terminalState(owner)??(record.session?'paused':'new');
  const label={blocked:'Needs you',working:'Working',done:'Idle',idle:'Idle',paused:'Paused',new:'New'}[state]??state;
  return {state,label:label+(active?` · ${active} worker${active===1?'':'s'}`:''),workers:active};
}
