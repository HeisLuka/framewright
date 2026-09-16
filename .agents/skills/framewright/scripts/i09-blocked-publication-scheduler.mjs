#!/usr/bin/env node
import crypto from 'node:crypto';
import { stableStringify } from './c30-campaign-learning.mjs';

export const I09_PLAN_SCHEMA='framewright-i09-blocked-publication-plan-v1';
export const I09_ASSIGNMENT_SCHEMA='framewright-i09-publication-opportunity-assignment-v1';

function isObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function object(value,label){if(!isObject(value))throw new Error(`${label} must be an object`);return value;}
function text(value,label){if(typeof value!=='string'||!value.trim())throw new Error(`${label} must be a non-empty string`);return value.trim();}
function integer(value,label,min=0){if(!Number.isSafeInteger(value)||value<min)throw new Error(`${label} must be an integer >= ${min}`);return value;}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function hashId(prefix,body){return `${prefix}_${sha256(stableStringify(body))}`;}
function sortValue(value){
  if(Array.isArray(value))return value.map(sortValue);
  if(isObject(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortValue(value[key])]));
  return value;
}
function normalizeOptionalTime(value,label){
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string')throw new Error(`${label} must be an ISO date-time string or null`);
  const ms=Date.parse(value);
  if(!Number.isFinite(ms))throw new Error(`${label} is not a valid date-time`);
  return new Date(ms).toISOString();
}

function normalizeTreatments(treatments){
  if(!Array.isArray(treatments)||treatments.length<2)throw new Error('treatments must contain at least two items');
  const treatmentIds=new Set(),creativeIds=new Set();
  const rows=treatments.map((raw,i)=>{
    const treatment=object(raw,`treatments[${i}]`);
    const treatment_id=text(treatment.treatment_id,`treatments[${i}].treatment_id`);
    const creative_id=text(treatment.creative_id,`treatments[${i}].creative_id`);
    if(treatmentIds.has(treatment_id))throw new Error(`duplicate treatment_id ${treatment_id}`);
    if(creativeIds.has(creative_id))throw new Error(`duplicate creative_id ${creative_id}`);
    treatmentIds.add(treatment_id);creativeIds.add(creative_id);
    if(!Array.isArray(treatment.render_specs)||treatment.render_specs.length===0)throw new Error(`treatment ${treatment_id} must declare render_specs`);
    const platforms=new Set();
    const render_specs=treatment.render_specs.map((specRaw,j)=>{
      const spec=object(specRaw,`treatment ${treatment_id}.render_specs[${j}]`);
      const platform=text(spec.platform,`treatment ${treatment_id}.render_specs[${j}].platform`);
      const render_spec_id=text(spec.render_spec_id,`treatment ${treatment_id}.render_specs[${j}].render_spec_id`);
      if(platforms.has(platform))throw new Error(`treatment ${treatment_id} has duplicate render spec platform ${platform}`);
      platforms.add(platform);
      return {platform,render_spec_id};
    }).sort((a,b)=>a.platform.localeCompare(b.platform));
    return {treatment_id,creative_id,axes:sortValue(treatment.axes||{}),render_specs};
  });
  return rows.sort((a,b)=>a.treatment_id.localeCompare(b.treatment_id));
}

function normalizeBlocks(blocks,treatmentCount){
  if(!Array.isArray(blocks)||blocks.length<2)throw new Error('blocks must contain at least two publication blocks');
  const blockIds=new Set(),replicateIndexes=new Set(),globalSlotIds=new Set();
  const rows=blocks.map((raw,i)=>{
    const block=object(raw,`blocks[${i}]`);
    const block_id=text(block.block_id,`blocks[${i}].block_id`);
    const replicate_index=integer(block.replicate_index,`blocks[${i}].replicate_index`);
    const platform=text(block.platform,`blocks[${i}].platform`);
    const account_id=text(block.account_id,`blocks[${i}].account_id`);
    if(blockIds.has(block_id))throw new Error(`duplicate block_id ${block_id}`);
    if(replicateIndexes.has(replicate_index))throw new Error(`duplicate replicate_index ${replicate_index}`);
    blockIds.add(block_id);replicateIndexes.add(replicate_index);
    if(!Array.isArray(block.slots)||block.slots.length!==treatmentCount)throw new Error(`block ${block_id} must contain exactly ${treatmentCount} slots for a complete block`);
    const positions=new Set();
    const slots=block.slots.map((slotRaw,j)=>{
      const slot=object(slotRaw,`block ${block_id}.slots[${j}]`);
      const slot_id=text(slot.slot_id,`block ${block_id}.slots[${j}].slot_id`);
      const position=integer(slot.position,`block ${block_id}.slots[${j}].position`);
      if(globalSlotIds.has(slot_id))throw new Error(`duplicate slot_id ${slot_id}`);
      if(positions.has(position))throw new Error(`block ${block_id} has duplicate slot position ${position}`);
      globalSlotIds.add(slot_id);positions.add(position);
      return {slot_id,position,scheduled_at:normalizeOptionalTime(slot.scheduled_at,`block ${block_id}.slot ${slot_id}.scheduled_at`)};
    }).sort((a,b)=>a.position-b.position||a.slot_id.localeCompare(b.slot_id));
    for(let position=0;position<treatmentCount;position++)if(!positions.has(position))throw new Error(`block ${block_id} slot positions must be contiguous 0..${treatmentCount-1}; missing ${position}`);
    return {block_id,replicate_index,platform,account_id,context:sortValue(block.context||{}),slots};
  }).sort((a,b)=>a.replicate_index-b.replicate_index||a.block_id.localeCompare(b.block_id));
  for(let i=0;i<rows.length;i++)if(rows[i].replicate_index!==i)throw new Error(`replicate_index values must be contiguous 0..${rows.length-1}; expected ${i}, got ${rows[i].replicate_index}`);
  return rows;
}

function basePermutation(treatments,assignmentSeed){
  return [...treatments].sort((a,b)=>{
    const ah=sha256(`${assignmentSeed}\u001f${a.treatment_id}`),bh=sha256(`${assignmentSeed}\u001f${b.treatment_id}`);
    return ah.localeCompare(bh)||a.treatment_id.localeCompare(b.treatment_id);
  });
}

function renderForPlatform(treatment,platform){
  const matches=treatment.render_specs.filter(spec=>spec.platform===platform);
  if(matches.length!==1)throw new Error(`treatment ${treatment.treatment_id} must provide exactly one render_spec_id for block platform ${platform}`);
  return matches[0].render_spec_id;
}

export function buildBlockedPublicationPlan(input){
  const raw=object(input,'input');
  const experiment_id=text(raw.experiment_id,'experiment_id');
  const policy_version=text(raw.policy_version,'policy_version');
  const assignment_seed=text(raw.assignment_seed,'assignment_seed');
  const design_ref=text(raw.design_ref,'design_ref');
  const treatments=normalizeTreatments(raw.treatments);
  const blocks=normalizeBlocks(raw.blocks,treatments.length);
  const permutation=basePermutation(treatments,assignment_seed);

  for(const block of blocks)for(const treatment of treatments)renderForPlatform(treatment,block.platform);

  const assignments=[];
  for(const block of blocks){
    for(const slot of block.slots){
      const treatment=permutation[(slot.position+block.replicate_index)%permutation.length];
      const body={
        schema:I09_ASSIGNMENT_SCHEMA,
        experiment_id,
        policy_version,
        design_ref,
        block_id:block.block_id,
        replicate_index:block.replicate_index,
        platform:block.platform,
        account_id:block.account_id,
        block_context:block.context,
        slot_id:slot.slot_id,
        slot_position:slot.position,
        scheduled_at:slot.scheduled_at,
        treatment_id:treatment.treatment_id,
        creative_id:treatment.creative_id,
        render_spec_id:renderForPlatform(treatment,block.platform),
        axes:treatment.axes,
        exposure_semantics:'publication_opportunity_only_platform_controls_viewer_delivery'
      };
      assignments.push({...body,assignment_id:hashId('i09a1',body)});
    }
  }
  assignments.sort((a,b)=>a.replicate_index-b.replicate_index||a.slot_position-b.slot_position||a.slot_id.localeCompare(b.slot_id));

  for(const block of blocks){
    const blockAssignments=assignments.filter(x=>x.block_id===block.block_id);
    if(blockAssignments.length!==treatments.length)throw new Error(`block ${block.block_id} assignment count drift`);
    if(new Set(blockAssignments.map(x=>x.treatment_id)).size!==treatments.length)throw new Error(`block ${block.block_id} must assign every treatment exactly once`);
  }

  const body={
    schema:I09_PLAN_SCHEMA,
    experiment_id,
    policy_version,
    assignment_seed,
    design_ref,
    assignment_unit:'publication_opportunity',
    exposure_semantics:'publication_opportunity_only_platform_controls_viewer_delivery',
    block_policy:'complete_blocks_with_cyclic_position_rotation_v1',
    treatment_count:treatments.length,
    block_count:blocks.length,
    opportunity_count:assignments.length,
    treatments,
    blocks,
    base_permutation:permutation.map(x=>x.treatment_id),
    assignments
  };
  return {...body,publication_plan_id:hashId('i09p1',body)};
}

export function validateBlockedPublicationPlan(plan){
  const raw=object(plan,'publication_plan');
  if(raw.schema!==I09_PLAN_SCHEMA)throw new Error(`wrong publication plan schema: ${raw.schema}`);
  const declared=text(raw.publication_plan_id,'publication_plan.publication_plan_id');
  const body={...raw};delete body.publication_plan_id;
  const expected=hashId('i09p1',body);
  if(declared!==expected)throw new Error(`publication_plan_id mismatch: declared ${declared}, expected ${expected}`);
  if(raw.assignment_unit!=='publication_opportunity')throw new Error('publication plan assignment_unit must be publication_opportunity');
  if(raw.exposure_semantics!=='publication_opportunity_only_platform_controls_viewer_delivery')throw new Error('publication plan must not claim randomized viewer exposure');
  if(!Array.isArray(raw.assignments)||raw.assignments.length!==raw.opportunity_count)throw new Error('publication plan opportunity_count drift');
  for(const [i,rowRaw] of raw.assignments.entries()){
    const row=object(rowRaw,`assignments[${i}]`);
    if(row.schema!==I09_ASSIGNMENT_SCHEMA)throw new Error(`assignments[${i}] wrong schema`);
    const assignmentId=text(row.assignment_id,`assignments[${i}].assignment_id`);
    const assignmentBody={...row};delete assignmentBody.assignment_id;
    if(assignmentId!==hashId('i09a1',assignmentBody))throw new Error(`assignments[${i}] assignment_id mismatch`);
    if(row.exposure_semantics!=='publication_opportunity_only_platform_controls_viewer_delivery')throw new Error(`assignments[${i}] viewer-delivery semantics drift`);
  }
  return raw;
}
