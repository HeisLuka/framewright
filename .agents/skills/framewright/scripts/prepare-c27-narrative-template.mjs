#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c26.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c27.html');
let html=fs.readFileSync(input,'utf8');
const marker='function post(src,dst){';
if(!html.includes(marker))throw new Error('C27 post marker missing');
const injected=String.raw`
// C27: NarrativePlan owns the semantic schedule. The current C20-C26 stack remains
// the visual implementation; its default E14/C24 plate schedule is discarded here.
const C27_PLAN=(window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.narrative_plan)||null;
if(!C27_PLAN||C27_PLAN.schema!=='framewright-c27-narrative-plan-v1')throw new Error('C27 NarrativePlan missing/wrong schema');
if(C27_PLAN.policy_version!=='c27-narrative-v1')throw new Error('C27 NarrativePlan policy mismatch');
if(!Array.isArray(C27_PLAN.roles)||!C27_PLAN.roles.length)throw new Error('C27 NarrativePlan roles missing');
if(!Number.isInteger(C27_PLAN.total_frames)||C27_PLAN.total_frames<=0||C27_PLAN.total_frames!==C27_PLAN.duration_seconds*FPS)throw new Error('C27 NarrativePlan duration/frame mismatch');
let __c27Cursor=0;
for(const role of C27_PLAN.roles){
  if(!['hook','tension','desire_payoff','book_reveal','cta'].includes(role.role))throw new Error('C27 unsupported narrative role: '+role.role);
  if(!Number.isInteger(role.frames)||role.frames<=0||role.start_frame!==__c27Cursor||role.end_frame!==__c27Cursor+role.frames)throw new Error('C27 non-contiguous role: '+role.role);
  __c27Cursor=role.end_frame;
}
if(__c27Cursor!==C27_PLAN.total_frames)throw new Error('C27 NarrativePlan total mismatch');
if(C27_PLAN.roles[0].role!=='hook'||C27_PLAN.roles[0].start_frame!==0)throw new Error('C27 hook must begin at frame 0');

P.narrative_plan_id=C27_PLAN.narrative_plan_id;
P.narrative_angle={...C27_PLAN.angle};
P.narrative_reveal_timing=C27_PLAN.reveal_timing;
P.narrative_cta_treatment=C27_PLAN.cta_treatment;
P.duration_profile=C27_PLAN.duration_seconds;
P.pacing={mode:'c27-narrative-v1',profileSeconds:C27_PLAN.duration_seconds,totalFrames:C27_PLAN.total_frames,roles:C27_PLAN.roles.map(r=>({role:r.role,frames:r.frames,start_frame:r.start_frame,end_frame:r.end_frame}))};

// The inherited page marker is hard-coded to /03. NarrativePlan can have 1..5 roles,
// so suppress it instead of emitting semantically false page counters.
pageNum=function(){};

function __c27RoleText(role){return(role.atoms||[]).filter(a=>a&&a.source&&a.source.kind!=='reserved_affordance').map(a=>String(a.text||'').trim()).filter(Boolean).join(' ');}
function __c27With(overrides,fn){const old={};for(const [k,v] of Object.entries(overrides)){old[k]=P[k];P[k]=v;}try{return fn();}finally{for(const [k,v] of Object.entries(old))P[k]=v;}}
function __c27Mapped(S,sourceLen,sourcePlate){return{...S,i:Math.round(clamp(S.t)*(sourceLen-1)),t:clamp(S.t),plate:sourcePlate};}
function __c27RenderRole(g,S,role){
  const text=__c27RoleText(role);
  if(role.role==='hook'||role.role==='tension'||role.role==='desire_payoff'){
    if(!text)throw new Error('C27 semantic text missing for '+role.role);
    // All text beats use the same existing hook visual primitive. This keeps the visual
    // grammar fixed while angle content and semantic order are the controlled variables.
    return __c27With({hook:text},()=>SYSTEM[P.visual_system][0](g,__c27Mapped(S,90,'hook')));
  }
  if(role.role==='book_reveal'){
    // Do not leak the generic payload hook into the reveal plate: title/author/cover are
    // the reveal; all narrative text must have appeared through declared plan atoms.
    return __c27With({hook:''},()=>SYSTEM[P.visual_system][1](g,__c27Mapped(S,150,'book')));
  }
  if(role.role==='cta'){
    // CTA copy is also plan-owned. qr_slot currently resolves to an empty label; actual QR
    // generation/attribution is a later delivery concern.
    return __c27With({cta:text},()=>SYSTEM[P.visual_system][2](g,__c27Mapped(S,120,'cta')));
  }
  throw new Error('C27 unsupported narrative role: '+role.role);
}

PLATES.length=0;
for(const __c27role of C27_PLAN.roles)plate(__c27role.role,__c27role.frames,(g,S)=>__c27RenderRole(g,S,__c27role));
if(total()!==C27_PLAN.total_frames)throw new Error('C27 renderer total != NarrativePlan total');
window.__C27_NARRATIVE_PLAN=()=>JSON.parse(JSON.stringify(C27_PLAN));
window.__C27_RENDER_CONTRACT=()=>({schema:'framewright-c27-render-contract-v1',planId:C27_PLAN.narrative_plan_id,totalFrames:total(),roles:PLATES.map(p=>({role:p.name,frames:p.len}))});
`;
html=html.replace(marker,injected+'\n'+marker);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log(`prepared C27 narrative template: ${output}`);
