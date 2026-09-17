#!/usr/bin/env node
import assert from 'node:assert/strict';
import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  buildDefaultTemplateAutoPolicy,
  buildCanonicalTemplateVariabilityRegistry,
} from './template-variant-composer-v1.mjs';
import {
  buildDefaultTemplateCandidatePoolPolicy,
  buildTemplateCandidatePool,
  computeTemplateCandidatePoolPolicyId,
  validateTemplateCandidatePool,
  validateTemplateCandidatePoolPolicy,
} from './template-candidate-pool-v1.mjs';

const source={book_id:'book-c50-trusted',narrative_plan_id:'c27-c50-trusted-plan'};
const context={aspect:'vertical',duration_seconds:9,semantic_roles:['hook','book_reveal','tension','desire_payoff','cta'],available_asset_kinds:['cover']};
const registry=buildCanonicalTemplateVariabilityRegistry();
const poolPolicy=buildDefaultTemplateCandidatePoolPolicy();
const autoPolicy=buildDefaultTemplateAutoPolicy();

const pool=buildTemplateCandidatePool({source,context,pool_seed:50,server_pool_policy:poolPolicy,server_auto_policy:autoPolicy,registry});
assert.equal(pool.schema,'newboo-template-candidate-pool-v1');
assert.equal(pool.candidates.length,1024);
assert.equal(pool.target_unique_candidates,1024);
assert.ok(pool.probe_count>=1024&&pool.probe_count<=4096);
assert.equal(new Set(pool.candidates.map(item=>item.candidate_id)).size,1024);
assert.equal(new Set(pool.candidates.map(item=>item.template_variant.template_variant_id)).size,1024);
assert.equal(validateTemplateCandidatePool(pool,{server_pool_policy:poolPolicy,server_auto_policy:autoPolicy,registry}).valid,true);
assert.equal(JSON.stringify(pool).includes(source.book_id),false,'raw book_id leaked into candidate pool');
assert.equal(JSON.stringify(pool).includes(source.narrative_plan_id),false,'raw narrative_plan_id leaked into candidate pool');

const replay=buildTemplateCandidatePool({source:{narrative_plan_id:source.narrative_plan_id,book_id:source.book_id},context:{available_asset_kinds:['cover'],semantic_roles:['cta','tension','hook','desire_payoff','book_reveal'],duration_seconds:9,aspect:'vertical'},pool_seed:50,server_auto_policy:autoPolicy,server_pool_policy:poolPolicy,registry});
assert.deepEqual(replay,pool,'object/role ordering must not change candidate pool');

const changedNarrative=buildTemplateCandidatePool({source:{...source,narrative_plan_id:'c27-c50-other-plan'},context,pool_seed:50,server_pool_policy:poolPolicy,server_auto_policy:autoPolicy,registry});
assert.notEqual(changedNarrative.candidate_pool_id,pool.candidate_pool_id);
assert.notDeepEqual(changedNarrative.candidates.map(item=>item.template_variant.template_variant_id),pool.candidates.map(item=>item.template_variant.template_variant_id));
const changedSeed=buildTemplateCandidatePool({source,context,pool_seed:51,server_pool_policy:poolPolicy,server_auto_policy:autoPolicy,registry});
assert.notEqual(changedSeed.candidate_pool_id,pool.candidate_pool_id);
assert.notDeepEqual(changedSeed.candidates.map(item=>item.template_variant.template_variant_id),pool.candidates.map(item=>item.template_variant.template_variant_id));

const forbiddenKey=/^(?:payload|payload_sha256|scene_program|scene_program_id|delivery_profile|delivery_profile_id|html|css|js|url|uri|path|probe_key|subject_key)$/i;
function walk(value,path='pool'){
  if(Array.isArray(value)){value.forEach((item,index)=>walk(item,`${path}[${index}]`));return;}
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    assert.equal(forbiddenKey.test(key),false,`physical/external field leaked at ${path}.${key}`);
    walk(item,`${path}.${key}`);
  }
}
walk(pool);

assert.throws(()=>buildTemplateCandidatePool({source:{...source,probe_key:'user-controlled'},context,pool_seed:50}),/unsupported fields/);
assert.throws(()=>buildTemplateCandidatePool({source,context:{...context,pool_policy_id:'user-controlled'},pool_seed:50}),/unsupported fields/);
assert.throws(()=>buildTemplateCandidatePool({source,context,pool_seed:50,mode:'legacy'}),/unsupported fields/);
const forgedPolicy={...poolPolicy,policy_id:'nbtpoolpol1_forged'};
assert.equal(validateTemplateCandidatePoolPolicy(forgedPolicy).valid,false);
const forgedPool=structuredClone(pool);forgedPool.candidate_pool_id='nbtpool1_forged';
assert.equal(validateTemplateCandidatePool(forgedPool,{server_pool_policy:poolPolicy,server_auto_policy:autoPolicy,registry}).valid,false);
const forgedCandidate=structuredClone(pool);forgedCandidate.candidates[0].candidate_id='nbtcand1_forged';
assert.equal(validateTemplateCandidatePool(forgedCandidate,{server_pool_policy:poolPolicy,server_auto_policy:autoPolicy,registry}).valid,false);

// Fail closed when a valid server policy asks for more unique candidates than
// the bounded automatic space can produce under the probe budget.
function reidentifyAuto(policy){const next=structuredClone(policy);delete next.policy_id;return {...next,policy_id:`nbtvpol1_${sha256Canonical(next)}`};}
const singleAuto=reidentifyAuto({
  ...autoPolicy,
  visual_systems:[autoPolicy.visual_systems[0]],
  structural_layouts:[autoPolicy.structural_layouts[0]],
  typography:[autoPolicy.typography[0]],
  motion_grammars:[autoPolicy.motion_grammars[0]],
  asset_staging:[autoPolicy.asset_staging[0]],
  graphic_devices:[autoPolicy.graphic_devices[0]],
});
const tinyPolicy={schema:poolPolicy.schema,version:1,algorithm:poolPolicy.algorithm,target_unique_candidates:2,max_probes:8,policy_id:''};
tinyPolicy.policy_id=computeTemplateCandidatePoolPolicyId(tinyPolicy);
assert.throws(()=>buildTemplateCandidatePool({source,context,pool_seed:50,server_pool_policy:tinyPolicy,server_auto_policy:singleAuto,registry}),/uniqueness target unsatisfied/);

console.log(JSON.stringify({
  schema:'c50-template-candidate-pool-acceptance-v1',
  candidate_pool_id:pool.candidate_pool_id,
  source_ref:pool.source_ref,
  registry_id:pool.registry_id,
  auto_policy_id:pool.auto_policy_id,
  pool_policy_id:pool.pool_policy_id,
  target_unique_candidates:pool.target_unique_candidates,
  probe_count:pool.probe_count,
  unique_candidate_ids:new Set(pool.candidates.map(item=>item.candidate_id)).size,
  unique_template_variant_ids:new Set(pool.candidates.map(item=>item.template_variant.template_variant_id)).size,
  deterministic_replay:true,
  input_order_invariant:true,
  raw_source_identity_absent:true,
  physical_surface_absent:true,
  bounded_uniqueness_failure_closed:true,
},null,2));
