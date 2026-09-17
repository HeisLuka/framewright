#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeAudioSpecId,assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';
import {loadSemanticSceneObjectFamilyRegistry,resolveSemanticSceneObject} from '../../../../contracts/semantic-scene-object-families-v1.mjs';

const phase1File=path.resolve(process.argv[2]||'.bench/c53/phase-a-inference.json');
const html=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c53-semantic-object.html');
const audioSource=path.resolve(process.argv[4]||'.bench/c53/source.wav');
const audioArtifact=path.resolve(process.argv[5]||'.bench/c53/canonical-audio.m4a');
const outDir=path.resolve(process.argv[6]||'.bench/c53/phase2-input');
const TARGET_SEED=303,DURATION_SECONDS=3,FPS=30,BOOK_ID='c53-semantic-object-parameter-benchmark';
const shaBytes=b=>createHash('sha256').update(b).digest('hex'),shaFile=f=>shaBytes(fs.readFileSync(f));
const rel=f=>path.relative(process.cwd(),f).split(path.sep).join('/');
const q=x=>Number(Number(x).toFixed(6));
for(const f of [phase1File,html,audioSource,audioArtifact])if(!fs.existsSync(f))throw new Error(`missing C53 Phase2 input ${f}`);
const phase1=JSON.parse(fs.readFileSync(phase1File,'utf8'));
if(phase1.schema!=='c53-pixel-family-inference-v1')throw new Error('phase1 inference schema');
const admitted=phase1.targets.filter(x=>x.state==='accepted'&&x.accepted_family_id).map(x=>({selection_id:x.selection_id,family_id:x.accepted_family_id}));
if(!admitted.length)throw new Error('no Phase1 admitted families');
const registry=loadSemanticSceneObjectFamilyRegistry(),familyById=new Map(registry.families.map(f=>[f.id,f]));
function targetValue(family,name,spec){
 if(spec.type==='number')return q(spec.min+(spec.max-spec.min)*0.63);
 if(spec.type==='integer'){
  let lo=spec.min,hi=spec.max;
  if(family.id==='scene_crowd_v1'&&name==='highlight_index')hi=Math.min(hi,family.parameters.count.default-1);
  let v=Math.round(lo+(hi-lo)*0.63);
  if(v===spec.default&&hi>lo)v=v<hi?v+1:v-1;
  return Math.max(lo,Math.min(hi,v));
 }
 if(spec.type==='boolean')return !spec.default;
 if(spec.type==='enum'){const i=spec.values.indexOf(spec.default);return spec.values[(i+1)%spec.values.length];}
 throw new Error(`unsupported parameter type ${spec.type}`);
}
const templateSha256=shaFile(html),sourceSha256=shaFile(audioSource),durationMs=DURATION_SECONDS*1000,frameCount=DURATION_SECONDS*FPS;
const audioSpec={schema:'framewright-audio-spec-v1',audio_spec_id:'',version:1,source_sha256:sourceSha256,timing:{trim_start_ms:0,duration_ms:durationMs,final_mux_duration_ms:durationMs},mix:{gain_db:0,fades:null},codec:{name:'aac',bitrate_bps:192000,container:'m4a',policy:'aac-lc-ffmpeg-192k-v2-explicit-duration'}};
audioSpec.audio_spec_id=computeAudioSpecId(audioSpec);
const audioBytes=fs.readFileSync(audioArtifact),canonicalAudio={schema:'framewright-canonical-audio-v1',audio_spec_id:audioSpec.audio_spec_id,sha256:shaBytes(audioBytes),bytes:audioBytes.byteLength,media_type:'audio/mp4',storage_uri:`artifact://c53/${path.basename(audioArtifact)}`,provenance:{encoder:'ffmpeg-github-runner',policy:audioSpec.codec.policy}};
assertCanonicalAudioArtifact(audioSpec,canonicalAudio,audioBytes);
const template={id:'semantic-scene-object-benchmark',version:'c53-object-runtime-v1',sha256:templateSha256};
fs.mkdirSync(outDir,{recursive:true});
const selected=[],publicTargets=[],truthTargets=[];let n=0;
for(const admission of admitted){
 const family=familyById.get(admission.family_id);if(!family)throw new Error(`admitted family missing ${admission.family_id}`);
 const role=family.supported_roles[0];
 for(const [parameter_name,spec] of Object.entries(family.parameters)){
  const value=targetValue(family,parameter_name,spec),params={[parameter_name]:value};
  const program=resolveSemanticSceneObject({family_id:family.id,role,params,seed:TARGET_SEED});
  const selectionId=`c53-p2-target-${String(++n).padStart(3,'0')}`;
  const payload={schema:'c53-semantic-object-payload-v1',book_id:BOOK_ID,delivery_profile:'vertical',semantic_object_program:program};
  const bytes=Buffer.from(JSON.stringify(payload,null,2)+'\n'),payloadSha256=shaBytes(bytes),payloadFile=path.join(outDir,`${selectionId}.payload.json`);fs.writeFileSync(payloadFile,bytes);
  selected.push({selection_id:selectionId,creative:{schema:'newboo-creative-spec-v1',book_id:BOOK_ID,payload_sha256:payloadSha256,template,visual_system:{id:'semantic-object-monochrome',version:'v1'},structural_variant:'semantic-object-safe-stage',hook:{source:'c53_parameter_benchmark',text:'semantic object parameter benchmark',source_ref:'c53:parameter'},motion:{profile:'static',version:'v1'},art_direction:{mode:'semantic-object-parameter-benchmark',algorithm:'c52-bounded-primitives-v1',palette:{background:'#f4f1e8',surface:'#f4f1e8',ink:'#111111',accent:'#111111',secondary:'#111111'}},seed:TARGET_SEED,assets:[],semantic_object_program_id:program.object_program_id},timeline:{source:'c53:static-object-parameter',policy_version:'c53-object-runtime-v1',duration_ms:durationMs,frame_count:frameCount},requested_delivery_profile_ids:['vertical-c53-p2-v1'],render_assets:[{role:'scene_payload',sha256:payloadSha256,media_type:'application/json',uri:`execution://${selectionId}/payload`}],audio:{spec:audioSpec,artifact:canonicalAudio},execution:{html:rel(html),payload:rel(payloadFile),audio:rel(audioArtifact),template_id:template.id,template_version:template.version}});
  publicTargets.push({selection_id:selectionId,source_admission_selection_id:admission.selection_id,parameter_name,parameter_type:spec.type});
  truthTargets.push({selection_id:selectionId,family_id:family.id,role,parameter_name,parameter_type:spec.type,target_value:value,target_seed:TARGET_SEED,object_program_id:program.object_program_id});
 }
}
const request={schema:'framewright-c19-campaign-request-v1',campaign_id:'c53-semantic-object-parameter-targets-v1',compiler_policy_version:'c19-delivery-package-v1',runtime:{class:'FAST',scene_contract_version:'canvas-scene-v1',environment_id:'video-worker-chromium-v1',renderer:{id:'webcodecs-h264',version:'r35-standard-v1'},encoder:{video_codec:'avc1.420028',bitrate_bps:3000000,pixel_format:'yuv420p'},muxer:{id:'ffmpeg-stream-copy-aac',version:'6.1.1'}},delivery_profiles:[{id:'vertical-c53-p2-v1',width:1080,height:1920,fps:FPS,safe_area_profile:'c26-ui-safe-v1-2026-09-17:youtube_shorts',platform_ui_profile:'youtube_shorts',platform_ui_version:'c26-ui-safe-v1-2026-09-17'}],selected,reserves:[{reserve_id:'c53-p2-unrendered-control',reason:'prove-reserve-suppression'}]};
fs.writeFileSync(path.join(outDir,'campaign.json'),JSON.stringify(request,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'public-targets.json'),JSON.stringify({schema:'c53-parameter-target-public-v1',phase1_admissions:admitted,targets:publicTargets,target_seed_hidden:true},null,2)+'\n');
fs.writeFileSync(path.join(outDir,'hidden-truth.json'),JSON.stringify({schema:'c53-parameter-target-truth-v1',targets:truthTargets},null,2)+'\n');
console.log(JSON.stringify({admitted_families:admitted.length,parameter_targets:publicTargets.length,campaign:path.join(outDir,'campaign.json'),publicTargets:path.join(outDir,'public-targets.json'),hiddenTruth:path.join(outDir,'hidden-truth.json'),templateSha256},null,2));
