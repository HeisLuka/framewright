#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CreativeIngressError,
  processCreativeIngress,
  validateCreativeIngressEnvelope,
} from './creative-ingress-v1.mjs';
import {
  PROPOSAL_SCHEMA,
  computeProposalId,
} from './creative-proposal-v1.mjs';
import { compileCreativeProposal } from './compile-creative-proposal-v1.mjs';
import { COMPOSED_PROPOSAL_SCHEMA } from './compositional-copy-v1.mjs';
import { compileComposedCreativeProposal } from './compile-composed-creative-proposal-v1.mjs';
import {
  EXTERNAL_DRAFT_SCHEMA,
  compileExternalCreativeDraft,
  createServerCreativeApproval,
} from './external-creative-draft-v1.mjs';

const readJson=(relative)=>JSON.parse(readFileSync(new URL(relative,import.meta.url),'utf8'));
const pack=readJson('./examples/context-pack-v1.example.json');
const language=readJson('./examples/copy-language-v1.example.json');
const oldProposal=readJson('./examples/creative-proposal-v1.example.json');
const oldComposed=readJson('./examples/composed-creative-proposal-v1.example.json');
const oldExternal=readJson('./examples/external-creative-draft-v1.example.json');
const trustedIngress=readJson('./examples/creative-ingress-trusted-atoms-v1.example.json');
const composedIngress=readJson('./examples/creative-ingress-verified-composition-v1.example.json');
const externalIngress=readJson('./examples/creative-ingress-external-copy-v1.example.json');
const clone=value=>structuredClone(value);

function reverseKeys(value){
  if(Array.isArray(value))return value.map(reverseKeys);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reverseKeys(v)]));
  return value;
}
async function expectError(ingress,code,needle=null,options={}){
  let error=null;
  const resolver=Object.prototype.hasOwnProperty.call(options,'loadContextPack')?options.loadContextPack:(()=>pack);
  const copyResolver=Object.prototype.hasOwnProperty.call(options,'loadCopyLanguage')?options.loadCopyLanguage:null;
  const approvalResolver=Object.prototype.hasOwnProperty.call(options,'loadTrustedApproval')?options.loadTrustedApproval:null;
  try{
    await processCreativeIngress({ingress,loadContextPack:resolver,loadCopyLanguage:copyResolver,loadTrustedApproval:approvalResolver});
  }catch(caught){error=caught;}
  assert.ok(error instanceof CreativeIngressError,`expected CreativeIngressError for ${code}, got ${error}`);
  assert.equal(error.report.code,code,JSON.stringify(error.report));
  if(needle)assert.ok(JSON.stringify(error.report).includes(needle),`expected ${needle} in ${JSON.stringify(error.report)}`);
  return error.report;
}

assert.equal(validateCreativeIngressEnvelope(trustedIngress).valid,true);
assert.equal(validateCreativeIngressEnvelope(composedIngress).valid,true);
assert.equal(validateCreativeIngressEnvelope(externalIngress).valid,true);

const resolverCalls=[];
const loadContextPack=(id)=>{resolverCalls.push(id);return id===pack.context_pack_id?clone(pack):null;};
const trusted=await processCreativeIngress({ingress:trustedIngress,loadContextPack});
assert.deepEqual(resolverCalls,[pack.context_pack_id],'server resolver must receive only the referenced ContextPack ID');
assert.equal(trusted.mode,'trusted_atoms');
assert.equal(trusted.creative_gate.preview_render_allowed,true);
assert.equal(trusted.creative_gate.publication_trust_satisfied,true);
assert.equal(trusted.creative_gate.reason,'trusted_atoms');
assert.match(trusted.ingress_id,/^nbi1_[a-f0-9]{64}$/);
assert.match(trusted.decision_id,/^nbid1_[a-f0-9]{64}$/);

const mintedProposal={
  schema:PROPOSAL_SCHEMA,
  proposal_id:'',
  context_pack_id:trustedIngress.context_pack_id,
  context_hash:trustedIngress.context_hash,
  ...clone(trustedIngress.payload),
};
mintedProposal.proposal_id=computeProposalId(mintedProposal);
assert.equal(mintedProposal.proposal_id,oldProposal.proposal_id,'C35 server-minted proposal identity must match canonical C32 example');
const directTrustedProgram=compileCreativeProposal(pack,mintedProposal);
assert.equal(trusted.canonical_input.id,mintedProposal.proposal_id);
assert.equal(trusted.program.program_id,directTrustedProgram.program_id);
assert.deepEqual(trusted.program,directTrustedProgram,'C35 trusted mode must be an exact adapter over canonical C32 compiler');
const trustedReordered=await processCreativeIngress({ingress:reverseKeys(trustedIngress),loadContextPack:()=>clone(pack)});
assert.equal(trustedReordered.ingress_id,trusted.ingress_id,'object key order changed trusted ingress identity');
assert.equal(trustedReordered.program.program_id,trusted.program.program_id,'object key order changed trusted program identity');

const languageCalls=[];
const loadCopyLanguage=(id)=>{languageCalls.push(id);return id===language.copy_language_id?clone(language):null;};
const composed=await processCreativeIngress({ingress:composedIngress,loadContextPack:()=>clone(pack),loadCopyLanguage});
assert.equal(composed.mode,'verified_composition');
assert.equal(composed.creative_gate.preview_render_allowed,true);
assert.equal(composed.creative_gate.publication_trust_satisfied,true);
assert.equal(composed.creative_gate.reason,'verified_composition');
assert.deepEqual(languageCalls,[language.copy_language_id],'server CopyLanguage resolver must receive only the referenced language ID');
const directComposedProposal={
  schema:COMPOSED_PROPOSAL_SCHEMA,
  context_pack_id:composedIngress.context_pack_id,
  context_hash:composedIngress.context_hash,
  ...clone(composedIngress.payload),
};
const directComposedProgram=compileComposedCreativeProposal(pack,language,directComposedProposal);
assert.equal(composed.canonical_input.id,directComposedProgram.proposal_id);
assert.equal(composed.program.program_id,directComposedProgram.program_id);
assert.deepEqual(composed.program,directComposedProgram,'C35 verified-composition mode must be an exact adapter over canonical C36 compiler');
assert.equal(directComposedProgram.proposal_id,compileComposedCreativeProposal(pack,language,oldComposed).proposal_id,'C35 composed example must preserve canonical C36 semantics');
const composedSources=composed.program.narrative_plan.roles.flatMap(role=>role.atoms.map(atom=>atom.source));
assert.equal(composedSources.filter(source=>source?.kind==='context_atom').length,3,'verified composition must retain three derived context_atom sources');
assert.equal(composedSources.filter(source=>source?.kind==='human_verified').length,0,'verified composition must not be mislabeled human_verified');
const composedReordered=await processCreativeIngress({ingress:reverseKeys(composedIngress),loadContextPack:()=>clone(pack),loadCopyLanguage:()=>clone(language)});
assert.equal(composedReordered.ingress_id,composed.ingress_id,'object key order changed composed ingress identity');
assert.equal(composedReordered.program.program_id,composed.program.program_id,'object key order changed composed program identity');

const externalNoApproval=await processCreativeIngress({ingress:externalIngress,loadContextPack:()=>clone(pack)});
assert.equal(externalNoApproval.mode,'external_copy_review_required');
assert.equal(externalNoApproval.creative_gate.preview_render_allowed,true);
assert.equal(externalNoApproval.creative_gate.publication_trust_satisfied,false);
assert.equal(externalNoApproval.creative_gate.reason,'review_required');
const directDraft={
  schema:EXTERNAL_DRAFT_SCHEMA,
  context_pack_id:externalIngress.context_pack_id,
  context_hash:externalIngress.context_hash,
  ...clone(externalIngress.payload),
};
const directExternal=compileExternalCreativeDraft(pack,directDraft);
assert.equal(externalNoApproval.accepted_draft.draft_id,directExternal.accepted_draft.draft_id);
assert.equal(externalNoApproval.program.program_id,directExternal.program.program_id);
assert.deepEqual(externalNoApproval.program,directExternal.program,'C35 external mode must be an exact adapter over canonical C33 compiler');
assert.equal(externalNoApproval.accepted_draft.draft_id,compileExternalCreativeDraft(pack,oldExternal).accepted_draft.draft_id,'C35 external example must preserve canonical C33 semantics');

const approval=createServerCreativeApproval({
  accepted_draft:directExternal.accepted_draft,
  program:directExternal.program,
  decision:'approved',
  issuer_id:'reviewer:c35-fixture',
});
const approvalQueries=[];
const externalApproved=await processCreativeIngress({
  ingress:externalIngress,
  loadContextPack:()=>clone(pack),
  loadTrustedApproval:(query)=>{approvalQueries.push(query);return clone(approval);},
});
assert.equal(approvalQueries.length,1);
assert.equal(approvalQueries[0].draft_id,directExternal.accepted_draft.draft_id);
assert.equal(approvalQueries[0].program_id,directExternal.program.program_id);
assert.equal(approvalQueries[0].copy_manifest_sha256,directExternal.program.copy_manifest_sha256);
assert.equal(externalApproved.creative_gate.publication_trust_satisfied,true);
assert.equal(externalApproved.creative_gate.reason,'approved');
assert.equal(externalApproved.program.program_id,externalNoApproval.program.program_id,'approval changed render program identity');
assert.equal(externalApproved.ingress_id,externalNoApproval.ingress_id,'approval changed creative ingress identity');
assert.notEqual(externalApproved.decision_id,externalNoApproval.decision_id,'approval state must change decision receipt identity');
const externalReordered=await processCreativeIngress({ingress:reverseKeys(externalIngress),loadContextPack:()=>clone(pack)});
assert.equal(externalReordered.ingress_id,externalNoApproval.ingress_id,'object key order changed external ingress identity');
assert.equal(externalReordered.program.program_id,externalNoApproval.program.program_id,'object key order changed external program identity');

const changedExternal=clone(externalIngress);
changedExternal.payload.narrative.hook.text=changedExternal.payload.narrative.hook.text.replace('mailbox','doorstep');
const stale=await processCreativeIngress({
  ingress:changedExternal,
  loadContextPack:()=>clone(pack),
  loadTrustedApproval:()=>clone(approval),
});
assert.notEqual(stale.ingress_id,externalNoApproval.ingress_id);
assert.notEqual(stale.program.program_id,externalNoApproval.program.program_id);
assert.equal(stale.creative_gate.publication_trust_satisfied,false);
assert.equal(stale.creative_gate.reason,'approval_invalid');

const clientPack=clone(trustedIngress);clientPack.context_pack=clone(pack);
await expectError(clientPack,'CREATIVE_INGRESS_REJECTED','/context_pack');
const clientProposalId=clone(trustedIngress);clientProposalId.payload.proposal_id=oldProposal.proposal_id;
await expectError(clientProposalId,'CREATIVE_INGRESS_REJECTED','/payload/proposal_id');
const clientApproval=clone(externalIngress);clientApproval.approval=approval;
await expectError(clientApproval,'CREATIVE_INGRESS_REJECTED','/approval');
const clientLanguage=clone(composedIngress);clientLanguage.payload.copy_language=clone(language);
await expectError(clientLanguage,'CREATIVE_INGRESS_REJECTED','/payload/copy_language');
const unknownMode=clone(trustedIngress);unknownMode.mode='magic_llm';
await expectError(unknownMode,'CREATIVE_INGRESS_REJECTED','INGRESS_MODE_UNSUPPORTED');
const staleContext=clone(trustedIngress);staleContext.context_hash='0'.repeat(64);
await expectError(staleContext,'CONTEXT_HASH_MISMATCH','expected server context hash');
await expectError(trustedIngress,'CONTEXT_NOT_FOUND',pack.context_pack_id,{loadContextPack:()=>null});
await expectError(trustedIngress,'SERVER_CONTEXT_RESOLVER_REQUIRED','server-owned ContextPack resolver',{loadContextPack:null});
await expectError(composedIngress,'SERVER_COPY_LANGUAGE_RESOLVER_REQUIRED','server-owned CopyLanguage resolver',{loadCopyLanguage:null});
await expectError(composedIngress,'COPY_LANGUAGE_NOT_FOUND',language.copy_language_id,{loadCopyLanguage:()=>null});
const staleLanguage=clone(composedIngress);staleLanguage.payload.copy_language_hash='0'.repeat(64);
await expectError(staleLanguage,'COPY_LANGUAGE_HASH_MISMATCH','expected server copy language hash',{loadCopyLanguage:()=>clone(language)});

const rawCopyInTrusted=clone(trustedIngress);rawCopyInTrusted.payload.narrative.text='write whatever';
await expectError(rawCopyInTrusted,'CREATIVE_PROPOSAL_REJECTED','FORBIDDEN_RAW_CONTENT');
const rawCopyInComposed=clone(composedIngress);rawCopyInComposed.payload.narrative.hook.text='write whatever';
await expectError(rawCopyInComposed,'COMPOSED_CREATIVE_PROPOSAL_REJECTED','FORBIDDEN_RAW_CONTENT',{loadCopyLanguage:()=>clone(language)});
const selfApproveExternal=clone(externalIngress);selfApproveExternal.payload.narrative.hook.approved=true;
await expectError(selfApproveExternal,'EXTERNAL_CREATIVE_DRAFT_REJECTED','SELF_APPROVAL_FORBIDDEN');
const unknownFact=clone(externalIngress);unknownFact.payload.narrative.hook.supporting_fact_ids=['fact_missing'];
await expectError(unknownFact,'EXTERNAL_CREATIVE_DRAFT_REJECTED','UNKNOWN_FACT');

const receipt={
  status:'PASS',
  schema:'newboo-c35-creative-ingress-audit-v1',
  modes:['trusted_atoms','verified_composition','external_copy_review_required'],
  trusted:{
    ingress_id:trusted.ingress_id,
    proposal_id:trusted.canonical_input.id,
    program_id:trusted.program.program_id,
    preview_render_allowed:trusted.creative_gate.preview_render_allowed,
    publication_trust_satisfied:trusted.creative_gate.publication_trust_satisfied,
  },
  composed:{
    ingress_id:composed.ingress_id,
    proposal_id:composed.canonical_input.id,
    program_id:composed.program.program_id,
    preview_render_allowed:composed.creative_gate.preview_render_allowed,
    publication_trust_satisfied:composed.creative_gate.publication_trust_satisfied,
    context_atom_sources:composedSources.filter(source=>source?.kind==='context_atom').length,
    human_verified_sources:composedSources.filter(source=>source?.kind==='human_verified').length,
  },
  external:{
    ingress_id:externalNoApproval.ingress_id,
    draft_id:externalNoApproval.canonical_input.id,
    program_id:externalNoApproval.program.program_id,
    preview_without_approval:externalNoApproval.creative_gate.preview_render_allowed,
    publication_trust_without_approval:externalNoApproval.creative_gate.publication_trust_satisfied,
    publication_trust_with_server_approval:externalApproved.creative_gate.publication_trust_satisfied,
    approval_changes_program_identity:externalApproved.program.program_id!==externalNoApproval.program.program_id,
    approval_changes_ingress_identity:externalApproved.ingress_id!==externalNoApproval.ingress_id,
    approval_changes_decision_identity:externalApproved.decision_id!==externalNoApproval.decision_id,
    stale_approval_rejected:stale.creative_gate.publication_trust_satisfied===false,
  },
  server_authority:{
    context_pack_loaded_by_id_only:resolverCalls.length===1&&resolverCalls[0]===pack.context_pack_id,
    copy_language_loaded_by_id_only:languageCalls.length===1&&languageCalls[0]===language.copy_language_id,
    client_context_pack_rejected:true,
    client_copy_language_rejected:true,
    client_content_ids_rejected:true,
    client_approval_rejected:true,
  }
};
console.log(JSON.stringify(receipt,null,2));
