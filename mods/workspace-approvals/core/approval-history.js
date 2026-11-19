export function approvalOrigin(row) {
  return {user:'You · once','user-rule':'You · saved rule',rule:'Saved rule',assistant:'Assistant review',
    'codex-review':'Codex Auto-review · final result not reported','review-control':'Assistant review control',
    'feature-name':'Feature naming permission'}[row.source]??'Unknown approval source';
}
export function approvalDecision(row) {
  return {allow:'Allowed',deny:'Denied',saved:'Rule saved',delegated:'Sent for review',ask:'Asked you'}[row.decision]??row.decision??'Unknown decision';
}

export const RULE_SCOPES=[['task','This task/session'],['space','This space'],['account','Account in this folder'],['global','Global / Everywhere']];
export const RULE_LIFETIMES=[[1,'1 hour'],[24,'1 day'],[168,'1 week'],[8760,'1 year'],[0,'Forever']];
export function approvalToolName(tool) {
  const full=String(tool??''),match=/^mcp__(.+?)__(.+)$/.exec(full);
  return match ? `${match[1]} · ${match[2]}` : full;
}
export function approvalRuleTitle(row) {
  return `${row.decision} · ${row.match==='tool'?`${approvalToolName(row.tool)} · any arguments`:(row.pattern??[]).join(' ')}${row.match==='prefix'?' …':''}`;
}
export function approvalRuleScope(row) {
  return row.scope==='global' ? `Global / Everywhere${row.inherited?' · inherited in this space':''} · this computer` : `${row.account??''} · ${row.task||row.space||'Account in this folder'} · ${row.cwd??''}`;
}
export function approvalRuleLifetime(row) {
  return row.expires ? `Expires ${new Date(row.expires*1000).toISOString().slice(0,16).replace('T',' ')} UTC` : 'Forever';
}
