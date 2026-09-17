#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeAudioSpecId,assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';
import {
  buildCanonicalTemplateVariabilityRegistry,
  buildDefaultTemplateAutoPolicy,
  composeAutomaticTemplateVariant,
  deriveTemplateSceneProgram,
} from '../../../../contracts/template-variant-composer-v1.mjs';
import {
  buildDefaultBatchTemplateDiversityPolicy,
  selectDiverseTemplateBatch,
} from '../../../../contracts/batch-template-diversity-v1.mjs';

const fixtureDir=path.resolve(process.argv[2]||'.bench/c45/c27-fixtures');
const html=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c45-template-variant.html');
const audioSource=path.resolve(process.argv[4]||'.bench/c45/source.wav');
const audioArtifact=path.resolve(process.argv[5]||'.bench/c45/canonical-audio.m4a');
const outDir=path.resolve(process.argv[6]||'.bench/c45/input');
const BATCH_SIZE=40;
const shaBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const shaFile=file=>shaBytes(fs.readFileSync(file));
const rel=file=>path.relative(process.cwd(),file).split(path.sep).join('/');
function pngDimensions(file){const b=fs.readFileSync(file);if(b.length<24||b.toString('ascii',1,4)!=='PNG')throw new Error(`expected PNG cover ${file}`);return{width:b.readUInt32BE(16),height:b.readUInt32BE(20)};}
function roleText(role,book){
  const atoms=(role.atoms||[]).filter(a=>a?.source?.kind!=='reserved_affordance').map(a=>String(a.text||'').trim()).filter(Boolean);
  if(atoms.length)return atoms.join(' ');
  if(role.role==='book_reveal')return String(book.title||'').trim();
  if(role.role==='cta')return 'Открыть книгу';
  throw new Error(`no semantic text for ${role.role}`);
}
for(const file of [html,audioSource,audioArtifact,path.join(fixtureDir,'manifest.json')])if(!fs.existsSync(file))throw new Error(`missing C45 input ${file}`);
const manifest=JSON.parse(fs.readFileSync(path.join(fixtureDir,'manifest.json'),'utf8'));
const item=manifest.items.find(x=>Number(x.durationSeconds||0)===9)||manifest.items[0];
if(!item)throw new Error('no C27 fixture item');
const input=JSON.parse(fs.readFileSync(path.join(fixtureDir,item.inputFile),'utf8'));
const plan=JSON.parse(fs.readFileSync(path.join(fixtureDir,item.planFile),'utf8'));
const book=input.book;
if(plan.duration_seconds!==9)throw new Error(`C45 main corpus is frozen at canonical 9s C27, got ${plan.duration_seconds}s`);
const sourceCover=path.resolve('examples/book-ad-v0/generated-e08',path.basename(book.cover_url));
if(!fs.existsSync(sourceCover))throw new Error(`missing cover ${sourceCover}`);
const runtimeAssetDir=path.join(path.dirname(html),'generated-c45');fs.mkdirSync(runtimeAssetDir,{recursive:true});
const coverName=path.basename(sourceCover),runtimeCover=path.join(runtimeAssetDir,coverName);fs.copyFileSync(sourceCover,runtimeCover);
const coverSha256=shaFile(runtimeCover),dims=pngDimensions(runtimeCover);
const trustedCover={asset_id:`asset_${String(book.book_id).replace(/[^a-z0-9_-]/gi,'-').toLowerCase()}_cover`,kind:'cover',sha256:coverSha256,width:dims.width,height:dims.height};
const narrative={narrative_plan_id:plan.narrative_plan_id,seed:plan.seed,title:String(book.title||''),author:String(book.author||''),roles:plan.roles.map(role=>({role:role.role,text:roleText(role,book),start_frame:role.start_frame,end_frame:role.end_frame}))};
const delivery={aspect:'vertical',width:1080,height:1920,fps:30,duration_seconds:plan.duration_seconds};
const context={aspect:'vertical',duration_seconds:plan.duration_seconds,semantic_roles:narrative.roles.map(r=>r.role),available_asset_kinds:['cover']};
const registry=buildCanonicalTemplateVariabilityRegistry(),autoPolicy=buildDefaultTemplateAutoPolicy(),diversityPolicy=buildDefaultBatchTemplateDiversityPolicy();
const byVariant=new Map();
for(let i=0;i<3000;i++){
  const receipt=composeAutomaticTemplateVariant({subject_key:`c45-${book.book_id}-${String(i).padStart(4,'0')}`,seed:45,context,policy:autoPolicy,registry});
  const v=receipt.template_variant;if(!byVariant.has(v.template_variant_id))byVariant.set(v.template_variant_id,{candidate_id:`cand_${v.template_variant_id}`,template_variant:v});
}
const candidates=[...byVariant.values()];
const batch=selectDiverseTemplateBatch({candidates,batch_size:BATCH_SIZE,seed:4501,policy:diversityPolicy});
const candidateById=new Map(candidates.map(c=>[c.candidate_id,c]));
const templateSha256=shaFile(html),durationMs=plan.duration_seconds*1000,frameCount=plan.total_frames;
const sourceSha256=shaFile(audioSource);
const audioSpec={schema:'framewright-audio-spec-v1',audio_spec_id:'',version:1,source_sha256:sourceSha256,timing:{trim_start_ms:0,duration_ms:durationMs,final_mux_duration_ms:durationMs},mix:{gain_db:0,fades:null},codec:{name:'aac',bitrate_bps:192000,container:'m4a',policy:'aac-lc-ffmpeg-192k-v2-explicit-duration'}};
audioSpec.audio_spec_id=computeAudioSpecId(audioSpec);
const artifactBytes=fs.readFileSync(audioArtifact),canonicalAudio={schema:'framewright-canonical-audio-v1',audio_spec_id:audioSpec.audio_spec_id,sha256:shaBytes(artifactBytes),bytes:artifactBytes.byteLength,media_type:'audio/mp4',storage_uri:`artifact://c45/${path.basename(audioArtifact)}`,provenance:{encoder:'ffmpeg-github-runner',policy:audioSpec.codec.policy}};
assertCanonicalAudioArtifact(audioSpec,canonicalAudio,artifactBytes);
fs.mkdirSync(outDir,{recursive:true});
const selected=[],variantRows=[];
for(const assignment of batch.assignments){
  const candidate=candidateById.get(assignment.candidate_id);if(!candidate)throw new Error(`candidate missing ${assignment.candidate_id}`);
  const variant=candidate.template_variant;
  const sceneProgram=deriveTemplateSceneProgram({composition_receipt:{registry_id:registry.registry_id,template_variant:variant},narrative,delivery,trusted_cover:trustedCover,registry});
  const selectionId=`c45-${String(assignment.index+1).padStart(2,'0')}`;
  const payload={...book,cover_url:`./generated-c45/${coverName}`,delivery_profile:'vertical',narrative_plan:plan,template_scene_program:sceneProgram};
  const payloadBytes=Buffer.from(JSON.stringify(payload,null,2)+'\n'),payloadSha256=shaBytes(payloadBytes),payloadFile=path.join(outDir,`${selectionId}.payload.json`);fs.writeFileSync(payloadFile,payloadBytes);
  const hook=narrative.roles.find(r=>r.role==='hook')?.text||'';
  const template={id:'book-ad-template-variant',version:'c45-template-scene-program-v1',sha256:templateSha256};
  selected.push({selection_id:selectionId,creative:{schema:'newboo-creative-spec-v1',book_id:book.book_id,payload_sha256:payloadSha256,template,visual_system:{id:variant.axes.visual_system,version:'v2'},structural_variant:variant.axes.structural_layout,hook:{source:'c27_narrative_plan',text:hook,source_ref:`${plan.narrative_plan_id}:hook`},motion:{profile:variant.axes.motion_grammar,version:'v2'},art_direction:{mode:'template-variant',algorithm:'c38-c43-bounded-axes-v1',source_cover_sha256:coverSha256,palette:{background:book.background||'#eee8dc',surface:'#ffffff',ink:book.ink||'#111111',accent:book.accent||'#cc332d',secondary:'#315A7D'}},seed:plan.seed,assets:[{role:'cover',sha256:coverSha256,media_type:'image/png',uri:`asset://generated-c45/${coverName}`}],template_variant_id:variant.template_variant_id,scene_program_id:sceneProgram.scene_program_id},timeline:{source:`c27:${plan.narrative_plan_id}`,policy_version:plan.policy_version,duration_ms:durationMs,frame_count:frameCount},requested_delivery_profile_ids:['vertical-c45-v1'],render_assets:[{role:'scene_payload',sha256:payloadSha256,media_type:'application/json',uri:`execution://${selectionId}/payload`}],audio:{spec:audioSpec,artifact:canonicalAudio},execution:{html:rel(html),payload:rel(payloadFile),audio:rel(audioArtifact),template_id:template.id,template_version:template.version}});
  variantRows.push({index:assignment.index,selection_id:selectionId,candidate_id:assignment.candidate_id,template_variant_id:variant.template_variant_id,scene_program_id:sceneProgram.scene_program_id,payload_sha256:payloadSha256,axes:variant.axes,semantic_schedule_sha256:sceneProgram.semantic_schedule_sha256});
}
const request={schema:'framewright-c19-campaign-request-v1',campaign_id:'c45-template-diversity-40',compiler_policy_version:'c19-delivery-package-v1',runtime:{class:'FAST',scene_contract_version:'canvas-scene-v1',environment_id:'video-worker-chromium-v1',renderer:{id:'webcodecs-h264',version:'r35-standard-v1'},encoder:{video_codec:'avc1.420028',bitrate_bps:3000000,pixel_format:'yuv420p'},muxer:{id:'ffmpeg-stream-copy-aac',version:'6.1.1'}},delivery_profiles:[{id:'vertical-c45-v1',width:1080,height:1920,fps:30,safe_area_profile:'c26-ui-safe-v1-2026-09-17:youtube_shorts',platform_ui_profile:'youtube_shorts',platform_ui_version:'c26-ui-safe-v1-2026-09-17'}],selected,reserves:[{reserve_id:'c45-unrendered-control',reason:'prove-reserve-suppression'}]};
const campaignFile=path.join(outDir,'campaign.json'),batchFile=path.join(outDir,'batch-receipt.json'),variantFile=path.join(outDir,'variant-manifest.json');
fs.writeFileSync(campaignFile,JSON.stringify(request,null,2)+'\n');fs.writeFileSync(batchFile,JSON.stringify(batch,null,2)+'\n');fs.writeFileSync(variantFile,JSON.stringify({schema:'c45-variant-manifest-v1',registry_id:registry.registry_id,policy_id:autoPolicy.policy_id,diversity_policy_id:diversityPolicy.policy_id,narrative_plan_id:plan.narrative_plan_id,book_id:book.book_id,semantic_projection:narrative,cover_sha256:coverSha256,template_sha256:templateSha256,count:variantRows.length,variants:variantRows},null,2)+'\n');
console.log(JSON.stringify({campaign:campaignFile,batchReceipt:batchFile,variantManifest:variantFile,count:variantRows.length,narrativePlanId:plan.narrative_plan_id,semanticScheduleSha256:variantRows[0]?.semantic_schedule_sha256,uniqueVariants:new Set(variantRows.map(r=>r.template_variant_id)).size,uniqueScenePrograms:new Set(variantRows.map(r=>r.scene_program_id)).size,templateSha256,coverSha256,audioSpecId:audioSpec.audio_spec_id},null,2));
