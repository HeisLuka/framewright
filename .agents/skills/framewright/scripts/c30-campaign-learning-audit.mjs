#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  C30_EVIDENCE_SCHEMA,
  C30_POLICY_SCHEMA,
  buildSelectorPriorSnapshot,
  assertRendererIdentityUnchanged,
  stableStringify
} from './c30-campaign-learning.mjs';

const portfolio={
  portfolio_id:'c29-controlled-portfolio-fixture-v1',
  candidates:[
    {creative_id:'nvc1_premise_h1',render_spec_id:'nvr1_premise_h1_reels',axes:{angle:'premise',hook:'h1',reveal:'mid'}},
    {creative_id:'nvc1_premise_h2',render_spec_id:'nvr1_premise_h2_reels',axes:{angle:'premise',hook:'h2',reveal:'mid'}},
    {creative_id:'nvc1_conflict_h1',render_spec_id:'nvr1_conflict_h1_reels',axes:{angle:'conflict',hook:'h1',reveal:'late'}},
    {creative_id:'nvc1_conflict_h2',render_spec_id:'nvr1_conflict_h2_reels',axes:{angle:'conflict',hook:'h2',reveal:'late'}},
    {creative_id:'nvc1_identity_h1',render_spec_id:'nvr1_identity_h1_reels',axes:{angle:'identity',hook:'h1',reveal:'early'}},
    {creative_id:'nvc1_identity_h2',render_spec_id:'nvr1_identity_h2_reels',axes:{angle:'identity',hook:'h2',reveal:'early'}}
  ]
};

const policy={
  schema:C30_POLICY_SCHEMA,
  policy_version:'c30-learning-v1',
  metric_priors:{
    hold_3s:{alpha:1,beta:1},
    completion:{alpha:1,beta:1},
    share:{alpha:1,beta:1},
    save:{alpha:1,beta:1},
    cta_action:{alpha:1,beta:1},
    downstream_open:{alpha:1,beta:1}
  }
};

function observation({id,creative,render,impressions,hold3,completions,shares,saves,cta,opens,start='2026-09-17T00:00:00Z',end='2026-09-17T01:00:00Z'}){
  return {
    observation_id:id,
    source:{platform:'fixture',export_id:`export-${id}`},
    campaign_id:'campaign-fixture-c30',placement_id:'organic-reels-fixture',
    creative_id:creative,render_spec_id:render,window_start:start,window_end:end,
    metrics:{
      hold_3s:{numerator:hold3,denominator:impressions,denominator_kind:'qualified_starts'},
      completion:{numerator:completions,denominator:impressions,denominator_kind:'qualified_starts'},
      share:{numerator:shares,denominator:impressions,denominator_kind:'qualified_starts'},
      save:{numerator:saves,denominator:impressions,denominator_kind:'qualified_starts'},
      cta_action:{numerator:cta,denominator:impressions,denominator_kind:'qualified_starts'},
      downstream_open:{numerator:opens,denominator:cta,denominator_kind:'cta_actions'}
    }
  };
}

const observations=[
  observation({id:'obs-a',creative:'nvc1_premise_h1',render:'nvr1_premise_h1_reels',impressions:1000,hold3:620,completions:340,shares:35,saves:44,cta:52,opens:31}),
  observation({id:'obs-b',creative:'nvc1_conflict_h1',render:'nvr1_conflict_h1_reels',impressions:800,hold3:560,completions:250,shares:18,saves:21,cta:36,opens:20,start:'2026-09-17T01:00:00Z',end:'2026-09-17T02:00:00Z'}),
  observation({id:'obs-c',creative:'nvc1_premise_h1',render:'nvr1_premise_h1_reels',impressions:500,hold3:300,completions:190,shares:12,saves:19,cta:28,opens:17,start:'2026-09-17T02:00:00Z',end:'2026-09-17T03:00:00Z'})
];

function batch(items){return {schema:C30_EVIDENCE_SCHEMA,evidence_batch_id:'fixture-batch-v1',observations:items};}
function expectThrow(label,fn,needle){
  let error=null;try{fn();}catch(e){error=e;}
  assert.ok(error,`${label}: expected rejection`);
  if(needle)assert.match(String(error.message),needle,`${label}: unexpected error`);
}

const snapshotA=buildSelectorPriorSnapshot({portfolio,evidence:batch(observations),policy});
const snapshotB=buildSelectorPriorSnapshot({portfolio:{...portfolio,candidates:[...portfolio.candidates].reverse()},evidence:batch([...observations].reverse()),policy});
assert.equal(stableStringify(snapshotA),stableStringify(snapshotB),'canonical replay must ignore input order');
assert.equal(snapshotA.prior_snapshot_id,snapshotB.prior_snapshot_id,'snapshot identity must be deterministic');
assert.deepEqual(snapshotA.observation_ids,['obs-a','obs-b','obs-c']);

const premise=snapshotA.candidates.find(x=>x.creative_id==='nvc1_premise_h1');
assert.equal(premise.metrics.hold_3s.denominator,1500);
assert.equal(premise.metrics.hold_3s.numerator,920);
assert.equal(premise.metrics.hold_3s.observation_count,2);
assert.ok(premise.metrics.hold_3s.posterior_mean>0.5,'evidence should move hold prior');
const unseen=snapshotA.candidates.find(x=>x.creative_id==='nvc1_identity_h2');
assert.equal(unseen.metrics.hold_3s.denominator,0);
assert.equal(unseen.metrics.hold_3s.posterior_mean,0.5,'no-evidence candidate must stay at prior');
assert.equal(unseen.metrics.share.posterior_mean,0.5);

assertRendererIdentityUnchanged(portfolio,JSON.parse(JSON.stringify(portfolio)));
expectThrow('renderer identity mutation',()=>assertRendererIdentityUnchanged(portfolio,{...portfolio,candidates:portfolio.candidates.map((x,i)=>i?x:{...x,render_spec_id:'mutated'})}),/mutated creative\/render identity/);
expectThrow('double counting guard',()=>buildSelectorPriorSnapshot({portfolio,evidence:batch([observations[0],observations[0]]),policy}),/duplicate observation_id/);
expectThrow('unknown creative guard',()=>buildSelectorPriorSnapshot({portfolio,evidence:batch([{...observations[0],observation_id:'unknown',creative_id:'nvc1_unknown'}]),policy}),/unknown creative_id/);
expectThrow('unknown render guard',()=>buildSelectorPriorSnapshot({portfolio,evidence:batch([{...observations[0],observation_id:'unknown-render',render_spec_id:'nvr1_unknown'}]),policy}),/unknown render_spec_id/);
expectThrow('denominator semantics guard',()=>buildSelectorPriorSnapshot({portfolio,evidence:batch([
  observations[0],
  {...observations[2],observation_id:'kind-drift',metrics:{...observations[2].metrics,hold_3s:{...observations[2].metrics.hold_3s,denominator_kind:'views'}}}
]),policy}),/denominator kind drift/);

const reorderedPolicy={...policy,metric_priors:Object.fromEntries(Object.entries(policy.metric_priors).reverse())};
const snapshotC=buildSelectorPriorSnapshot({portfolio,evidence:batch(observations),policy:reorderedPolicy});
assert.equal(stableStringify(snapshotA),stableStringify(snapshotC),'policy map order must not change output');

console.log(JSON.stringify({
  ok:true,
  schema:snapshotA.schema,
  policyVersion:snapshotA.policy_version,
  candidates:snapshotA.candidates.length,
  observations:snapshotA.observation_ids.length,
  deterministicReplay:true,
  doubleCountingRejected:true,
  provenanceDriftRejected:true,
  denominatorDriftRejected:true,
  rendererIdentityImmutable:true,
  aggregateViralScore:false,
  snapshotId:snapshotA.prior_snapshot_id
},null,2));
