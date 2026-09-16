#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c26.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c27.html');
let html=fs.readFileSync(input,'utf8');

const startMarker="if(ACTIVE_VARIANT==='cover-first'){";
const endMarker='\nfunction post(src,dst)';
const start=html.indexOf(startMarker),end=html.indexOf(endMarker,start);
if(start<0||end<0)throw new Error('C27 requires the post-C24 variant schedule');
const fallbackSchedule=html.slice(start,end);

const adapter=String.raw`
const __C27_PLAN_RAW=window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.narrative_plan;
const __C27_PLAN=(__C27_PLAN_RAW&&__C27_PLAN_RAW.schema==='framewright-c27-narrative-plan-v1')?__C27_PLAN_RAW:null;
function __c27RoleText(role){return(role.atoms||[]).filter(a=>a&&a.source&&a.source.kind!=='reserved_affordance').map(a=>String(a.text||'').trim()).filter(Boolean).join(' ');}
function __c27ValidatePlan(plan){
  if(!plan||!Array.isArray(plan.roles)||!plan.roles.length)throw new Error('C27 NarrativePlan roles missing');
  if(!Number.isInteger(plan.total_frames)||plan.total_frames<=0||plan.total_frames!==plan.duration_seconds*FPS)throw new Error('C27 NarrativePlan duration/frame mismatch');
  let cursor=0;
  for(const role of plan.roles){
    if(!Number.isInteger(role.frames)||role.frames<=0||role.start_frame!==cursor||role.end_frame!==cursor+role.frames)throw new Error('C27 NarrativePlan non-contiguous role '+String(role.role));
    if(!['hook','tension','desire_payoff','book_reveal','cta'].includes(role.role))throw new Error('C27 unsupported renderer role '+String(role.role));
    if(['hook','tension','desire_payoff'].includes(role.role)&&!__c27RoleText(role))throw new Error('C27 semantic text missing for '+role.role);
    cursor=role.end_frame;
  }
  if(cursor!==plan.total_frames)throw new Error('C27 NarrativePlan total frame coverage mismatch');
  if(plan.roles[0].role!=='hook'||plan.roles[0].start_frame!==0)throw new Error('C27 hook must start at frame 0');
  return plan;
}
function __c27NarrativePlate(role){
  const isBook=role.role==='book_reveal',isCta=role.role==='cta';
  const sourceIndex=isBook?1:isCta?2:0,sourceLen=isBook?150:isCta?120:90,sourcePlate=isBook?'book':isCta?'cta':'hook';
  const pageNumber=isBook?2:isCta?3:1,text=__c27RoleText(role);
  plate(role.role,role.frames,(g,S)=>{
    __variantPageNumber=pageNumber;
    const oldHook=P.hook,oldCta=P.cta;
    try{
      if(isBook)P.hook='';
      else if(isCta&&text)P.cta=text;
      else if(!isCta)P.hook=text;
      const mapped={...S,i:Math.round(clamp(S.t)*(sourceLen-1)),t:clamp(S.t),plate:sourcePlate};
      SYSTEM[P.visual_system][sourceIndex](g,mapped);
    }finally{P.hook=oldHook;P.cta=oldCta;}
  });
}
if(__C27_PLAN){
  __c27ValidatePlan(__C27_PLAN);
  P.pacing={mode:'c27-narrative-plan-v1',profileSeconds:__C27_PLAN.duration_seconds,totalFrames:__C27_PLAN.total_frames,grammar:'narrative-plan',narrativePlanId:__C27_PLAN.narrative_plan_id};
  P.duration_profile=__C27_PLAN.duration_seconds;
  for(const role of __C27_PLAN.roles)__c27NarrativePlate(role);
  if(total()!==__C27_PLAN.total_frames)throw new Error('C27 renderer total != NarrativePlan total');
  window.__C27_NARRATIVE_PLAN=()=>__C27_PLAN;
  window.__C27_RENDER_CONTRACT=()=>({schema:'framewright-c27-render-contract-v1',planId:__C27_PLAN.narrative_plan_id,totalFrames:total(),roles:PLATES.map(p=>({role:p.name,frames:p.len}))});
}else{
${fallbackSchedule}
}
`;

html=html.slice(0,start)+adapter+html.slice(end);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log(`prepared C27 NarrativePlan renderer adapter: ${output}`);
