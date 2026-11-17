export function approvalOrigin(row) {
  return {user:'You · once','user-rule':'You · saved rule',rule:'Saved rule',assistant:'Assistant review',
    'codex-review':'Codex Auto-review · final result not reported','review-control':'Assistant review control',
    'feature-name':'Feature naming permission'}[row.source]??'Unknown approval source';
}
export function approvalDecision(row) {
  return {allow:'Allowed',deny:'Denied',delegated:'Sent for review',ask:'Asked you'}[row.decision]??row.decision??'Unknown decision';
}
