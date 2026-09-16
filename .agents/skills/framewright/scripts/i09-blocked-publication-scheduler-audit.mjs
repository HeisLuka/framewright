#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildC37ScreeningDesign } from './c37-doe-identifiability.mjs';
import {
  I09_PLAN_SCHEMA,
  I09_ASSIGNMENT_SCHEMA,
  buildBlockedPublicationPlan,
  validateBlockedPublicationPlan
} from './i09-blocked-publication-scheduler.mjs';
import { stableStringify } from './c30-campaign-learning.mjs';

const outDir=path.resolve(process.argv[2]||'artifacts/i09');
fs.mkdirSync(outDir,{recursive:true});
const clone=value=>JSON.parse(JSON.stringify(value));
const mustThrow=(label,fn,needle)=>{
  let message='';
  try{fn();}catch(error){message=String(error?.message||error);}
  if(!message)throw new Error(`${label}: expected rejection`);
  if(needle&&!message.includes(needle))throw new Error(`${label}: wrong rejection: ${message}`);
  return message;
};

const c37=buildC37ScreeningDesign();
const selected=c37.global_main_effects.design.candidates;
if(selected.length!==8)throw new Error(`I09 fixture requires C37 8-run design, got ${selected.length}`);
const platforms=['youtube_shorts','instagram_reels'];
const treatments=selected.map((candidate,i)=>({
  treatment_id:candidate.id,
  creative_id:`creative-i09-${String(i+1).padStart(2,'0')}`,
  axes:{angle:candidate.angle,hook_index:candidate.hook_index,reveal:candidate.reveal},
  render_specs:platforms.map(platform=>({platform,render_spec_id:`render-i09-${String(i+1).padStart(2,'0')}-${platform}`}))
}));
const blocks=Array.from({length:8},(_,replicate_index)=>{
  const platform=platforms[replicate_index%platforms.length];
  const day=1+replicate_index;
  return {
    block_id:`block-${String(replicate_index+1).padStart(2,'0')}`,
    replicate_index,
    platform,
    account_id:platform==='youtube_shorts'?'account-youtube-fixture':'account-instagram-fixture',
    context:{fixture_week:`2026-W${String(36+Math.floor(replicate_index/2)).padStart(2,'0')}`,daypart:replicate_index%2?'evening':'morning'},
    slots:Array.from({length:8},(_,position)=>({
      slot_id:`slot-b${String(replicate_index+1).padStart(2,'0')}-p${position}`,
      position,
      scheduled_at:`2026-09-${String(day).padStart(2,'0')}T${String(8+position).padStart(2,'0')}:00:00Z`
    }))
  };
});
const input={
  experiment_id:'exp-i09-blocked-organic-fixture',
  policy_version:'i09-blocked-publication-v1',
  assignment_seed:'i09-seed-2026-09-17',
  design_ref:'c37-global-main-effects-8run',
  treatments,
  blocks
};

const plan=buildBlockedPublicationPlan(input);
const reordered=buildBlockedPublicationPlan({
  ...input,
  treatments:[...treatments].reverse().map(t=>({...t,render_specs:[...t.render_specs].reverse()})),
  blocks:[...blocks].reverse().map(block=>({...block,slots:[...block.slots].reverse()}))
});
validateBlockedPublicationPlan(plan);
if(plan.schema!==I09_PLAN_SCHEMA)throw new Error('wrong I09 plan schema');
if(plan.assignments.some(row=>row.schema!==I09_ASSIGNMENT_SCHEMA))throw new Error('wrong I09 assignment schema');
if(stableStringify(plan)!==stableStringify(reordered))throw new Error('input order changed canonical I09 plan');
if(plan.treatment_count!==8||plan.block_count!==8||plan.opportunity_count!==64)throw new Error(`unexpected I09 dimensions ${plan.treatment_count}/${plan.block_count}/${plan.opportunity_count}`);

const treatmentIds=new Set(treatments.map(x=>x.treatment_id));
for(const block of plan.blocks){
  const rows=plan.assignments.filter(x=>x.block_id===block.block_id);
  if(rows.length!==8||new Set(rows.map(x=>x.treatment_id)).size!==8)throw new Error(`block ${block.block_id} is not complete`);
  if([...treatmentIds].some(id=>!rows.some(row=>row.treatment_id===id)))throw new Error(`block ${block.block_id} is missing a treatment`);
  if(rows.some(row=>row.platform!==block.platform||row.account_id!==block.account_id))throw new Error(`block ${block.block_id} assignment context drift`);
}

const treatmentCounts=new Map(),platformCounts=new Map(),positionCounts=new Map();
for(const row of plan.assignments){
  treatmentCounts.set(row.treatment_id,(treatmentCounts.get(row.treatment_id)||0)+1);
  const platformKey=`${row.treatment_id}/${row.platform}`;
  platformCounts.set(platformKey,(platformCounts.get(platformKey)||0)+1);
  const positionKey=`${row.treatment_id}/${row.slot_position}`;
  positionCounts.set(positionKey,(positionCounts.get(positionKey)||0)+1);
  const treatment=plan.treatments.find(x=>x.treatment_id===row.treatment_id);
  const expectedRender=treatment.render_specs.find(x=>x.platform===row.platform)?.render_spec_id;
  if(row.render_spec_id!==expectedRender)throw new Error(`platform-specific render drift for ${row.treatment_id}/${row.platform}`);
  if(row.exposure_semantics!=='publication_opportunity_only_platform_controls_viewer_delivery')throw new Error('assignment overclaims viewer exposure control');
}
for(const treatment of plan.treatments){
  if(treatmentCounts.get(treatment.treatment_id)!==8)throw new Error(`${treatment.treatment_id} must appear once in each of eight blocks`);
  for(const platform of platforms)if(platformCounts.get(`${treatment.treatment_id}/${platform}`)!==4)throw new Error(`${treatment.treatment_id} platform balance drift for ${platform}`);
  for(let position=0;position<8;position++)if(positionCounts.get(`${treatment.treatment_id}/${position}`)!==1)throw new Error(`${treatment.treatment_id} position ${position} is not exactly balanced`);
}

const selectedIds=selected.map(x=>x.id).sort();
const plannedIds=plan.treatments.map(x=>x.treatment_id).sort();
if(JSON.stringify(selectedIds)!==JSON.stringify(plannedIds))throw new Error('I09 treatment set drifted from C37 selected design');
if(plan.exposure_semantics!=='publication_opportunity_only_platform_controls_viewer_delivery')throw new Error('I09 plan overclaims viewer delivery control');
if(!plan.assignments.every(row=>row.scheduled_at&&row.scheduled_at.endsWith('Z')))throw new Error('fixture scheduled_at provenance was not normalized');

const rejected={};
const missingRender=clone(input);missingRender.treatments[0].render_specs=missingRender.treatments[0].render_specs.filter(x=>x.platform!=='instagram_reels');
rejected.missing_platform_render=mustThrow('missing platform render',()=>buildBlockedPublicationPlan(missingRender),'must provide exactly one render_spec_id');
const duplicateTreatment=clone(input);duplicateTreatment.treatments[1].treatment_id=duplicateTreatment.treatments[0].treatment_id;
rejected.duplicate_treatment=mustThrow('duplicate treatment',()=>buildBlockedPublicationPlan(duplicateTreatment),'duplicate treatment_id');
const duplicateCreative=clone(input);duplicateCreative.treatments[1].creative_id=duplicateCreative.treatments[0].creative_id;
rejected.duplicate_creative=mustThrow('duplicate creative',()=>buildBlockedPublicationPlan(duplicateCreative),'duplicate creative_id');
const duplicateRender=clone(input);duplicateRender.treatments[1].render_specs[0].render_spec_id=duplicateRender.treatments[0].render_specs[0].render_spec_id;
rejected.duplicate_render=mustThrow('duplicate render',()=>buildBlockedPublicationPlan(duplicateRender),'is reused across treatments/profiles');
const duplicateBlock=clone(input);duplicateBlock.blocks[1].block_id=duplicateBlock.blocks[0].block_id;
rejected.duplicate_block=mustThrow('duplicate block',()=>buildBlockedPublicationPlan(duplicateBlock),'duplicate block_id');
const duplicateReplicate=clone(input);duplicateReplicate.blocks[1].replicate_index=duplicateReplicate.blocks[0].replicate_index;
rejected.duplicate_replicate=mustThrow('duplicate replicate',()=>buildBlockedPublicationPlan(duplicateReplicate),'duplicate replicate_index');
const gapReplicate=clone(input);gapReplicate.blocks[7].replicate_index=9;
rejected.replicate_gap=mustThrow('replicate gap',()=>buildBlockedPublicationPlan(gapReplicate),'replicate_index values must be contiguous');
const missingSlot=clone(input);missingSlot.blocks[0].slots.pop();
rejected.incomplete_block=mustThrow('incomplete block',()=>buildBlockedPublicationPlan(missingSlot),'must contain exactly 8 slots');
const duplicatePosition=clone(input);duplicatePosition.blocks[0].slots[1].position=duplicatePosition.blocks[0].slots[0].position;
rejected.duplicate_position=mustThrow('duplicate position',()=>buildBlockedPublicationPlan(duplicatePosition),'duplicate slot position');
const nonContiguousPosition=clone(input);nonContiguousPosition.blocks[0].slots[7].position=9;
rejected.position_gap=mustThrow('position gap',()=>buildBlockedPublicationPlan(nonContiguousPosition),'slot positions must be contiguous');
const duplicateSlotId=clone(input);duplicateSlotId.blocks[1].slots[0].slot_id=duplicateSlotId.blocks[0].slots[0].slot_id;
rejected.duplicate_slot_id=mustThrow('duplicate slot id',()=>buildBlockedPublicationPlan(duplicateSlotId),'duplicate slot_id');
const badTime=clone(input);badTime.blocks[0].slots[0].scheduled_at='not-a-time';
rejected.invalid_schedule_time=mustThrow('invalid scheduled time',()=>buildBlockedPublicationPlan(badTime),'is not a valid date-time');
const tamperedPlan=clone(plan);tamperedPlan.assignments[0].treatment_id='tampered-treatment';
rejected.tampered_plan=mustThrow('tampered plan',()=>validateBlockedPublicationPlan(tamperedPlan),'publication_plan_id mismatch');

const gates={
  consumes_exact_c37_eight_run_treatments:JSON.stringify(selectedIds)===JSON.stringify(plannedIds),
  deterministic_under_input_reordering:stableStringify(plan)===stableStringify(reordered),
  complete_blocks:plan.blocks.every(block=>new Set(plan.assignments.filter(x=>x.block_id===block.block_id).map(x=>x.treatment_id)).size===8),
  every_treatment_once_per_block:[...treatmentCounts.values()].every(count=>count===8),
  balanced_per_platform:[...platformCounts.values()].every(count=>count===4),
  exact_cyclic_position_balance:[...positionCounts.values()].every(count=>count===1),
  platform_specific_render_identity_preserved:true,
  assignment_unit_is_publication_opportunity:plan.assignment_unit==='publication_opportunity',
  no_randomized_viewer_claim:plan.exposure_semantics==='publication_opportunity_only_platform_controls_viewer_delivery',
  content_addressed_plan_valid:true,
  all_negative_cases_rejected:Object.keys(rejected).length===13
};
if(!Object.values(gates).every(Boolean))throw new Error(`I09 audit gate failed: ${JSON.stringify(gates)}`);

const report={
  schema:'framewright-i09-blocked-publication-scheduler-audit-v1',
  boundary:'synthetic publication opportunities only; validates pre-outcome blocked assignment mechanics, not platform viewer delivery or causal treatment effects',
  gates,
  c37_design:{design_ref:plan.design_ref,treatment_ids:selectedIds},
  plan_summary:{publication_plan_id:plan.publication_plan_id,treatments:plan.treatment_count,blocks:plan.block_count,opportunities:plan.opportunity_count,platforms},
  balance:{treatment_counts:Object.fromEntries(treatmentCounts),platform_counts:Object.fromEntries(platformCounts),position_counts:Object.fromEntries(positionCounts)},
  integration_gap:'I08 is currently C34 arm/lane-specific. I09 blocked DOE assignments require a later generalized publication-attribution bridge before real export round-trip; this audit does not fake I08 compatibility.',
  rejected
};
fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'plan.json'),JSON.stringify(plan,null,2)+'\n');
const summary=`# I09 blocked publication scheduler audit\n\n`+
`C37 treatments: **8**. Complete publication blocks: **8**. Synthetic publication opportunities: **64** across YouTube Shorts and Instagram Reels fixture contexts.\n\n`+
`PASS: each block contains every treatment exactly once; every treatment appears four times on each platform; cyclic rotation puts every treatment exactly once in each slot position 0–7; plan identity is deterministic under treatment/block/slot reordering.\n\n`+
`Critical boundary: the randomized unit is the **publication opportunity**, not the viewer. The platform still controls downstream audience delivery. I09 contains no synthetic outcome claim. Also, current I08 is C34 arm/lane-specific, so blocked-DOE export attribution still needs a generalized bridge before live use.\n`;
fs.writeFileSync(path.join(outDir,'summary.md'),summary);
console.log(summary);
console.log(JSON.stringify({gates,publication_plan_id:plan.publication_plan_id,base_permutation:plan.base_permutation,rejected:Object.keys(rejected)},null,2));
