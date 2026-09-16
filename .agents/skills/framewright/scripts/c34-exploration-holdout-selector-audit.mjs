#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  C30_EVIDENCE_SCHEMA,
  C30_POLICY_SCHEMA,
  buildSelectorPriorSnapshot,
  stableStringify
} from './c30-campaign-learning.mjs';
import {
  C34_POLICY_SCHEMA,
  C34_PLAN_SCHEMA,
  C34_ASSIGNMENT_SCHEMA,
  buildTrafficPlan,
  assignTraffic
} from './c34-exploration-holdout-selector.mjs';

const outDir=path.resolve(process.argv[2]||'artifacts/c34');
fs.mkdirSync(outDir,{recursive:true});
const clone=value=>JSON.parse(JSON.stringify(value));
const mustThrow=(label,fn,needle)=>{
  let message='';
  try{fn();}catch(error){message=String(error?.message||error);}
  if(!message)throw new Error(`${label}: expected rejection`);
  if(needle&&!message.includes(needle))throw new Error(`${label}: wrong rejection: ${message}`);
  return message;
};

const portfolio={
  portfolio_id:'portfolio-c34-audit',
  candidates:Array.from({length:6},(_,i)=>({
    creative_id:`creative-${i+1}`,
    render_spec_id:`render-${i+1}`,
    axes:{angle:['premise','conflict','identity'][i%3],hook:`h${1+(i%2)}`}
  }))
};
const learningPolicy={
  schema:C30_POLICY_SCHEMA,
  policy_version:'c30-learning-c34-audit-v1',
  metric_priors:{downstream_open:{alpha:1,beta:19}}
};
function obs(id,creativeId,renderSpecId,numerator,denominator){return {
  observation_id:id,
  source:{platform:'fixture-shorts',export_id:'fixture-export'},
  campaign_id:'campaign-c34',
  placement_id:'feed',
  creative_id:creativeId,
  render_spec_id:renderSpecId,
  window_start:'2026-09-01T00:00:00Z',
  window_end:'2026-09-08T00:00:00Z',
  metrics:{downstream_open:{numerator,denominator,denominator_kind:'views'}}
};}
function snapshot(batchId,counts){
  return buildSelectorPriorSnapshot({
    portfolio,
    policy:learningPolicy,
    evidence:{
      schema:C30_EVIDENCE_SCHEMA,
      evidence_batch_id:batchId,
      observations:counts.map(([num,den],i)=>obs(`obs-${batchId}-${i+1}`,`creative-${i+1}`,`render-${i+1}`,num,den))
    }
  });
}

const snapshotA=snapshot('batch-a',[[20,1000],[40,1000],[35,1000],[25,1000],[2,50],[1,20]]);
const snapshotB=snapshot('batch-b',[[18,1000],[32,1000],[14,1000],[55,1000],[2,50],[1,20]]);
const snapshotCold=snapshot('batch-cold',[[1,20],[1,20],[1,20],[1,20],[1,20],[1,20]]);
const selectorPolicy={
  schema:C34_POLICY_SCHEMA,
  policy_version:'c34-selector-v1',
  experiment_id:'exp-c34-audit',
  primary_metric:'downstream_open',
  assignment_seed:'selector-seed-3401',
  control_creative_id:'creative-1',
  holdout_bps:2000,
  exploration_bps_per_candidate:500,
  exploit_top_k:2,
  min_primary_denominator:100,
  max_adaptive_bps_per_candidate:3500
};

const planA=buildTrafficPlan({snapshot:snapshotA,policy:selectorPolicy});
const planAReordered=buildTrafficPlan({snapshot:{...snapshotA,candidates:[...snapshotA.candidates].reverse()},policy:clone(selectorPolicy)});
const planB=buildTrafficPlan({snapshot:snapshotB,policy:selectorPolicy});
const coldPlan=buildTrafficPlan({snapshot:snapshotCold,policy:selectorPolicy});
if(planA.schema!==C34_PLAN_SCHEMA)throw new Error('wrong C34 plan schema');
if(stableStringify(planA)!==stableStringify(planAReordered))throw new Error('candidate order changed canonical traffic plan');
if(stableStringify(planA.exploit_rank)!==stableStringify(['creative-2','creative-3']))throw new Error(`unexpected plan A exploit rank: ${JSON.stringify(planA.exploit_rank)}`);
if(stableStringify(planB.exploit_rank)!==stableStringify(['creative-4','creative-2']))throw new Error(`unexpected plan B exploit rank: ${JSON.stringify(planB.exploit_rank)}`);
if(planA.candidates.reduce((s,x)=>s+x.total_bps,0)!==10000)throw new Error('plan A traffic does not sum to 10000 bps');
if(planA.candidates.some(x=>x.exploration_bps<selectorPolicy.exploration_bps_per_candidate))throw new Error('mandatory exploration floor violated');
if(planA.candidates.some(x=>x.adaptive_bps>selectorPolicy.max_adaptive_bps_per_candidate))throw new Error('adaptive candidate cap violated');
if(planA.candidates.find(x=>x.creative_id==='creative-5').exploitation_bps!==0||planA.candidates.find(x=>x.creative_id==='creative-6').exploitation_bps!==0)throw new Error('cold candidates entered exploitation');
if(coldPlan.mode!=='explore_only'||coldPlan.exploitation_bps!==0||coldPlan.exploit_rank.length!==0)throw new Error('cold-start plan was not purely exploratory');
if(coldPlan.exploration_bps!==8000)throw new Error(`cold-start adaptive exploration should be 8000 bps, got ${coldPlan.exploration_bps}`);

const laneCountsA={holdout:0,explore:0,exploit:0},laneCountsB={holdout:0,explore:0,exploit:0},laneCountsCold={holdout:0,explore:0,exploit:0};
let stableHoldoutMembership=0,stableExploreMembership=0,stableExploreCreative=0,changedExploitCreative=0;
const subjectCount=10000;
for(let i=0;i<subjectCount;i++){
  const subject=`opaque-subject-${String(i).padStart(5,'0')}`;
  const a=assignTraffic({plan:planA,subject_key:subject});
  const b=assignTraffic({plan:planB,subject_key:subject});
  const c=assignTraffic({plan:coldPlan,subject_key:subject});
  if(a.schema!==C34_ASSIGNMENT_SCHEMA||b.schema!==C34_ASSIGNMENT_SCHEMA||c.schema!==C34_ASSIGNMENT_SCHEMA)throw new Error('wrong assignment schema');
  laneCountsA[a.lane]++;laneCountsB[b.lane]++;laneCountsCold[c.lane]++;
  const ah=a.lane==='holdout',bh=b.lane==='holdout';
  if(ah===bh)stableHoldoutMembership++;else throw new Error(`holdout membership changed after priors update for ${subject}`);
  const ae=a.lane==='explore',be=b.lane==='explore';
  if(ae===be)stableExploreMembership++;else throw new Error(`explore cohort membership changed after priors update for ${subject}`);
  if(ae&&be){if(a.creative_id!==b.creative_id)throw new Error(`exploration candidate changed after priors update for ${subject}`);stableExploreCreative++;}
  if(a.lane==='exploit'&&b.lane==='exploit'&&a.creative_id!==b.creative_id)changedExploitCreative++;
  if(a.lane==='holdout'&&a.creative_id!==selectorPolicy.control_creative_id)throw new Error('holdout assigned outside frozen control');
  if(c.lane==='exploit')throw new Error('cold-start assignment emitted exploit lane');
  if(a.subject_ref.includes(subject)||b.subject_ref.includes(subject)||c.subject_ref.includes(subject))throw new Error('raw subject key leaked into assignment receipt');
}
if(changedExploitCreative===0)throw new Error('updated priors did not change any exploitation assignment in audit population');
const holdoutRate=laneCountsA.holdout/subjectCount,exploreRate=laneCountsA.explore/subjectCount,exploitRate=laneCountsA.exploit/subjectCount;
if(Math.abs(holdoutRate-.20)>.025)throw new Error(`holdout empirical rate drift ${holdoutRate}`);
if(Math.abs(exploreRate-.30)>.03)throw new Error(`explore empirical rate drift ${exploreRate}`);
if(Math.abs(exploitRate-.50)>.03)throw new Error(`exploit empirical rate drift ${exploitRate}`);

const rejected={};
rejected.composite_metric=mustThrow('composite metric',()=>buildTrafficPlan({snapshot:snapshotA,policy:{...selectorPolicy,metric_weights:{hold_3s:.5,downstream_open:.5}}}),'composite metric weights are forbidden');
const missingMetric=clone(snapshotA);delete missingMetric.candidates[0].metrics.downstream_open;
rejected.missing_primary_metric=mustThrow('missing primary metric',()=>buildTrafficPlan({snapshot:missingMetric,policy:selectorPolicy}),'missing primary metric');
rejected.unknown_control=mustThrow('unknown control',()=>buildTrafficPlan({snapshot:snapshotA,policy:{...selectorPolicy,control_creative_id:'creative-missing'}}),'is not in snapshot');
rejected.overbudget=mustThrow('overbudget',()=>buildTrafficPlan({snapshot:snapshotA,policy:{...selectorPolicy,exploration_bps_per_candidate:1400}}),'leaves no bounded adaptive budget');
rejected.cap_insufficient=mustThrow('cap insufficient',()=>buildTrafficPlan({snapshot:snapshotA,policy:{...selectorPolicy,max_adaptive_bps_per_candidate:1000}}),'cannot absorb exploitation budget');
rejected.top_k_too_large=mustThrow('top k too large',()=>buildTrafficPlan({snapshot:snapshotA,policy:{...selectorPolicy,exploit_top_k:7}}),'exceeds candidate count');
rejected.empty_subject=mustThrow('empty subject',()=>assignTraffic({plan:planA,subject_key:'   '}),'subject_key');

const gates={
  deterministic_plan_replay:stableStringify(planA)===stableStringify(planAReordered),
  explicit_single_primary_metric:planA.primary_metric==='downstream_open',
  fixed_holdout:planA.holdout_bps===2000&&planA.candidates.filter(x=>x.holdout_bps>0).length===1,
  mandatory_exploration_floor:planA.candidates.every(x=>x.exploration_bps>=500),
  cold_candidates_not_exploited:['creative-5','creative-6'].every(id=>planA.candidates.find(x=>x.creative_id===id).exploitation_bps===0),
  adaptive_cap_enforced:planA.candidates.every(x=>x.adaptive_bps<=3500),
  cold_start_is_explore_only:coldPlan.mode==='explore_only'&&coldPlan.exploitation_bps===0&&laneCountsCold.exploit===0,
  holdout_membership_stable_across_prior_update:stableHoldoutMembership===subjectCount,
  exploration_membership_stable_across_prior_update:stableExploreMembership===subjectCount,
  exploration_candidate_stable_across_prior_update:stableExploreCreative===laneCountsA.explore,
  exploitation_can_change_with_priors:changedExploitCreative>0,
  raw_subject_key_not_persisted:true,
  all_negative_cases_rejected:Object.keys(rejected).length===7
};
if(!Object.values(gates).every(Boolean))throw new Error(`C34 audit gate failed: ${JSON.stringify(gates)}`);
const report={
  schema:'framewright-c34-exploration-holdout-selector-audit-v1',
  boundary:'synthetic assignment population; validates selector mechanics only, not campaign lift or causal effect',
  gates,
  policy:selectorPolicy,
  planA,
  planB,
  coldPlan,
  assignmentAudit:{subjectCount,laneCountsA,laneCountsB,laneCountsCold,holdoutRate,exploreRate,exploitRate,changedExploitCreative},
  rejected
};
fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2)+'\n');
const summary=`# C34 exploration/holdout selector audit\n\n`+
`Synthetic opaque subjects: **${subjectCount}**. Candidates: **${portfolio.candidates.length}**. Primary metric: **downstream_open**.\n\n`+
`PASS: fixed 20% control holdout, mandatory exploration floor, denominator eligibility before exploitation, per-candidate adaptive cap, cold-start explore-only behavior, deterministic replay, stable holdout/exploration cohorts across a prior update, and exploitation movement only inside the adaptive lane.\n\n`+
`Observed synthetic assignment mix: holdout ${(100*holdoutRate).toFixed(2)}%, explore ${(100*exploreRate).toFixed(2)}%, exploit ${(100*exploitRate).toFixed(2)}%.\n\n`+
`Boundary: this is selector-contract evidence only. It does not claim that downstream_open is the final business objective, that these traffic shares are optimal, or that any creative is better. Real platform delivery/export data is still required.\n`;
fs.writeFileSync(path.join(outDir,'summary.md'),summary);
console.log(summary);
console.log(JSON.stringify({gates,traffic_plan_id:planA.traffic_plan_id,updated_traffic_plan_id:planB.traffic_plan_id,cold_traffic_plan_id:coldPlan.traffic_plan_id},null,2));
