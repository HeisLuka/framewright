#!/usr/bin/env node
import {
  assertBookEvidence,
  buildCreativePortfolio,
  compilePortfolioPlans,
  makeBookEvidence
} from './c27-creative-portfolio.mjs';
import {resolveCopySource,stableStringify} from './c27-narrative-plan.mjs';

const book={
  book_id:'future-letters',
  title:'Letters From Tomorrow',
  author:'Mara Bell',
  hook:'Every evening he receives a letter written by himself tomorrow. One night it tells him not to leave home. The next letter is addressed to someone else.',
  cta:'Read the book'
};
const sentence=index=>({kind:'book_payload_field',field:'hook',selector:{kind:'sentence',index}});
const evidence=makeBookEvidence({book,items:[
  {id:'premise-0',kind:'premise',source:sentence(0),spoiler_level:0,role_tags:['hook','tension']},
  {id:'conflict-1',kind:'conflict',source:sentence(1),spoiler_level:1,role_tags:['hook','tension']},
  {id:'payoff-2',kind:'payoff',source:sentence(2),spoiler_level:2,role_tags:['payoff']},
  {id:'identity-verified',kind:'identity',source:{kind:'human_verified',text:'What if the warning came from you?',verification_id:'editorial-001'},spoiler_level:0,role_tags:['hook']}
]});
assertBookEvidence(evidence,book);

const angles=[
  {
    id:'future-message',type:'premise',label:'Future message',variants:[
      {id:'premise-first',hook_evidence_id:'premise-0',tension_evidence_id:'conflict-1',payoff_evidence_id:'payoff-2'},
      {id:'conflict-first',hook_evidence_id:'conflict-1',tension_evidence_id:'premise-0',payoff_evidence_id:'payoff-2'}
    ]
  },
  {
    id:'self-warning',type:'question',label:'Self warning',variants:[
      {id:'question-first',hook_evidence_id:'identity-verified',tension_evidence_id:'conflict-1',payoff_evidence_id:'payoff-2'}
    ]
  }
];

const portfolio=buildCreativePortfolio({book,evidence,angles});
const replay=buildCreativePortfolio({book,evidence,angles});
if(portfolio.concepts.length!==3)throw new Error(`expected 3 creative concepts, got ${portfolio.concepts.length}`);
if(portfolio.portfolio_id!==replay.portfolio_id||stableStringify(portfolio)!==stableStringify(replay))throw new Error('portfolio deterministic replay drift');
if(new Set(portfolio.concepts.map(x=>x.hook_candidate_id)).size!==3)throw new Error('hook candidates collapsed');

const compiled=compilePortfolioPlans({
  book,evidence,angles,
  duration_seconds:[9],
  reveal_timing:['early','mid','late'],
  cta_treatment:['none','soft_reveal','intent'],
  fps:30,
  seed:7,
  max_spoiler_level:2
});
if(compiled.plans.length!==27)throw new Error(`expected 27 plans, got ${compiled.plans.length}`);
for(const entry of compiled.plans){
  const concept=portfolio.concepts.find(x=>x.concept_id===entry.concept_id);
  if(!concept)throw new Error(`missing concept for plan ${entry.concept_id}`);
  if(entry.hook_candidate_id!==concept.hook_candidate_id)throw new Error('hook_candidate_id drift');
  if(stableStringify(entry.evidence_ids)!==stableStringify(concept.evidence_ids))throw new Error('evidence id drift');
  const visible=entry.narrative_plan.roles.flatMap(r=>r.atoms).filter(atom=>atom.source.kind!=='reserved_affordance');
  for(const atom of visible){
    const resolved=resolveCopySource(atom.source,book);
    if(resolved!==atom.text)throw new Error(`invented or drifted visible copy: ${atom.text}`);
  }
}

const spoilerSafe=compilePortfolioPlans({
  book,evidence,angles,
  duration_seconds:9,
  reveal_timing:'mid',
  cta_treatment:'none',
  max_spoiler_level:1
});
if(spoilerSafe.plans.length!==0)throw new Error('spoiler filter failed: all concepts include level-2 payoff');

const teaserSafe=compilePortfolioPlans({
  book,evidence,angles,
  duration_seconds:[3,5],
  reveal_timing:['early','late'],
  cta_treatment:['none','soft_reveal','direct'],
  max_spoiler_level:2
});
const three=teaserSafe.plans.filter(x=>x.narrative_plan.duration_seconds===3);
const five=teaserSafe.plans.filter(x=>x.narrative_plan.duration_seconds===5);
if(three.length!==3||three.some(x=>x.narrative_plan.cta_treatment!=='none'))throw new Error('3s portfolio compilation violated hook-only CTA contract');
if(five.length!==12||five.some(x=>!['none','soft_reveal'].includes(x.narrative_plan.cta_treatment)))throw new Error('5s portfolio compilation violated CTA contract');

let unknownEvidenceRejected=false;
try{
  buildCreativePortfolio({book,evidence,angles:[{id:'bad',type:'premise',variants:[{id:'bad-hook',hook_evidence_id:'missing'}]}]});
}catch(error){unknownEvidenceRejected=/unknown evidence/.test(String(error.message));}
if(!unknownEvidenceRejected)throw new Error('unknown evidence reference was not rejected');

let untrustedSourceRejected=false;
try{
  makeBookEvidence({book,items:[{id:'bad-source',kind:'premise',source:{kind:'generated',text:'invented'},spoiler_level:0}]});
}catch(error){untrustedSourceRejected=/unsupported copy source kind/.test(String(error.message));}
if(!untrustedSourceRejected)throw new Error('untrusted evidence source was not rejected');

let duplicateRoleEvidenceRejected=false;
try{
  buildCreativePortfolio({book,evidence,angles:[{id:'dup',type:'premise',variants:[{id:'dup-role',hook_evidence_id:'premise-0',tension_evidence_id:'premise-0'}]}]});
}catch(error){duplicateRoleEvidenceRejected=/reuses evidence/.test(String(error.message));}
if(!duplicateRoleEvidenceRejected)throw new Error('same evidence reused across semantic roles was not rejected');

console.log(JSON.stringify({
  ok:true,
  evidenceItems:evidence.items.length,
  creativeConcepts:portfolio.concepts.length,
  matrixPlans:compiled.plans.length,
  teaserPlans:teaserSafe.plans.length,
  unknownEvidenceRejected,
  untrustedSourceRejected,
  duplicateRoleEvidenceRejected
},null,2));
