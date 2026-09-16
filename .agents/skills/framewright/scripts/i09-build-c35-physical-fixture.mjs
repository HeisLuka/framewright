#!/usr/bin/env node
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

import { processCreativeIngress } from '../../../../contracts/creative-ingress-v1.mjs';
import { computeContextHash } from '../../../../contracts/creative-proposal-v1.mjs';
import { computeCopyLanguageHash } from '../../../../contracts/compositional-copy-v1.mjs';

const root=path.resolve(process.cwd());
const htmlPath=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c27-i09.html');
const basePayloadPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-c26/payload-paper-short-youtube_shorts.json');
const outDir=path.resolve(process.argv[4]||'artifacts/i09/input');
await fs.mkdir(outDir,{recursive:true});

const readJson=async filename=>JSON.parse(await fs.readFile(filename,'utf8'));
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const stablePath=filename=>path.relative(root,filename).split(path.sep).join('/');

const base=await readJson(basePayloadPath);
const htmlSha=sha256(await fs.readFile(htmlPath));
const coverPath=path.resolve(path.dirname(htmlPath),base.cover_url);
const coverSha=sha256(await fs.readFile(coverPath));

const pack={
  schema:'newboo-context-pack-v1',
  context_pack_id:`ctx_i09_${base.book_id}_r1`,
  revision:1,
  context_hash:'',
  account:{account_id:'account_i09_fixture'},
  books:[{
    book_id:base.book_id,
    title:base.title,
    author:base.author,
    facts:[
      {fact_id:'fact_premise',kind:'premise',value:base.hook,source_ref:`i09:${base.book_id}:premise`},
      {fact_id:'fact_conflict',kind:'conflict',value:'The disappearance repeats each midnight.',source_ref:`i09:${base.book_id}:conflict`},
      {fact_id:'fact_promise',kind:'promise',value:'The mystery asks whether the next disappearance can be stopped.',source_ref:`i09:${base.book_id}:promise`},
    ],
    creative_atoms:[
      {atom_id:'atom_hook',role:'hook',angle_types:['conflict'],text:base.hook,source_fact_ids:['fact_premise'],spoiler_level:0},
      {atom_id:'atom_tension',role:'tension',angle_types:['conflict'],text:'The disappearance repeats each midnight.',source_fact_ids:['fact_conflict'],spoiler_level:0},
      {atom_id:'atom_payoff',role:'payoff',angle_types:['conflict'],text:'Can anyone stop the next disappearance?',source_fact_ids:['fact_promise'],spoiler_level:1},
    ],
    assets:[{asset_id:'asset_cover',role:'cover',sha256:coverSha,media_type:'image/png'}],
  }],
  ctas:[{cta_id:'cta_open',text:base.cta,treatments:['intent','direct']}],
  capabilities:{
    angle_types:['conflict'],
    duration_seconds:[9],
    fps:[30],
    visual_systems:['paper','swiss','newspaper'],
    delivery_profiles:['youtube_shorts'],
    reveal_timings:['late'],
    cta_treatments:['intent'],
  },
  constraints:{max_spoiler_level:1,max_body_atoms:2},
};
pack.context_hash=computeContextHash(pack);

const language={
  schema:'newboo-copy-language-v1',
  copy_language_id:`copylang_i09_${base.book_id}_r1`,
  copy_language_hash:'',
  context_pack_id:pack.context_pack_id,
  context_hash:pack.context_hash,
  locale:'en-US',
  books:[{
    book_id:base.book_id,
    surface_forms:[
      {form_id:'form_premise',fact_id:'fact_premise',surface_type:'clause',text:'one name disappears from the station board at midnight',spoiler_level:0,composition_groups:['core_arc']},
      {form_id:'form_conflict',fact_id:'fact_conflict',surface_type:'clause',text:'the disappearance keeps repeating',spoiler_level:0,composition_groups:['core_arc']},
      {form_id:'form_promise',fact_id:'fact_promise',surface_type:'question_body',text:'the next disappearance can be stopped',spoiler_level:1,composition_groups:['core_arc']},
    ],
    templates:[
      {template_id:'tpl_hook',role:'hook',angle_types:['conflict'],parts:[{kind:'literal',text:'What if '},{kind:'slot',slot_id:'premise',fact_kinds:['premise'],surface_types:['clause']},{kind:'literal',text:'?'}],require_shared_group:false,allow_fact_reuse:false,max_output_chars:110},
      {template_id:'tpl_tension',role:'tension',angle_types:['conflict'],parts:[{kind:'literal',text:'Then '},{kind:'slot',slot_id:'conflict',fact_kinds:['conflict'],surface_types:['clause']},{kind:'literal',text:'.'}],require_shared_group:false,allow_fact_reuse:false,max_output_chars:100},
      {template_id:'tpl_payoff',role:'payoff',angle_types:['conflict'],parts:[{kind:'literal',text:'So: can '},{kind:'slot',slot_id:'question',fact_kinds:['promise'],surface_types:['question_body']},{kind:'literal',text:'?'}],require_shared_group:false,allow_fact_reuse:false,max_output_chars:110},
    ],
  }],
};
language.copy_language_hash=computeCopyLanguageHash(language);

const common={
  schema:'newboo-creative-ingress-v1',
  context_pack_id:pack.context_pack_id,
  context_hash:pack.context_hash,
};
const ingresses={
  trusted_atoms:{
    ...common,mode:'trusted_atoms',
    payload:{
      account_id:pack.account.account_id,book_id:base.book_id,
      narrative:{angle_type:'conflict',hook_atom_id:'atom_hook',tension_atom_id:'atom_tension',payoff_atom_id:'atom_payoff',reveal_timing:'late',cta_treatment:'intent',cta_id:'cta_open'},
      presentation:{duration_seconds:9,fps:30,visual_system:'paper',delivery_profile:'youtube_shorts',seed:101},
      selected_asset_ids:['asset_cover'],
    },
  },
  verified_composition:{
    ...common,mode:'verified_composition',
    payload:{
      copy_language_id:language.copy_language_id,copy_language_hash:language.copy_language_hash,
      account_id:pack.account.account_id,book_id:base.book_id,
      narrative:{
        angle_type:'conflict',
        hook:{template_id:'tpl_hook',bindings:[{slot_id:'premise',form_id:'form_premise'}]},
        tension:{template_id:'tpl_tension',bindings:[{slot_id:'conflict',form_id:'form_conflict'}]},
        payoff:{template_id:'tpl_payoff',bindings:[{slot_id:'question',form_id:'form_promise'}]},
        reveal_timing:'late',cta_treatment:'intent',cta_id:'cta_open',
      },
      presentation:{duration_seconds:9,fps:30,visual_system:'swiss',delivery_profile:'youtube_shorts',seed:102},
      selected_asset_ids:['asset_cover'],
    },
  },
  external_copy_review_required:{
    ...common,mode:'external_copy_review_required',
    payload:{
      account_id:pack.account.account_id,book_id:base.book_id,
      narrative:{
        angle_type:'conflict',
        hook:{text:'Every midnight, the station board erases one name.',supporting_fact_ids:['fact_premise']},
        tension:{text:'By morning, the disappearance has happened again.',supporting_fact_ids:['fact_conflict']},
        payoff:{text:'Can anyone stop the board before the next name vanishes?',supporting_fact_ids:['fact_promise','fact_conflict']},
        reveal_timing:'late',cta_treatment:'intent',cta_id:'cta_open',
      },
      presentation:{duration_seconds:9,fps:30,visual_system:'newspaper',delivery_profile:'youtube_shorts',seed:103},
      selected_asset_ids:['asset_cover'],
    },
  },
};

const loadContextPack=async id=>id===pack.context_pack_id?structuredClone(pack):null;
const loadCopyLanguage=async id=>id===language.copy_language_id?structuredClone(language):null;
const results=[];
for(const [mode,ingress] of Object.entries(ingresses)){
  const result=await processCreativeIngress({ingress,loadContextPack,loadCopyLanguage});
  if(!result.creative_gate.preview_render_allowed)throw new Error(`${mode}: preview render unexpectedly denied`);
  if(mode==='external_copy_review_required'&&result.creative_gate.publication_trust_satisfied)throw new Error('unapproved external copy unexpectedly publication-trusted');
  if(mode!=='external_copy_review_required'&&!result.creative_gate.publication_trust_satisfied)throw new Error(`${mode}: canonical creative trust unexpectedly unsatisfied`);
  results.push({mode,ingress,result});
}

const deliveryProfile={
  id:'youtube_short',
  width:1080,
  height:1920,
  fps:30,
  safe_area_profile:'youtube-shorts-c26-v1',
  platform_ui_profile:'youtube_shorts',
  platform_ui_version:'c26-ui-safe-v1-2026-09-17',
};
const runtime={
  class:'FAST',
  scene_contract_version:'canvas-scene-v1',
  environment_id:'video-worker-chromium-v1',
  renderer:{id:'webcodecs-h264',version:'r39-standard-v1'},
  encoder:{video_codec:'avc1.420028',bitrate_bps:3000000,pixel_format:'yuv420p'},
  muxer:{id:'ffmpeg-stream-copy-aac',version:'6.1.1'},
};

const selected=[];
const modeReports=[];
for(const [index,item] of results.entries()){
  const {mode,ingress,result}=item;
  const plan=result.program.narrative_plan;
  const hookRole=plan.roles.find(role=>role.role==='hook');
  const hookText=hookRole?.atoms?.map(atom=>atom.text).filter(Boolean).join(' ').trim();
  if(!hookText)throw new Error(`${mode}: C35 program has no hook display text`);
  if(result.program.presentation.delivery_profile!=='youtube_shorts')throw new Error(`${mode}: unsupported physical delivery profile ${result.program.presentation.delivery_profile}`);
  const physicalPayload={
    ...base,
    hook:hookText,
    visual_system:result.program.presentation.visual_system,
    creative_variant:'hook-first',
    delivery_profile:'vertical',
    platform_profile:'youtube_shorts',
    narrative_plan:plan,
  };
  const payloadPath=path.join(outDir,`payload-${mode}.json`);
  const payloadBytes=Buffer.from(`${JSON.stringify(physicalPayload,null,2)}\n`);
  await fs.writeFile(payloadPath,payloadBytes);
  const payloadSha=sha256(payloadBytes);
  const provenance={
    kind:'c35_creative_ingress',
    mode,
    ingress_id:result.ingress_id,
    decision_id:result.decision_id,
    canonical_input:result.canonical_input,
    program_id:result.program.program_id,
    narrative_plan_id:plan.narrative_plan_id,
    publication_trust_satisfied:result.creative_gate.publication_trust_satisfied,
    gate_reason:result.creative_gate.reason,
  };
  const creative={
    schema:'newboo-creative-spec-v1',
    book_id:base.book_id,
    template:{id:'book-ad-systems-c27',version:'i09-v1',sha256:htmlSha},
    payload_sha256:payloadSha,
    visual_system:{id:result.program.presentation.visual_system,version:'c35-v1'},
    structural_variant:'hook-first',
    hook:{text:hookText,provenance},
    cta:{text:base.cta,provenance:{kind:'server_context',context_pack_id:pack.context_pack_id,context_hash:pack.context_hash,cta_id:'cta_open'}},
    seed:result.program.presentation.seed,
    assets:[{role:'cover',sha256:coverSha}],
  };
  const selectionId=`i11-${String(index+1).padStart(2,'0')}-${mode}`;
  selected.push({
    selection_id:selectionId,
    creative,
    timeline:{
      source:`c35:${plan.narrative_plan_id}`,
      policy_version:'i11-c35-9s-30fps-v1',
      duration_ms:9000,
      frame_count:270,
    },
    requested_delivery_profile_ids:['youtube_short'],
    render_assets:[],
    execution:{
      html:stablePath(htmlPath),
      payload:stablePath(payloadPath),
      template_id:'book-ad-systems-c27',
      template_version:'i09-v1',
    },
  });
  await fs.writeFile(path.join(outDir,`ingress-${mode}.json`),`${JSON.stringify(ingress,null,2)}\n`);
  modeReports.push({
    mode,
    selection_id:selectionId,
    ingress_id:result.ingress_id,
    decision_id:result.decision_id,
    canonical_input:result.canonical_input,
    program_id:result.program.program_id,
    narrative_plan_id:plan.narrative_plan_id,
    payload_sha256:payloadSha,
    hook_text:hookText,
    visual_system:result.program.presentation.visual_system,
    preview_render_allowed:result.creative_gate.preview_render_allowed,
    publication_trust_satisfied:result.creative_gate.publication_trust_satisfied,
    gate_reason:result.creative_gate.reason,
  });
}

const request={
  schema:'framewright-c19-campaign-request-v1',
  campaign_id:'i09-c35-physical-factory',
  compiler_policy_version:'c19-delivery-package-v1',
  runtime,
  selected,
  reserves:[],
  delivery_profiles:[deliveryProfile],
};
const requestPath=path.join(outDir,'request.json');
await fs.writeFile(requestPath,`${JSON.stringify(request,null,2)}\n`);
await fs.writeFile(path.join(outDir,'context-pack.json'),`${JSON.stringify(pack,null,2)}\n`);
await fs.writeFile(path.join(outDir,'copy-language.json'),`${JSON.stringify(language,null,2)}\n`);

const publishReady=modeReports.filter(x=>x.publication_trust_satisfied).map(x=>({mode:x.mode,ingress_id:x.ingress_id,program_id:x.program_id}));
await fs.writeFile(path.join(outDir,'publish-ready.json'),`${JSON.stringify({schema:'newboo-i09-publish-ready-v1',items:publishReady},null,2)}\n`);
const report={
  schema:'newboo-i09-c35-physical-input-v1',
  campaign_id:request.campaign_id,
  html:stablePath(htmlPath),html_sha256:htmlSha,
  base_payload:stablePath(basePayloadPath),
  cover:{path:stablePath(coverPath),sha256:coverSha},
  context_pack_id:pack.context_pack_id,context_hash:pack.context_hash,
  copy_language_id:language.copy_language_id,copy_language_hash:language.copy_language_hash,
  modes:modeReports,
  publish_ready_modes:publishReady.map(x=>x.mode),
  preview_modes:modeReports.filter(x=>x.preview_render_allowed).map(x=>x.mode),
  request:stablePath(requestPath),
};
await fs.writeFile(path.join(outDir,'input-report.json'),`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify(report,null,2));
