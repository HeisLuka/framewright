#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeAudioSpecId,assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';
import {assembleC19TemplateCampaignRequest,selectCurrentTemplateCampaignBatch} from '../../../../contracts/template-campaign-selection-v1.mjs';
import {
  buildCanonicalTemplateVariabilityRegistry,
  buildDefaultTemplateAutoPolicy,
  composeAutomaticTemplateVariant,
  composeExplicitTemplateVariant,
  deriveTemplateSceneProgram,
} from '../../../../contracts/template-variant-composer-v1.mjs';
import {loadMotionGrammarFamilyRegistry} from '../../../../contracts/motion-grammar-families-v2.mjs';

const fixtureDir=path.resolve(process.argv[2]||'.bench/c50/c27-fixtures');
const html=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c45-template-variant.html');
const audioSource=path.resolve(process.argv[4]||'.bench/c50/source.wav');
const audioArtifact=path.resolve(process.argv[5]||'.bench/c50/canonical-audio.m4a');
const outDir=path.resolve(process.argv[6]||'.bench/c50/motion-ofat-input');
const shaBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const shaFile=file=>shaBytes(fs.readFileSync(file));
const rel=file=>path.relative(process.cwd(),file).split(path.sep).join('/');
function pngDimensions(file){const b=fs.readFileSync(file);if(b.length<24||b.toString('ascii',1,4)!=='PNG')throw new Error(`expected PNG cover ${file}`);return{width:b.readUInt32BE(16),height:b.readUInt32BE(20)};}
function roleText(role,book){const atoms=(role.atoms||[]).filter(a=>a?.source?.kind!=='reserved_affordance').map(a=>String(a.text||'').trim()).filter(Boolean);if(atoms.length)return atoms.join(' ');if(role.role==='book_reveal')return String(book.title||'').trim();if(role.role==='cta')return 'Открыть книгу';throw new Error(`no semantic text for ${role.role}`);}
for(const file of [html,audioSource,audioArtifact,path.join(fixtureDir,'manifest.json')])if(!fs.existsSync(file))throw new Error(`missing C50 motion OFAT input ${file}`);
const sourceManifest=JSON.parse(fs.readFileSync(path.join(fixtureDir,'manifest.json'),'utf8'));
const item=sourceManifest.items.find(x=>Number(x.durationSeconds||0)===9)||sourceManifest.items[0];
if(!item)throw new Error('no C27 fixture item');
const input=JSON.parse(fs.readFileSync(path.join(fixtureDir,item.inputFile),'utf8'));
const plan=JSON.parse(fs.readFileSync(path.join(fixtureDir,item.planFile),'utf8'));
const book=input.book;if(plan.duration_seconds!==9)throw new Error(`C50 motion OFAT expects canonical 9s C27, got ${plan.duration_seconds}s`);
const sourceCover=path.resolve('examples/book-ad-v0/generated-e08',path.basename(book.cover_url));
if(!fs.existsSync(sourceCover))throw new Error(`missing cover ${sourceCover}`);
const runtimeAssetDir=path.join(path.dirname(html),'generated-c50-motion-ofat');fs.mkdirSync(runtimeAssetDir,{recursive:true});
const coverName=path.basename(sourceCover),runtimeCover=path.join(runtimeAssetDir,coverName);fs.copyFileSync(sourceCover,runtimeCover);
const coverSha256=shaFile(runtimeCover),dims=pngDimensions(runtimeCover);
const trustedCover={asset_id:`asset_${String(book.book_id).replace(/[^a-z0-9_-]/gi,'-').toLowerCase()}_cover`,kind:'cover',sha256:coverSha256,width:dims.width,height:dims.height};
const narrative={narrative_plan_id:plan.narrative_plan_id,seed:plan.seed,title:String(book.title||''),author:String(book.author||''),roles:plan.roles.map(role=>({role:role.role,text:roleText(role,book),start_frame:role.start_frame,end_frame:role.end_frame}))};
const delivery={aspect:'vertical',width:1080,height:1920,fps:30,duration_seconds:plan.duration_seconds};
const context={aspect:'vertical',duration_seconds:plan.duration_seconds,semantic_roles:narrative.roles.map(r=>r.role),available_asset_kinds:['cover']};
const registry=buildCanonicalTemplateVariabilityRegistry(),autoPolicy=buildDefaultTemplateAutoPolicy();
const baseReceipt=composeAutomaticTemplateVariant({subject_key:'c50-motion-ofat-base',seed:5001,context,policy:autoPolicy,registry});
const baseAxes=baseReceipt.template_variant.axes;
const motionFamilies=loadMotionGrammarFamilyRegistry().families.map(f=>f.id).sort();
if(motionFamilies.length!==6)throw new Error(`C50 motion OFAT expected 6 C40 families, got ${motionFamilies.length}`);
const candidates=motionFamilies.map(motion_grammar=>{
  const receipt=composeExplicitTemplateVariant({selection:{...baseAxes,motion_grammar,graphic_devices:[...baseAxes.graphic_devices]},context,registry});
  const variant=receipt.template_variant;
  return{candidate_id:`candidate_${motion_grammar}`,template_variant:variant};
});
for(const candidate of candidates){const axes=candidate.template_variant.axes;for(const axis of ['visual_system','structural_layout','typography','asset_staging'])if(axes[axis]!==baseAxes[axis])throw new Error(`OFAT invariant changed ${axis}`);if(JSON.stringify(axes.graphic_devices)!==JSON.stringify(baseAxes.graphic_devices))throw new Error('OFAT invariant changed graphic_devices');}
const selection=selectCurrentTemplateCampaignBatch({candidates,batch_size:6,selection_seed:5002});
if(selection.ordered_selected_candidate_ids.length!==6)throw new Error('OFAT selector must retain all six candidates');
const candidateById=new Map(candidates.map(item=>[item.candidate_id,item]));
const templateSha256=shaFile(html),durationMs=plan.duration_seconds*1000,frameCount=plan.total_frames,sourceSha256=shaFile(audioSource);
const audioSpec={schema:'framewright-audio-spec-v1',audio_spec_id:'',version:1,source_sha256:sourceSha256,timing:{trim_start_ms:0,duration_ms:durationMs,final_mux_duration_ms:durationMs},mix:{gain_db:0,fades:null},codec:{name:'aac',bitrate_bps:192000,container:'m4a',policy:'aac-lc-ffmpeg-192k-v2-explicit-duration'}};
audioSpec.audio_spec_id=computeAudioSpecId(audioSpec);
const artifactBytes=fs.readFileSync(audioArtifact),canonicalAudio={schema:'framewright-canonical-audio-v1',audio_spec_id:audioSpec.audio_spec_id,sha256:shaBytes(artifactBytes),bytes:artifactBytes.byteLength,media_type:'audio/mp4',storage_uri:`artifact://c50-motion-ofat/${path.basename(audioArtifact)}`,provenance:{encoder:'ffmpeg-github-runner',policy:audioSpec.codec.policy}};assertCanonicalAudioArtifact(audioSpec,canonicalAudio,artifactBytes);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const materialized=[],rows=[];
for(const [index,candidateId] of selection.ordered_selected_candidate_ids.entries()){
  const candidate=candidateById.get(candidateId);if(!candidate)throw new Error(`selected candidate missing ${candidateId}`);
  const variant=candidate.template_variant,sceneProgram=deriveTemplateSceneProgram({composition_receipt:{registry_id:registry.registry_id,template_variant:variant},narrative,delivery,trusted_cover:trustedCover,registry});
  const motionFamily=variant.axes.motion_grammar,selectionId=`c50-motion-${String(index+1).padStart(2,'0')}`;
  const payload={...book,cover_url:`./generated-c50-motion-ofat/${coverName}`,delivery_profile:'vertical',narrative_plan:plan,template_scene_program:sceneProgram,c50_motion_ofat:{selection_id:selection.selection_id,candidate_id:candidateId,motion_grammar:motionFamily,index}};
  const payloadBytes=Buffer.from(JSON.stringify(payload,null,2)+'\n'),payloadSha256=shaBytes(payloadBytes),payloadFile=path.join(outDir,`${selectionId}.payload.json`);fs.writeFileSync(payloadFile,payloadBytes);
  const hook=narrative.roles.find(role=>role.role==='hook')?.text||'',template={id:'book-ad-template-variant',version:'c50-motion-ofat-v1',sha256:templateSha256};
  const row={selection_id:selectionId,creative:{schema:'newboo-creative-spec-v1',book_id:book.book_id,payload_sha256:payloadSha256,template,visual_system:{id:variant.axes.visual_system,version:'v2'},structural_variant:variant.axes.structural_layout,hook:{source:'c27_narrative_plan',text:hook,source_ref:`${plan.narrative_plan_id}:hook`},motion:{profile:motionFamily,version:'v2'},art_direction:{mode:'template-variant',algorithm:'c50-motion-ofat-v1',source_cover_sha256:coverSha256,palette:{background:book.background||'#eee8dc',surface:'#ffffff',ink:book.ink||'#111111',accent:book.accent||'#cc332d',secondary:'#315A7D'}},seed:plan.seed,assets:[{role:'cover',sha256:coverSha256,media_type:'image/png',uri:`asset://generated-c50-motion-ofat/${coverName}`}],template_variant_id:variant.template_variant_id,scene_program_id:sceneProgram.scene_program_id},timeline:{source:`c27:${plan.narrative_plan_id}`,policy_version:plan.policy_version,duration_ms:durationMs,frame_count:frameCount},requested_delivery_profile_ids:['vertical-c50-motion-ofat-v1'],render_assets:[{role:'scene_payload',sha256:payloadSha256,media_type:'application/json',uri:`execution://${selectionId}/payload`}],audio:{spec:audioSpec,artifact:canonicalAudio},execution:{html:rel(html),payload:rel(payloadFile),audio:rel(audioArtifact),template_id:template.id,template_version:template.version}};
  materialized.push({candidate_id:candidateId,row});rows.push({index,candidate_id:candidateId,selection_id:selectionId,template_variant_id:variant.template_variant_id,scene_program_id:sceneProgram.scene_program_id,motion_grammar:motionFamily,payload_sha256:payloadSha256,axes:variant.axes});
}
const runtime={class:'FAST',scene_contract_version:'canvas-scene-v1',environment_id:'video-worker-chromium-v1',renderer:{id:'webcodecs-h264',version:'r35-standard-v1'},encoder:{video_codec:'avc1.420028',bitrate_bps:3000000,pixel_format:'yuv420p'},muxer:{id:'ffmpeg-stream-copy-aac',version:'6.1.1'}};
const deliveryProfiles=[{id:'vertical-c50-motion-ofat-v1',width:1080,height:1920,fps:30,safe_area_profile:'c26-ui-safe-v1-2026-09-17:youtube_shorts',platform_ui_profile:'youtube_shorts',platform_ui_version:'c26-ui-safe-v1-2026-09-17'}];
const request=assembleC19TemplateCampaignRequest({selection,materialized_selected:materialized,campaign_id:'c50-motion-ofat',runtime,delivery_profiles:deliveryProfiles});
const invariantAxes={visual_system:baseAxes.visual_system,structural_layout:baseAxes.structural_layout,typography:baseAxes.typography,asset_staging:baseAxes.asset_staging,graphic_devices:baseAxes.graphic_devices};
fs.writeFileSync(path.join(outDir,'campaign.json'),JSON.stringify(request,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'selection.json'),JSON.stringify(selection,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'materialization-manifest.json'),JSON.stringify({schema:'c50-motion-ofat-materialization-v1',selected_count:rows.length,narrative_plan_id:plan.narrative_plan_id,template_sha256:templateSha256,cover_sha256:coverSha256,invariant_axes:invariantAxes,varied_axis:'motion_grammar',motion_families:motionFamilies,rows},null,2)+'\n');
console.log(JSON.stringify({schema:'c50-motion-ofat-fixture-v1',selectedCount:rows.length,variedAxis:'motion_grammar',motionFamilies,invariantAxes,narrativePlanId:plan.narrative_plan_id,templateSha256,coverSha256,audioSpecId:audioSpec.audio_spec_id},null,2));
