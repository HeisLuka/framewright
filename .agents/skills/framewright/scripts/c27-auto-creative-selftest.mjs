#!/usr/bin/env node
import {
  assertCreativeSourcePack,
  buildAutoCreativeInputs,
  compileAutoCreativePlans,
  makeCreativeSourcePack
} from './c27-auto-creative.mjs';
import {resolveCopySource,stableStringify} from './c27-narrative-plan.mjs';

const book={
  book_id:'future-letters-auto',
  title:'Letters From Tomorrow',
  author:'Mara Bell',
  hook:'Every evening he receives a letter written by himself tomorrow. One night it tells him not to leave home.',
  cta:'Read the book'
};

const sourcePack=makeCreativeSourcePack({book,blocks:[
  {
    id:'publisher-synopsis',
    kind:'publisher_synopsis',
    verification_id:'catalog-feed-2026-09-17:future-letters',
    spoiler_level:0,
    text:'Every evening he receives a letter written by himself tomorrow. The city has no record of the sender. The city rewrites its records each midnight. Before sunrise he must decide whether to trust the warning.'
  },
  {
    id:'excerpt-safe-boundary',
    kind:'book_excerpt',
    verification_id:'excerpt-ingest-7f31',
    spoiler_level:2,
    text:'The next letter is addressed to someone else. His own name disappears from the final page.'
  },
  {
    id:'editorial-angle',
    kind:'editorial_verified',
    verification_id:'editorial-review-118',
    spoiler_level:0,
    text:'The story is built around choosing whether to trust your future self.'
  },
  {
    id:'identity-leak-copy',
    kind:'publisher_description',
    verification_id:'catalog-feed-2026-09-17:identity-line',
    spoiler_level:0,
    text:'Letters From Tomorrow is a novel by Mara Bell.'
  }
]});
assertCreativeSourcePack(sourcePack,book);

const first=buildAutoCreativeInputs({
  book,source_pack:sourcePack,max_spoiler_level:1,max_angle_types:8,max_hooks_per_angle:2
});
const replay=buildAutoCreativeInputs({
  book,source_pack:sourcePack,max_spoiler_level:1,max_angle_types:8,max_hooks_per_angle:2
});
if(stableStringify(first)!==stableStringify(replay))throw new Error('auto creative deterministic replay drift');

if(first.evidence.items.length!==9)throw new Error(`expected 9 distinct evidence atoms, got ${first.evidence.items.length}`);
const duplicatePremise=first.evidence.items.filter(item=>resolveCopySource(item.source,book).startsWith('Every evening he receives'));
if(duplicatePremise.length!==1)throw new Error('duplicate synopsis/payload sentence was not deduplicated');

const identityLeakEvidence=first.evidence.items.find(item=>item.id==='identity-leak-copy-s0');
if(!identityLeakEvidence)throw new Error('identity-leak evidence missing from evidence ledger');
if(identityLeakEvidence.role_tags.length!==0)throw new Error('title/author-bearing source was allowed into pre-reveal roles');

const angleTypes=new Set(first.angles.map(x=>x.type));
for(const required of ['premise','conflict','identity','world','thesis'])if(!angleTypes.has(required))throw new Error(`missing automatic angle type ${required}`);
if(first.portfolio.concepts.length<5)throw new Error(`expected at least 5 hook candidates, got ${first.portfolio.concepts.length}`);

const compiled=compileAutoCreativePlans({
  book,
  source_pack:sourcePack,
  max_spoiler_level:1,
  max_angle_types:8,
  max_hooks_per_angle:2,
  duration_seconds:9,
  reveal_timing:['early','mid','late'],
  cta_treatment:['none','intent'],
  fps:30,
  seed:11
});
if(compiled.plans.length<30)throw new Error(`expected at least 30 automatic plans, got ${compiled.plans.length}`);

const evidenceById=new Map(compiled.evidence.items.map(x=>[x.id,x]));
for(const entry of compiled.plans){
  for(const id of entry.evidence_ids){
    const evidence=evidenceById.get(id);
    if(!evidence)throw new Error(`plan references missing evidence ${id}`);
    if(evidence.spoiler_level>1)throw new Error(`spoiler budget leaked evidence ${id}`);
    if(evidence.role_tags.length===0)throw new Error(`identity-leak evidence used before reveal: ${id}`);
  }
  for(const role of entry.narrative_plan.roles)for(const atom of role.atoms){
    if(atom.source.kind==='reserved_affordance')continue;
    const resolved=resolveCopySource(atom.source,book);
    if(resolved!==atom.text)throw new Error(`visible copy drift: ${atom.text}`);
    if(atom.source.kind==='human_verified'){
      if(!atom.source.verification_id||!atom.source.source_pack_block_id)throw new Error('source-pack provenance metadata missing');
    }
  }
}

const highSpoilerIds=new Set(compiled.evidence.items.filter(x=>x.spoiler_level===2).map(x=>x.id));
if(!highSpoilerIds.size)throw new Error('high-spoiler fixture evidence missing');
if(compiled.plans.some(p=>p.evidence_ids.some(id=>highSpoilerIds.has(id))))throw new Error('high-spoiler evidence entered safe plan matrix');

let missingVerificationRejected=false;
try{
  makeCreativeSourcePack({book,blocks:[{id:'bad',kind:'publisher_synopsis',spoiler_level:0,text:'Unverified copy.'}]});
}catch(error){missingVerificationRejected=/verification_id/.test(String(error.message));}
if(!missingVerificationRejected)throw new Error('unverified source pack block was not rejected');

console.log(JSON.stringify({
  ok:true,
  sourcePackId:sourcePack.source_pack_id,
  evidenceItems:first.evidence.items.length,
  angleTypes:[...angleTypes],
  hookCandidates:first.portfolio.concepts.length,
  automaticPlans:compiled.plans.length,
  identityLeakExcluded:true,
  highSpoilerExcluded:true,
  missingVerificationRejected
},null,2));
