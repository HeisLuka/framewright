#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  C30_EVIDENCE_SCHEMA,
  C30_POLICY_SCHEMA,
  buildSelectorPriorSnapshot,
  canonicalizeEvidence,
  stableStringify
} from './c30-campaign-learning.mjs';
import { C31_ADAPTER_SCHEMA } from './c31-platform-export-ingestion.mjs';
import { C34_POLICY_SCHEMA,buildTrafficPlan } from './c34-exploration-holdout-selector.mjs';
import { buildC37ScreeningDesign } from './c37-doe-identifiability.mjs';
import { buildBlockedPublicationPlan } from './i09-blocked-publication-scheduler.mjs';
import {
  buildPublicationAttribution as buildI08PublicationAttribution,
  ingestAttributedExport as ingestI08AttributedExport
} from './i08-publication-attribution-roundtrip.mjs';
import {
  I10_SET_SCHEMA,
  I10_PUBLICATION_SCHEMA,
  I10_ATTRIBUTED_EVIDENCE_SCHEMA,
  assignmentSetFromC34,
  assignmentSetFromI09,
  validateAssignmentSet,
  buildPublicationManifest,
  validatePublicationManifest,
  buildC31JoinForPlatform,
  ingestAttributedExport
} from './i10-general-publication-attribution.mjs';

const outDir=path.resolve(process.argv[2]||'artifacts/i10');
fs.mkdirSync(outDir,{recursive:true});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const mustThrow=(label,fn,needle)=>{
  let message='';
  try{fn();}catch(error){message=String(error?.message||error);}
  if(!message)throw new Error(`${label}: expected rejection`);
  if(needle&&!message.includes(needle))throw new Error(`${label}: wrong rejection: ${message}`);
  return message;
};
function makeAdapter(platform){return {
  schema:C31_ADAPTER_SCHEMA,
  adapter_id:`i10-fixture-${platform}`,
  adapter_version:'1',
  platform,
  source_schema:'i10-fixture-export-v1',
  fields:{row_key:'row_key',campaign_id:'campaign',placement_id:'placement',creative_key:'video',window_start:'start',window_end:'end'},
  metrics:{downstream_open:{numerator_field:'opens',denominator_field:'views',denominator_kind:'views'}}
};}
function exportBundle(platform,rows,exportId){
  const raw=JSON.stringify({schema:'i10-fixture-export-v1',platform,rows})+'\n';
  return {raw,meta:{platform,export_id:exportId,source_schema:'i10-fixture-export-v1',raw_sha256:sha(raw)},adapter:makeAdapter(platform)};
}
function sourceRowsFromBindings(bindings,prefix){return bindings.map((binding,i)=>({
  row_key:`${prefix}-${String(i+1).padStart(3,'0')}`,
  campaign:binding.campaign_id,
  placement:binding.placement_id,
  video:binding.source_creative_key,
  start:'2026-09-01T00:00:00Z',
  end:'2026-09-08T00:00:00Z',
  views:String(1000+i*31),
  opens:String(10+(i%7)),
  assignment_kind:'evil-export-assignment-kind',
  lane:'evil-export-lane',
  treatment_ref:'evil-export-treatment',
  creative_id:'evil-export-creative',
  render_spec_id:'evil-export-render'
}));}

// --- C34 compatibility path -------------------------------------------------
const c34Portfolio={
  portfolio_id:'portfolio-i10-c34',
  candidates:Array.from({length:6},(_,i)=>({creative_id:`c34-creative-${i+1}`,render_spec_id:`c34-render-${i+1}`,axes:{angle:['premise','conflict','identity'][i%3],hook:`h${1+(i%2)}`}}))
};
const c34LearningPolicy={schema:C30_POLICY_SCHEMA,policy_version:'c30-i10-audit-v1',metric_priors:{downstream_open:{alpha:1,beta:19}}};
const c34SeedEvidence={
  schema:C30_EVIDENCE_SCHEMA,
  evidence_batch_id:'i10-c34-seed',
  observations:c34Portfolio.candidates.map((candidate,i)=>({
    observation_id:`c34-seed-${i+1}`,
    source:{platform:'seed-fixture',export_id:'seed-export'},
    campaign_id:'seed-campaign',placement_id:'seed-placement',creative_id:candidate.creative_id,render_spec_id:candidate.render_spec_id,
    window_start:'2026-08-01T00:00:00.000Z',window_end:'2026-08-08T00:00:00.000Z',
    metrics:{downstream_open:{numerator:[20,40,35,25,2,1][i],denominator:[1000,1000,1000,1000,50,20][i],denominator_kind:'views'}}
  }))
};
const c34Snapshot=buildSelectorPriorSnapshot({portfolio:c34Portfolio,evidence:c34SeedEvidence,policy:c34LearningPolicy});
const c34SelectorPolicy={
  schema:C34_POLICY_SCHEMA,policy_version:'c34-i10-audit-v1',experiment_id:'exp-i10-c34',primary_metric:'downstream_open',assignment_seed:'i10-c34-seed',
  control_creative_id:'c34-creative-1',holdout_bps:2000,exploration_bps_per_candidate:500,exploit_top_k:2,min_primary_denominator:100,max_adaptive_bps_per_candidate:3500
};
const c34Plan=buildTrafficPlan({snapshot:c34Snapshot,policy:c34SelectorPolicy});
const c34Platform='fixture-c34-organic';
const c34Set=assignmentSetFromC34({traffic_plan:c34Plan,platform:c34Platform});
validateAssignmentSet(c34Set);
if(c34Set.schema!==I10_SET_SCHEMA||c34Set.source_kind!=='c34_selector'||c34Set.assignment_count!==9)throw new Error(`unexpected C34 assignment set ${c34Set.source_kind}/${c34Set.assignment_count}`);
const c34Bindings=c34Set.assignments.map((assignment,i)=>({
  source_assignment_ref:assignment.source_assignment_ref,
  campaign_id:'campaign-i10-c34',placement_id:'organic-short',source_creative_key:`c34-published-${String(i+1).padStart(2,'0')}`,published_at:`2026-09-${String(1+i).padStart(2,'0')}T12:00:00Z`
}));
const c34Manifest=buildPublicationManifest({assignment_set:c34Set,bindings:c34Bindings});
const c34ManifestReordered=buildPublicationManifest({assignment_set:c34Set,bindings:[...c34Bindings].reverse()});
validatePublicationManifest(c34Manifest);
if(c34Manifest.schema!==I10_PUBLICATION_SCHEMA||c34Manifest.coverage!=='complete')throw new Error('C34 I10 publication manifest incomplete');
if(stableStringify(c34Manifest)!==stableStringify(c34ManifestReordered))throw new Error('C34 I10 publication binding order changed manifest');

const i08Bindings=c34Bindings.map(binding=>({arm_id:binding.source_assignment_ref,campaign_id:binding.campaign_id,placement_id:binding.placement_id,source_creative_key:binding.source_creative_key}));
const i08Manifest=buildI08PublicationAttribution({traffic_plan:c34Plan,platform:c34Platform,bindings:i08Bindings});
const c34Rows=sourceRowsFromBindings(c34Manifest.bindings,'c34-row');
const c34Export=exportBundle(c34Platform,c34Rows,'i10-c34-export');
const i10C34=ingestAttributedExport({publication_manifest:c34Manifest,raw_bytes:c34Export.raw,export_meta:c34Export.meta,rows:c34Rows,adapter:c34Export.adapter});
const i10C34Reordered=ingestAttributedExport({publication_manifest:c34Manifest,raw_bytes:c34Export.raw,export_meta:c34Export.meta,rows:[...c34Rows].reverse(),adapter:c34Export.adapter});
const i08C34=ingestI08AttributedExport({publication_manifest:i08Manifest,raw_bytes:c34Export.raw,export_meta:c34Export.meta,rows:c34Rows,adapter:c34Export.adapter});
if(i10C34.schema!==I10_ATTRIBUTED_EVIDENCE_SCHEMA)throw new Error('wrong I10 attributed evidence schema');
if(stableStringify(i10C34.c30_evidence)!==stableStringify(i08C34.c30_evidence))throw new Error('I10 changed C34 C30 evidence vs canonical I08');
if(stableStringify(i10C34.c30_evidence)!==stableStringify(i10C34Reordered.c30_evidence)||stableStringify(i10C34.attributions)!==stableStringify(i10C34Reordered.attributions))throw new Error('I10 C34 export row order changed output');
canonicalizeEvidence({portfolio:c34Portfolio,evidence:i10C34.c30_evidence});
const i08AttrByArm=new Map(i08C34.attributions.map(row=>[row.arm_id,row]));
for(const attr of i10C34.attributions){
  if(attr.assignment_kind!=='c34_selector_arm')throw new Error('C34 attribution lost assignment kind');
  const legacy=i08AttrByArm.get(attr.source_assignment_ref);if(!legacy)throw new Error(`I10 C34 arm missing from I08 ${attr.source_assignment_ref}`);
  if(attr.assignment_context.lane!==legacy.lane||attr.assignment_context.requested_bps!==legacy.requested_bps)throw new Error(`I10 C34 lane/requested_bps drift for ${attr.source_assignment_ref}`);
  if(attr.creative_id!==legacy.creative_id||attr.render_spec_id!==legacy.render_spec_id)throw new Error(`I10 C34 canonical identity drift for ${attr.source_assignment_ref}`);
  if(attr.assignment_context.requested_share_semantics!=='planning_basis_points_not_observed_delivery')throw new Error('C34 requested-share boundary lost');
}
if(i10C34.attributions.some(attr=>attr.assignment_context.lane==='evil-export-lane'||attr.creative_id==='evil-export-creative'||attr.render_spec_id==='evil-export-render'))throw new Error('C34 hostile raw attribution overrode server manifest');

// --- I09 blocked-design path ------------------------------------------------
const c37=buildC37ScreeningDesign();
const selected=c37.global_main_effects.design.candidates;
const i09Platforms=['youtube_shorts','instagram_reels'];
const i09Treatments=selected.map((candidate,i)=>({
  treatment_id:candidate.id,creative_id:`i09-creative-${i+1}`,axes:{angle:candidate.angle,hook_index:candidate.hook_index,reveal:candidate.reveal},
  render_specs:i09Platforms.map(platform=>({platform,render_spec_id:`i09-render-${i+1}-${platform}`}))
}));
const i09Blocks=i09Platforms.map((platform,replicate_index)=>({
  block_id:`i09-block-${replicate_index}`,replicate_index,platform,account_id:`account-${platform}`,context:{fixture_block:true,platform},
  slots:Array.from({length:8},(_,position)=>({slot_id:`i09-${platform}-slot-${position}`,position,scheduled_at:`2026-09-${String(10+replicate_index).padStart(2,'0')}T${String(8+position).padStart(2,'0')}:00:00Z`}))
}));
const i09Plan=buildBlockedPublicationPlan({experiment_id:'exp-i10-i09',policy_version:'i09-i10-audit-v1',assignment_seed:'i10-i09-seed',design_ref:'c37-global-main-effects-8run',treatments:i09Treatments,blocks:i09Blocks});
const i09Set=assignmentSetFromI09(i09Plan);
validateAssignmentSet(i09Set);
if(i09Set.source_kind!=='i09_blocked'||i09Set.assignment_count!==16)throw new Error(`unexpected I09 assignment set ${i09Set.source_kind}/${i09Set.assignment_count}`);
if(i09Set.assignments.some(row=>row.assignment_kind!=='i09_blocked_opportunity'||row.assignment_unit!=='publication_opportunity'||Object.prototype.hasOwnProperty.call(row.context,'lane')))throw new Error('I09 assignment set was relabelled as selector-lane semantics');
const i09Bindings=i09Set.assignments.map((assignment,i)=>({
  source_assignment_ref:assignment.source_assignment_ref,campaign_id:`campaign-${assignment.platform}`,placement_id:'organic-short',source_creative_key:`i09-published-${String(i+1).padStart(3,'0')}`,published_at:assignment.context.scheduled_at
}));
const i09Manifest=buildPublicationManifest({assignment_set:i09Set,bindings:i09Bindings});
if(i09Manifest.coverage!=='complete'||i09Manifest.bound_assignment_count!==16)throw new Error('I09 generic publication manifest incomplete');
const partialManifest=buildPublicationManifest({assignment_set:i09Set,bindings:i09Bindings.slice(0,3)});
if(partialManifest.coverage!=='partial'||partialManifest.bound_assignment_count!==3||partialManifest.planned_assignment_count!==16)throw new Error('I10 partial execution coverage semantics failed');

const i09Results={};
for(const platform of i09Platforms){
  const platformBindings=i09Manifest.bindings.filter(row=>row.platform===platform);
  if(platformBindings.length!==8)throw new Error(`${platform}: expected 8 executed blocked opportunities`);
  const rows=sourceRowsFromBindings(platformBindings,platform.replace('_','-'));
  const exp=exportBundle(platform,rows,`i10-${platform}-export`);
  const result=ingestAttributedExport({publication_manifest:i09Manifest,raw_bytes:exp.raw,export_meta:exp.meta,rows,adapter:exp.adapter});
  const platformPortfolio={portfolio_id:`i10-i09-${platform}`,candidates:i09Treatments.map(t=>({creative_id:t.creative_id,render_spec_id:t.render_specs.find(x=>x.platform===platform).render_spec_id,axes:t.axes}))};
  canonicalizeEvidence({portfolio:platformPortfolio,evidence:result.c30_evidence});
  if(result.attributions.length!==8||result.c30_evidence.observations.length!==8)throw new Error(`${platform}: I09 attribution/evidence count drift`);
  for(const attr of result.attributions){
    if(attr.source_kind!=='i09_blocked'||attr.assignment_kind!=='i09_blocked_opportunity'||attr.assignment_unit!=='publication_opportunity')throw new Error(`${platform}: I09 generic attribution kind drift`);
    if(Object.prototype.hasOwnProperty.call(attr.assignment_context,'lane'))throw new Error(`${platform}: fake C34 lane appeared in I09 attribution`);
    if(!attr.assignment_context.block_id||!attr.assignment_context.slot_id||!Number.isInteger(attr.assignment_context.slot_position))throw new Error(`${platform}: blocked opportunity provenance missing`);
    if(attr.exposure_semantics!=='publication_opportunity_only_platform_controls_viewer_delivery')throw new Error(`${platform}: viewer exposure semantics drift`);
    if(attr.creative_id==='evil-export-creative'||attr.render_spec_id==='evil-export-render'||attr.treatment_ref==='evil-export-treatment')throw new Error(`${platform}: hostile raw attribution overrode server manifest`);
  }
  i09Results[platform]=result;
}

// --- Fail-closed checks ------------------------------------------------------
const rejected={};
const tamperedSet=clone(i09Set);tamperedSet.assignments[0].treatment_ref='tampered';
rejected.tampered_assignment_set=mustThrow('tampered assignment set',()=>buildPublicationManifest({assignment_set:tamperedSet,bindings:i09Bindings}),'assignment_set_id mismatch');
const unknownBinding=clone(i09Bindings);unknownBinding[0].source_assignment_ref='unknown-assignment';
rejected.unknown_assignment=mustThrow('unknown assignment',()=>buildPublicationManifest({assignment_set:i09Set,bindings:unknownBinding}),'unknown publication source_assignment_ref');
const duplicateBinding=clone(i09Bindings);duplicateBinding[1].source_assignment_ref=duplicateBinding[0].source_assignment_ref;
rejected.duplicate_assignment_binding=mustThrow('duplicate assignment binding',()=>buildPublicationManifest({assignment_set:i09Set,bindings:duplicateBinding}),'duplicate publication source_assignment_ref');
const injected=clone(i09Bindings);injected[0].assignment_kind='c34_selector_arm';
rejected.derived_field_injection=mustThrow('derived field injection',()=>buildPublicationManifest({assignment_set:i09Set,bindings:injected}),'must not supply derived field assignment_kind');
const duplicateSource=clone(i09Bindings);duplicateSource[1].campaign_id=duplicateSource[0].campaign_id;duplicateSource[1].placement_id=duplicateSource[0].placement_id;duplicateSource[1].source_creative_key=duplicateSource[0].source_creative_key;
if(i09Set.assignments.find(x=>x.source_assignment_ref===duplicateSource[1].source_assignment_ref).platform===i09Set.assignments.find(x=>x.source_assignment_ref===duplicateSource[0].source_assignment_ref).platform)rejected.duplicate_source=mustThrow('duplicate source',()=>buildPublicationManifest({assignment_set:i09Set,bindings:duplicateSource}),'duplicate publication source key');
else{
  const samePlatformPair=i09Bindings.map((b,i)=>({b,i,a:i09Set.assignments.find(x=>x.source_assignment_ref===b.source_assignment_ref)})).reduce((acc,row,_,arr)=>acc||arr.find(other=>other.i!==row.i&&other.a.platform===row.a.platform)?[row,arr.find(other=>other.i!==row.i&&other.a.platform===row.a.platform)]:acc,null);
  const dup=clone(i09Bindings);dup[samePlatformPair[1].i].campaign_id=dup[samePlatformPair[0].i].campaign_id;dup[samePlatformPair[1].i].placement_id=dup[samePlatformPair[0].i].placement_id;dup[samePlatformPair[1].i].source_creative_key=dup[samePlatformPair[0].i].source_creative_key;
  rejected.duplicate_source=mustThrow('duplicate source',()=>buildPublicationManifest({assignment_set:i09Set,bindings:dup}),'duplicate publication source key');
}
const badPublished=clone(i09Bindings);badPublished[0].published_at='not-a-date';
rejected.invalid_published_at=mustThrow('invalid published time',()=>buildPublicationManifest({assignment_set:i09Set,bindings:badPublished}),'is not a valid date-time');
const tamperedManifest=clone(i09Manifest);tamperedManifest.bindings[0].treatment_ref='tampered';
rejected.tampered_manifest=mustThrow('tampered manifest',()=>buildC31JoinForPlatform(tamperedManifest,'youtube_shorts'),'publication_manifest_id mismatch');
rejected.no_platform_bindings=mustThrow('no platform bindings',()=>buildC31JoinForPlatform(i09Manifest,'tiktok'),'has no bindings for platform');
const youtubeBindings=i09Manifest.bindings.filter(x=>x.platform==='youtube_shorts');
const youtubeRows=sourceRowsFromBindings(youtubeBindings,'negative-youtube');
const youtubeExport=exportBundle('youtube_shorts',youtubeRows,'i10-negative-youtube');
rejected.adapter_export_platform_mismatch=mustThrow('adapter/export mismatch',()=>ingestAttributedExport({publication_manifest:i09Manifest,raw_bytes:youtubeExport.raw,export_meta:{...youtubeExport.meta,platform:'instagram_reels'},rows:youtubeRows,adapter:youtubeExport.adapter}),'adapter/export platform mismatch');
const unknownRows=clone(youtubeRows);unknownRows[0].video='not-published';
rejected.unbound_export_row=mustThrow('unbound row',()=>ingestAttributedExport({publication_manifest:i09Manifest,raw_bytes:youtubeExport.raw,export_meta:youtubeExport.meta,rows:unknownRows,adapter:youtubeExport.adapter}),'unbound platform row');
rejected.raw_sha_tamper=mustThrow('raw sha tamper',()=>ingestAttributedExport({publication_manifest:i09Manifest,raw_bytes:youtubeExport.raw+'tamper',export_meta:youtubeExport.meta,rows:youtubeRows,adapter:youtubeExport.adapter}),'raw export sha256 mismatch');

const gates={
  c34_assignment_set_has_nine_arms:c34Set.assignment_count===9,
  c34_i10_c30_evidence_matches_i08:stableStringify(i10C34.c30_evidence)===stableStringify(i08C34.c30_evidence),
  c34_lane_and_requested_share_preserved:i10C34.attributions.every(attr=>i08AttrByArm.get(attr.source_assignment_ref)?.lane===attr.assignment_context.lane&&i08AttrByArm.get(attr.source_assignment_ref)?.requested_bps===attr.assignment_context.requested_bps),
  c34_hostile_export_attribution_ignored:i10C34.attributions.every(attr=>attr.creative_id!=='evil-export-creative'&&attr.render_spec_id!=='evil-export-render'),
  i09_assignment_set_has_sixteen_opportunities:i09Set.assignment_count===16,
  i09_multi_platform_roundtrip:i09Platforms.every(platform=>i09Results[platform]?.attributions.length===8),
  i09_block_slot_treatment_provenance_preserved:i09Platforms.every(platform=>i09Results[platform].attributions.every(attr=>attr.assignment_context.block_id&&attr.assignment_context.slot_id&&attr.treatment_ref)),
  i09_not_relabelled_as_c34_lane:i09Platforms.every(platform=>i09Results[platform].attributions.every(attr=>!Object.prototype.hasOwnProperty.call(attr.assignment_context,'lane'))),
  partial_publication_manifest_supported:partialManifest.coverage==='partial'&&partialManifest.bound_assignment_count===3,
  c34_export_row_order_invariant:stableStringify(i10C34.attributions)===stableStringify(i10C34Reordered.attributions),
  all_negative_cases_rejected:Object.keys(rejected).length===11
};
if(!Object.values(gates).every(Boolean))throw new Error(`I10 audit gate failed: ${JSON.stringify(gates)}`);

const report={
  schema:'framewright-i10-general-publication-attribution-audit-v1',
  boundary:'synthetic source-shaped exports; validates semantic-preserving attribution plumbing only, not delivery fidelity or campaign effects',
  gates,
  c34:{assignment_set_id:c34Set.assignment_set_id,publication_manifest_id:c34Manifest.publication_manifest_id,attributed_evidence_id:i10C34.attributed_evidence_id,legacy_i08_publication_manifest_id:i08Manifest.publication_manifest_id,observation_count:i10C34.c30_evidence.observations.length},
  i09:{assignment_set_id:i09Set.assignment_set_id,publication_manifest_id:i09Manifest.publication_manifest_id,planned_assignments:i09Set.assignment_count,platform_results:Object.fromEntries(i09Platforms.map(platform=>[platform,{attributed_evidence_id:i09Results[platform].attributed_evidence_id,observation_count:i09Results[platform].c30_evidence.observations.length}]))},
  rejected
};
fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2)+'\n');
const summary=`# I10 generalized publication attribution audit\n\n`+
`C34 compatibility: **9 selector arms**, with I10 producing byte-equivalent canonical C30 evidence to I08 while preserving lane/requested-bps sidecar semantics.\n\n`+
`I09 support: **16 blocked publication opportunities** across two platform exports, each returning canonical C30 evidence plus block/slot/treatment attribution with **no fake C34 lane field**. Partial publication manifests are supported for incremental execution.\n\n`+
`Boundary: this proves semantic-preserving attribution plumbing over synthetic source-shaped exports only. It does not prove platform delivery, viewer randomization, campaign lift or causal effects.\n`;
fs.writeFileSync(path.join(outDir,'summary.md'),summary);
console.log(summary);
console.log(JSON.stringify({gates,c34_assignment_set_id:c34Set.assignment_set_id,i09_assignment_set_id:i09Set.assignment_set_id,rejected:Object.keys(rejected)},null,2));
