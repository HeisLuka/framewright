#!/usr/bin/env node
import crypto from 'node:crypto';

export const C27_POLICY_VERSION='c27-narrative-v1';
export const C27_DURATION_PROFILES=[3,5,7,9,12,15];
export const C27_ANGLE_TYPES=['premise','conflict','identity','emotion','question','world','character','thesis','quote','recommendation_context'];
export const C27_REVEAL_TIMINGS=['early','mid','late'];
export const C27_CTA_TREATMENTS=['none','soft_reveal','intent','direct','qr_slot'];

function sortValue(value){
  if(Array.isArray(value))return value.map(sortValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sortValue(value[k])]));
  return value;
}
export function stableStringify(value){return JSON.stringify(sortValue(value));}
function sha256(text){return crypto.createHash('sha256').update(text).digest('hex');}

export function splitSentences(text){
  return String(text||'').match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(x=>x.trim()).filter(Boolean)||[];
}

export function resolveCopySource(source,book){
  if(!source||typeof source!=='object')throw new Error('copy source must be an object');
  if(source.kind==='human_verified'){
    if(typeof source.text!=='string'||!source.text.trim())throw new Error('human_verified source requires text');
    if(typeof source.verification_id!=='string'||!source.verification_id.trim())throw new Error('human_verified source requires verification_id');
    return source.text;
  }
  if(source.kind!=='book_payload_field')throw new Error(`unsupported copy source kind: ${source.kind}`);
  const allowed=new Set(['title','author','hook','cta','eyebrow','brand']);
  if(!allowed.has(source.field))throw new Error(`unsupported BookPayload field: ${source.field}`);
  const raw=String(book?.[source.field]??'');
  if(!raw)throw new Error(`BookPayload.${source.field} is empty`);
  const selector=source.selector||{kind:'full'};
  if(selector.kind==='full')return raw;
  if(selector.kind==='sentence'){
    const xs=splitSentences(raw),i=Number(selector.index);
    if(!Number.isInteger(i)||i<0||i>=xs.length)throw new Error(`sentence selector out of range for ${source.field}`);
    return xs[i];
  }
  if(selector.kind==='span'){
    const start=Number(selector.start),end=Number(selector.end);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>raw.length)throw new Error(`invalid span selector for ${source.field}`);
    return raw.slice(start,end);
  }
  throw new Error(`unsupported selector kind: ${selector.kind}`);
}

function copyAtom(source,book){
  const text=resolveCopySource(source,book);
  return {text,source:structuredClone(source)};
}
function field(field){return {kind:'book_payload_field',field,selector:{kind:'full'}};}

function roleSpec(role,atoms,minSeconds,weight){return{role,atoms,minSeconds,weight};}

function semanticRoles({book,angle,durationSeconds,revealTiming,ctaTreatment}){
  const hook=roleSpec('hook',[copyAtom(angle.hook,book)],durationSeconds===3?3:durationSeconds===5?2:1.5,1.35);
  const reveal=roleSpec('book_reveal',[copyAtom(field('title'),book),copyAtom(field('author'),book)],durationSeconds===5?3:1.8,1.25);
  if(durationSeconds===3)return[hook];
  if(durationSeconds===5)return[hook,reveal];

  const tension=angle.tension?roleSpec('tension',[copyAtom(angle.tension,book)],1.2,1.05):null;
  const payoff=angle.payoff?roleSpec('desire_payoff',[copyAtom(angle.payoff,book)],1.2,1.0):null;
  const middle=[tension,payoff].filter(Boolean);
  let roles;
  if(revealTiming==='early')roles=[hook,reveal,...middle];
  else if(revealTiming==='mid'){
    const split=Math.max(1,Math.ceil(middle.length/2));
    roles=[hook,...middle.slice(0,split),reveal,...middle.slice(split)];
  } else roles=[hook,...middle,reveal];

  if(['intent','direct','qr_slot'].includes(ctaTreatment)){
    const atoms=[];
    if(ctaTreatment!=='qr_slot')atoms.push(copyAtom(field('cta'),book));
    else atoms.push({text:'',source:{kind:'reserved_affordance',slot:'qr'}});
    roles.push(roleSpec('cta',atoms,1.3,.8));
  }
  return roles;
}

function allocateFrames(roles,totalFrames,fps){
  const mins=roles.map(r=>Math.round(r.minSeconds*fps));
  const minTotal=mins.reduce((a,b)=>a+b,0);
  if(minTotal>totalFrames)throw new Error(`role minimums ${minTotal} exceed totalFrames ${totalFrames}`);
  const extra=totalFrames-minTotal;
  const weightTotal=roles.reduce((s,r)=>s+r.weight,0);
  const exact=roles.map(r=>extra*r.weight/weightTotal);
  const extras=exact.map(Math.floor);
  let remainder=extra-extras.reduce((a,b)=>a+b,0);
  const order=exact.map((x,i)=>({i,frac:x-Math.floor(x)})).sort((a,b)=>b.frac-a.frac||a.i-b.i);
  for(let k=0;k<remainder;k++)extras[order[k%order.length].i]++;
  let cursor=0;
  return roles.map((r,i)=>{
    const frames=mins[i]+extras[i],out={role:r.role,start_frame:cursor,end_frame:cursor+frames,frames,atoms:r.atoms};
    cursor+=frames;return out;
  });
}

function identityInput(plan){const {narrative_plan_id,...rest}=plan;return rest;}
export function computeNarrativePlanId(plan){return `c27_${sha256(stableStringify(identityInput(plan)))}`;}

export function planNarrative(input){
  const book=input?.book,angle=input?.angle;
  if(!book||typeof book!=='object')throw new Error('book is required');
  if(!angle||typeof angle!=='object')throw new Error('angle is required');
  if(typeof angle.id!=='string'||!angle.id)throw new Error('angle.id is required');
  if(!C27_ANGLE_TYPES.includes(angle.type))throw new Error(`unsupported angle type: ${angle.type}`);
  if(!angle.hook)throw new Error('angle.hook is required');

  const durationSeconds=Number(input.duration_seconds??9),fps=Number(input.fps??30),revealTiming=String(input.reveal_timing||'mid'),ctaTreatment=String(input.cta_treatment||'soft_reveal');
  if(!C27_DURATION_PROFILES.includes(durationSeconds))throw new Error(`duration_seconds must be one of ${C27_DURATION_PROFILES.join(',')}`);
  if(!Number.isInteger(fps)||fps<=0)throw new Error('fps must be a positive integer');
  if(!C27_REVEAL_TIMINGS.includes(revealTiming))throw new Error(`unsupported reveal_timing: ${revealTiming}`);
  if(!C27_CTA_TREATMENTS.includes(ctaTreatment))throw new Error(`unsupported cta_treatment: ${ctaTreatment}`);
  if(durationSeconds>=7&&(!angle.tension||!angle.payoff))throw new Error('7s+ full grammar requires verified tension and payoff copy sources');
  if(durationSeconds===3&&ctaTreatment!=='none')throw new Error('3s teaser forces cta_treatment=none');
  if(durationSeconds===5&&!['none','soft_reveal'].includes(ctaTreatment))throw new Error('5s profile supports only none/soft_reveal CTA treatment');

  const totalFrames=durationSeconds*fps;
  const specs=semanticRoles({book,angle,durationSeconds,revealTiming,ctaTreatment});
  const roles=allocateFrames(specs,totalFrames,fps);
  const reveal=roles.find(x=>x.role==='book_reveal');
  const cta=roles.find(x=>x.role==='cta');
  const plan={
    schema:'framewright-c27-narrative-plan-v1',
    policy_version:C27_POLICY_VERSION,
    book_id:String(book.book_id||book.id||''),
    angle:{id:angle.id,type:angle.type,label:angle.label||angle.id,source:angle.source||null},
    duration_seconds:durationSeconds,
    fps,
    total_frames:totalFrames,
    reveal_timing:durationSeconds===3?'none':revealTiming,
    cta_treatment:durationSeconds<=5?(durationSeconds===3?'none':ctaTreatment):ctaTreatment,
    seed:Number.isInteger(input.seed)?input.seed:0,
    roles,
    checkpoints:{
      hook:0,
      pre_reveal:reveal?Math.max(0,reveal.start_frame-1):null,
      reveal:reveal?.start_frame??null,
      cta:cta?.start_frame??null,
      end:totalFrames-1
    }
  };
  plan.narrative_plan_id=computeNarrativePlanId(plan);
  assertNarrativePlan(plan);
  return plan;
}

export function assertNarrativePlan(plan){
  if(plan?.schema!=='framewright-c27-narrative-plan-v1')throw new Error('wrong NarrativePlan schema');
  if(plan.policy_version!==C27_POLICY_VERSION)throw new Error('wrong NarrativePlan policy version');
  if(!/^c27_[a-f0-9]{64}$/.test(plan.narrative_plan_id||''))throw new Error('invalid narrative_plan_id format');
  if(computeNarrativePlanId(plan)!==plan.narrative_plan_id)throw new Error('narrative_plan_id drift');
  if(plan.total_frames!==plan.duration_seconds*plan.fps)throw new Error('duration/frame mismatch');
  if(!Array.isArray(plan.roles)||!plan.roles.length)throw new Error('roles missing');
  let cursor=0;
  for(const r of plan.roles){
    if(r.start_frame!==cursor||r.end_frame<=r.start_frame||r.frames!==r.end_frame-r.start_frame)throw new Error(`non-contiguous role ${r.role}`);
    if(!Array.isArray(r.atoms))throw new Error(`atoms missing for role ${r.role}`);
    for(const atom of r.atoms){
      if(!atom?.source)throw new Error(`copy provenance missing for role ${r.role}`);
      if(atom.source.kind==='human_verified'&&!atom.source.verification_id)throw new Error('human_verified atom missing verification_id');
      if(atom.source.kind==='book_payload_field'&&!atom.source.field)throw new Error('book_payload_field atom missing field');
      if(!['human_verified','book_payload_field','reserved_affordance'].includes(atom.source.kind))throw new Error(`untrusted source kind ${atom.source.kind}`);
    }
    cursor=r.end_frame;
  }
  if(cursor!==plan.total_frames)throw new Error('timeline does not cover exact total_frames');
  if(plan.roles[0].role!=='hook'||plan.roles[0].start_frame!==0)throw new Error('hook must begin on frame 0');
  const names=plan.roles.map(r=>r.role);
  if(plan.duration_seconds===3&&stableStringify(names)!==stableStringify(['hook']))throw new Error('3s grammar must be hook-only');
  if(plan.duration_seconds===5){
    if(stableStringify(names)!==stableStringify(['hook','book_reveal']))throw new Error('5s grammar must be hook -> book_reveal');
    if(names.includes('cta'))throw new Error('5s grammar must not contain CTA role');
  }
  if(plan.duration_seconds>=7&&!names.includes('book_reveal'))throw new Error('7s+ grammar requires book_reveal');
  if(['intent','direct','qr_slot'].includes(plan.cta_treatment)&&plan.duration_seconds>=7&&!names.includes('cta'))throw new Error('explicit CTA treatment requires CTA role');
  return true;
}
