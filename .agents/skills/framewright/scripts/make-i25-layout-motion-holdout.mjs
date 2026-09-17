#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeAudioSpecId,assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';
import {buildCanonicalTemplateVariabilityRegistry,composeExplicitTemplateVariant,deriveTemplateSceneProgram} from '../../../../contracts/template-variant-composer-v1.mjs';
import {loadMotionGrammarFamilyRegistry} from '../../../../contracts/motion-grammar-families-v2.mjs';
import {loadStructuralLayoutFamilyRegistry} from '../../../../contracts/structural-layout-families-v2.mjs';

const fixtureDir=path.resolve(process.argv[2]||'.bench/i25/c27-fixtures');
const html=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c45-template-variant.html');
const audioSource=path.resolve(process.argv[4]||'.bench/i25/source.wav');
const audioArtifact=path.resolve(process.argv[5]||'.bench/i25/canonical-audio.m4a');
const outDir=path.resolve(process.argv[6]||'.bench/i25/source-input');
const shaBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const shaFile=file=>shaBytes(fs.readFileSync(file));
const rel=file=>path.relative(process.cwd(),file).split(path.sep).join('/');
function slug(value){return String(value).replace(/[^a-z0-9_-]/gi,'-').toLowerCase();}
function pngDimensions(file){const b=fs.readFileSync(file);if(b.length<24||b.toString('ascii',1,4)!=='PNG')throw new Error(`expected PNG cover ${file}`);return{width:b.readUInt32BE(16),height:b.readUInt32BE(20)};}
function roleText(role,book){const atoms=(role.atoms||[]).filter(a=>a?.source?.kind!=='reserved_affordance').map(a=>String(a.text||'').trim()).filter(Boolean);if(atoms.length)return atoms.join(' ');if(role.role==='book_reveal')return String(book.title||'').trim();if(role.role==='cta')return String(book.cta||'Открыть книгу').trim();throw new Error(`no semantic text for ${role.role}`);}
for(const file of [html,audioSource,audioArtifact,path.join(fixtureDir,'manifest.json')])if(!fs.existsSync(file))throw new Error(`missing I25 input ${file}`);
const sourceManifest=JSON.parse(fs.readFileSync(path.join(fixtureDir,'manifest.json'),'utf8'));
const item=sourceManifest.items.find(x=>x.bookId==='winter-map'&&x.revealTiming==='early'&&Number(x.durationSeconds)===9)||sourceManifest.items.find(x=>x.revealTiming==='early'&&Number(x.durationSeconds)===9);
if(!item)throw new Error('I25 requires one early 9s C27 fixture');
const input=JSON.parse(fs.readFileSync(path.join(fixtureDir,item.inputFile),'utf8')),plan=JSON.parse(fs.readFileSync(path.join(fixtureDir,item.planFile),'utf8')),book=input.book;
if(plan.duration_seconds!==9||plan.cta_treatment!=='intent')throw new Error('I25 expects canonical 9s intent CTA');
const cta=plan.roles.find(role=>role.role==='cta');if(!cta||cta.start_frame!==Math.round(plan.total_frames*.82))throw new Error(`unexpected CTA boundary ${cta?.start_frame}`);
const beforeCta=plan.roles.find(role=>role.end_frame===cta.start_frame);if(!beforeCta||beforeCta.role==='book_reveal')throw new Error('no-cover pre-CTA calibration frame unavailable');
const sourceCover=path.resolve('examples/book-ad-v0/generated-e08',path.basename(book.cover_url));if(!fs.existsSync(sourceCover))throw new Error(`missing cover ${sourceCover}`);
const runtimeAssetDir=path.join(path.dirname(html),'generated-i25-layout-motion');fs.rmSync(runtimeAssetDir,{recursive:true,force:true});fs.mkdirSync(runtimeAssetDir,{recursive:true});
const coverName=`${slug(book.book_id)}-${path.basename(sourceCover)}`,runtimeCover=path.join(runtimeAssetDir,coverName);fs.copyFileSync(sourceCover,runtimeCover);
const coverSha256=shaFile(runtimeCover),dims=pngDimensions(runtimeCover),trustedCover={asset_id:`asset_${slug(book.book_id)}_cover`,kind:'cover',sha256:coverSha256,width:dims.width,height:dims.height};
const narrative={narrative_plan_id:plan.narrative_plan_id,seed:plan.seed,title:String(book.title||''),author:String(book.author||''),roles:plan.roles.map(role=>({role:role.role,text:roleText(role,book),start_frame:role.start_frame,end_frame:role.end_frame}))};
const delivery={aspect:'vertical',width:1080,height:1920,fps:30,duration_seconds:9},context={aspect:'vertical',duration_seconds:9,semantic_roles:narrative.roles.map(r=>r.role),available_asset_kinds:['cover']};
const registry=buildCanonicalTemplateVariabilityRegistry(),layouts=loadStructuralLayoutFamilyRegistry().families.map(f=>f.id).sort(),motions=loadMotionGrammarFamilyRegistry().families.map(f=>f.id).sort();
if(layouts.length!==6||motions.length!==6)throw new Error(`I25 expected 6x6 families, got ${layouts.length}x${motions.length}`);
const fixedAxes={visual_system:'swiss',typography:'type_editorial_hierarchy_v2',asset_staging:'stage_hero_cover_v2',graphic_devices:['device_rule_pair_v2']};
const templateSha256=shaFile(html),durationMs=9000,sourceSha256=shaFile(audioSource);
const audioSpec={schema:'framewright-audio-spec-v1',audio_spec_id:'',version:1,source_sha256:sourceSha256,timing:{trim_start_ms:0,duration_ms:durationMs,final_mux_duration_ms:durationMs},mix:{gain_db:0,fades:null},codec:{name:'aac',bitrate_bps:192000,container:'m4a',policy:'aac-lc-ffmpeg-192k-v2-explicit-duration'}};audioSpec.audio_spec_id=computeAudioSpecId(audioSpec);
const audioBytes=fs.readFileSync(audioArtifact),canonicalAudio={schema:'framewright-canonical-audio-v1',audio_spec_id:audioSpec.audio_spec_id,sha256:shaBytes(audioBytes),bytes:audioBytes.byteLength,media_type:'audio/mp4',storage_uri:`artifact://i25/${path.basename(audioArtifact)}`,provenance:{encoder:'ffmpeg-github-runner',policy:audioSpec.codec.policy}};assertCanonicalAudioArtifact(audioSpec,canonicalAudio,audioBytes);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const selected=[],rows=[];let order=0;
for(const [layoutIndex,structural_layout] of layouts.entries())for(const [motionIndex,motion_grammar] of motions.entries()){
  const receipt=composeExplicitTemplateVariant({selection:{...fixedAxes,structural_layout,motion_grammar},context,registry}),variant=receipt.template_variant,sceneProgram=deriveTemplateSceneProgram({composition_receipt:receipt,narrative,delivery,trusted_cover:trustedCover,registry});
  const selectionId=`i25-cell-${String(layoutIndex+1).padStart(2,'0')}-${String(motionIndex+1).padStart(2,'0')}`;
  const payload={...book,cover_url:`./generated-i25-layout-motion/${coverName}`,delivery_profile:'vertical',narrative_plan:plan,template_scene_program:sceneProgram,i25_experiment:{arm:'layout_motion_holdout',layout_index:layoutIndex,motion_index:motionIndex}};
  const payloadBytes=Buffer.from(JSON.stringify(payload,null,2)+'\n'),payloadSha256=shaBytes(payloadBytes),payloadFile=path.join(outDir,`${selectionId}.payload.json`);fs.writeFileSync(payloadFile,payloadBytes);
  const template={id:'book-ad-template-variant',version:'i25-layout-motion-holdout-v1',sha256:templateSha256},hook=narrative.roles.find(r=>r.role==='hook')?.text||'';
  selected.push({selection_id:selectionId,selection_order:order++,creative:{schema:'newboo-creative-spec-v1',book_id:book.book_id,payload_sha256:payloadSha256,template,visual_system:{id:variant.axes.visual_system,version:'v2'},structural_variant:variant.axes.structural_layout,hook:{source:'c27_narrative_plan',text:hook,source_ref:`${plan.narrative_plan_id}:hook`},motion:{profile:variant.axes.motion_grammar,version:'v2'},art_direction:{mode:'template-variant',algorithm:'i25-layout-motion-holdout-v1',source_cover_sha256:coverSha256,palette:{background:book.background||'#eee8dc',surface:'#ffffff',ink:book.ink||'#111111',accent:book.accent||'#cc332d',secondary:'#315A7D'}},seed:plan.seed,assets:[{role:'cover',sha256:coverSha256,media_type:'image/png',uri:`asset://generated-i25-layout-motion/${coverName}`}],template_variant_id:variant.template_variant_id,scene_program_id:sceneProgram.scene_program_id},timeline:{source:`c27:${plan.narrative_plan_id}`,policy_version:plan.policy_version,duration_ms:durationMs,frame_count:plan.total_frames},requested_delivery_profile_ids:['vertical-i25-layout-motion-v1'],render_assets:[{role:'scene_payload',sha256:payloadSha256,media_type:'application/json',uri:`execution://${selectionId}/payload`}],audio:{spec:audioSpec,artifact:canonicalAudio},execution:{html:rel(html),payload:rel(payloadFile),audio:rel(audioArtifact),template_id:template.id,template_version:template.version}});
  rows.push({selection_id:selectionId,layout_index:layoutIndex,motion_index:motionIndex,structural_layout:variant.axes.structural_layout,motion_grammar:variant.axes.motion_grammar,template_variant_id:variant.template_variant_id,scene_program_id:sceneProgram.scene_program_id,payload_sha256:payloadSha256});
}
const runtime={class:'FAST',scene_contract_version:'canvas-scene-v1',environment_id:'video-worker-chromium-v1',renderer:{id:'webcodecs-h264',version:'r35-standard-v1'},encoder:{video_codec:'avc1.420028',bitrate_bps:3000000,pixel_format:'yuv420p'},muxer:{id:'ffmpeg-stream-copy-aac',version:'6.1.1'}};
const request={schema:'framewright-c19-campaign-request-v1',campaign_id:'i25-layout-motion-holdout-source',compiler_policy_version:'c19-delivery-package-v1',runtime,delivery_profiles:[{id:'vertical-i25-layout-motion-v1',width:1080,height:1920,fps:30,safe_area_profile:'c26-ui-safe-v1-2026-09-17:youtube_shorts',platform_ui_profile:'youtube_shorts',platform_ui_version:'c26-ui-safe-v1-2026-09-17'}],selected,reserves:[]};
fs.writeFileSync(path.join(outDir,'campaign.json'),JSON.stringify(request,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'materialization-manifest.json'),JSON.stringify({schema:'i25-layout-motion-holdout-materialization-v1',selected_count:rows.length,layout_family_count:layouts.length,motion_family_count:motions.length,book_id:book.book_id,narrative_plan_id:plan.narrative_plan_id,cover_sha256:coverSha256,template_sha256:templateSha256,fixed_axes:fixedAxes,varied_axes:['structural_layout','motion_grammar'],layouts,motions,selection_provenance:null,rows},null,2)+'\n');
console.log(JSON.stringify({schema:'i25-layout-motion-holdout-fixture-v1',selectedCount:rows.length,bookId:book.book_id,layoutFamilies:layouts,motionFamilies:motions,fixedAxes,selectionProvenance:null},null,2));
