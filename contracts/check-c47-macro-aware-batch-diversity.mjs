#!/usr/bin/env node
import assert from 'node:assert/strict';
import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  BATCH_TEMPLATE_DIVERSITY_AXES,
  buildDefaultBatchTemplateDiversityPolicy,
  categoricalTemplateDistance,
  selectDiverseTemplateBatch,
} from './batch-template-diversity-v1.mjs';
import {
  BATCH_TEMPLATE_DIVERSITY_V2_ALLOWED_MACRO_AXES,
  buildDefaultBatchTemplateDiversityPolicyV2,
  macroTemplateDistance,
  selectDiverseTemplateBatchV2,
  validateBatchTemplateDiversityPolicyV2,
  validateDiverseTemplateBatchReceiptV2,
} from './batch-template-diversity-v2.mjs';
import {
  buildCanonicalTemplateVariabilityRegistry,
  buildDefaultTemplateAutoPolicy,
  composeAutomaticTemplateVariant,
  composeExplicitTemplateVariant,
} from './template-variant-composer-v1.mjs';

const context={
  aspect:'vertical',
  duration_seconds:9,
  semantic_roles:['hook','book_reveal','tension','desire_payoff','cta'],
  available_asset_kinds:['cover'],
};
const registry=buildCanonicalTemplateVariabilityRegistry();
const autoPolicy=buildDefaultTemplateAutoPolicy();
const policy=buildDefaultBatchTemplateDiversityPolicyV2();
assert.deepEqual(policy.macro_axes,['asset_staging','structural_layout','visual_system']);
assert.deepEqual(policy.macro_axes,BATCH_TEMPLATE_DIVERSITY_V2_ALLOWED_MACRO_AXES);
assert.equal(validateBatchTemplateDiversityPolicyV2(policy).valid,true);

const byVariant=new Map();
for(let i=0;i<2500;i+=1){
  const receipt=composeAutomaticTemplateVariant({subject_key:`c47-synthetic-subject-${String(i).padStart(4,'0')}`,seed:47,context,policy:autoPolicy,registry});
  const variant=receipt.template_variant;
  if(!byVariant.has(variant.template_variant_id))byVariant.set(variant.template_variant_id,{candidate_id:`cand_${variant.template_variant_id}`,template_variant:variant});
}
const candidates=[...byVariant.values()];
assert.ok(candidates.length>=1000,`expected >=1000 unique candidates, got ${candidates.length}`);

const batch=selectDiverseTemplateBatchV2({candidates,batch_size:40,seed:4701,policy});
assert.equal(batch.assignments.length,40);
assert.equal(batch.duplicate_full_tuple_count,0);
assert.equal(new Set(batch.assignments.map(item=>item.template_variant_id)).size,40);
assert.ok(batch.min_observed_transition_distance>=policy.min_categorical_distance);
assert.ok(batch.min_observed_lookback_distance>=policy.min_categorical_distance);
assert.ok(batch.min_observed_macro_transition_distance>=policy.min_macro_distance);
assert.ok(batch.min_observed_macro_lookback_distance>=policy.min_macro_distance);

let checkedLookbackPairs=0;
for(let i=0;i<batch.assignments.length;i+=1){
  const current=batch.assignments[i];
  assert.deepEqual(Object.keys(current).sort(),['axes','candidate_id','distance_from_previous','index','macro_distance_from_previous','template_variant_id']);
  for(let back=1;back<=policy.lookback_window&&i-back>=0;back+=1){
    const previous=batch.assignments[i-back];
    const total=categoricalTemplateDistance(previous.axes,current.axes);
    const macro=macroTemplateDistance(previous.axes,current.axes,policy.macro_axes);
    assert.ok(total.distance>=policy.min_categorical_distance,`categorical distance ${total.distance} below minimum at ${i-back}->${i}`);
    assert.ok(macro.distance>=policy.min_macro_distance,`macro distance ${macro.distance} below minimum at ${i-back}->${i}`);
    checkedLookbackPairs+=1;
  }
}
assert.ok(checkedLookbackPairs>40);

for(const axis of BATCH_TEMPLATE_DIVERSITY_AXES){
  const cap=Math.ceil(batch.batch_size*policy.max_option_share_bps[axis]/10000);
  for(const [option,count] of Object.entries(batch.axis_distribution[axis]))assert.ok(count<=cap,`${axis}/${option} count ${count} exceeds cap ${cap}`);
}

const reversed=selectDiverseTemplateBatchV2({candidates:[...candidates].reverse(),batch_size:40,seed:4701,policy});
assert.deepEqual(reversed,batch,'candidate input order must not change v2 batch');
const replay=selectDiverseTemplateBatchV2({candidates,batch_size:40,seed:4701,policy});
assert.deepEqual(replay,batch,'same v2 inputs must replay exactly');
assert.equal(validateDiverseTemplateBatchReceiptV2(batch,{candidates,policy}).valid,true);
const alternate=selectDiverseTemplateBatchV2({candidates,batch_size:40,seed:4702,policy});
assert.notEqual(alternate.batch_id,batch.batch_id,'seed should be able to change v2 batch identity');
assert.notDeepEqual(alternate.assignments.map(item=>item.template_variant_id),batch.assignments.map(item=>item.template_variant_id));

function reidentifyV2(value){
  const next=structuredClone(value);delete next.policy_id;return {...next,policy_id:`nbdivpol2_${sha256Canonical(next)}`};
}
function reidentifyV1(value){
  const next=structuredClone(value);delete next.policy_id;return {...next,policy_id:`nbdivpol1_${sha256Canonical(next)}`};
}
for(const bad of [
  reidentifyV2({...policy,macro_axes:[]}),
  reidentifyV2({...policy,macro_axes:['asset_staging','asset_staging']}),
  reidentifyV2({...policy,macro_axes:['typography']}),
  reidentifyV2({...policy,min_macro_distance:4}),
])assert.equal(validateBatchTemplateDiversityPolicyV2(bad).valid,false,`invalid v2 policy unexpectedly accepted: ${JSON.stringify(bad)}`);
assert.equal(validateBatchTemplateDiversityPolicyV2({...policy,policy_id:'nbdivpol2_forged'}).valid,false);

// Targeted counterexample: same macro composition/art direction, but exactly three
// non-macro axes change. C44 v1 can accept the pair when caps are neutralized;
// v2 must reject it because macro distance is zero.
const baseReceipt=composeAutomaticTemplateVariant({subject_key:'c47-micro-only-base',seed:4700,context,policy:autoPolicy,registry});
const base=baseReceipt.template_variant;
const microAxes=structuredClone(base.axes);
microAxes.typography=autoPolicy.typography.find(id=>id!==base.axes.typography);
microAxes.motion_grammar=autoPolicy.motion_grammars.find(id=>id!==base.axes.motion_grammar);
microAxes.graphic_devices=[autoPolicy.graphic_devices.find(id=>id!==base.axes.graphic_devices[0])];
const microVariant=composeExplicitTemplateVariant({selection:microAxes,context,registry}).template_variant;
const microPair=[
  {candidate_id:'micro_base',template_variant:base},
  {candidate_id:'micro_alt',template_variant:microVariant},
];
const totalMicro=categoricalTemplateDistance(base.axes,microVariant.axes);
const macroMicro=macroTemplateDistance(base.axes,microVariant.axes,policy.macro_axes);
assert.equal(totalMicro.distance,3);
assert.deepEqual(Object.entries(totalMicro.components).filter(([,changed])=>changed).map(([axis])=>axis).sort(),['graphic_devices','motion_grammar','typography']);
assert.equal(macroMicro.distance,0);

const v1Base=buildDefaultBatchTemplateDiversityPolicy();
const v1Counter=reidentifyV1({...v1Base,max_option_share_bps:Object.fromEntries(BATCH_TEMPLATE_DIVERSITY_AXES.map(axis=>[axis,10000]))});
const v1Pair=selectDiverseTemplateBatch({candidates:microPair,batch_size:2,seed:47,policy:v1Counter});
assert.equal(v1Pair.assignments.length,2,'v1 counterexample should accept total-distance-only pair');
const v2Counter=reidentifyV2({...policy,max_option_share_bps:Object.fromEntries(BATCH_TEMPLATE_DIVERSITY_AXES.map(axis=>[axis,10000]))});
assert.throws(()=>selectDiverseTemplateBatchV2({candidates:microPair,batch_size:2,seed:47,policy:v2Counter}),/v2 constraints unsatisfied/);

// Historical v1 remains callable and unchanged while v2 is additive.
const v1Regression=selectDiverseTemplateBatch({candidates,batch_size:40,seed:4401,policy:buildDefaultBatchTemplateDiversityPolicy()});
assert.equal(v1Regression.schema,'newboo-batch-template-diversity-receipt-v1');
assert.equal(v1Regression.assignments.length,40);

console.log(JSON.stringify({
  schema:'c47-macro-aware-batch-diversity-acceptance-v1',
  candidate_count:candidates.length,
  batch_id:batch.batch_id,
  batch_size:batch.batch_size,
  policy_id:policy.policy_id,
  macro_axes:policy.macro_axes,
  min_categorical_distance:policy.min_categorical_distance,
  min_macro_distance:policy.min_macro_distance,
  min_observed_lookback_distance:batch.min_observed_lookback_distance,
  min_observed_macro_lookback_distance:batch.min_observed_macro_lookback_distance,
  checked_lookback_pairs:checkedLookbackPairs,
  duplicate_full_tuple_count:batch.duplicate_full_tuple_count,
  input_order_invariant:true,
  deterministic_replay:true,
  historical_v1_replay_surface_preserved:true,
  micro_only_counterexample:{categorical_distance:totalMicro.distance,macro_distance:macroMicro.distance,v1_accepts_under_neutral_caps:true,v2_rejects:true},
},null,2));
