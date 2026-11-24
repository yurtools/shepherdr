// Global template bodies remain the source of truth. Spaces store only their additions.
export const INSTRUCTION_ROLES=['coordinator','feature','worker','reviewer'];
export function spaceInstructions(cfg,space,role) {
 role=role==='assistant'?'coordinator':role;
 if(!space||!INSTRUCTION_ROLES.includes(role))return '';
 const value=cfg?.spaces?.[space]?.instructions?.[role];
 return typeof value==='string'?value.trim():'';
}
export function appendInstructions(global,extra) {
 return typeof extra==='string'&&extra.trim()?`${String(global??'').trimEnd()}\n\n## Space-specific instructions\n\n${extra.trim()}\n`:global;
}
