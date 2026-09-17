#!/usr/bin/env node
import assert from 'node:assert/strict';
import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  buildCanonicalTemplateVariabilityRegistry,
  buildDefaultTemplateAutoPolicy,
  composeAutomaticTemplateVariant,
} from './template-variant-composer-v1.mjs';
import {
  BATCH_TEMPLATE_DIVERSITY_AXES,
  buildDefaultBatchTemplateDiversityPolicy,
  categoricalTemplateDistance,
  selectDiverseTemplateBatch,
  validateDiverseTemplateBatchReceipt,
} from './batch-template-diversity-v1.mjs';

const context={
  aspect:'vertical',
  duration_seconds:9,
  semantic_roles:['hook','book_reveal','cta'],
  available_asset_kinds:['cover'],
};
const registry=buildCanonicalTemplateVariabilityRegistry();
const autoPolicy=buildDefaultTemplateAutoPolicy();
const diversityPolicy=buildDefaultBatchTemplateDiversityPolicy();

const byVariant=new Map();
for(let i=0;i<2500;i+=1){
  const receipt=composeAutomaticTemplateVariant({
    subject_key:`c44-synthetic-subject-${String(i).padStart(4,'0')}`,
    seed:44,
    context,
    policy:autoPolicy,
    registry,
  });
  const variant=receipt.template_variant;
  if(!byVariant.has(variant.template_variant_id)){
    byVariant.set(variant.template_variant_id,{
      candidate_id:`cand_${variant.template_variant_id}`,
      template_variant:variant,
    });
  }
}
const candidates=[...byVariant.values()];
assert.ok(candidates.length>=1000,`expected >=1000 unique candidates, got ${candidates.length}`);

const batch=selectDiverseTemplateBatch({candidates,batch_size:40,seed:4401,policy:diversityPolicy});
assert.equal(batch.assignments.length,40);
assert.equal(batch.duplicate_full_tuple_count,0);
assert.ok(batch.min_observed_transition_distance>=diversityPolicy.min_categorical_distance);
assert.equal(new Set(batch.assignments.map(item=>item.template_variant_id)).size,40);

for(let i=0;i<batch.assignments.length;i+=1){
  const current=batch.assignments[i];
  assert.deepEqual(Object.keys(current).sort(),['axes','candidate_id','distance_from_previous','index','template_variant_id']);
  assert.equal('hook' in current,false);
  assert.equal('title' in current,false);
  assert.equal('cta' in current,false);
  for(let back=1;back<=diversityPolicy.lookback_window&&i-back>=0;back+=1){
    const distance=categoricalTemplateDistance(batch.assignments[i-back].axes,current.axes);
    assert.ok(distance.distance>=diversityPolicy.min_categorical_distance,`distance ${distance.distance} below minimum at ${i-back}->${i}`);
  }
}

for(const axis of BATCH_TEMPLATE_DIVERSITY_AXES){
  const cap=Math.ceil(batch.batch_size*diversityPolicy.max_option_share_bps[axis]/10000);
  for(const [option,count] of Object.entries(batch.axis_distribution[axis])){
    assert.ok(count<=cap,`${axis}/${option} count ${count} exceeds cap ${cap}`);
  }
}

const reversed=selectDiverseTemplateBatch({candidates:[...candidates].reverse(),batch_size:40,seed:4401,policy:diversityPolicy});
assert.deepEqual(reversed,batch,'candidate input order must not change batch');
const replay=selectDiverseTemplateBatch({candidates,batch_size:40,seed:4401,policy:diversityPolicy});
assert.deepEqual(replay,batch,'same inputs must replay exactly');
assert.equal(validateDiverseTemplateBatchReceipt(batch,{candidates,policy:diversityPolicy}).valid,true);

const alternate=selectDiverseTemplateBatch({candidates,batch_size:40,seed:4402,policy:diversityPolicy});
assert.notEqual(alternate.batch_id,batch.batch_id,'seed should be able to change deterministic batch identity');
assert.notDeepEqual(alternate.assignments.map(item=>item.template_variant_id),batch.assignments.map(item=>item.template_variant_id));

assert.throws(()=>selectDiverseTemplateBatch({
  candidates:[candidates[0],{...candidates[1],hook:'injected semantic copy'}],
  batch_size:2,
  seed:1,
  policy:diversityPolicy,
}),/unsupported fields/);

assert.throws(()=>selectDiverseTemplateBatch({
  candidates:[candidates[0],{...candidates[0],candidate_id:'different-id'}],
  batch_size:2,
  seed:1,
  policy:diversityPolicy,
}),/duplicate template_variant_id|duplicate full template tuples/);

const impossible={...diversityPolicy,min_categorical_distance:6};
const {policy_id,...projection}=impossible;
void policy_id;
impossible.policy_id=`nbdivpol1_${sha256Canonical(projection)}`;
assert.throws(()=>selectDiverseTemplateBatch({candidates:candidates.slice(0,80),batch_size:40,seed:1,policy:impossible}),/constraints unsatisfied/);

console.log(JSON.stringify({
  schema:'c44-batch-template-diversity-acceptance-v1',
  unique_candidate_count:candidates.length,
  batch_id:batch.batch_id,
  batch_size:batch.batch_size,
  policy_id:batch.policy_id,
  min_observed_transition_distance:batch.min_observed_transition_distance,
  duplicate_full_tuple_count:batch.duplicate_full_tuple_count,
  axis_distribution:batch.axis_distribution,
  candidate_order_invariant:true,
  deterministic_replay:true,
  semantic_copy_surface_absent:true,
},null,2));
