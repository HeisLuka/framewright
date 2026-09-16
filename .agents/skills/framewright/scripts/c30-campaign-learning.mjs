#!/usr/bin/env node
import crypto from 'node:crypto';

export const C30_EVIDENCE_SCHEMA='framewright-c30-campaign-evidence-v1';
export const C30_POLICY_SCHEMA='framewright-c30-learning-policy-v1';
export const C30_SNAPSHOT_SCHEMA='framewright-c30-selector-prior-snapshot-v1';

function isObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function finiteNonNegative(value,label){
  if(!Number.isFinite(value)||value<0)throw new Error(`${label} must be finite and >= 0`);
  return value;
}
function nonEmpty(value,label){
  if(typeof value!=='string'||!value.trim())throw new Error(`${label} must be a non-empty string`);
  return value;
}
function sortValue(value){
  if(Array.isArray(value))return value.map(sortValue);
  if(isObject(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortValue(value[key])]));
  return value;
}
export function stableStringify(value){return JSON.stringify(sortValue(value));}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function clone(value){return JSON.parse(JSON.stringify(value));}

export function validateLearningPolicy(policy){
  if(!isObject(policy))throw new Error('policy must be an object');
  if(policy.schema!==C30_POLICY_SCHEMA)throw new Error(`wrong policy schema: ${policy.schema}`);
  nonEmpty(policy.policy_version,'policy.policy_version');
  if(!isObject(policy.metric_priors)||Object.keys(policy.metric_priors).length===0)throw new Error('policy.metric_priors must be a non-empty object');
  const normalized={};
  for(const metric of Object.keys(policy.metric_priors).sort()){
    const prior=policy.metric_priors[metric];
    if(!isObject(prior))throw new Error(`metric prior ${metric} must be an object`);
    const alpha=finiteNonNegative(prior.alpha,`${metric}.alpha`),beta=finiteNonNegative(prior.beta,`${metric}.beta`);
    if(alpha<=0||beta<=0)throw new Error(`${metric} alpha/beta must be > 0`);
    normalized[metric]={alpha,beta};
  }
  return {schema:C30_POLICY_SCHEMA,policy_version:policy.policy_version,metric_priors:normalized};
}

function normalizeMetric(name,metric){
  if(!isObject(metric))throw new Error(`metric ${name} must be an object`);
  const numerator=finiteNonNegative(metric.numerator,`${name}.numerator`);
  const denominator=finiteNonNegative(metric.denominator,`${name}.denominator`);
  if(denominator===0&&numerator!==0)throw new Error(`${name}: numerator cannot be non-zero when denominator is zero`);
  if(numerator>denominator)throw new Error(`${name}: numerator cannot exceed denominator for rate evidence`);
  return {
    numerator,
    denominator,
    denominator_kind:nonEmpty(metric.denominator_kind,`${name}.denominator_kind`)
  };
}

function normalizeObservation(observation,knownCreativeIds,knownRenderSpecIds){
  if(!isObject(observation))throw new Error('observation must be an object');
  const creative_id=nonEmpty(observation.creative_id,'observation.creative_id');
  const render_spec_id=nonEmpty(observation.render_spec_id,'observation.render_spec_id');
  if(!knownCreativeIds.has(creative_id))throw new Error(`unknown creative_id ${creative_id}`);
  if(!knownRenderSpecIds.has(render_spec_id))throw new Error(`unknown render_spec_id ${render_spec_id}`);
  const window_start=nonEmpty(observation.window_start,'observation.window_start');
  const window_end=nonEmpty(observation.window_end,'observation.window_end');
  const startMs=Date.parse(window_start),endMs=Date.parse(window_end);
  if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs)throw new Error(`invalid observation window ${window_start}..${window_end}`);
  if(!isObject(observation.metrics)||Object.keys(observation.metrics).length===0)throw new Error(`observation ${observation.observation_id} has no metrics`);
  const metrics={};
  for(const name of Object.keys(observation.metrics).sort())metrics[name]=normalizeMetric(name,observation.metrics[name]);
  return {
    observation_id:nonEmpty(observation.observation_id,'observation.observation_id'),
    source:{
      platform:nonEmpty(observation.source?.platform,'observation.source.platform'),
      export_id:nonEmpty(observation.source?.export_id,'observation.source.export_id')
    },
    campaign_id:nonEmpty(observation.campaign_id,'observation.campaign_id'),
    placement_id:nonEmpty(observation.placement_id,'observation.placement_id'),
    creative_id,
    render_spec_id,
    window_start:new Date(startMs).toISOString(),
    window_end:new Date(endMs).toISOString(),
    metrics
  };
}

export function canonicalizeEvidence({portfolio,evidence}){
  if(!isObject(portfolio)||!Array.isArray(portfolio.candidates)||portfolio.candidates.length===0)throw new Error('portfolio.candidates must be non-empty');
  const candidates=portfolio.candidates.map(candidate=>{
    if(!isObject(candidate))throw new Error('candidate must be an object');
    const creative_id=nonEmpty(candidate.creative_id,'candidate.creative_id');
    const render_spec_id=nonEmpty(candidate.render_spec_id,'candidate.render_spec_id');
    return {creative_id,render_spec_id,axes:sortValue(clone(candidate.axes||{}))};
  }).sort((a,b)=>a.creative_id.localeCompare(b.creative_id)||a.render_spec_id.localeCompare(b.render_spec_id));
  const creativeIds=new Set(),renderSpecIds=new Set();
  for(const candidate of candidates){
    if(creativeIds.has(candidate.creative_id))throw new Error(`duplicate portfolio creative_id ${candidate.creative_id}`);
    if(renderSpecIds.has(candidate.render_spec_id))throw new Error(`duplicate portfolio render_spec_id ${candidate.render_spec_id}`);
    creativeIds.add(candidate.creative_id);renderSpecIds.add(candidate.render_spec_id);
  }
  if(!isObject(evidence)||evidence.schema!==C30_EVIDENCE_SCHEMA||!Array.isArray(evidence.observations))throw new Error('invalid evidence batch');
  const observations=evidence.observations.map(x=>normalizeObservation(x,creativeIds,renderSpecIds)).sort((a,b)=>a.observation_id.localeCompare(b.observation_id));
  const seen=new Set();
  for(const observation of observations){if(seen.has(observation.observation_id))throw new Error(`duplicate observation_id ${observation.observation_id}`);seen.add(observation.observation_id);}
  return {
    portfolio:{portfolio_id:nonEmpty(portfolio.portfolio_id,'portfolio.portfolio_id'),candidates},
    evidence:{schema:C30_EVIDENCE_SCHEMA,evidence_batch_id:nonEmpty(evidence.evidence_batch_id,'evidence.evidence_batch_id'),observations}
  };
}

export function buildSelectorPriorSnapshot({portfolio,evidence,policy}){
  const normalizedPolicy=validateLearningPolicy(policy);
  const canonical=canonicalizeEvidence({portfolio,evidence});
  const byCreative=new Map(canonical.portfolio.candidates.map(candidate=>[candidate.creative_id,new Map()]));
  const denominatorKinds=new Map();
  for(const observation of canonical.evidence.observations){
    const metricMap=byCreative.get(observation.creative_id);
    for(const [metricName,metric] of Object.entries(observation.metrics)){
      if(!normalizedPolicy.metric_priors[metricName])continue;
      const denominatorKey=`${observation.creative_id}/${metricName}`;
      const knownKind=denominatorKinds.get(denominatorKey);
      if(knownKind&&knownKind!==metric.denominator_kind)throw new Error(`denominator kind drift for ${denominatorKey}: ${knownKind} vs ${metric.denominator_kind}`);
      denominatorKinds.set(denominatorKey,metric.denominator_kind);
      const current=metricMap.get(metricName)||{numerator:0,denominator:0,denominator_kind:metric.denominator_kind,observation_count:0};
      current.numerator+=metric.numerator;current.denominator+=metric.denominator;current.observation_count+=1;
      metricMap.set(metricName,current);
    }
  }
  const candidates=canonical.portfolio.candidates.map(candidate=>{
    const metricMap=byCreative.get(candidate.creative_id),metrics={};
    for(const metricName of Object.keys(normalizedPolicy.metric_priors).sort()){
      const prior=normalizedPolicy.metric_priors[metricName],observed=metricMap.get(metricName)||{numerator:0,denominator:0,denominator_kind:null,observation_count:0};
      const posteriorAlpha=prior.alpha+observed.numerator;
      const posteriorBeta=prior.beta+Math.max(0,observed.denominator-observed.numerator);
      metrics[metricName]={
        denominator_kind:observed.denominator_kind,
        numerator:observed.numerator,
        denominator:observed.denominator,
        observation_count:observed.observation_count,
        observed_rate:observed.denominator?observed.numerator/observed.denominator:null,
        prior_alpha:prior.alpha,
        prior_beta:prior.beta,
        posterior_alpha:posteriorAlpha,
        posterior_beta:posteriorBeta,
        posterior_mean:posteriorAlpha/(posteriorAlpha+posteriorBeta)
      };
    }
    return {...candidate,metrics};
  });
  const body={
    schema:C30_SNAPSHOT_SCHEMA,
    policy_version:normalizedPolicy.policy_version,
    portfolio_id:canonical.portfolio.portfolio_id,
    evidence_batch_id:canonical.evidence.evidence_batch_id,
    observation_ids:canonical.evidence.observations.map(x=>x.observation_id),
    candidates
  };
  const prior_snapshot_id=`c30p1_${sha256(stableStringify(body))}`;
  return {...body,prior_snapshot_id};
}

export function assertRendererIdentityUnchanged(beforePortfolio,afterPortfolio){
  const before=beforePortfolio.candidates.map(x=>({creative_id:x.creative_id,render_spec_id:x.render_spec_id})).sort((a,b)=>a.creative_id.localeCompare(b.creative_id));
  const after=afterPortfolio.candidates.map(x=>({creative_id:x.creative_id,render_spec_id:x.render_spec_id})).sort((a,b)=>a.creative_id.localeCompare(b.creative_id));
  if(stableStringify(before)!==stableStringify(after))throw new Error('campaign learning mutated creative/render identity');
  return true;
}
