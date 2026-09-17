import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  buildCanonicalTemplateVariabilityRegistry,
  buildDefaultTemplateAutoPolicy,
  composeAutomaticTemplateVariant,
  validateTemplateAutoPolicy,
} from './template-variant-composer-v1.mjs';
import {
  TEMPLATE_VARIABILITY_ASPECTS,
  TEMPLATE_VARIABILITY_DURATIONS,
  TEMPLATE_VARIABILITY_ROLES,
  validateTemplateVariantForContext,
} from './template-variability-v1.mjs';

export const TEMPLATE_CANDIDATE_POOL_POLICY_SCHEMA='newboo-template-candidate-pool-policy-v1';
export const TEMPLATE_CANDIDATE_POOL_SCHEMA='newboo-template-candidate-pool-v1';
export const TEMPLATE_CANDIDATE_SOURCE_SCHEMA='newboo-template-candidate-source-v1';
export const TEMPLATE_CANDIDATE_POOL_ALGORITHM='bounded_c43_hash_probe_dedupe_v1';

const POLICY_FIELDS=['schema','version','algorithm','target_unique_candidates','max_probes','policy_id'];
const SOURCE_FIELDS=['book_id','narrative_plan_id'];
const CONTEXT_FIELDS=['aspect','duration_seconds','semantic_roles','available_asset_kinds'];
const BUILD_FIELDS=['source','context','pool_seed','server_pool_policy','server_auto_policy','registry'];
const POOL_FIELDS=['schema','version','candidate_pool_id','source_ref','registry_id','auto_policy_id','pool_policy_id','pool_seed','context','probe_count','target_unique_candidates','candidates'];
const CANDIDATE_FIELDS=['candidate_id','template_variant'];

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function assert(condition,message){if(!condition)throw new Error(message);}
function exactKeys(value,allowed,label){
  assert(isObject(value),`${label} must be an object`);
  const unknown=Object.keys(value).filter(key=>!allowed.includes(key));
  assert(unknown.length===0,`${label} contains unsupported fields: ${unknown.sort().join(', ')}`);
}
function sortedStrings(values){return [...values].map(String).sort((a,b)=>a.localeCompare(b));}
function duplicateValues(values){const seen=new Set(),duplicates=new Set();for(const value of values){if(seen.has(value))duplicates.add(value);seen.add(value);}return [...duplicates].sort();}

function normalizeContext(context){
  exactKeys(context,CONTEXT_FIELDS,'template candidate context');
  assert(TEMPLATE_VARIABILITY_ASPECTS.includes(context.aspect),`unsupported candidate-pool aspect ${context.aspect}`);
  assert(TEMPLATE_VARIABILITY_DURATIONS.includes(context.duration_seconds),`unsupported candidate-pool duration ${context.duration_seconds}`);
  assert(Array.isArray(context.semantic_roles)&&context.semantic_roles.length>0,'candidate-pool semantic_roles must be non-empty');
  assert(context.semantic_roles.every(role=>TEMPLATE_VARIABILITY_ROLES.includes(role)),'candidate-pool semantic_roles contain unsupported role');
  assert(duplicateValues(context.semantic_roles).length===0,'candidate-pool semantic_roles contain duplicates');
  assert(Array.isArray(context.available_asset_kinds)&&context.available_asset_kinds.length>0,'candidate-pool available_asset_kinds must be non-empty');
  assert(context.available_asset_kinds.every(kind=>typeof kind==='string'&&kind.length>0),'candidate-pool available_asset_kinds must contain non-empty strings');
  assert(duplicateValues(context.available_asset_kinds).length===0,'candidate-pool available_asset_kinds contain duplicates');
  return {
    aspect:context.aspect,
    duration_seconds:context.duration_seconds,
    semantic_roles:sortedStrings(context.semantic_roles),
    available_asset_kinds:sortedStrings(context.available_asset_kinds),
  };
}

function normalizeSource(source){
  exactKeys(source,SOURCE_FIELDS,'template candidate source');
  assert(typeof source.book_id==='string'&&source.book_id.length>0,'source.book_id required');
  assert(typeof source.narrative_plan_id==='string'&&source.narrative_plan_id.length>0,'source.narrative_plan_id required');
  return {book_id:source.book_id,narrative_plan_id:source.narrative_plan_id};
}

export function computeTemplateCandidateSourceRef(source){
  const normalized=normalizeSource(source);
  return `nbtsrc1_${sha256Canonical({schema:TEMPLATE_CANDIDATE_SOURCE_SCHEMA,...normalized})}`;
}

function policyProjection(policy){
  return {
    schema:TEMPLATE_CANDIDATE_POOL_POLICY_SCHEMA,
    version:policy.version,
    algorithm:policy.algorithm,
    target_unique_candidates:policy.target_unique_candidates,
    max_probes:policy.max_probes,
  };
}
export function computeTemplateCandidatePoolPolicyId(policy){return `nbtpoolpol1_${sha256Canonical(policyProjection(policy))}`;}

export function buildDefaultTemplateCandidatePoolPolicy(){
  const policy={
    schema:TEMPLATE_CANDIDATE_POOL_POLICY_SCHEMA,
    version:1,
    algorithm:TEMPLATE_CANDIDATE_POOL_ALGORITHM,
    target_unique_candidates:1024,
    max_probes:4096,
  };
  policy.policy_id=computeTemplateCandidatePoolPolicyId(policy);
  return policy;
}

export function validateTemplateCandidatePoolPolicy(policy){
  const errors=[];
  try{
    exactKeys(policy,POLICY_FIELDS,'template candidate pool policy');
    assert(policy.schema===TEMPLATE_CANDIDATE_POOL_POLICY_SCHEMA,`policy schema must be ${TEMPLATE_CANDIDATE_POOL_POLICY_SCHEMA}`);
    assert(policy.version===1,'candidate-pool policy version must be 1');
    assert(policy.algorithm===TEMPLATE_CANDIDATE_POOL_ALGORITHM,`candidate-pool algorithm must be ${TEMPLATE_CANDIDATE_POOL_ALGORITHM}`);
    assert(Number.isInteger(policy.target_unique_candidates)&&policy.target_unique_candidates>=1&&policy.target_unique_candidates<=4096,'target_unique_candidates must be integer 1..4096');
    assert(Number.isInteger(policy.max_probes)&&policy.max_probes>=policy.target_unique_candidates&&policy.max_probes<=65536,'max_probes must be integer >= target_unique_candidates and <=65536');
    assert(policy.policy_id===computeTemplateCandidatePoolPolicyId(policy),'candidate-pool policy_id mismatch');
  }catch(error){errors.push(String(error.message||error));}
  return {valid:errors.length===0,errors};
}

function computeCandidateId({source_ref,registry_id,auto_policy_id,pool_policy_id,pool_seed,template_variant_id}){
  return `nbtcand1_${sha256Canonical({source_ref,registry_id,auto_policy_id,pool_policy_id,pool_seed,template_variant_id})}`;
}
function poolIdentityProjection(pool){
  return {
    schema:TEMPLATE_CANDIDATE_POOL_SCHEMA,
    version:pool.version,
    source_ref:pool.source_ref,
    registry_id:pool.registry_id,
    auto_policy_id:pool.auto_policy_id,
    pool_policy_id:pool.pool_policy_id,
    pool_seed:pool.pool_seed,
    context:pool.context,
    probe_count:pool.probe_count,
    target_unique_candidates:pool.target_unique_candidates,
    candidates:pool.candidates.map(candidate=>({candidate_id:candidate.candidate_id,template_variant_id:candidate.template_variant.template_variant_id})),
  };
}
export function computeTemplateCandidatePoolId(pool){return `nbtpool1_${sha256Canonical(poolIdentityProjection(pool))}`;}

export function buildTemplateCandidatePool(options){
  exactKeys(options,BUILD_FIELDS,'template candidate pool build options');
  const source=normalizeSource(options.source);
  const context=normalizeContext(options.context);
  const poolSeed=options.pool_seed??0;
  assert(Number.isInteger(poolSeed),'pool_seed must be an integer');
  const registry=options.registry??buildCanonicalTemplateVariabilityRegistry();
  const autoPolicy=options.server_auto_policy??buildDefaultTemplateAutoPolicy();
  const poolPolicy=options.server_pool_policy??buildDefaultTemplateCandidatePoolPolicy();
  const autoReport=validateTemplateAutoPolicy(autoPolicy,registry);
  assert(autoReport.valid,`server auto policy rejected: ${JSON.stringify(autoReport.errors)}`);
  const poolPolicyReport=validateTemplateCandidatePoolPolicy(poolPolicy);
  assert(poolPolicyReport.valid,`server candidate-pool policy rejected: ${JSON.stringify(poolPolicyReport.errors)}`);
  const sourceRef=computeTemplateCandidateSourceRef(source);
  const byVariant=new Map();
  let probeCount=0;
  for(let ordinal=0;ordinal<poolPolicy.max_probes&&byVariant.size<poolPolicy.target_unique_candidates;ordinal+=1){
    probeCount+=1;
    const probeKey=`${TEMPLATE_CANDIDATE_POOL_ALGORITHM}:${sourceRef}:${poolPolicy.policy_id}:${poolSeed}:${ordinal}`;
    const receipt=composeAutomaticTemplateVariant({subject_key:probeKey,seed:poolSeed,context,policy:autoPolicy,registry});
    const variant=receipt.template_variant;
    if(!byVariant.has(variant.template_variant_id)){
      byVariant.set(variant.template_variant_id,{
        candidate_id:computeCandidateId({source_ref:sourceRef,registry_id:registry.registry_id,auto_policy_id:autoPolicy.policy_id,pool_policy_id:poolPolicy.policy_id,pool_seed:poolSeed,template_variant_id:variant.template_variant_id}),
        template_variant:variant,
      });
    }
  }
  assert(byVariant.size===poolPolicy.target_unique_candidates,`candidate-pool uniqueness target unsatisfied: ${byVariant.size}/${poolPolicy.target_unique_candidates} unique after ${probeCount}/${poolPolicy.max_probes} probes`);
  const candidates=[...byVariant.values()].sort((a,b)=>a.candidate_id.localeCompare(b.candidate_id));
  const pool={
    schema:TEMPLATE_CANDIDATE_POOL_SCHEMA,
    version:1,
    candidate_pool_id:'',
    source_ref:sourceRef,
    registry_id:registry.registry_id,
    auto_policy_id:autoPolicy.policy_id,
    pool_policy_id:poolPolicy.policy_id,
    pool_seed:poolSeed,
    context,
    probe_count:probeCount,
    target_unique_candidates:poolPolicy.target_unique_candidates,
    candidates,
  };
  pool.candidate_pool_id=computeTemplateCandidatePoolId(pool);
  return pool;
}

export function validateTemplateCandidatePool(pool,{server_pool_policy=buildDefaultTemplateCandidatePoolPolicy(),server_auto_policy=buildDefaultTemplateAutoPolicy(),registry=buildCanonicalTemplateVariabilityRegistry()}={}){
  const errors=[];
  try{
    exactKeys(pool,POOL_FIELDS,'template candidate pool');
    assert(pool.schema===TEMPLATE_CANDIDATE_POOL_SCHEMA,`candidate-pool schema must be ${TEMPLATE_CANDIDATE_POOL_SCHEMA}`);
    assert(pool.version===1,'candidate-pool version must be 1');
    const poolPolicyReport=validateTemplateCandidatePoolPolicy(server_pool_policy);
    assert(poolPolicyReport.valid,`server candidate-pool policy rejected: ${JSON.stringify(poolPolicyReport.errors)}`);
    const autoReport=validateTemplateAutoPolicy(server_auto_policy,registry);
    assert(autoReport.valid,`server auto policy rejected: ${JSON.stringify(autoReport.errors)}`);
    assert(pool.registry_id===registry.registry_id,'candidate-pool registry_id mismatch');
    assert(pool.auto_policy_id===server_auto_policy.policy_id,'candidate-pool auto_policy_id mismatch');
    assert(pool.pool_policy_id===server_pool_policy.policy_id,'candidate-pool pool_policy_id mismatch');
    assert(typeof pool.source_ref==='string'&&/^nbtsrc1_[a-f0-9]{64}$/.test(pool.source_ref),'candidate-pool source_ref invalid');
    assert(Number.isInteger(pool.pool_seed),'candidate-pool pool_seed must be integer');
    const context=normalizeContext(pool.context);
    assert(JSON.stringify(context)===JSON.stringify(pool.context),'candidate-pool context must be normalized');
    assert(Number.isInteger(pool.probe_count)&&pool.probe_count>=pool.target_unique_candidates&&pool.probe_count<=server_pool_policy.max_probes,'candidate-pool probe_count outside policy bounds');
    assert(pool.target_unique_candidates===server_pool_policy.target_unique_candidates,'candidate-pool target_unique_candidates mismatch');
    assert(Array.isArray(pool.candidates)&&pool.candidates.length===pool.target_unique_candidates,'candidate-pool candidate count mismatch');
    assert(new Set(pool.candidates.map(candidate=>candidate.candidate_id)).size===pool.candidates.length,'candidate-pool candidate_id values must be unique');
    assert(new Set(pool.candidates.map(candidate=>candidate.template_variant?.template_variant_id)).size===pool.candidates.length,'candidate-pool template_variant_id values must be unique');
    assert(JSON.stringify(pool.candidates.map(candidate=>candidate.candidate_id))===JSON.stringify(sortedStrings(pool.candidates.map(candidate=>candidate.candidate_id))),'candidate-pool candidates must be sorted by candidate_id');
    for(const [index,candidate] of pool.candidates.entries()){
      exactKeys(candidate,CANDIDATE_FIELDS,`candidate-pool candidates[${index}]`);
      const report=validateTemplateVariantForContext(registry,candidate.template_variant,context);
      assert(report.valid,`candidate-pool candidates[${index}] template variant rejected: ${JSON.stringify(report.errors)}`);
      const expected=computeCandidateId({source_ref:pool.source_ref,registry_id:pool.registry_id,auto_policy_id:pool.auto_policy_id,pool_policy_id:pool.pool_policy_id,pool_seed:pool.pool_seed,template_variant_id:candidate.template_variant.template_variant_id});
      assert(candidate.candidate_id===expected,`candidate-pool candidates[${index}] candidate_id mismatch`);
    }
    assert(pool.candidate_pool_id===computeTemplateCandidatePoolId(pool),'candidate_pool_id mismatch');
  }catch(error){errors.push(String(error.message||error));}
  return {valid:errors.length===0,errors};
}
