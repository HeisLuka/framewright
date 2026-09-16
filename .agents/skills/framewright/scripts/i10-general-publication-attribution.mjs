#!/usr/bin/env node
import crypto from 'node:crypto';
import { stableStringify } from './c30-campaign-learning.mjs';
import {
  C31_JOIN_SCHEMA,
  ingestPlatformExport,
  validateExportAdapter
} from './c31-platform-export-ingestion.mjs';
import { C34_PLAN_SCHEMA } from './c34-exploration-holdout-selector.mjs';
import { validateBlockedPublicationPlan } from './i09-blocked-publication-scheduler.mjs';

export const I10_ASSIGNMENT_SCHEMA='framewright-i10-experiment-assignment-v1';
export const I10_SET_SCHEMA='framewright-i10-experiment-assignment-set-v1';
export const I10_PUBLICATION_SCHEMA='framewright-i10-publication-manifest-v1';
export const I10_ATTRIBUTED_EVIDENCE_SCHEMA='framewright-i10-attributed-evidence-v1';

function isObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function object(value,label){if(!isObject(value))throw new Error(`${label} must be an object`);return value;}
function text(value,label){if(typeof value!=='string'||!value.trim())throw new Error(`${label} must be a non-empty string`);return value.trim();}
function nonNegativeInt(value,label){if(!Number.isSafeInteger(value)||value<0)throw new Error(`${label} must be an integer >= 0`);return value;}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function hashId(prefix,body){return `${prefix}_${sha256(stableStringify(body))}`;}
function withoutKey(value,key){const copy={...value};delete copy[key];return copy;}
function sortValue(value){
  if(Array.isArray(value))return value.map(sortValue);
  if(isObject(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortValue(value[key])]));
  return value;
}
function optionalTime(value,label){
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string')throw new Error(`${label} must be a date-time string or null`);
  const ms=Date.parse(value);if(!Number.isFinite(ms))throw new Error(`${label} is not a valid date-time`);
  return new Date(ms).toISOString();
}

function validateC34Plan(plan){
  const raw=object(plan,'traffic_plan');
  if(raw.schema!==C34_PLAN_SCHEMA)throw new Error(`I10 C34 adapter requires ${C34_PLAN_SCHEMA}`);
  const declared=text(raw.traffic_plan_id,'traffic_plan.traffic_plan_id');
  const expected=hashId('c34t1',withoutKey(raw,'traffic_plan_id'));
  if(declared!==expected)throw new Error(`traffic_plan_id mismatch: declared ${declared}, expected ${expected}`);
  text(raw.experiment_id,'traffic_plan.experiment_id');
  text(raw.policy_version,'traffic_plan.policy_version');
  if(!Array.isArray(raw.candidates)||raw.candidates.length<2)throw new Error('traffic_plan.candidates must contain at least two candidates');
  return raw;
}

function makeAssignment({assignment_kind,source_assignment_ref,experiment_id,policy_version,source_plan_id,platform,creative_id,render_spec_id,treatment_ref,assignment_unit,exposure_semantics,context}){
  const body={
    schema:I10_ASSIGNMENT_SCHEMA,
    assignment_kind:text(assignment_kind,'assignment_kind'),
    source_assignment_ref:text(source_assignment_ref,'source_assignment_ref'),
    experiment_id:text(experiment_id,'experiment_id'),
    policy_version:text(policy_version,'policy_version'),
    source_plan_id:text(source_plan_id,'source_plan_id'),
    platform:text(platform,'platform'),
    creative_id:text(creative_id,'creative_id'),
    render_spec_id:text(render_spec_id,'render_spec_id'),
    treatment_ref:text(treatment_ref,'treatment_ref'),
    assignment_unit:text(assignment_unit,'assignment_unit'),
    exposure_semantics:text(exposure_semantics,'exposure_semantics'),
    context:sortValue(context||{})
  };
  return {...body,experiment_assignment_id:hashId('i10x1',body)};
}

function buildAssignmentSet({source_kind,experiment_id,policy_version,source_plan_id,assignments}){
  if(!Array.isArray(assignments)||assignments.length===0)throw new Error('assignment set must contain at least one assignment');
  const refs=new Set(),ids=new Set();
  const normalized=[...assignments].sort((a,b)=>a.source_assignment_ref.localeCompare(b.source_assignment_ref)||a.experiment_assignment_id.localeCompare(b.experiment_assignment_id));
  for(const [i,rowRaw] of normalized.entries()){
    const row=object(rowRaw,`assignments[${i}]`);
    if(row.schema!==I10_ASSIGNMENT_SCHEMA)throw new Error(`assignments[${i}] wrong schema`);
    const expected=hashId('i10x1',withoutKey(row,'experiment_assignment_id'));
    if(row.experiment_assignment_id!==expected)throw new Error(`assignments[${i}] experiment_assignment_id mismatch`);
    if(row.experiment_id!==experiment_id||row.policy_version!==policy_version||row.source_plan_id!==source_plan_id)throw new Error(`assignments[${i}] source provenance mismatch`);
    if(refs.has(row.source_assignment_ref))throw new Error(`duplicate source_assignment_ref ${row.source_assignment_ref}`);
    if(ids.has(row.experiment_assignment_id))throw new Error(`duplicate experiment_assignment_id ${row.experiment_assignment_id}`);
    refs.add(row.source_assignment_ref);ids.add(row.experiment_assignment_id);
  }
  const body={
    schema:I10_SET_SCHEMA,
    source_kind:text(source_kind,'source_kind'),
    experiment_id:text(experiment_id,'experiment_id'),
    policy_version:text(policy_version,'policy_version'),
    source_plan_id:text(source_plan_id,'source_plan_id'),
    assignment_count:normalized.length,
    assignments:normalized
  };
  return {...body,assignment_set_id:hashId('i10s1',body)};
}

export function assignmentSetFromC34({traffic_plan,platform}){
  const plan=validateC34Plan(traffic_plan);
  const normalizedPlatform=text(platform,'platform');
  const assignments=[];
  for(const candidate of plan.candidates){
    const creativeId=text(candidate.creative_id,'candidate.creative_id');
    const renderSpecId=text(candidate.render_spec_id,'candidate.render_spec_id');
    const lanes=[
      ['holdout','holdout_bps'],
      ['explore','exploration_bps'],
      ['exploit','exploitation_bps']
    ];
    for(const [lane,bpsField] of lanes){
      const requestedBps=nonNegativeInt(candidate[bpsField],`candidate ${creativeId}.${bpsField}`);
      const armId=candidate.arms?.[lane];
      if(requestedBps===0){if(armId!==null&&armId!==undefined)throw new Error(`candidate ${creativeId}: zero-bps ${lane} lane must not carry arm_id`);continue;}
      const sourceRef=text(armId,`candidate ${creativeId}.arms.${lane}`);
      assignments.push(makeAssignment({
        assignment_kind:'c34_selector_arm',
        source_assignment_ref:sourceRef,
        experiment_id:plan.experiment_id,
        policy_version:plan.policy_version,
        source_plan_id:plan.traffic_plan_id,
        platform:normalizedPlatform,
        creative_id:creativeId,
        render_spec_id:renderSpecId,
        treatment_ref:creativeId,
        assignment_unit:'selector_arm_publication',
        exposure_semantics:'publication_mapping_only_platform_controls_viewer_delivery',
        context:{
          lane,
          requested_bps:requestedBps,
          requested_share_semantics:'planning_basis_points_not_observed_delivery',
          prior_snapshot_id:plan.prior_snapshot_id,
          portfolio_id:plan.portfolio_id,
          primary_metric:plan.primary_metric
        }
      }));
    }
  }
  return buildAssignmentSet({source_kind:'c34_selector',experiment_id:plan.experiment_id,policy_version:plan.policy_version,source_plan_id:plan.traffic_plan_id,assignments});
}

export function assignmentSetFromI09(publicationPlan){
  const plan=validateBlockedPublicationPlan(publicationPlan);
  const assignments=plan.assignments.map(row=>makeAssignment({
    assignment_kind:'i09_blocked_opportunity',
    source_assignment_ref:row.assignment_id,
    experiment_id:plan.experiment_id,
    policy_version:plan.policy_version,
    source_plan_id:plan.publication_plan_id,
    platform:row.platform,
    creative_id:row.creative_id,
    render_spec_id:row.render_spec_id,
    treatment_ref:row.treatment_id,
    assignment_unit:'publication_opportunity',
    exposure_semantics:'publication_opportunity_only_platform_controls_viewer_delivery',
    context:{
      design_ref:plan.design_ref,
      block_id:row.block_id,
      replicate_index:row.replicate_index,
      account_id:row.account_id,
      block_context:row.block_context,
      slot_id:row.slot_id,
      slot_position:row.slot_position,
      scheduled_at:row.scheduled_at
    }
  }));
  return buildAssignmentSet({source_kind:'i09_blocked',experiment_id:plan.experiment_id,policy_version:plan.policy_version,source_plan_id:plan.publication_plan_id,assignments});
}

export function validateAssignmentSet(set){
  const raw=object(set,'assignment_set');
  if(raw.schema!==I10_SET_SCHEMA)throw new Error(`wrong assignment set schema: ${raw.schema}`);
  const declared=text(raw.assignment_set_id,'assignment_set.assignment_set_id');
  const expected=hashId('i10s1',withoutKey(raw,'assignment_set_id'));
  if(declared!==expected)throw new Error(`assignment_set_id mismatch: declared ${declared}, expected ${expected}`);
  if(!Array.isArray(raw.assignments)||raw.assignments.length!==raw.assignment_count||raw.assignments.length===0)throw new Error('assignment set count drift');
  const refs=new Set(),ids=new Set();
  for(const [i,rowRaw] of raw.assignments.entries()){
    const row=object(rowRaw,`assignment_set.assignments[${i}]`);
    if(row.schema!==I10_ASSIGNMENT_SCHEMA)throw new Error(`assignment_set.assignments[${i}] wrong schema`);
    if(row.experiment_id!==raw.experiment_id||row.policy_version!==raw.policy_version||row.source_plan_id!==raw.source_plan_id)throw new Error(`assignment_set.assignments[${i}] provenance drift`);
    const expectedAssignment=hashId('i10x1',withoutKey(row,'experiment_assignment_id'));
    if(row.experiment_assignment_id!==expectedAssignment)throw new Error(`assignment_set.assignments[${i}] identity mismatch`);
    if(refs.has(row.source_assignment_ref))throw new Error(`duplicate source_assignment_ref ${row.source_assignment_ref}`);
    if(ids.has(row.experiment_assignment_id))throw new Error(`duplicate experiment_assignment_id ${row.experiment_assignment_id}`);
    refs.add(row.source_assignment_ref);ids.add(row.experiment_assignment_id);
  }
  return raw;
}

export function buildPublicationManifest({assignment_set,bindings}){
  const set=validateAssignmentSet(assignment_set);
  if(!Array.isArray(bindings)||bindings.length===0)throw new Error('publication bindings must be a non-empty array');
  const assignmentByRef=new Map(set.assignments.map(row=>[row.source_assignment_ref,row]));
  const seenRefs=new Set(),seenSourceKeys=new Set();
  const rows=bindings.map((bindingRaw,i)=>{
    const binding=object(bindingRaw,`bindings[${i}]`);
    const sourceRef=text(binding.source_assignment_ref,`bindings[${i}].source_assignment_ref`);
    if(seenRefs.has(sourceRef))throw new Error(`duplicate publication source_assignment_ref ${sourceRef}`);
    seenRefs.add(sourceRef);
    const assignment=assignmentByRef.get(sourceRef);
    if(!assignment)throw new Error(`unknown publication source_assignment_ref ${sourceRef}`);
    for(const forbidden of ['assignment_kind','platform','creative_id','render_spec_id','treatment_ref','assignment_unit','exposure_semantics','context','source_plan_id'])if(Object.prototype.hasOwnProperty.call(binding,forbidden))throw new Error(`bindings[${i}] must not supply derived field ${forbidden}`);
    const campaignId=text(binding.campaign_id,`bindings[${i}].campaign_id`);
    const placementId=text(binding.placement_id,`bindings[${i}].placement_id`);
    const sourceCreativeKey=text(binding.source_creative_key,`bindings[${i}].source_creative_key`);
    const publishedAt=optionalTime(binding.published_at,`bindings[${i}].published_at`);
    const sourceKey=[assignment.platform,campaignId,placementId,sourceCreativeKey].join('\u001f');
    if(seenSourceKeys.has(sourceKey))throw new Error(`duplicate publication source key ${assignment.platform}/${campaignId}/${placementId}/${sourceCreativeKey}`);
    seenSourceKeys.add(sourceKey);
    const body={
      assignment_set_id:set.assignment_set_id,
      source_kind:set.source_kind,
      source_plan_id:set.source_plan_id,
      source_assignment_ref:sourceRef,
      experiment_assignment_id:assignment.experiment_assignment_id,
      assignment_kind:assignment.assignment_kind,
      experiment_id:set.experiment_id,
      policy_version:set.policy_version,
      platform:assignment.platform,
      creative_id:assignment.creative_id,
      render_spec_id:assignment.render_spec_id,
      treatment_ref:assignment.treatment_ref,
      assignment_unit:assignment.assignment_unit,
      exposure_semantics:assignment.exposure_semantics,
      assignment_context:assignment.context,
      campaign_id:campaignId,
      placement_id:placementId,
      source_creative_key:sourceCreativeKey,
      published_at:publishedAt
    };
    return {...body,publication_binding_id:hashId('i10b1',body)};
  }).sort((a,b)=>a.source_assignment_ref.localeCompare(b.source_assignment_ref)||a.publication_binding_id.localeCompare(b.publication_binding_id));
  const body={
    schema:I10_PUBLICATION_SCHEMA,
    assignment_set_id:set.assignment_set_id,
    source_kind:set.source_kind,
    source_plan_id:set.source_plan_id,
    experiment_id:set.experiment_id,
    policy_version:set.policy_version,
    planned_assignment_count:set.assignment_count,
    bound_assignment_count:rows.length,
    coverage:rows.length===set.assignment_count?'complete':'partial',
    bindings:rows
  };
  return {...body,publication_manifest_id:hashId('i10m1',body)};
}

export function validatePublicationManifest(manifest){
  const raw=object(manifest,'publication_manifest');
  if(raw.schema!==I10_PUBLICATION_SCHEMA)throw new Error(`wrong I10 publication manifest schema: ${raw.schema}`);
  const declared=text(raw.publication_manifest_id,'publication_manifest.publication_manifest_id');
  const expected=hashId('i10m1',withoutKey(raw,'publication_manifest_id'));
  if(declared!==expected)throw new Error(`publication_manifest_id mismatch: declared ${declared}, expected ${expected}`);
  if(!Array.isArray(raw.bindings)||raw.bindings.length===0||raw.bindings.length!==raw.bound_assignment_count)throw new Error('publication manifest binding count drift');
  if(!['complete','partial'].includes(raw.coverage))throw new Error('publication manifest coverage must be complete or partial');
  if((raw.coverage==='complete')!==(raw.bound_assignment_count===raw.planned_assignment_count))throw new Error('publication manifest coverage/count disagreement');
  const refs=new Set(),sourceKeys=new Set(),bindingIds=new Set();
  for(const [i,rowRaw] of raw.bindings.entries()){
    const row=object(rowRaw,`publication_manifest.bindings[${i}]`);
    if(row.assignment_set_id!==raw.assignment_set_id||row.source_kind!==raw.source_kind||row.source_plan_id!==raw.source_plan_id||row.experiment_id!==raw.experiment_id||row.policy_version!==raw.policy_version)throw new Error(`publication_manifest.bindings[${i}] provenance drift`);
    const expectedBinding=hashId('i10b1',withoutKey(row,'publication_binding_id'));
    if(row.publication_binding_id!==expectedBinding)throw new Error(`publication_manifest.bindings[${i}] identity mismatch`);
    if(refs.has(row.source_assignment_ref))throw new Error(`duplicate publication source_assignment_ref ${row.source_assignment_ref}`);refs.add(row.source_assignment_ref);
    const sourceKey=[row.platform,row.campaign_id,row.placement_id,row.source_creative_key].join('\u001f');
    if(sourceKeys.has(sourceKey))throw new Error(`duplicate publication source key ${sourceKey}`);sourceKeys.add(sourceKey);
    if(bindingIds.has(row.publication_binding_id))throw new Error(`duplicate publication_binding_id ${row.publication_binding_id}`);bindingIds.add(row.publication_binding_id);
  }
  return raw;
}

export function buildC31JoinForPlatform(publicationManifest,platform){
  const manifest=validatePublicationManifest(publicationManifest);
  const normalizedPlatform=text(platform,'platform');
  const bindings=manifest.bindings.filter(row=>row.platform===normalizedPlatform);
  if(bindings.length===0)throw new Error(`publication manifest has no bindings for platform ${normalizedPlatform}`);
  return {
    schema:C31_JOIN_SCHEMA,
    platform:normalizedPlatform,
    bindings:bindings.map(row=>({
      campaign_id:row.campaign_id,
      placement_id:row.placement_id,
      source_creative_key:row.source_creative_key,
      creative_id:row.creative_id,
      render_spec_id:row.render_spec_id
    }))
  };
}

function readField(row,name,label){
  if(!Object.prototype.hasOwnProperty.call(row,name))throw new Error(`${label}: missing source field ${name}`);
  return row[name];
}

export function ingestAttributedExport({publication_manifest,raw_bytes,export_meta,rows,adapter}){
  const manifest=validatePublicationManifest(publication_manifest);
  const normalizedAdapter=validateExportAdapter(adapter);
  const platform=text(export_meta?.platform,'export_meta.platform');
  if(normalizedAdapter.platform!==platform)throw new Error(`adapter/export platform mismatch: ${normalizedAdapter.platform} vs ${platform}`);
  const join=buildC31JoinForPlatform(manifest,platform);
  const c31=ingestPlatformExport({raw_bytes,export_meta,rows,adapter,publication_join:join});
  const publicationIndex=new Map(manifest.bindings.filter(row=>row.platform===platform).map(row=>[[row.campaign_id,row.placement_id,row.source_creative_key].join('\u001f'),row]));
  const sourceRows=rows.map((rowRaw,i)=>{
    const row=object(rowRaw,`rows[${i}]`);
    const rowKey=text(readField(row,normalizedAdapter.row_key_field,`rows[${i}]`),`rows[${i}].row_key`);
    const campaignId=text(readField(row,normalizedAdapter.campaign_field,`row ${rowKey}`),`row ${rowKey}.campaign_id`);
    const placementId=text(readField(row,normalizedAdapter.placement_field,`row ${rowKey}`),`row ${rowKey}.placement_id`);
    const sourceCreativeKey=text(readField(row,normalizedAdapter.creative_key_field,`row ${rowKey}`),`row ${rowKey}.creative_key`);
    return {rowKey,campaignId,placementId,sourceCreativeKey};
  }).sort((a,b)=>a.rowKey.localeCompare(b.rowKey));
  if(sourceRows.length!==c31.evidence.observations.length||sourceRows.length!==c31.receipt.observation_ids.length)throw new Error('C31 observation count does not match source rows');
  const attributions=[];
  for(let i=0;i<sourceRows.length;i++){
    const source=sourceRows[i],observation=c31.evidence.observations[i],observationId=c31.receipt.observation_ids[i];
    if(observation.observation_id!==observationId)throw new Error(`C31 receipt/evidence observation order drift at index ${i}`);
    const binding=publicationIndex.get([source.campaignId,source.placementId,source.sourceCreativeKey].join('\u001f'));
    if(!binding)throw new Error(`source row ${source.rowKey} has no I10 publication attribution`);
    if(observation.creative_id!==binding.creative_id||observation.render_spec_id!==binding.render_spec_id)throw new Error(`source row ${source.rowKey} canonical creative/render drift`);
    const body={
      observation_id:observationId,
      publication_binding_id:binding.publication_binding_id,
      assignment_set_id:binding.assignment_set_id,
      source_kind:binding.source_kind,
      source_plan_id:binding.source_plan_id,
      source_assignment_ref:binding.source_assignment_ref,
      experiment_assignment_id:binding.experiment_assignment_id,
      assignment_kind:binding.assignment_kind,
      experiment_id:binding.experiment_id,
      policy_version:binding.policy_version,
      treatment_ref:binding.treatment_ref,
      assignment_unit:binding.assignment_unit,
      exposure_semantics:binding.exposure_semantics,
      assignment_context:binding.assignment_context,
      creative_id:binding.creative_id,
      render_spec_id:binding.render_spec_id,
      platform:binding.platform,
      campaign_id:binding.campaign_id,
      placement_id:binding.placement_id,
      source_creative_key:binding.source_creative_key,
      published_at:binding.published_at,
      source_row_key:source.rowKey
    };
    attributions.push({...body,attribution_id:hashId('i10a1',body)});
  }
  attributions.sort((a,b)=>a.observation_id.localeCompare(b.observation_id));
  const body={
    schema:I10_ATTRIBUTED_EVIDENCE_SCHEMA,
    publication_manifest_id:manifest.publication_manifest_id,
    assignment_set_id:manifest.assignment_set_id,
    source_kind:manifest.source_kind,
    source_plan_id:manifest.source_plan_id,
    ingestion_id:c31.receipt.ingestion_id,
    evidence_batch_id:c31.evidence.evidence_batch_id,
    observed_delivery_semantics:'platform_export_counts_only_platform_controls_viewer_delivery',
    attributions
  };
  return {...body,attributed_evidence_id:hashId('i10e1',body),c30_evidence:c31.evidence,c31_receipt:c31.receipt};
}
