#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeAudioSpecId,assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';
import {loadSemanticSceneObjectFamilyRegistry,resolveSemanticSceneObject} from '../../../../contracts/semantic-scene-object-families-v1.mjs';

const inferenceFile=path.resolve(process.argv[2]||'.bench/c53/phase2-parameter-inference.json');
const html=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c53-semantic-object.html');
const audioSource=path.resolve(process.argv[4]||'.bench/c53/source.wav');
const audioArtifact=path.resolve(process.argv[5]||'.bench/c53/canonical-audio.m4a');
const outDir=path.resolve(process.argv[6]||'.bench/c53/phase2-recon-input');
const DURATION_SECONDS=3,FPS=30,BOOK_ID='c53-semantic-object-reconstruction-benchmark';
const shaBytes=b=>createHash('sha256').update(b).digest('hex'),shaFile=f=>shaBytes(fs.readFileSync(f));
const rel=f=>path.relative(process.cwd(),f).split(path.sep).join('/');
for(const f of [inferenceFile,html,audioSource,audioArtifact])if(!fs.existsSync(f))throw new Error(`missing reconstruction input ${f}`);
const inference=JSON.parse(fs.readFileSync(inferenceFile,'utf8'));if(inference.schema!=='c53-parameter-pixel-inference-v1')throw new Error('parameter inference schema');
const accepted=inference.rows.filter(x=>x.state==='accepted'&&x.inferred);if(!accepted.length)throw new Error('no accepted parameter inferences to reconstruct');
const registry=loadSemanticSceneObjectFamilyRegistry(),familyById=new Map(registry.families.map(f=>[f.id,f]));
const templateSha256=shaFile(html),sourceSha256=shaFile(audioSource),durationMs=DURATION_SECONDS*1000,frameCount=DURATION_SECONDS*FPS;
const audioSpec={schema:'framewright-audio-spec-v1',audio_spec_id:'',version:1,source_sha256:sourceSha256,timing:{trim_start_ms:0,duration_ms:durationMs,final_mux_duration_ms:durationMs},mix:{gain_db:0,fades:null},codec:{name:'aac',bitrate_bps:192000,container:'m4a',policy:'aac-lc-ffmpeg-192k-v2-explicit-duration'}};audioSpec.audio_spec_id=computeAudioSpecId(audioSpec);
const audioBytes=fs.readFileSync(audioArtifact),canonicalAudio={schema:'framewright-canonical-audio-v1',audio_spec_id:audioSpec.audio_spec_id,sha256:shaBytes(audioBytes),bytes:audioBytes.byteLength,media_type:'audio/mp4',storage_uri:`artifact://c53/${path.basename(audioArtifact)}`,provenance:{encoder:'ffmpeg-github-runner',policy:audioSpec.codec.policy}};assertCanonicalAudioArtifact(audioSpec,canonicalAudio,audioBytes);
const template={id:'semantic-scene-object-benchmark',version:'c53-object-runtime-v1',sha256:templateSha256};fs.mkdirSync(outDir,{recursive:true});
const selected=[],mapping=[];let n=0;
for(const row of accepted){
 const family=familyById.get(row.inferred.family_id);if(!family)throw new Error(`unknown inferred family ${row.inferred.family_id}`);
 if(!Object.hasOwn(family.parameters,row.parameter_name))throw new Error(`unknown inferred parameter ${family.id}/${row.parameter_name}`);
 const program=resolveSemanticSceneObject({family_id:family.id,role:family.supported_roles[0],params:{[row.parameter_name]:row.inferred.value},seed:row.inferred.seed});
 const selectionId=`c53-p2-recon-${String(++n).padStart(3,'0')}`;
 const payload={schema:'c53-semantic-object-payload-v1',book_id:BOOK_ID,delivery_profile:'vertical',semantic_object_program:program};const bytes=Buffer.from(JSON.stringify(payload,null,2)+'\n'),payloadSha256=shaBytes(bytes),payloadFile=path.join(outDir,`${selectionId}.payload.json`);fs.writeFileSync(payloadFile,bytes);
 selected.push({selection_id:selectionId,creative:{schema:'newboo-creative-spec-v1',book_id:BOOK_ID,payload_sha256:payloadSha256,template,visual_system:{id:'semantic-object-monochrome',version:'v1'},structural_variant:'semantic-object-safe-stage',hook:{source:'c53_parameter_reconstruction',text:'semantic object parameter reconstruction',source_ref:'c53:reconstruction'},motion:{profile:'static',version:'v1'},art_direction:{mode:'semantic-object-reconstruction',algorithm:'c53-pixel-fit-v1',palette:{background:'#f4f1e8',surface:'#f4f1e8',ink:'#111111',accent:'#111111',secondary:'#111111'}},seed:row.inferred.seed,assets:[],semantic_object_program_id:program.object_program_id},timeline:{source:'c53:static-object-reconstruction',policy_version:'c53-object-runtime-v1',duration_ms:durationMs,frame_count:frameCount},requested_delivery_profile_ids:['vertical-c53-p2-recon-v1'],render_assets:[{role:'scene_payload',sha256:payloadSha256,media_type:'application/json',uri:`execution://${selectionId}/payload`}],audio:{spec:audioSpec,artifact:canonicalAudio},execution:{html:rel(html),payload:rel(payloadFile),audio:rel(audioArtifact),template_id:template.id,template_version:template.version}});
 mapping.push({source_target_selection_id:row.selection_id,reconstruction_selection_id:selectionId,family_id:family.id,parameter_name:row.parameter_name,inferred_value:row.inferred.value,inferred_seed:row.inferred.seed,object_program_id:program.object_program_id});
}
const request={schema:'framewright-c19-campaign-request-v1',campaign_id:'c53-semantic-object-parameter-reconstructions-v1',compiler_policy_version:'c19-delivery-package-v1',runtime:{class:'FAST',scene_contract_version:'canvas-scene-v1',environment_id:'video-worker-chromium-v1',renderer:{id:'webcodecs-h264',version:'r35-standard-v1'},encoder:{video_codec:'avc1.420028',bitrate_bps:3000000,pixel_format:'yuv420p'},muxer:{id:'ffmpeg-stream-copy-aac',version:'6.1.1'}},delivery_profiles:[{id:'vertical-c53-p2-recon-v1',width:1080,height:1920,fps:FPS,safe_area_profile:'c26-ui-safe-v1-2026-09-17:youtube_shorts',platform_ui_profile:'youtube_shorts',platform_ui_version:'c26-ui-safe-v1-2026-09-17'}],selected,reserves:[{reserve_id:'c53-p2-recon-unrendered-control',reason:'prove-reserve-suppression'}]};
fs.writeFileSync(path.join(outDir,'campaign.json'),JSON.stringify(request,null,2)+'\n');fs.writeFileSync(path.join(outDir,'mapping.json'),JSON.stringify({schema:'c53-parameter-reconstruction-map-v1',rows:mapping},null,2)+'\n');
console.log(JSON.stringify({accepted_parameter_inferences:accepted.length,reconstructions:mapping.length,campaign:path.join(outDir,'campaign.json'),mapping:path.join(outDir,'mapping.json')},null,2));
