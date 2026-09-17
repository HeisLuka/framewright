#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  assembleC19TemplateCampaignRequest,
  replayLegacyTemplateCampaignV1,
  selectCurrentTemplateCampaignBatch,
  validateTemplateCampaignSelection,
  validateTemplateCampaignSelectionProvenance,
} from './template-campaign-selection-v1.mjs';
import { compileDeliveryPackage } from './c19-delivery-package-v1.mjs';
import { buildDefaultBatchTemplateDiversityPolicy, selectDiverseTemplateBatch } from './batch-template-diversity-v1.mjs';
import {
  buildCanonicalTemplateVariabilityRegistry,
  buildDefaultTemplateAutoPolicy,
  composeAutomaticTemplateVariant,
} from './template-variant-composer-v1.mjs';

const context={aspect:'vertical',duration_seconds:9,semantic_roles:['hook','book_reveal','tension','desire_payoff','cta'],available_asset_kinds:['cover']};
const registry=buildCanonicalTemplateVariabilityRegistry();
const autoPolicy=buildDefaultTemplateAutoPolicy();
const byVariant=new Map();
for(let i=0;i<1800;i+=1){
  const receipt=composeAutomaticTemplateVariant({subject_key:`c49-contract-${String(i).padStart(4,'0')}`,seed:49,context,policy:autoPolicy,registry});
  const variant=receipt.template_variant;
  if(!byVariant.has(variant.template_variant_id))byVariant.set(variant.template_variant_id,{candidate_id:`candidate_${variant.template_variant_id}`,template_variant:variant});
}
const candidates=[...byVariant.values()];
assert.ok(candidates.length>=1000,`expected >=1000 unique semantic candidates, got ${candidates.length}`);

const current=selectCurrentTemplateCampaignBatch({candidates,batch_size:12,selection_seed:4901});
assert.equal(current.mode,'current_macro_aware_v2');
assert.equal(current.ordered_selected_candidate_ids.length,12);
assert.equal(current.provenance.receipt.schema,'newboo-batch-template-diversity-receipt-v2');
assert.equal(current.provenance.receipt.min_observed_macro_lookback_distance>=1,true);
assert.equal(validateTemplateCampaignSelection(current).valid,true);
assert.equal(validateTemplateCampaignSelectionProvenance(current.provenance).valid,true);
const reversed=selectCurrentTemplateCampaignBatch({candidates:[...candidates].reverse(),batch_size:12,selection_seed:4901});
assert.deepEqual(reversed,current,'current production selection must be candidate-order invariant');

assert.throws(()=>selectCurrentTemplateCampaignBatch({candidates,batch_size:12,selection_seed:4901,mode:'legacy'}),/unsupported fields/);
assert.throws(()=>selectCurrentTemplateCampaignBatch({candidates:[{...candidates[0],policy_id:'user-injected'}],batch_size:1,selection_seed:1}),/unsupported fields/);
assert.throws(()=>selectCurrentTemplateCampaignBatch({candidates:[{...candidates[0],macro_axes:['typography']}],batch_size:1,selection_seed:1}),/unsupported fields/);
const forgedProvenance=structuredClone(current.provenance);forgedProvenance.policy_id='nbdivpol2_forged';
assert.equal(validateTemplateCampaignSelectionProvenance(forgedProvenance).valid,false);

const selectorCandidates=candidates.map(item=>({candidate_id:item.candidate_id,template_variant:item.template_variant}));
const legacyPolicy=buildDefaultBatchTemplateDiversityPolicy();
const legacyReceipt=selectDiverseTemplateBatch({candidates:selectorCandidates,batch_size:12,seed:4401,policy:legacyPolicy});
const legacy=replayLegacyTemplateCampaignV1({candidates,legacy_receipt:legacyReceipt});
assert.equal(legacy.mode,'legacy_c44_v1_replay');
assert.equal(legacy.provenance.receipt.schema,'newboo-batch-template-diversity-receipt-v1');
assert.deepEqual(legacy.ordered_selected_candidate_ids,legacyReceipt.assignments.map(item=>item.candidate_id));
const forgedLegacy=structuredClone(legacyReceipt);forgedLegacy.batch_id='nbdiv1_forged';
assert.throws(()=>replayLegacyTemplateCampaignV1({candidates,legacy_receipt:forgedLegacy}),/legacy C44 receipt rejected/);

const variantByCandidate=new Map(candidates.map(item=>[item.candidate_id,item.template_variant]));
function fakeRow(candidateId,index){
  const variant=variantByCandidate.get(candidateId);
  return {
    selection_id:`physical-${String(index).padStart(2,'0')}`,
    creative:{
      schema:'newboo-creative-spec-v1',book_id:'book-c49',payload_sha256:'a'.repeat(64),
      template:{id:'book-ad-template-variant',version:'c49-fixture-v1',sha256:'1'.repeat(64)},
      visual_system:{id:variant.axes.visual_system,version:'v2'},structural_variant:variant.axes.structural_layout,
      hook:{source:'c27_narrative_plan',text:'Один проверенный хук',source_ref:'c49:hook'},
      motion:{profile:variant.axes.motion_grammar,version:'v2'},
      art_direction:{mode:'template-variant',algorithm:'c49-contract-fixture',source_cover_sha256:'2'.repeat(64),palette:{background:'#f2efe8',surface:'#ffffff',ink:'#111111',accent:'#d13c2f',secondary:'#315a7d'}},
      seed:49,assets:[{role:'cover',sha256:'2'.repeat(64),media_type:'image/png',uri:'asset://book-c49-cover'}],
      template_variant_id:variant.template_variant_id,
    },
    timeline:{source:'c27:test',policy_version:'c27-v1',duration_ms:9000,frame_count:270},
    requested_delivery_profile_ids:['vertical-c49-v1'],render_assets:[],
  };
}
const materialized=current.ordered_selected_candidate_ids.map((candidateId,index)=>({candidate_id:candidateId,row:fakeRow(candidateId,index)}));
const runtime={class:'FAST',scene_contract_version:'canvas-scene-v1',environment_id:'video-worker-chromium-v1',renderer:{id:'webcodecs-h264',version:'r35-standard-v1'},encoder:{video_codec:'avc1.420028',bitrate_bps:3000000,pixel_format:'yuv420p'},muxer:{id:'ffmpeg-stream-copy-aac',version:'6.1.1'}};
const deliveryProfiles=[{id:'vertical-c49-v1',width:1080,height:1920,fps:30,safe_area_profile:'c26-ui-safe-v1-2026-09-17:generic',platform_ui_profile:'generic',platform_ui_version:'c26-ui-safe-v1-2026-09-17'}];
const request=assembleC19TemplateCampaignRequest({selection:current,materialized_selected:materialized,campaign_id:'c49-contract-production',runtime,delivery_profiles:deliveryProfiles});
assert.equal(request.schema,'framewright-c19-campaign-request-v1');
assert.equal(request.selected.length,12);
assert.equal(request.reserves.length,candidates.length-12);
assert.deepEqual(request.selected.map(row=>row.selection_order),[0,1,2,3,4,5,6,7,8,9,10,11]);
assert.equal(request.selection_provenance.selection_id,current.selection_id);
const packageManifest=compileDeliveryPackage(request);
assert.equal(packageManifest.selection_provenance.selection_id,current.selection_id);
assert.deepEqual(packageManifest.selected.map(row=>row.selection_order),[0,1,2,3,4,5,6,7,8,9,10,11]);
assert.equal(packageManifest.renders.length,12);
assert.equal(packageManifest.reserves.length,candidates.length-12);
assert.equal(packageManifest.renders.some(row=>request.reserves.some(reserve=>reserve.reserve_id===row.selection_id)),false,'reserve received a RenderSpec');

const strippedRequest=structuredClone(request);delete strippedRequest.selection_provenance;for(const row of strippedRequest.selected)delete row.selection_order;
const strippedPackage=compileDeliveryPackage(strippedRequest);
const creativeIdsBySelection=new Map(packageManifest.selected.map(row=>[row.selection_id,row.creative.creative_id]));
for(const row of strippedPackage.selected)assert.equal(row.creative.creative_id,creativeIdsBySelection.get(row.selection_id),'selection metadata changed creative identity');
const renderIdsByKey=new Map(packageManifest.renders.map(row=>[`${row.selection_id}/${row.delivery_profile_id}`,row.render.render_spec_id]));
for(const row of strippedPackage.renders)assert.equal(row.render.render_spec_id,renderIdsByKey.get(`${row.selection_id}/${row.delivery_profile_id}`),'selection metadata changed RenderSpec identity');
assert.equal('selection_provenance' in strippedPackage,false,'legacy-style C19 package invented selection provenance');
assert.ok(strippedPackage.selected.every(row=>!('selection_order' in row)),'legacy-style C19 package invented selection order');

assert.throws(()=>assembleC19TemplateCampaignRequest({selection:current,materialized_selected:materialized.slice(1),campaign_id:'x',runtime,delivery_profiles:deliveryProfiles}),/materialized selected count/);
assert.throws(()=>assembleC19TemplateCampaignRequest({selection:current,materialized_selected:[...materialized,{candidate_id:candidates.find(item=>!current.ordered_selected_candidate_ids.includes(item.candidate_id)).candidate_id,row:fakeRow(current.ordered_selected_candidate_ids[0],99)}],campaign_id:'x',runtime,delivery_profiles:deliveryProfiles}),/materialized selected count|unselected candidate/);
const preordered=structuredClone(materialized);preordered[0].row.selection_order=999;
assert.throws(()=>assembleC19TemplateCampaignRequest({selection:current,materialized_selected:preordered,campaign_id:'x',runtime,delivery_profiles:deliveryProfiles}),/selection_order is server-owned/);
const mismatched=structuredClone(materialized);mismatched[0].row.creative.template_variant_id=variantByCandidate.get(current.ordered_selected_candidate_ids[1]).template_variant_id;
assert.throws(()=>assembleC19TemplateCampaignRequest({selection:current,materialized_selected:mismatched,campaign_id:'x',runtime,delivery_profiles:deliveryProfiles}),/does not match selection receipt/);

console.log(JSON.stringify({
  schema:'c49-template-campaign-selection-acceptance-v1',candidate_count:candidates.length,current_selection_id:current.selection_id,current_policy_id:current.provenance.policy_id,current_batch_id:current.provenance.batch_id,current_selected:current.ordered_selected_candidate_ids.length,current_reserves:request.reserves.length,current_macro_axes:current.provenance.receipt.macro_axes,legacy_selection_id:legacy.selection_id,legacy_policy_id:legacy.provenance.policy_id,legacy_batch_id:legacy.provenance.batch_id,legacy_replay_explicit:true,candidate_order_invariant:true,user_policy_surface_rejected:true,c19_order_preserved:true,c19_selection_provenance_preserved:true,reserves_receive_no_render_specs:true,creative_render_identity_independent_of_selection_metadata:true},null,2));
