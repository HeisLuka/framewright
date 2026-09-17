#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeContextHash } from './creative-proposal-v1.mjs';
import { computeRenderSpecId, sha256Canonical } from './factory-identity-v1.mjs';
import {
  CREATIVE_INGRESS_SCHEMA,
  CreativeIngressError,
  createServerCreativeApprovalV2,
  processCreativeIngress,
  validateCreativeIngressEnvelope,
  validateRequestedDeliveryProfiles,
} from './creative-ingress-v2.mjs';

const readJson=(relative)=>JSON.parse(readFileSync(new URL(relative,import.meta.url),'utf8'));
const clone=value=>structuredClone(value);
const reverseKeys=value=>Array.isArray(value)?value.map(reverseKeys):(value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverseKeys(item)])):value);

const pack=readJson('./examples/context-pack-v1.example.json');
pack.capabilities.delivery_profiles=['instagram_reels','square_feed','landscape_feed'];
pack.context_hash=computeContextHash(pack);
const language=readJson('./examples/copy-language-v1.example.json');

function migrate(relative){
  const ingress=readJson(relative);
  ingress.schema=CREATIVE_INGRESS_SCHEMA;
  ingress.context_hash=pack.context_hash;
  delete ingress.payload.presentation.delivery_profile;
  return ingress;
}
const trustedIngress=migrate('./examples/creative-ingress-trusted-atoms-v1.example.json');
const composedIngress=migrate('./examples/creative-ingress-verified-composition-v1.example.json');
const externalIngress=migrate('./examples/creative-ingress-external-copy-v1.example.json');

for(const ingress of [trustedIngress,composedIngress,externalIngress]){
  const envelope=validateCreativeIngressEnvelope(ingress);
  assert.equal(envelope.valid,true,JSON.stringify(envelope.errors));
}
const legacyLeak=clone(trustedIngress);
legacyLeak.payload.presentation.delivery_profile='instagram_reels';
const leakReport=validateCreativeIngressEnvelope(legacyLeak);
assert.equal(leakReport.valid,false);
assert.ok(leakReport.errors.some(error=>error.code==='DELIVERY_OWNERSHIP_VIOLATION'&&error.path==='/payload/presentation/delivery_profile'));

const loadContextPack=()=>clone(pack);
const loadCopyLanguage=()=>clone(language);
const trusted=await processCreativeIngress({ingress:trustedIngress,loadContextPack});
const composed=await processCreativeIngress({ingress:composedIngress,loadContextPack,loadCopyLanguage});
const external=await processCreativeIngress({ingress:externalIngress,loadContextPack});

for(const result of [trusted,composed,external]){
  assert.equal(Object.hasOwn(result.program.presentation,'delivery_profile'),false,'canonical program leaked delivery_profile');
  assert.match(result.canonical_input.id,/^nbci2_[a-f0-9]{64}$/);
  assert.match(result.program.program_id,/^nbprog2_[a-f0-9]{64}$/);
  assert.match(result.ingress_id,/^nbi2_[a-f0-9]{64}$/);
  assert.equal(result.creative_gate.preview_render_allowed,true);
}
assert.equal(trusted.creative_gate.publication_trust_satisfied,true);
assert.equal(composed.creative_gate.publication_trust_satisfied,true);
assert.equal(external.creative_gate.publication_trust_satisfied,false);
assert.equal(external.creative_gate.reason,'review_required');

const trustedReordered=await processCreativeIngress({ingress:reverseKeys(trustedIngress),loadContextPack});
assert.equal(trustedReordered.canonical_input.id,trusted.canonical_input.id,'key order changed canonical input identity');
assert.equal(trustedReordered.program.program_id,trusted.program.program_id,'key order changed program identity');
assert.equal(trustedReordered.ingress_id,trusted.ingress_id,'key order changed ingress identity');

const approval=createServerCreativeApprovalV2({
  accepted_draft:external.accepted_draft,
  program:external.program,
  decision:'approved',
  issuer_id:'reviewer:i18-fixture',
});
const approvalQueries=[];
const externalApproved=await processCreativeIngress({
  ingress:externalIngress,
  loadContextPack,
  loadTrustedApproval:(query)=>{approvalQueries.push(query);return clone(approval);},
});
assert.equal(approvalQueries.length,1);
assert.equal(approvalQueries[0].draft_id,external.accepted_draft.draft_id);
assert.equal(approvalQueries[0].program_id,external.program.program_id);
assert.equal(externalApproved.creative_gate.publication_trust_satisfied,true);
assert.equal(externalApproved.program.program_id,external.program.program_id,'approval changed creative program identity');
assert.equal(externalApproved.ingress_id,external.ingress_id,'approval changed creative ingress identity');
assert.notEqual(externalApproved.decision_id,external.decision_id,'approval must change only decision receipt identity');

const allProfiles=validateRequestedDeliveryProfiles(pack,['square_feed','instagram_reels','landscape_feed']);
assert.equal(allProfiles.valid,true,JSON.stringify(allProfiles.errors));
assert.deepEqual(allProfiles.requested_delivery_profile_ids,['instagram_reels','landscape_feed','square_feed']);
const unsupported=validateRequestedDeliveryProfiles(pack,['tiktok_magic_crop']);
assert.equal(unsupported.valid,false);
assert.ok(unsupported.errors.some(error=>error.code==='CAPABILITY_DENIED'));

// Delivery selection is downstream: one semantic identity, multiple RenderSpec identities.
const creativeId=`nvc1_${sha256Canonical({program_id:trusted.program.program_id})}`;
const renderBase={
  schema:'newboo-render-spec-v1',
  creative_id:creativeId,
  duration_ms:9000,
  frame_count:270,
  runtime:{class:'FAST',renderer:{id:'webcodecs-h264',version:'i18-test'},encoder:{video_codec:'avc1.420028',bitrate_bps:3000000},muxer:{id:'ffmpeg',version:'test'}},
  assets:[],
  artifact_policy:{reuse:'prefer-existing',canonical_key:'render_spec_id'},
};
const deliveries={
  instagram_reels:{id:'instagram_reels',width:1080,height:1920,fps:30,duration_ms:9000},
  square_feed:{id:'square_feed',width:1080,height:1080,fps:30,duration_ms:9000},
  landscape_feed:{id:'landscape_feed',width:1920,height:1080,fps:30,duration_ms:9000},
};
const renderIds=Object.fromEntries(Object.entries(deliveries).map(([id,delivery])=>[id,computeRenderSpecId({...renderBase,delivery})]));
assert.equal(new Set(Object.values(renderIds)).size,3,'delivery profiles did not produce distinct RenderSpec identities');
assert.equal(trusted.program.program_id, trustedReordered.program.program_id,'delivery-independent program identity drifted');

let missingResolver=null;
try{await processCreativeIngress({ingress:trustedIngress,loadContextPack:null});}catch(error){missingResolver=error;}
assert.ok(missingResolver instanceof CreativeIngressError);
assert.equal(missingResolver.report.code,'SERVER_CONTEXT_RESOLVER_REQUIRED');

console.log(JSON.stringify({
  status:'PASS',
  schema:'newboo-i18-delivery-ownership-audit-v1',
  modes:{
    trusted_atoms:{input_id:trusted.canonical_input.id,program_id:trusted.program.program_id},
    verified_composition:{input_id:composed.canonical_input.id,program_id:composed.program.program_id},
    external_copy_review_required:{input_id:external.canonical_input.id,program_id:external.program.program_id,approved:externalApproved.creative_gate.publication_trust_satisfied},
  },
  server_capabilities:pack.capabilities.delivery_profiles,
  downstream_requested:allProfiles.requested_delivery_profile_ids,
  render_spec_ids:renderIds,
  legacy_delivery_field_rejected:true,
  program_delivery_field_absent:true,
},null,2));
