#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  acceptExternalCreativeDraft,
  compileExternalCreativeDraft,
  computeExternalDraftId,
  createServerCreativeApproval,
  evaluatePublishEligibility,
  validateExternalCreativeDraft,
} from './external-creative-draft-v1.mjs';
import { computeContextHash } from './creative-proposal-v1.mjs';

const readJson=(relative)=>JSON.parse(readFileSync(new URL(relative,import.meta.url),'utf8'));
const pack=readJson('./examples/context-pack-v1.example.json');
const draft=readJson('./examples/external-creative-draft-v1.example.json');
const clone=value=>structuredClone(value);

function reversedKeys(value){
  if(Array.isArray(value))return value.map(reversedKeys);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reversedKeys(v)]));
  return value;
}
function codes(report){return new Set(report.errors.map(x=>x.code));}
function expectCode(mutator,code,{context=pack,base=draft}={}){
  const candidate=clone(base);mutator(candidate);
  const report=validateExternalCreativeDraft(context,candidate);
  assert.equal(report.valid,false,`expected ${code} rejection`);
  assert.ok(codes(report).has(code),`expected ${code}, got ${JSON.stringify(report.errors)}`);
  return report;
}

const report=validateExternalCreativeDraft(pack,draft);
assert.equal(report.valid,true,JSON.stringify(report.errors));
const first=compileExternalCreativeDraft(pack,draft);
const second=compileExternalCreativeDraft(pack,reversedKeys(draft));
assert.equal(first.accepted_draft.draft_id,second.accepted_draft.draft_id,'object key order changed draft identity');
assert.equal(first.program.program_id,second.program.program_id,'object key order changed program identity');

const factOrder=clone(draft);
factOrder.narrative.hook.supporting_fact_ids=[...factOrder.narrative.hook.supporting_fact_ids].reverse();
const factOrderCompiled=compileExternalCreativeDraft(pack,factOrder);
assert.equal(first.accepted_draft.draft_id,factOrderCompiled.accepted_draft.draft_id,'supporting-fact set order changed draft identity');
assert.equal(first.program.program_id,factOrderCompiled.program.program_id,'supporting-fact set order changed program identity');

const externalAtoms=first.program.narrative_plan.roles.flatMap(role=>role.atoms.map(atom=>({role:role.role,...atom}))).filter(atom=>atom.source?.kind==='external_llm_copy');
assert.equal(externalAtoms.length,3,'hook/tension/payoff must remain explicit external_llm_copy sources');
const expectedText=new Map([
  ['hook',draft.narrative.hook.text],
  ['tension',draft.narrative.tension.text],
  ['desire_payoff',draft.narrative.payoff.text],
]);
for(const atom of externalAtoms){
  assert.equal(atom.text,expectedText.get(atom.role),'external display text drifted');
  assert.equal(atom.source.text,atom.text,'source/display text drifted');
  assert.equal(atom.source.context_pack_id,pack.context_pack_id);
  assert.equal(atom.source.context_hash,pack.context_hash);
  assert.equal(atom.source.draft_id,first.accepted_draft.draft_id);
  assert.match(atom.source.copy_sha256,/^[a-f0-9]{64}$/);
  assert.ok(atom.source.supporting_fact_ids.length>=1);
}
assert.equal(first.program.trust_mode,'external_llm_review_required');
assert.equal(first.program.publication_class,'review_required');

const noApproval=evaluatePublishEligibility({accepted_draft:first.accepted_draft,program:first.program});
assert.deepEqual(noApproval,{preview_render_allowed:true,publish_allowed:false,reason:'review_required'});
const programIdBeforeApproval=first.program.program_id;
const approved=createServerCreativeApproval({accepted_draft:first.accepted_draft,program:first.program,decision:'approved',issuer_id:'reviewer:fixture'});
const approvedEligibility=evaluatePublishEligibility({accepted_draft:first.accepted_draft,program:first.program,trusted_approval:approved});
assert.equal(approvedEligibility.preview_render_allowed,true);
assert.equal(approvedEligibility.publish_allowed,true);
assert.equal(approvedEligibility.reason,'approved');
assert.equal(first.program.program_id,programIdBeforeApproval,'approval must not mutate render program identity');

const rejected=createServerCreativeApproval({accepted_draft:first.accepted_draft,program:first.program,decision:'rejected',issuer_id:'reviewer:fixture'});
assert.deepEqual(evaluatePublishEligibility({accepted_draft:first.accepted_draft,program:first.program,trusted_approval:rejected}),{preview_render_allowed:true,publish_allowed:false,reason:'rejected'});

const changed=clone(draft);
changed.narrative.hook.text=changed.narrative.hook.text.replace('mailbox','doorstep');
const changedCompiled=compileExternalCreativeDraft(pack,changed);
assert.notEqual(changedCompiled.accepted_draft.draft_id,first.accepted_draft.draft_id,'semantic copy change did not change draft identity');
assert.notEqual(changedCompiled.program.program_id,first.program.program_id,'semantic copy change did not change program identity');
const stale=evaluatePublishEligibility({accepted_draft:changedCompiled.accepted_draft,program:changedCompiled.program,trusted_approval:approved});
assert.equal(stale.publish_allowed,false);
assert.equal(stale.reason,'approval_invalid');

const forgedAccepted=clone(first.accepted_draft);
forgedAccepted.narrative.hook.supporting_fact_ids=['fact_does_not_exist'];
forgedAccepted.draft_id=computeExternalDraftId(forgedAccepted);
assert.throws(()=>compileExternalCreativeDraft(pack,forgedAccepted),error=>error?.name==='ExternalCreativeDraftValidationError'&&codes(error.report).has('UNKNOWN_FACT'),'content-addressed accepted draft must still be revalidated');

expectCode(x=>{x.approved=true;},'SELF_APPROVAL_FORBIDDEN');
expectCode(x=>{x.narrative.hook.approval={decision:'approved'};},'SELF_APPROVAL_FORBIDDEN');
expectCode(x=>{x.narrative.hook.text='Watch this at https://example.com now';},'COPY_URL_FORBIDDEN');
expectCode(x=>{x.narrative.hook.text='Line one\nLine two';},'COPY_CONTROL_CHARACTER');
expectCode(x=>{x.narrative.hook.text='x'.repeat(221);},'COPY_TOO_LONG');
expectCode(x=>{x.narrative.hook.supporting_fact_ids=['fact_missing'];},'UNKNOWN_FACT');
expectCode(x=>{x.narrative.cta_id='cta_missing';},'UNKNOWN_CTA');
expectCode(x=>{delete x.narrative.tension;},'TENSION_REQUIRED');
expectCode(x=>{x.presentation.duration_seconds=5;},'BODY_COPY_FORBIDDEN');
expectCode(x=>{x.presentation.duration_seconds=3;x.narrative.reveal_timing='none';},'BODY_COPY_FORBIDDEN');

const expanded=clone(pack);
expanded.books.push({
  book_id:'book_other',title:'Other Book',author:'B. Example',
  facts:[{fact_id:'fact_other',kind:'premise',value:'An unrelated premise.',source_ref:'book:other:synopsis:v1'}],
  creative_atoms:[{atom_id:'atom_other',role:'hook',angle_types:['conflict'],text:'Other hook.',source_fact_ids:['fact_other'],spoiler_level:0}],
  assets:[{asset_id:'asset_other',role:'cover',sha256:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',media_type:'image/webp'}]
});
expanded.context_hash=computeContextHash(expanded);
const expandedDraft=clone(draft);expandedDraft.context_hash=expanded.context_hash;
expectCode(x=>{x.narrative.hook.supporting_fact_ids=['fact_other'];},'UNKNOWN_FACT',{context:expanded,base:expandedDraft});
expectCode(x=>{x.selected_asset_ids=['asset_other'];},'ASSET_SCOPE_MISMATCH',{context:expanded,base:expandedDraft});

const fakeClientApproval={...approved,authority:'client_supplied'};
fakeClientApproval.approval_id='nba1_'+ '0'.repeat(64);
const fakeEligibility=evaluatePublishEligibility({accepted_draft:first.accepted_draft,program:first.program,trusted_approval:fakeClientApproval});
assert.equal(fakeEligibility.publish_allowed,false);
assert.equal(fakeEligibility.reason,'approval_invalid');

const summary={
  status:'PASS',
  trust_mode:first.program.trust_mode,
  draft_id:first.accepted_draft.draft_id,
  program_id:first.program.program_id,
  copy_manifest_sha256:first.program.copy_manifest_sha256,
  external_copy_sources:externalAtoms.length,
  preview_without_approval:noApproval.preview_render_allowed,
  publish_without_approval:noApproval.publish_allowed,
  publish_with_server_approval:approvedEligibility.publish_allowed,
  stale_approval_rejected:stale.publish_allowed===false,
  semantic_copy_change_changes_identity:changedCompiled.program.program_id!==first.program.program_id,
  approval_changes_render_identity:first.program.program_id!==programIdBeforeApproval,
};
console.log(JSON.stringify(summary,null,2));
