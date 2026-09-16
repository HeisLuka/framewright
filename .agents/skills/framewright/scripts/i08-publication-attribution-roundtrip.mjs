#!/usr/bin/env node
import crypto from 'node:crypto';
import { stableStringify } from './c30-campaign-learning.mjs';
import {
  C31_JOIN_SCHEMA,
  ingestPlatformExport,
  validateExportAdapter
} from './c31-platform-export-ingestion.mjs';
import {
  C34_PLAN_SCHEMA
} from './c34-exploration-holdout-selector.mjs';

export const I08_PUBLICATION_SCHEMA='framewright-i08-publication-attribution-v1';
export const I08_ATTRIBUTED_EVIDENCE_SCHEMA='framewright-i08-attributed-evidence-v1';

function isObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function object(value,label){if(!isObject(value))throw new Error(`${label} must be an object`);return value;}
function text(value,label){if(typeof value!=='string'||!value.trim())throw new Error(`${label} must be a non-empty string`);return value.trim();}
function bps(value,label){if(!Number.isSafeInteger(value)||value<0||value>10000)throw new Error(`${label} must be an integer in [0, 10000]`);return value;}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function hashId(prefix,body){return `${prefix}_${sha256(stableStringify(body))}`;}
function withoutKey(value,key){const copy={...value};delete copy[key];return copy;}

function validateTrafficPlan(plan){
  object(plan,'traffic_plan');
  if(plan.schema!==C34_PLAN_SCHEMA)throw new Error(`I08 requires ${C34_PLAN_SCHEMA}`);
  const declaredId=text(plan.traffic_plan_id,'traffic_plan.traffic_plan_id');
  const expectedId=hashId('c34t1',withoutKey(plan,'traffic_plan_id'));
  if(declaredId!==expectedId)throw new Error(`traffic_plan_id mismatch: declared ${declaredId}, expected ${expectedId}`);
  text(plan.experiment_id,'traffic_plan.experiment_id');
  text(plan.policy_version,'traffic_plan.policy_version');
  text(plan.prior_snapshot_id,'traffic_plan.prior_snapshot_id');
  text(plan.portfolio_id,'traffic_plan.portfolio_id');
  if(!Array.isArray(plan.candidates)||plan.candidates.length<2)throw new Error('traffic_plan.candidates must contain at least two candidates');
  const creativeIds=new Set(),renderIds=new Set(),armIds=new Set();
  let total=0;
  for(const [i,candidateRaw] of plan.candidates.entries()){
    const candidate=object(candidateRaw,`traffic_plan.candidates[${i}]`);
    const creativeId=text(candidate.creative_id,`candidate[${i}].creative_id`);
    const renderId=text(candidate.render_spec_id,`candidate[${i}].render_spec_id`);
    if(creativeIds.has(creativeId))throw new Error(`duplicate traffic-plan creative_id ${creativeId}`);
    if(renderIds.has(renderId))throw new Error(`duplicate traffic-plan render_spec_id ${renderId}`);
    creativeIds.add(creativeId);renderIds.add(renderId);
    const holdout=bps(candidate.holdout_bps,`candidate[${i}].holdout_bps`);
    const explore=bps(candidate.exploration_bps,`candidate[${i}].exploration_bps`);
    const exploit=bps(candidate.exploitation_bps,`candidate[${i}].exploitation_bps`);
    const adaptive=bps(candidate.adaptive_bps,`candidate[${i}].adaptive_bps`);
    const rowTotal=bps(candidate.total_bps,`candidate[${i}].total_bps`);
    if(adaptive!==explore+exploit)throw new Error(`candidate ${creativeId}: adaptive_bps drift`);
    if(rowTotal!==holdout+adaptive)throw new Error(`candidate ${creativeId}: total_bps drift`);
    total+=rowTotal;
    const arms=object(candidate.arms,`candidate[${i}].arms`);
    for(const [lane,amount] of [['holdout',holdout],['explore',explore],['exploit',exploit]]){
      const arm=arms[lane];
      if(amount>0){
        const id=text(arm,`candidate ${creativeId}.arms.${lane}`);
        if(armIds.has(id))throw new Error(`duplicate traffic-plan arm_id ${id}`);
        armIds.add(id);
      }else if(arm!==null&&arm!==undefined){
        throw new Error(`candidate ${creativeId}: zero-bps ${lane} lane must not carry an arm_id`);
      }
    }
  }
  if(total!==10000)throw new Error(`traffic_plan total must be 10000 bps, got ${total}`);
  return plan;
}

function enumerateArms(plan){
  validateTrafficPlan(plan);
  const rows=[];
  for(const candidate of plan.candidates){
    for(const [lane,bpsField] of [['holdout','holdout_bps'],['explore','exploration_bps'],['exploit','exploitation_bps']]){
      const requestedBps=candidate[bpsField];
      if(!requestedBps)continue;
      rows.push({
        experiment_id:plan.experiment_id,
        policy_version:plan.policy_version,
        traffic_plan_id:plan.traffic_plan_id,
        prior_snapshot_id:plan.prior_snapshot_id,
        portfolio_id:plan.portfolio_id,
        arm_id:candidate.arms[lane],
        lane,
        requested_bps:requestedBps,
        creative_id:candidate.creative_id,
        render_spec_id:candidate.render_spec_id
      });
    }
  }
  return rows.sort((a,b)=>a.arm_id.localeCompare(b.arm_id));
}

export function buildPublicationAttribution({traffic_plan,platform,bindings}){
  const plan=validateTrafficPlan(traffic_plan);
  const normalizedPlatform=text(platform,'platform');
  const arms=enumerateArms(plan),armIndex=new Map(arms.map(row=>[row.arm_id,row]));
  if(!Array.isArray(bindings))throw new Error('bindings must be an array');
  if(bindings.length!==arms.length)throw new Error(`publication bindings must cover every nonzero arm exactly once: expected ${arms.length}, got ${bindings.length}`);
  const seenArms=new Set(),seenSourceKeys=new Set(),publication=[];
  for(const [i,bindingRaw] of bindings.entries()){
    const binding=object(bindingRaw,`bindings[${i}]`);
    const armId=text(binding.arm_id,`bindings[${i}].arm_id`);
    if(seenArms.has(armId))throw new Error(`duplicate publication arm binding ${armId}`);
    seenArms.add(armId);
    const arm=armIndex.get(armId);
    if(!arm)throw new Error(`unknown publication arm_id ${armId}`);
    for(const forbidden of ['creative_id','render_spec_id','lane','requested_bps','traffic_plan_id','prior_snapshot_id']){
      if(Object.prototype.hasOwnProperty.call(binding,forbidden))throw new Error(`bindings[${i}] must not supply derived field ${forbidden}`);
    }
    const campaignId=text(binding.campaign_id,`bindings[${i}].campaign_id`);
    const placementId=text(binding.placement_id,`bindings[${i}].placement_id`);
    const sourceCreativeKey=text(binding.source_creative_key,`bindings[${i}].source_creative_key`);
    const sourceKey=[normalizedPlatform,campaignId,placementId,sourceCreativeKey].join('\u001f');
    if(seenSourceKeys.has(sourceKey))throw new Error(`duplicate publication source key ${campaignId}/${placementId}/${sourceCreativeKey}`);
    seenSourceKeys.add(sourceKey);
    const body={
      ...arm,
      platform:normalizedPlatform,
      campaign_id:campaignId,
      placement_id:placementId,
      source_creative_key:sourceCreativeKey,
      requested_share_semantics:'planning_basis_points_not_observed_delivery'
    };
    publication.push({...body,publication_binding_id:hashId('i08p1',body)});
  }
  const missing=arms.filter(arm=>!seenArms.has(arm.arm_id));
  if(missing.length)throw new Error(`missing publication bindings for arm(s): ${missing.map(x=>x.arm_id).join(', ')}`);
  publication.sort((a,b)=>a.arm_id.localeCompare(b.arm_id));
  const body={
    schema:I08_PUBLICATION_SCHEMA,
    platform:normalizedPlatform,
    experiment_id:plan.experiment_id,
    policy_version:plan.policy_version,
    traffic_plan_id:plan.traffic_plan_id,
    prior_snapshot_id:plan.prior_snapshot_id,
    portfolio_id:plan.portfolio_id,
    requested_total_bps:publication.reduce((sum,row)=>sum+row.requested_bps,0),
    requested_share_semantics:'planning_basis_points_not_observed_delivery',
    bindings:publication
  };
  if(body.requested_total_bps!==10000)throw new Error(`publication requested_total_bps must be 10000, got ${body.requested_total_bps}`);
  return {...body,publication_manifest_id:hashId('i08m1',body)};
}

export function validatePublicationManifest(manifest){
  object(manifest,'publication_manifest');
  if(manifest.schema!==I08_PUBLICATION_SCHEMA)throw new Error(`wrong publication manifest schema: ${manifest.schema}`);
  const declaredId=text(manifest.publication_manifest_id,'publication_manifest.publication_manifest_id');
  const expectedId=hashId('i08m1',withoutKey(manifest,'publication_manifest_id'));
  if(declaredId!==expectedId)throw new Error(`publication_manifest_id mismatch: declared ${declaredId}, expected ${expectedId}`);
  const platform=text(manifest.platform,'publication_manifest.platform');
  text(manifest.experiment_id,'publication_manifest.experiment_id');
  text(manifest.policy_version,'publication_manifest.policy_version');
  text(manifest.traffic_plan_id,'publication_manifest.traffic_plan_id');
  text(manifest.prior_snapshot_id,'publication_manifest.prior_snapshot_id');
  text(manifest.portfolio_id,'publication_manifest.portfolio_id');
  if(manifest.requested_share_semantics!=='planning_basis_points_not_observed_delivery')throw new Error('publication manifest must distinguish requested planning share from observed delivery');
  if(!Array.isArray(manifest.bindings)||!manifest.bindings.length)throw new Error('publication manifest bindings must be non-empty');
  const seenBindings=new Set(),seenArms=new Set(),seenSourceKeys=new Set();
  let total=0;
  for(const [i,rowRaw] of manifest.bindings.entries()){
    const row=object(rowRaw,`publication_manifest.bindings[${i}]`);
    const bindingId=text(row.publication_binding_id,`binding[${i}].publication_binding_id`);
    const expectedBindingId=hashId('i08p1',withoutKey(row,'publication_binding_id'));
    if(bindingId!==expectedBindingId)throw new Error(`publication_binding_id mismatch for binding[${i}]`);
    if(seenBindings.has(bindingId))throw new Error(`duplicate publication_binding_id ${bindingId}`);seenBindings.add(bindingId);
    const armId=text(row.arm_id,`binding[${i}].arm_id`);
    if(seenArms.has(armId))throw new Error(`duplicate publication arm_id ${armId}`);seenArms.add(armId);
    if(!['holdout','explore','exploit'].includes(row.lane))throw new Error(`binding[${i}].lane is invalid`);
    const requested=bps(row.requested_bps,`binding[${i}].requested_bps`);if(requested<=0)throw new Error(`binding[${i}].requested_bps must be > 0`);total+=requested;
    text(row.creative_id,`binding[${i}].creative_id`);text(row.render_spec_id,`binding[${i}].render_spec_id`);
    if(row.platform!==platform)throw new Error(`binding[${i}] platform mismatch`);
    if(row.experiment_id!==manifest.experiment_id||row.policy_version!==manifest.policy_version||row.traffic_plan_id!==manifest.traffic_plan_id||row.prior_snapshot_id!==manifest.prior_snapshot_id||row.portfolio_id!==manifest.portfolio_id)throw new Error(`binding[${i}] experiment provenance mismatch`);
    if(row.requested_share_semantics!=='planning_basis_points_not_observed_delivery')throw new Error(`binding[${i}] requested share semantics drift`);
    const campaignId=text(row.campaign_id,`binding[${i}].campaign_id`),placementId=text(row.placement_id,`binding[${i}].placement_id`),sourceCreativeKey=text(row.source_creative_key,`binding[${i}].source_creative_key`);
    const sourceKey=[platform,campaignId,placementId,sourceCreativeKey].join('\u001f');
    if(seenSourceKeys.has(sourceKey))throw new Error(`duplicate publication source key ${campaignId}/${placementId}/${sourceCreativeKey}`);seenSourceKeys.add(sourceKey);
  }
  if(total!==10000||manifest.requested_total_bps!==10000)throw new Error(`publication requested traffic must sum to 10000 bps, got ${total}`);
  return manifest;
}

export function buildC31PublicationJoin(publicationManifest){
  const manifest=validatePublicationManifest(publicationManifest);
  return {
    schema:C31_JOIN_SCHEMA,
    platform:manifest.platform,
    bindings:manifest.bindings.map(row=>({
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
  if(normalizedAdapter.platform!==manifest.platform)throw new Error(`adapter/publication platform mismatch: ${normalizedAdapter.platform} vs ${manifest.platform}`);
  if(export_meta?.platform!==manifest.platform)throw new Error(`export/publication platform mismatch: ${export_meta?.platform} vs ${manifest.platform}`);
  const join=buildC31PublicationJoin(manifest);
  const c31=ingestPlatformExport({raw_bytes,export_meta,rows,adapter,publication_join:join});
  const publicationIndex=new Map(manifest.bindings.map(row=>[[row.campaign_id,row.placement_id,row.source_creative_key].join('\u001f'),row]));
  const sortedRows=rows.map((rowRaw,i)=>{
    const row=object(rowRaw,`rows[${i}]`);
    const rowKey=text(readField(row,normalizedAdapter.row_key_field,`rows[${i}]`),`rows[${i}].row_key`);
    const campaignId=text(readField(row,normalizedAdapter.campaign_field,`row ${rowKey}`),`row ${rowKey}.campaign_id`);
    const placementId=text(readField(row,normalizedAdapter.placement_field,`row ${rowKey}`),`row ${rowKey}.placement_id`);
    const sourceCreativeKey=text(readField(row,normalizedAdapter.creative_key_field,`row ${rowKey}`),`row ${rowKey}.creative_key`);
    return {rowKey,campaignId,placementId,sourceCreativeKey};
  }).sort((a,b)=>a.rowKey.localeCompare(b.rowKey));
  if(sortedRows.length!==c31.evidence.observations.length||sortedRows.length!==c31.receipt.observation_ids.length)throw new Error('C31 observation count does not match parsed source rows');
  const attributions=[];
  for(let i=0;i<sortedRows.length;i++){
    const source=sortedRows[i],observation=c31.evidence.observations[i],observationId=c31.receipt.observation_ids[i];
    if(observation.observation_id!==observationId)throw new Error(`C31 receipt/evidence observation order drift at index ${i}`);
    const publication=publicationIndex.get([source.campaignId,source.placementId,source.sourceCreativeKey].join('\u001f'));
    if(!publication)throw new Error(`source row ${source.rowKey} has no I08 publication attribution`);
    if(observation.campaign_id!==source.campaignId||observation.placement_id!==source.placementId)throw new Error(`source row ${source.rowKey} campaign/placement drift after C31 ingestion`);
    if(observation.creative_id!==publication.creative_id||observation.render_spec_id!==publication.render_spec_id)throw new Error(`source row ${source.rowKey} canonical creative/render drift after C31 ingestion`);
    const body={
      observation_id:observationId,
      publication_binding_id:publication.publication_binding_id,
      experiment_id:publication.experiment_id,
      policy_version:publication.policy_version,
      traffic_plan_id:publication.traffic_plan_id,
      prior_snapshot_id:publication.prior_snapshot_id,
      portfolio_id:publication.portfolio_id,
      arm_id:publication.arm_id,
      lane:publication.lane,
      requested_bps:publication.requested_bps,
      requested_share_semantics:'planning_basis_points_not_observed_delivery',
      creative_id:publication.creative_id,
      render_spec_id:publication.render_spec_id,
      platform:publication.platform,
      campaign_id:publication.campaign_id,
      placement_id:publication.placement_id,
      source_creative_key:publication.source_creative_key,
      source_row_key:source.rowKey
    };
    attributions.push({...body,attribution_id:hashId('i08a1',body)});
  }
  attributions.sort((a,b)=>a.observation_id.localeCompare(b.observation_id));
  const body={
    schema:I08_ATTRIBUTED_EVIDENCE_SCHEMA,
    publication_manifest_id:manifest.publication_manifest_id,
    ingestion_id:c31.receipt.ingestion_id,
    evidence_batch_id:c31.evidence.evidence_batch_id,
    requested_share_semantics:'planning_basis_points_not_observed_delivery',
    observed_delivery_semantics:'platform_export_counts_only_no_requested_share_fidelity_claim',
    attributions
  };
  return {
    ...body,
    attributed_evidence_id:hashId('i08e1',body),
    c30_evidence:c31.evidence,
    c31_receipt:c31.receipt
  };
}
