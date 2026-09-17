#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeAudioSpecId,assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';
import {loadSemanticSceneObjectFamilyRegistry,resolveSemanticSceneObject} from '../../../../contracts/semantic-scene-object-families-v1.mjs';

const html=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c53-semantic-object.html');
const audioSource=path.resolve(process.argv[3]||'.bench/c53/source.wav');
const audioArtifact=path.resolve(process.argv[4]||'.bench/c53/canonical-audio.m4a');
const outDir=path.resolve(process.argv[5]||'.bench/c53/input');
const TARGET_SEED=901,REFERENCE_SEEDS=[101,202,303],DURATION_SECONDS=3,FPS=30;
const shaBytes=b=>createHash('sha256').update(b).digest('hex'),shaFile=f=>shaBytes(fs.readFileSync(f));
const rel=f=>path.relative(process.cwd(),f).split(path.sep).join('/');
for(const f of [html,audioSource,audioArtifact])if(!fs.existsSync(f))throw new Error(`missing C53 input ${f}`);
fs.mkdirSync(outDir,{recursive:true});
const registry=loadSemanticSceneObjectFamilyRegistry();
const templateSha256=shaFile(html),sourceSha256=shaFile(audioSource),durationMs=DURATION_SECONDS*1000,frameCount=DURATION_SECONDS*FPS;
const audioSpec={schema:'framewright-audio-spec-v1',audio_spec_id:'',version:1,source_sha256:sourceSha256,timing:{trim_start_ms:0,duration_ms:durationMs,final_mux_duration_ms:durationMs},mix:{gain_db:0,fades:null},codec:{name:'aac',bitrate_bps:192000,container:'m4a',policy:'aac-lc-ffmpeg-192k-v2-explicit-duration'}};
audioSpec.audio_spec_id=computeAudioSpecId(audioSpec);
const audioBytes=fs.readFileSync(audioArtifact),canonicalAudio={schema:'framewright-canonical-audio-v1',audio_spec_id:audioSpec.audio_spec_id,sha256:shaBytes(audioBytes),bytes:audioBytes.byteLength,media_type:'audio/mp4',storage_uri:`artifact://c53/${path.basename(audioArtifact)}`,provenance:{encoder:'ffmpeg-github-runner',policy:audioSpec.codec.policy}};
assertCanonicalAudioArtifact(audioSpec,canonicalAudio,audioBytes);
const template={id:'semantic-scene-object-benchmark',version:'c53-object-runtime-v1',sha256:templateSha256};
const selected=[],targets=[],references=[],truthTargets=[];
function addSelection({selectionId,program,seed,kind}){
  const payload={schema:'c53-semantic-object-payload-v1',delivery_profile:'vertical',semantic_object_program:program};
  const bytes=Buffer.from(JSON.stringify(payload,null,2)+'\n'),payloadSha256=shaBytes(bytes),payloadFile=path.join(outDir,`${selectionId}.payload.json`);fs.writeFileSync(payloadFile,bytes);
  selected.push({selection_id:selectionId,creative:{schema:'newboo-creative-spec-v1',book_id:'c53-semantic-object-benchmark',payload_sha256:payloadSha256,template,visual_system:{id:'semantic-object-monochrome',version:'v1'},structural_variant:'semantic-object-safe-stage',hook:{source:'c53_benchmark',text:'semantic object benchmark',source_ref:'c53:benchmark'},motion:{profile:'static',version:'v1'},art_direction:{mode:'semantic-object-benchmark',algorithm:'c52-bounded-primitives-v1',palette:{background:'#f4f1e8',surface:'#f4f1e8',ink:'#111111',accent:'#111111',secondary:'#111111'}},seed,assets:[],semantic_object_program_id:program.object_program_id},timeline:{source:'c53:static-object',policy_version:'c53-object-runtime-v1',duration_ms:durationMs,frame_count:frameCount},requested_delivery_profile_ids:['vertical-c53-v1'],render_assets:[{role:'scene_payload',sha256:payloadSha256,media_type:'application/json',uri:`execution://${selectionId}/payload`}],audio:{spec:audioSpec,artifact:canonicalAudio},execution:{html:rel(html),payload:rel(payloadFile),audio:rel(audioArtifact),template_id:template.id,template_version:template.version}});
  return {selection_id:selectionId,payload_sha256:payloadSha256,object_program_id:program.object_program_id,kind};
}
let targetIndex=0,referenceIndex=0;
for(const family of registry.families){
  const role=family.supported_roles[0];
  const targetProgram=resolveSemanticSceneObject({family_id:family.id,role,params:{},seed:TARGET_SEED});
  const targetId=`c53-target-${String(++targetIndex).padStart(3,'0')}`;
  targets.push(addSelection({selectionId:targetId,program:targetProgram,seed:TARGET_SEED,kind:'target'}));
  truthTargets.push({selection_id:targetId,family_id:family.id,role,seed:TARGET_SEED,parameters:targetProgram.parameters,object_program_id:targetProgram.object_program_id});
  for(const refSeed of REFERENCE_SEEDS){
    const refProgram=resolveSemanticSceneObject({family_id:family.id,role,params:{},seed:refSeed});
    const refId=`c53-ref-${String(++referenceIndex).padStart(3,'0')}`;
    const row=addSelection({selectionId:refId,program:refProgram,seed:refSeed,kind:'reference'});
    references.push({...row,family_id:family.id,role,seed:refSeed});
  }
}
const request={schema:'framewright-c19-campaign-request-v1',campaign_id:'c53-semantic-object-family-roundtrip-v1',compiler_policy_version:'c19-delivery-package-v1',runtime:{class:'FAST',scene_contract_version:'canvas-scene-v1',environment_id:'video-worker-chromium-v1',renderer:{id:'webcodecs-h264',version:'r35-standard-v1'},encoder:{video_codec:'avc1.420028',bitrate_bps:3000000,pixel_format:'yuv420p'},muxer:{id:'ffmpeg-stream-copy-aac',version:'6.1.1'}},delivery_profiles:[{id:'vertical-c53-v1',width:1080,height:1920,fps:FPS,safe_area_profile:'c26-ui-safe-v1-2026-09-17:youtube_shorts',platform_ui_profile:'youtube_shorts',platform_ui_version:'c26-ui-safe-v1-2026-09-17'}],selected,reserves:[{reserve_id:'c53-unrendered-control',reason:'prove-reserve-suppression'}]};
fs.writeFileSync(path.join(outDir,'campaign.json'),JSON.stringify(request,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'public-bank.json'),JSON.stringify({schema:'c53-public-family-bank-v1',targets:targets.map(({selection_id})=>({selection_id})),references:references.map(({selection_id,family_id,role,seed})=>({selection_id,family_id,role,seed})),reference_seeds:REFERENCE_SEEDS,target_seed_hidden:true},null,2)+'\n');
fs.writeFileSync(path.join(outDir,'hidden-truth.json'),JSON.stringify({schema:'c53-hidden-family-truth-v1',targets:truthTargets},null,2)+'\n');
console.log(JSON.stringify({families:registry.families.length,targets:targets.length,references:references.length,selected:selected.length,campaign:path.join(outDir,'campaign.json'),publicBank:path.join(outDir,'public-bank.json'),hiddenTruth:path.join(outDir,'hidden-truth.json'),templateSha256,audioSpecId:audioSpec.audio_spec_id},null,2));
