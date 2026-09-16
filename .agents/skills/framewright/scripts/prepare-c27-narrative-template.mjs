#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c26.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c27.html');
let html=fs.readFileSync(input,'utf8');
const marker='function post(src,dst){';
if(!html.includes(marker))throw new Error('C27 post marker missing');
const injected=String.raw`
// C27: NarrativePlan is the semantic schedule. Existing C24/E14 plates were useful defaults,
// but this experiment deliberately replaces them after all current layout/style policies are installed.
const C27_PLAN=(window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.narrative_plan)||null;
if(!C27_PLAN||C27_PLAN.schema!=='framewright-c27-narrative-plan-v1')throw new Error('C27 NarrativePlan missing/wrong schema');
if(C27_PLAN.policy_version!=='c27-narrative-v1')throw new Error('C27 NarrativePlan policy mismatch');
if(!Array.isArray(C27_PLAN.roles)||!C27_PLAN.roles.length)throw new Error('C27 NarrativePlan roles missing');
if(C27_PLAN.total_frames!==C27_PLAN.roles.reduce((s,r)=>s+r.frames,0))throw new Error('C27 NarrativePlan total mismatch');
P.narrative_plan_id=C27_PLAN.narrative_plan_id;
P.narrative_angle={...C27_PLAN.angle};
P.narrative_reveal_timing=C27_PLAN.reveal_timing;
P.narrative_cta_treatment=C27_PLAN.cta_treatment;
P.duration_profile=C27_PLAN.duration_seconds;

function __c27RoleText(role){return(role.atoms||[]).map(a=>String(a.text||'').trim()).filter(Boolean).join(' ');}
function __c27With(overrides,fn){const old={};for(const [k,v] of Object.entries(overrides)){old[k]=P[k];P[k]=v;}try{return fn();}finally{for(const [k,v] of Object.entries(old))P[k]=v;}}
function __c27Mapped(S,sourceLen,roleName){return{...S,i:Math.round(clamp(S.t)*(sourceLen-1)),t:clamp(S.t),plate:roleName};}
function __c27RenderRole(g,S,role,index){
  const text=__c27RoleText(role),page=index+1;
  if(typeof __variantPageNumber!=='undefined')__variantPageNumber=page;
  if(role.role==='hook')return __c27With({hook:text},()=>SYSTEM[P.visual_system][0](g,__c27Mapped(S,90,'hook')));
  if(role.role==='tension'||role.role==='desire_payoff'){
    // Reuse the same visual text grammar for controlled causal isolation: only verified content/order changes.
    return __c27With({hook:text},()=>SYSTEM[P.visual_system][0](g,__c27Mapped(S,90,role.role)));
  }
  if(role.role==='book_reveal'){
    // The reveal itself must not leak the original generic hook into the narrative path.
    return __c27With({hook:''},()=>SYSTEM[P.visual_system][1](g,__c27Mapped(S,150,'book_reveal')));
  }
  if(role.role==='cta')return SYSTEM[P.visual_system][2](g,__c27Mapped(S,120,'cta'));
  throw new Error('C27 unsupported narrative role: '+role.role);
}
PLATES.length=0;
for(let __c27i=0;__c27i<C27_PLAN.roles.length;__c27i++){
  const __c27role=C27_PLAN.roles[__c27i];
  if(!Number.isInteger(__c27role.frames)||__c27role.frames<=0)throw new Error('C27 invalid role frames: '+__c27role.role);
  plate(__c27role.role,__c27role.frames,(g,S)=>__c27RenderRole(g,S,__c27role,__c27i));
}
window.__C27_NARRATIVE_PLAN=()=>JSON.parse(JSON.stringify(C27_PLAN));
`;
html=html.replace(marker,injected+'\n'+marker);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log(`prepared C27 narrative template: ${output}`);
