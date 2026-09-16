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
import {
  C31_ADAPTER_SCHEMA
} from './c31-platform-export-ingestion.mjs';
import {
  C34_POLICY_SCHEMA,
  buildTrafficPlan
} from './c34-exploration-holdout-selector.mjs';
import {
  I08_PUBLICATION_SCHEMA,
  I08_ATTRIBUTED_EVIDENCE_SCHEMA,
  buildPublicationAttribution,
  ingestAttributedExport
} from './i08-publication-attribution-roundtrip.mjs';

const outDir=path.resolve(process.argv[2]||'artifacts/i08');
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

const portfolio={
  portfolio_id:'portfolio-i08-audit',
  candidates:Array.from({length:6},(_,i)=>({
    creative_id:`creative-${i+1}`,
    render_spec_id:`render-${i+1}`,
    axes:{angle:['premise','conflict','identity'][i%3],hook:`h${1+(i%2)}`}
  }))
};
const learningPolicy={
  schema:C30_POLICY_SCHEMA,
  policy_version:'c30-learning-i08-audit-v1',
  metric_priors:{downstream_open:{alpha:1,beta:19}}
};
const seedEvidence={
  schema:C30_EVIDENCE_SCHEMA,
  evidence_batch_id:'i08-seed-evidence',
  observations:portfolio.candidates.map((candidate,i)=>({
    observation_id:`seed-${i+1}`,
    source:{platform:'seed-fixture',export_id:'seed-export'},
    campaign_id:'seed-campaign',
    placement_id:'seed-placement',
    creative_id:candidate.creative_id,
    render_spec_id:candidate.render_spec_id,
    window_start:'2026-08-01T00:00:00.000Z',
    window_end:'2026-08-08T00:00:00.000Z',
    metrics:{downstream_open:{numerator:[20,40,35,25,2,1][i],denominator:[1000,1000,1000,1000,50,20][i],denominator_kind:'views'}}
  }))
};
const snapshot=buildSelectorPriorSnapshot({portfolio,evidence:seedEvidence,policy:learningPolicy});
const selectorPolicy={
  schema:C34_POLICY_SCHEMA,
  policy_version:'c34-i08-audit-v1',
  experiment_id:'exp-i08-roundtrip',
  primary_metric:'downstream_open',
  assignment_seed:'selector-seed-i08',
  control_creative_id:'creative-1',
  holdout_bps:2000,
  exploration_bps_per_candidate:500,
  exploit_top_k:2,
  min_primary_denominator:100,
  max_adaptive_bps_per_candidate:3500
};
const plan=buildTrafficPlan({snapshot,policy:selectorPolicy});

const arms=[];
for(const candidate of plan.candidates){
  for(const lane of ['holdout','explore','exploit']){
    const armId=candidate.arms[lane];
    if(armId)arms.push({arm_id:armId,lane,creative_id:candidate.creative_id,render_spec_id:candidate.render_spec_id});
  }
}
arms.sort((a,b)=>a.arm_id.localeCompare(b.arm_id));
if(arms.length!==9)throw new Error(`expected 9 nonzero C34 arms, got ${arms.length}`);
const publicationBindings=arms.map((arm,i)=>({
  arm_id:arm.arm_id,
  campaign_id:'campaign-i08',
  placement_id:'organic-short',
  source_creative_key:`published-${String(i+1).padStart(2,'0')}-${arm.lane}`
}));
const manifest=buildPublicationAttribution({traffic_plan:plan,platform:'fixture-organic-short',bindings:publicationBindings});
const manifestReordered=buildPublicationAttribution({traffic_plan:plan,platform:'fixture-organic-short',bindings:[...publicationBindings].reverse()});
if(manifest.schema!==I08_PUBLICATION_SCHEMA)throw new Error('wrong I08 publication schema');
if(stableStringify(manifest)!==stableStringify(manifestReordered))throw new Error('publication binding order changed canonical manifest');
if(manifest.requested_total_bps!==10000)throw new Error('publication requested total did not preserve C34 plan');
if(manifest.bindings.some(x=>x.requested_share_semantics!=='planning_basis_points_not_observed_delivery'))throw new Error('requested share semantics missing');

const rows=manifest.bindings.map((binding,i)=>({
  row_key:`row-${String(i+1).padStart(2,'0')}`,
  campaign:binding.campaign_id,
  placement:binding.placement_id,
  video:binding.source_creative_key,
  start:'2026-09-01T00:00:00Z',
  end:'2026-09-08T00:00:00Z',
  views:String(1000+i*17),
  opens:String(10+(i%5)),
  arm_id:'evil-export-arm',
  lane:'evil-export-lane',
  creative_id:'evil-export-creative',
  render_spec_id:'evil-export-render'
}));
const raw=JSON.stringify({schema:'fixture-organic-export-v1',rows})+'\n';
const exportMeta={platform:'fixture-organic-short',export_id:'fixture-export-i08',source_schema:'fixture-organic-json-v1',raw_sha256:sha(raw)};
const adapter={
  schema:C31_ADAPTER_SCHEMA,
  adapter_id:'fixture-organic-counts',
  adapter_version:'1',
  platform:'fixture-organic-short',
  source_schema:'fixture-organic-json-v1',
  fields:{row_key:'row_key',campaign_id:'campaign',placement_id:'placement',creative_key:'video',window_start:'start',window_end:'end'},
  metrics:{downstream_open:{numerator_field:'opens',denominator_field:'views',denominator_kind:'views'}}
};
const bundle=ingestAttributedExport({publication_manifest:manifest,raw_bytes:raw,export_meta:exportMeta,rows,adapter});
const reorderedBundle=ingestAttributedExport({publication_manifest:manifest,raw_bytes:raw,export_meta:exportMeta,rows:[...rows].reverse(),adapter});
if(bundle.schema!==I08_ATTRIBUTED_EVIDENCE_SCHEMA)throw new Error('wrong I08 attributed evidence schema');
if(stableStringify(bundle)!==stableStringify(reorderedBundle))throw new Error('parsed row order changed attributed export output');
canonicalizeEvidence({portfolio,evidence:bundle.c30_evidence});
if(bundle.attributions.length!==rows.length||bundle.c30_evidence.observations.length!==rows.length)throw new Error('attribution/evidence row count drift');
if(bundle.attributions.some(x=>x.arm_id==='evil-export-arm'||x.lane==='evil-export-lane'||x.creative_id==='evil-export-creative'||x.render_spec_id==='evil-export-render'))throw new Error('raw export overrode canonical attribution');
if(bundle.attributions.some(x=>x.requested_share_semantics!=='planning_basis_points_not_observed_delivery'))throw new Error('attribution requested-share semantics drift');
if(bundle.observed_delivery_semantics!=='platform_export_counts_only_no_requested_share_fidelity_claim')throw new Error('observed-delivery boundary missing');
const attributionByObservation=new Map(bundle.attributions.map(x=>[x.observation_id,x]));
if(attributionByObservation.size!==bundle.attributions.length)throw new Error('duplicate observation attribution');
for(const observation of bundle.c30_evidence.observations){
  const attribution=attributionByObservation.get(observation.observation_id);
  if(!attribution)throw new Error(`missing attribution for ${observation.observation_id}`);
  if(observation.creative_id!==attribution.creative_id||observation.render_spec_id!==attribution.render_spec_id)throw new Error(`canonical identity drift for ${observation.observation_id}`);
}

const controlAttrs=bundle.attributions.filter(x=>x.creative_id==='creative-1');
const controlLanes=new Set(controlAttrs.map(x=>x.lane));
if(!controlLanes.has('holdout')||!controlLanes.has('explore'))throw new Error(`control creative did not survive as distinct holdout/explore publications: ${JSON.stringify([...controlLanes])}`);
const holdout=controlAttrs.find(x=>x.lane==='holdout'),explore=controlAttrs.find(x=>x.lane==='explore');
if(holdout.render_spec_id!==explore.render_spec_id)throw new Error('control holdout/explore should share canonical render identity');
if(holdout.arm_id===explore.arm_id||holdout.source_creative_key===explore.source_creative_key)throw new Error('control holdout/explore lost distinct publication attribution');

const rejected={};
const tamperedPlan=clone(plan);tamperedPlan.traffic_plan_id='c34t1_deadbeef';
rejected.tampered_plan=mustThrow('tampered plan',()=>buildPublicationAttribution({traffic_plan:tamperedPlan,platform:'fixture-organic-short',bindings:publicationBindings}),'traffic_plan_id mismatch');
rejected.missing_arm=mustThrow('missing arm',()=>buildPublicationAttribution({traffic_plan:plan,platform:'fixture-organic-short',bindings:publicationBindings.slice(1)}),'cover every nonzero arm exactly once');
const duplicateArm=clone(publicationBindings);duplicateArm[duplicateArm.length-1].arm_id=duplicateArm[0].arm_id;
rejected.duplicate_arm=mustThrow('duplicate arm',()=>buildPublicationAttribution({traffic_plan:plan,platform:'fixture-organic-short',bindings:duplicateArm}),'duplicate publication arm binding');
const unknownArm=clone(publicationBindings);unknownArm[unknownArm.length-1].arm_id='c34a1_unknown';
rejected.unknown_arm=mustThrow('unknown arm',()=>buildPublicationAttribution({traffic_plan:plan,platform:'fixture-organic-short',bindings:unknownArm}),'unknown publication arm_id');
const duplicateSource=clone(publicationBindings);duplicateSource[1].campaign_id=duplicateSource[0].campaign_id;duplicateSource[1].placement_id=duplicateSource[0].placement_id;duplicateSource[1].source_creative_key=duplicateSource[0].source_creative_key;
rejected.duplicate_source=mustThrow('duplicate source',()=>buildPublicationAttribution({traffic_plan:plan,platform:'fixture-organic-short',bindings:duplicateSource}),'duplicate publication source key');
const injectedDerived=clone(publicationBindings);injectedDerived[0].lane='holdout';
rejected.derived_field_injection=mustThrow('derived field injection',()=>buildPublicationAttribution({traffic_plan:plan,platform:'fixture-organic-short',bindings:injectedDerived}),'must not supply derived field lane');
const unknownRow=clone(rows);unknownRow[0].video='not-published';
rejected.unbound_export_row=mustThrow('unbound export row',()=>ingestAttributedExport({publication_manifest:manifest,raw_bytes:raw,export_meta:exportMeta,rows:unknownRow,adapter}),'unbound platform row');
rejected.raw_tamper=mustThrow('raw tamper',()=>ingestAttributedExport({publication_manifest:manifest,raw_bytes:raw+'tamper',export_meta:exportMeta,rows,adapter}),'raw export sha256 mismatch');
rejected.platform_mismatch=mustThrow('platform mismatch',()=>ingestAttributedExport({publication_manifest:manifest,raw_bytes:raw,export_meta:{...exportMeta,platform:'other-platform'},rows,adapter}),'export/publication platform mismatch');
const tamperedManifest=clone(manifest);tamperedManifest.bindings[0].requested_bps+=1;
rejected.manifest_tamper=mustThrow('manifest tamper',()=>ingestAttributedExport({publication_manifest:tamperedManifest,raw_bytes:raw,export_meta:exportMeta,rows,adapter}),'publication_manifest_id mismatch');

const gates={
  c34_plan_content_address_verified:true,
  exact_nonzero_arm_coverage:manifest.bindings.length===arms.length&&manifest.bindings.length===9,
  requested_bps_preserved_as_planning_metadata:manifest.requested_total_bps===10000,
  no_observed_delivery_fidelity_claim:bundle.observed_delivery_semantics==='platform_export_counts_only_no_requested_share_fidelity_claim',
  publication_manifest_order_invariant:stableStringify(manifest)===stableStringify(manifestReordered),
  c31_row_order_roundtrip_invariant:stableStringify(bundle)===stableStringify(reorderedBundle),
  c30_evidence_still_valid:true,
  attribution_complete:bundle.attributions.length===bundle.c30_evidence.observations.length,
  same_control_render_distinct_lanes:holdout.render_spec_id===explore.render_spec_id&&holdout.arm_id!==explore.arm_id,
  hostile_export_attribution_ignored:bundle.attributions.every(x=>!String(x.arm_id).startsWith('evil')&&!String(x.lane).startsWith('evil')),
  all_negative_cases_rejected:Object.keys(rejected).length===10
};
if(!Object.values(gates).every(Boolean))throw new Error(`I08 audit gate failed: ${JSON.stringify(gates)}`);

const report={
  schema:'framewright-i08-publication-attribution-roundtrip-audit-v1',
  boundary:'synthetic publication/export fixture; validates attribution provenance only, not platform traffic-share fidelity or campaign lift',
  gates,
  trafficPlan:{traffic_plan_id:plan.traffic_plan_id,requested_total_bps:plan.candidates.reduce((sum,x)=>sum+x.total_bps,0),nonzeroArms:arms.length},
  publicationManifest:manifest,
  attributedEvidence:{
    attributed_evidence_id:bundle.attributed_evidence_id,
    ingestion_id:bundle.ingestion_id,
    evidence_batch_id:bundle.evidence_batch_id,
    observation_count:bundle.c30_evidence.observations.length,
    attribution_count:bundle.attributions.length,
    requested_share_semantics:bundle.requested_share_semantics,
    observed_delivery_semantics:bundle.observed_delivery_semantics,
    controlRoundTrip:{
      creative_id:'creative-1',render_spec_id:holdout.render_spec_id,
      holdout:{arm_id:holdout.arm_id,source_creative_key:holdout.source_creative_key,observation_id:holdout.observation_id},
      explore:{arm_id:explore.arm_id,source_creative_key:explore.source_creative_key,observation_id:explore.observation_id}
    }
  },
  rejected
};
fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2)+'\n');
const summary=`# I08 publication attribution round-trip audit\n\n`+
`C34 nonzero arms published: **${arms.length}**. Synthetic export rows: **${rows.length}**. C30 observations after C31 ingestion: **${bundle.c30_evidence.observations.length}**.\n\n`+
`PASS: exact arm coverage, content-addressed C34 plan + I08 manifest validation, deterministic publication/export replay, C30-compatible evidence, observation-id attribution sidecar, hostile export-column rejection, and distinct holdout/explore attribution for the same control creative/render identity.\n\n`+
`Critical boundary: C34 basis points are stored only as **requested planning metadata**. This audit does **not** claim an organic platform delivered those viewer shares. Actual delivery and outcomes must come from a real platform export.\n`;
fs.writeFileSync(path.join(outDir,'summary.md'),summary);
console.log(summary);
console.log(JSON.stringify({gates,publication_manifest_id:manifest.publication_manifest_id,attributed_evidence_id:bundle.attributed_evidence_id,ingestion_id:bundle.ingestion_id,evidence_batch_id:bundle.evidence_batch_id},null,2));
