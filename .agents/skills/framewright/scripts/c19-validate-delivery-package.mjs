#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeCreativeId,computeRenderSpecId,assertFactoryIds} from '../../../../contracts/factory-identity-v1.mjs';
import {computeAudioSpecId,assertAudioSpecId,assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';

const packageA=path.resolve(process.argv[2]||'artifacts/c19/delivery-package.json');
const packageB=path.resolve(process.argv[3]||'artifacts/c19/delivery-package-check.json');
const e15Dir=path.resolve(process.argv[4]||'artifacts/e15/package');
const verticalPath=path.resolve(process.argv[5]||'artifacts/c19/vertical-only.json');
const audioAPath=path.resolve(process.argv[6]||'artifacts/c19/delivery-package-audio-adoption.json');
const audioBPath=path.resolve(process.argv[7]||'artifacts/c19/delivery-package-audio-adoption-check.json');
const audioSourcePath=path.resolve(process.argv[8]||'artifacts/c19/audio-source.wav');
const audioArtifactPath=path.resolve(process.argv[9]||'artifacts/c19/canonical-audio.m4a');
for(const f of[packageA,packageB,verticalPath,audioAPath,audioBPath,path.join(e15Dir,'campaign-manifest.json'),path.join(e15Dir,'candidate-catalog.json'),audioSourcePath,audioArtifactPath])if(!fs.existsSync(f))throw new Error(`missing ${f}`);
const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const read=(f)=>JSON.parse(fs.readFileSync(f,'utf8'));
const aBytes=fs.readFileSync(packageA),bBytes=fs.readFileSync(packageB),audioABytes=fs.readFileSync(audioAPath),audioBBytes=fs.readFileSync(audioBPath),audioSourceBytes=fs.readFileSync(audioSourcePath),audioArtifactBytes=fs.readFileSync(audioArtifactPath);
if(!aBytes.equals(bBytes))throw new Error(`primary C19 package is not byte-identical: ${hash(aBytes)} != ${hash(bBytes)}`);
if(!audioABytes.equals(audioBBytes))throw new Error(`audio-adoption C19 package is not byte-identical: ${hash(audioABytes)} != ${hash(audioBBytes)}`);
const p=JSON.parse(aBytes),vertical=read(verticalPath),audioP=JSON.parse(audioABytes),campaign=read(path.join(e15Dir,'campaign-manifest.json')),catalog=read(path.join(e15Dir,'candidate-catalog.json'));
const selectedIds=new Set((campaign.creatives||[]).map(x=>x.creativeId)),reserveIds=new Set((catalog.creatives||[]).filter(x=>x.selection?.status==='reserve').map(x=>x.creativeId));

function validateCore(pkg,{expectAudio=false,singleProfile=false}={}){
 if(pkg.schema!=='framewright-c19-delivery-package-v1')throw new Error(`unexpected C19 schema ${pkg.schema}`);
 if(pkg.contract?.producer_contract!=='i04-duration-audio-v1')throw new Error(`C19 did not adopt current I04 producer contract: ${pkg.contract?.producer_contract}`);
 if(!/^[a-f0-9]{64}$/.test(pkg.source?.delivery_template_sha256||''))throw new Error('responsive delivery template SHA missing');
 if(pkg.source?.delivery_template_contract!=='book-ad-systems-e18-v1')throw new Error(`unexpected delivery template contract ${pkg.source?.delivery_template_contract}`);
 if(pkg.delivery_qa_context?.delivery_template_sha256!==pkg.source.delivery_template_sha256)throw new Error('delivery QA/template identity drift');
 if(pkg.request?.benchmark_duration_ms!==12000)throw new Error(`expected 12s benchmark control, got ${pkg.request?.benchmark_duration_ms}`);
 if(pkg.counts.creative_specs!==selectedIds.size)throw new Error(`expected ${selectedIds.size} selected creative specs, got ${pkg.counts.creative_specs}`);
 if(pkg.counts.reserve_render_specs!==0)throw new Error(`reserve_render_specs must be 0, got ${pkg.counts.reserve_render_specs}`);
 if(pkg.counts.render_specs!==pkg.counts.creative_specs*pkg.counts.requested_profiles)throw new Error('render count is not bounded selected x requested profiles');
 if(pkg.source.reserve_source_creatives!==reserveIds.size)throw new Error(`source reserve count mismatch ${pkg.source.reserve_source_creatives} vs ${reserveIds.size}`);
 if(new Set(pkg.creatives.map(x=>x.creative.creative_id)).size!==pkg.creatives.length)throw new Error('duplicate nvc1 creative IDs');
 if(expectAudio&&pkg.audio_workload?.mode!=='benchmark-fixture')throw new Error('audio adoption package missing benchmark-fixture mode');
 if(!expectAudio&&pkg.audio_workload?.mode!=='none')throw new Error('primary campaign package must not invent soundtrack audio');
 const sourceSeen=new Set();
 for(const row of pkg.creatives){
   const id=row.provenance?.e15_creative_id;if(!selectedIds.has(id)||reserveIds.has(id))throw new Error(`non-selected source creative in C19: ${id}`);sourceSeen.add(id);
   const expected=computeCreativeId(row.creative);if(row.creative.creative_id!==expected)throw new Error(`creative identity mismatch ${row.creative.creative_id} != ${expected}`);
   if(row.creative.hook?.source!=='payload_field'||!row.creative.hook?.text)throw new Error(`${id}: hook provenance lost`);
   if(!row.provenance?.source_output?.sha256?.match(/^[a-f0-9]{64}$/))throw new Error(`${id}: source artifact SHA evidence missing`);
   if(!row.provenance?.source_template_sha256?.match(/^[a-f0-9]{64}$/))throw new Error(`${id}: E15 source template SHA missing`);
   if(row.provenance?.delivery_template_sha256!==pkg.source.delivery_template_sha256)throw new Error(`${id}: delivery template provenance drift`);
   if(row.creative.template?.id!=='book-ad-systems-responsive'||row.creative.template?.version!=='e18-v1'||row.creative.template?.sha256!==pkg.source.delivery_template_sha256)throw new Error(`${id}: creative is not bound to canonical responsive E18 template`);
 }
 if(sourceSeen.size!==selectedIds.size)throw new Error(`selected-source coverage ${sourceSeen.size}/${selectedIds.size}`);
 const byCreative=new Map(),renderIds=new Set(),audioIds=new Set(),audioArtifacts=new Set();let audioBytesChecked=false;
 for(const row of pkg.render_specs){
   const creative=pkg.creatives.find(x=>x.creative.creative_id===row.render.creative_id)?.creative;if(!creative)throw new Error(`render references missing creative ${row.render.creative_id}`);
   if(!selectedIds.has(row.provenance?.e15_creative_id)||reserveIds.has(row.provenance?.e15_creative_id))throw new Error(`render source is not selected ${row.provenance?.e15_creative_id}`);
   if(row.render.duration_ms!==12000||row.render.delivery?.duration_ms!==12000)throw new Error(`${row.render.render_spec_id}: explicit duration mismatch`);
   assertFactoryIds({creative,render:row.render});const expected=computeRenderSpecId(row.render);if(expected!==row.render.render_spec_id)throw new Error(`render identity mismatch ${row.render.render_spec_id}`);if(renderIds.has(expected))throw new Error(`duplicate render_spec_id ${expected}`);renderIds.add(expected);
   if(expectAudio){
     const audio=row.render.audio;if(!audio?.spec||!audio?.artifact)throw new Error(`${expected}: canonical audio missing`);assertAudioSpecId(audio.spec);
     if(audio.spec.audio_spec_id!==pkg.audio_workload.audio_spec_id||audio.spec.source_sha256!==pkg.audio_workload.source_sha256)throw new Error(`${expected}: audio spec drift`);
     if(audio.spec.timing?.duration_ms!==12000||audio.spec.timing?.final_mux_duration_ms!==12000)throw new Error(`${expected}: audio duration drift`);
     if(audio.artifact.sha256!==pkg.audio_workload.canonical_artifact_sha256||audio.artifact.bytes!==pkg.audio_workload.canonical_artifact_bytes)throw new Error(`${expected}: canonical audio artifact drift`);
     if(!audioBytesChecked){if(audio.spec.source_sha256!==hash(audioSourceBytes))throw new Error('audio fixture source SHA mismatch');assertCanonicalAudioArtifact(audio.spec,audio.artifact,audioArtifactBytes);audioBytesChecked=true;}
     audioIds.add(audio.spec.audio_spec_id);audioArtifacts.add(audio.artifact.sha256);
   }else if(row.render.audio!==undefined)throw new Error(`${expected}: primary package invented audio`);
   const i04=row.qa_evidence?.find(x=>x.id==='i04-duration-audio-contract');if(i04?.status!=='pass'||i04.details?.duration_ms!==12000||i04.details?.audio_mode!==(expectAudio?'benchmark-fixture':'none'))throw new Error(`${expected}: I04 QA evidence mismatch`);
   const layout=row.qa_evidence?.find(x=>x.id==='c18-responsive-layout-contract');if(layout?.status!=='representative-pass'||layout.details?.delivery_template_sha256!==pkg.source.delivery_template_sha256)throw new Error(`${expected}: responsive layout evidence missing`);
   const dims={vertical:[1080,1920],square:[1080,1080],landscape:[1920,1080]}[row.profile];if(!dims||row.render.delivery.width!==dims[0]||row.render.delivery.height!==dims[1])throw new Error(`${expected}: bad profile dimensions ${row.profile}`);
   const xs=byCreative.get(row.render.creative_id)||[];xs.push(row);byCreative.set(row.render.creative_id,xs);
 }
 if(expectAudio&&(audioIds.size!==1||audioArtifacts.size!==1))throw new Error(`audio adoption must pin one spec/artifact, got ${audioIds.size}/${audioArtifacts.size}`);
 const wanted=pkg.request.requested_profiles;
 for(const [creativeId,rows] of byCreative){const profiles=rows.map(x=>x.profile);if(JSON.stringify(profiles)!==JSON.stringify(wanted))throw new Error(`${creativeId}: profiles ${profiles} != ${wanted}`);if(new Set(rows.map(x=>x.render.creative_id)).size!==1)throw new Error(`${creativeId}: parent creative_id changed across profiles`);}
 if(byCreative.size!==pkg.creatives.length)throw new Error(`render coverage ${byCreative.size}/${pkg.creatives.length}`);
 if(singleProfile&&(wanted.length!==1||wanted[0]!=='vertical'||pkg.render_specs.some(x=>x.profile!=='vertical')))throw new Error('vertical-only smoke emitted unrequested profiles');
 return {renderIds};
}

validateCore(p);validateCore(vertical,{singleProfile:true});validateCore(audioP,{expectAudio:true});
if(p.source.delivery_template_sha256!==vertical.source.delivery_template_sha256||p.source.delivery_template_sha256!==audioP.source.delivery_template_sha256)throw new Error('delivery template identity changed across package modes');
const creativeIds=(x)=>x.creatives.map(r=>r.creative.creative_id).sort();if(JSON.stringify(creativeIds(p))!==JSON.stringify(creativeIds(audioP)))throw new Error('audio fixture changed creative identity');
if(JSON.stringify(p.request.requested_profiles)!==JSON.stringify(audioP.request.requested_profiles))throw new Error('audio adoption changed requested profile set');
const primaryByKey=new Map(p.render_specs.map(x=>[[x.render.creative_id,x.profile].join('|'),x.render]));
for(const row of audioP.render_specs){const base=primaryByKey.get([row.render.creative_id,row.profile].join('|'));if(!base)throw new Error('audio adoption has no matching primary render');if(base.render_spec_id===row.render.render_spec_id)throw new Error('adding canonical audio did not change render_spec_id');}
const sample=structuredClone(audioP.render_specs[0].render),originalRenderId=sample.render_spec_id;sample.audio.spec.codec.bitrate_bps=128000;sample.audio.spec.audio_spec_id=computeAudioSpecId(sample.audio.spec);sample.audio.artifact.audio_spec_id=sample.audio.spec.audio_spec_id;sample.render_spec_id=computeRenderSpecId(sample);if(sample.render_spec_id===originalRenderId)throw new Error('render_spec_id did not change transitively with audio identity');
const durationDrift=structuredClone(p.render_specs[0].render);durationDrift.duration_ms=11999;let durationRejected=false;try{assertFactoryIds({creative:p.creatives.find(x=>x.creative.creative_id===durationDrift.creative_id).creative,render:durationDrift});}catch(e){durationRejected=/duration mismatch|duration_ms/.test(String(e.message));}if(!durationRejected)throw new Error('duration mismatch was not rejected');

console.log(JSON.stringify({status:'pass',primaryPackageSha256:hash(aBytes),audioAdoptionPackageSha256:hash(audioABytes),deliveryTemplateSha256:p.source.delivery_template_sha256,durationMs:12000,audioSpecId:audioP.audio_workload.audio_spec_id,canonicalAudioSha256:audioP.audio_workload.canonical_artifact_sha256,books:p.counts.books,selectedCreativeSpecs:p.counts.creative_specs,requestedProfiles:p.request.requested_profiles,renderSpecs:p.counts.render_specs,sourceReserves:p.source.reserve_source_creatives,reserveRenderSpecs:p.counts.reserve_render_specs,primaryByteIdentical:true,audioAdoptionByteIdentical:true,verticalOnlyBounded:true,audioIdentityTransitive:true,durationMismatchRejected:true},null,2));
