#!/usr/bin/env node
import crypto from 'node:crypto';
import { C30_SNAPSHOT_SCHEMA, stableStringify } from './c30-campaign-learning.mjs';

export const C33_POLICY_SCHEMA='framewright-c33-selector-policy-v1';
export const C33_PLAN_SCHEMA='framewright-c33-traffic-plan-v1';
export const C33_ASSIGNMENT_SCHEMA='framewright-c33-assignment-receipt-v1';

function isObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function text(value,label){if(typeof value!=='string'||!value.trim())throw new Error(`${label} must be a non-empty string`);return value.trim();}
function int(value,label,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${label} must be an integer in [${min}, ${max}]`);return value;}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function sortObject(value){
  if(Array.isArray(value))return value.map(sortObject);
  if(isObject(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortObject(value[key])]));
  return value;
}
function armId(experimentId,policyVersion,lane,creativeId){return `c33a1_${sha256(`${experimentId}\u001f${policyVersion}\u001f${lane}\u001f${creativeId}`)}`;}

export function validateSelectorPolicy(policy){
  if(!isObject(policy))throw new Error('selector policy must be an object');
  if(policy.schema!==C33_POLICY_SCHEMA)throw new Error(`wrong selector policy schema: ${policy.schema}`);
  if(policy.metric_weights!==undefined||policy.objective_weights!==undefined||policy.composite_score!==undefined)throw new Error('composite metric weights are forbidden in C33; declare exactly one primary_metric');
  return {
    schema:C33_POLICY_SCHEMA,
    policy_version:text(policy.policy_version,'policy.policy_version'),
    experiment_id:text(policy.experiment_id,'policy.experiment_id'),
    primary_metric:text(policy.primary_metric,'policy.primary_metric'),
    assignment_seed:text(policy.assignment_seed,'policy.assignment_seed'),
    control_creative_id:text(policy.control_creative_id,'policy.control_creative_id'),
    holdout_bps:int(policy.holdout_bps,'policy.holdout_bps',1,9999),
    exploration_bps_per_candidate:int(policy.exploration_bps_per_candidate,'policy.exploration_bps_per_candidate',1,9999),
    exploit_top_k:int(policy.exploit_top_k,'policy.exploit_top_k',1,1000),
    min_primary_denominator:int(policy.min_primary_denominator,'policy.min_primary_denominator',0),
    max_adaptive_bps_per_candidate:int(policy.max_adaptive_bps_per_candidate,'policy.max_adaptive_bps_per_candidate',1,10000)
  };
}

export function validatePriorSnapshot(snapshot,primaryMetric){
  if(!isObject(snapshot)||snapshot.schema!==C30_SNAPSHOT_SCHEMA)throw new Error(`selector requires ${C30_SNAPSHOT_SCHEMA}`);
  const priorSnapshotId=text(snapshot.prior_snapshot_id,'snapshot.prior_snapshot_id');
  const portfolioId=text(snapshot.portfolio_id,'snapshot.portfolio_id');
  if(!Array.isArray(snapshot.candidates)||snapshot.candidates.length<2)throw new Error('selector requires at least two candidates');
  const creativeIds=new Set(),renderSpecIds=new Set();
  const candidates=snapshot.candidates.map((candidate,index)=>{
    if(!isObject(candidate))throw new Error(`snapshot.candidates[${index}] must be an object`);
    const creative_id=text(candidate.creative_id,`candidate[${index}].creative_id`);
    const render_spec_id=text(candidate.render_spec_id,`candidate[${index}].render_spec_id`);
    if(creativeIds.has(creative_id))throw new Error(`duplicate snapshot creative_id ${creative_id}`);
    if(renderSpecIds.has(render_spec_id))throw new Error(`duplicate snapshot render_spec_id ${render_spec_id}`);
    creativeIds.add(creative_id);renderSpecIds.add(render_spec_id);
    const metric=candidate.metrics?.[primaryMetric];
    if(!isObject(metric))throw new Error(`candidate ${creative_id} missing primary metric ${primaryMetric}`);
    const denominator=Number(metric.denominator);
    const posteriorMean=Number(metric.posterior_mean);
    if(!Number.isFinite(denominator)||denominator<0)throw new Error(`candidate ${creative_id} has invalid ${primaryMetric} denominator`);
    if(!Number.isFinite(posteriorMean)||posteriorMean<0||posteriorMean>1)throw new Error(`candidate ${creative_id} has invalid ${primaryMetric} posterior_mean`);
    return {
      creative_id,
      render_spec_id,
      axes:sortObject(candidate.axes||{}),
      primary_metric:{
        name:primaryMetric,
        denominator,
        denominator_kind:metric.denominator_kind??null,
        observation_count:Number(metric.observation_count||0),
        posterior_mean:posteriorMean
      }
    };
  }).sort((a,b)=>a.creative_id.localeCompare(b.creative_id));
  return {prior_snapshot_id:priorSnapshotId,portfolio_id:portfolioId,candidates};
}

function distributeEven(total,targets,allocation,key){
  if(total<0)throw new Error('cannot distribute negative traffic');
  if(!targets.length){if(total!==0)throw new Error('no targets available for non-zero traffic');return;}
  const base=Math.floor(total/targets.length),remainder=total%targets.length;
  for(let i=0;i<targets.length;i++)allocation.get(targets[i].creative_id)[key]+=base+(i<remainder?1:0);
}

export function buildTrafficPlan({snapshot,policy}){
  const p=validateSelectorPolicy(policy);
  const s=validatePriorSnapshot(snapshot,p.primary_metric);
  const control=s.candidates.find(x=>x.creative_id===p.control_creative_id);
  if(!control)throw new Error(`control_creative_id ${p.control_creative_id} is not in snapshot`);
  const n=s.candidates.length;
  if(p.exploit_top_k>n)throw new Error(`exploit_top_k ${p.exploit_top_k} exceeds candidate count ${n}`);
  const explorationTotal=p.exploration_bps_per_candidate*n;
  if(p.holdout_bps+explorationTotal>=10000)throw new Error('holdout + mandatory exploration leaves no bounded exploitation budget');
  if(p.exploration_bps_per_candidate>p.max_adaptive_bps_per_candidate)throw new Error('exploration floor exceeds per-candidate adaptive cap');
  const exploitationTotal=10000-p.holdout_bps-explorationTotal;
  const eligible=s.candidates.filter(x=>x.primary_metric.denominator>=p.min_primary_denominator).sort((a,b)=>
    b.primary_metric.posterior_mean-a.primary_metric.posterior_mean||
    b.primary_metric.denominator-a.primary_metric.denominator||
    a.creative_id.localeCompare(b.creative_id)
  );
  const mode=eligible.length?'adaptive':'explore_only';
  const exploitTargets=eligible.length?eligible.slice(0,Math.min(p.exploit_top_k,eligible.length)):s.candidates;
  const totalExploitCapacity=exploitTargets.reduce((sum)=>sum+(p.max_adaptive_bps_per_candidate-p.exploration_bps_per_candidate),0);
  if(exploitationTotal>totalExploitCapacity)throw new Error(`per-candidate adaptive cap cannot absorb exploitation budget: need ${exploitationTotal}, capacity ${totalExploitCapacity}`);

  const allocation=new Map(s.candidates.map(candidate=>[candidate.creative_id,{holdout_bps:candidate.creative_id===control.creative_id?p.holdout_bps:0,exploration_bps:p.exploration_bps_per_candidate,exploitation_bps:0}]));
  let remaining=exploitationTotal;
  let active=[...exploitTargets];
  while(remaining>0){
    active=active.filter(candidate=>allocation.get(candidate.creative_id).exploration_bps+allocation.get(candidate.creative_id).exploitation_bps<p.max_adaptive_bps_per_candidate);
    if(!active.length)throw new Error('adaptive cap exhausted before traffic allocation completed');
    const share=Math.max(1,Math.floor(remaining/active.length));
    let progressed=0;
    for(const candidate of active){
      if(remaining<=0)break;
      const row=allocation.get(candidate.creative_id);
      const capacity=p.max_adaptive_bps_per_candidate-row.exploration_bps-row.exploitation_bps;
      const give=Math.min(capacity,share,remaining);
      if(give>0){row.exploitation_bps+=give;remaining-=give;progressed+=give;}
    }
    if(progressed===0)throw new Error('traffic allocation made no progress');
  }

  const candidates=s.candidates.map(candidate=>{
    const a=allocation.get(candidate.creative_id);
    const adaptive_bps=a.exploration_bps+a.exploitation_bps;
    const total_bps=a.holdout_bps+adaptive_bps;
    return {
      creative_id:candidate.creative_id,
      render_spec_id:candidate.render_spec_id,
      axes:candidate.axes,
      primary_metric:candidate.primary_metric,
      holdout_bps:a.holdout_bps,
      exploration_bps:a.exploration_bps,
      exploitation_bps:a.exploitation_bps,
      adaptive_bps,
      total_bps,
      arms:{
        holdout:a.holdout_bps?armId(p.experiment_id,p.policy_version,'holdout',candidate.creative_id):null,
        explore:armId(p.experiment_id,p.policy_version,'explore',candidate.creative_id),
        exploit:a.exploitation_bps?armId(p.experiment_id,p.policy_version,'exploit',candidate.creative_id):null
      }
    };
  });
  const totalBps=candidates.reduce((sum,row)=>sum+row.total_bps,0);
  const adaptiveBps=candidates.reduce((sum,row)=>sum+row.adaptive_bps,0);
  if(totalBps!==10000)throw new Error(`traffic plan must sum to 10000 bps, got ${totalBps}`);
  if(adaptiveBps!==10000-p.holdout_bps)throw new Error('adaptive traffic total drift');
  if(candidates.some(row=>row.adaptive_bps>p.max_adaptive_bps_per_candidate))throw new Error('per-candidate adaptive cap violated');
  const body={
    schema:C33_PLAN_SCHEMA,
    experiment_id:p.experiment_id,
    policy_version:p.policy_version,
    prior_snapshot_id:s.prior_snapshot_id,
    portfolio_id:s.portfolio_id,
    primary_metric:p.primary_metric,
    assignment_seed:p.assignment_seed,
    mode,
    control_creative_id:p.control_creative_id,
    holdout_bps:p.holdout_bps,
    exploration_bps_per_candidate:p.exploration_bps_per_candidate,
    exploitation_bps:exploitationTotal,
    exploit_top_k:p.exploit_top_k,
    min_primary_denominator:p.min_primary_denominator,
    max_adaptive_bps_per_candidate:p.max_adaptive_bps_per_candidate,
    exploit_rank:exploitTargets.map(x=>x.creative_id),
    candidates
  };
  return {...body,traffic_plan_id:`c33t1_${sha256(stableStringify(body))}`};
}

function hashUnit(seed){
  const digest=crypto.createHash('sha256').update(seed).digest();
  const n=digest.readBigUInt64BE(0);
  return Number((n*1000000000n)/(1n<<64n))/1000000000;
}
function chooseByBps(rows,bpsField,u,totalBps){
  if(totalBps<=0)throw new Error('cannot choose from zero traffic');
  const point=Math.min(totalBps-1,Math.floor(u*totalBps));
  let cursor=0;
  for(const row of rows){cursor+=row[bpsField];if(point<cursor)return row;}
  throw new Error(`assignment bucket overflow for ${bpsField}`);
}

export function assignTraffic({plan,subject_key}){
  if(!isObject(plan)||plan.schema!==C33_PLAN_SCHEMA)throw new Error('invalid C33 traffic plan');
  const subjectKey=text(subject_key,'subject_key');
  const candidates=[...plan.candidates].sort((a,b)=>a.creative_id.localeCompare(b.creative_id));
  const control=candidates.find(x=>x.creative_id===plan.control_creative_id);
  if(!control)throw new Error('traffic plan control candidate missing');
  const stablePrefix=`${plan.experiment_id}\u001f${plan.policy_version}\u001f${plan.assignment_seed}\u001f${subjectKey}`;
  const holdoutU=hashUnit(`${stablePrefix}\u001fholdout`);
  let lane,selected;
  if(holdoutU<plan.holdout_bps/10000){lane='holdout';selected=control;}
  else{
    const adaptiveTotal=10000-plan.holdout_bps;
    const explorationTotal=candidates.reduce((sum,row)=>sum+row.exploration_bps,0);
    const laneU=hashUnit(`${stablePrefix}\u001flane`);
    const exploreProbability=explorationTotal/adaptiveTotal;
    if(laneU<exploreProbability){
      lane='explore';
      const exploreU=hashUnit(`${stablePrefix}\u001fexplore-candidate`);
      selected=chooseByBps(candidates,'exploration_bps',exploreU,explorationTotal);
    }else{
      lane='exploit';
      const exploitRows=candidates.filter(row=>row.exploitation_bps>0);
      const exploitationTotal=exploitRows.reduce((sum,row)=>sum+row.exploitation_bps,0);
      if(!exploitationTotal)throw new Error('exploit lane selected but plan has zero exploitation traffic');
      const exploitU=hashUnit(`${stablePrefix}\u001fexploit-candidate\u001f${plan.traffic_plan_id}`);
      selected=chooseByBps(exploitRows,'exploitation_bps',exploitU,exploitationTotal);
    }
  }
  const arm_id=selected.arms[lane];
  if(!arm_id)throw new Error(`missing ${lane} arm for ${selected.creative_id}`);
  const body={
    schema:C33_ASSIGNMENT_SCHEMA,
    experiment_id:plan.experiment_id,
    policy_version:plan.policy_version,
    traffic_plan_id:plan.traffic_plan_id,
    prior_snapshot_id:plan.prior_snapshot_id,
    subject_ref:`c33s1_${sha256(`${plan.experiment_id}\u001f${subjectKey}`)}`,
    lane,
    arm_id,
    creative_id:selected.creative_id,
    render_spec_id:selected.render_spec_id
  };
  return {...body,assignment_id:`c33x1_${sha256(stableStringify(body))}`};
}
