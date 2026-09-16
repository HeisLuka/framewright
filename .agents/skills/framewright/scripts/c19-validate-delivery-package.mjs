#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeCreativeId,computeRenderSpecId,assertFactoryIds} from '../../../../contracts/factory-identity-v1.mjs';
import {computeAudioSpecId,assertAudioSpecId,assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';

const packageA=path.resolve(process.argv[2]||'artifacts/c19/delivery-package.json');
const packageB=path.resolve(process.argv[3]||'artifacts/c19/delivery-package-check.json');
const e15Dir=path.resolve(process.argv[4]||'artifacts/e15/package');
const optionalSingle=process.argv[5]?path.resolve(process.argv[5]):null;
const audioSourcePath=path.resolve(process.argv[6]||'artifacts/c19/audio/track.wav');
const audioArtifactPath=path.resolve(process.argv[7]||'artifacts/c19/audio/canonical.m4a');
for(const f of[packageA,packageB,path.join(e15Dir,'campaign-manifest.json'),path.join(e15Dir,'candidate-catalog.json'),audioSourcePath,audioArtifactPath])if(!fs.existsSync(f))throw new Error(`missing ${f}`);
function sha(buf){return createHash('sha256').update(buf).digest('hex');}
const aBytes=fs.readFileSync(packageA),bBytes=fs.readFileSync(packageB),audioSourceBytes=fs.readFileSync(audioSourcePath),audioArtifactBytes=fs.readFileSync(audioArtifactPath);
if(!aBytes.equals(bBytes))throw new Error(`C19 package is not byte-identical across equivalent profile requests: ${sha(aBytes)} != ${sha(bBytes)}`);
const p=JSON.parse(aBytes),campaign=JSON.parse(fs.readFileSync(path.join(e15Dir,'campaign-manifest.json'),'utf8')),catalog=JSON.parse(fs.readFileSync(path.join(e15Dir,'candidate-catalog.json'),'utf8'));
if(p.schema!=='framewright-c19-delivery-package-v1')throw new Error(`unexpected C19 schema ${p.schema}`);
if(p.contract?.producer_contract!=='i04-duration-audio')throw new Error(`C19 did not adopt I04 producer contract: ${p.contract?.producer_contract}`);
if(!/^[a-f0-9]{64}$/.test(p.source?.delivery_template_sha256||''))throw new Error('responsive delivery template SHA missing');
if(p.source?.delivery_template_contract!=='book-ad-systems-e18-v1')throw new Error(`unexpected delivery template contract ${p.source?.delivery_template_contract}`);
if(p.delivery_qa_context?.delivery_template_sha256!==p.source.delivery_template_sha256)throw new Error('delivery QA/template identity drift');
if(p.request?.benchmark_duration_ms!==12000)throw new Error(`expected 12s benchmark control, got ${p.request?.benchmark_duration_ms}`);
if(!/^fwa1_[a-f0-9]{64}$/.test(p.benchmark_audio?.audio_spec_id||''))throw new Error('benchmark audio_spec_id missing');
if(p.benchmark_audio?.source_sha256!==sha(audioSourceBytes))throw new Error('benchmark source audio SHA mismatch');
if(p.benchmark_audio?.canonical_artifact_sha256!==sha(audioArtifactBytes))throw new Error('benchmark canonical audio SHA mismatch');
if(p.benchmark_audio?.canonical_artifact_bytes!==audioArtifactBytes.byteLength)throw new Error('benchmark canonical audio byte count mismatch');

const selectedIds=new Set((campaign.creatives||[]).map(x=>x.creativeId)),reserveIds=new Set((catalog.creatives||[]).filter(x=>x.selection?.status==='reserve').map(x=>x.creativeId));
if(p.counts.creative_specs!==selectedIds.size)throw new Error(`expected ${selectedIds.size} selected creative specs, got ${p.counts.creative_specs}`);
if(p.counts.reserve_render_specs!==0)throw new Error(`reserve_render_specs must be 0, got ${p.counts.reserve_render_specs}`);
if(p.counts.render_specs!==p.counts.creative_specs*p.counts.requested_profiles)throw new Error('render count is not bounded selected x requested profiles');
if(p.source.reserve_source_creatives!==reserveIds.size)throw new Error(`source reserve count mismatch ${p.source.reserve_source_creatives} vs ${reserveIds.size}`);
if(new Set(p.creatives.map(x=>x.creative.creative_id)).size!==p.creatives.length)throw new Error('duplicate nvc1 creative IDs');
const sourceSeen=new Set();
for(const row of p.creatives){
 const id=row.provenance?.e15_creative_id;if(!selectedIds.has(id))throw new Error(`non-selected E15 source creative in C19: ${id}`);if(reserveIds.has(id))throw new Error(`reserve source leaked into C19 creative ${id}`);sourceSeen.add(id);
 const expected=computeCreativeId(row.creative);if(row.creative.creative_id!==expected)throw new Error(`creative identity mismatch ${row.creative.creative_id} != ${expected}`);
 if(row.creative.hook?.source!=='payload_field'||!row.creative.hook?.text)throw new Error(`${id}: hook provenance lost`);
 if(!row.provenance?.source_output?.sha256?.match(/^[a-f0-9]{64}$/))throw new Error(`${id}: source artifact SHA evidence missing`);
 if(!row.provenance?.source_template_sha256?.match(/^[a-f0-9]{64}$/))throw new Error(`${id}: E15 source template SHA missing`);
 if(row.provenance?.delivery_template_sha256!==p.source.delivery_template_sha256)throw new Error(`${id}: delivery template provenance drift`);
 if(row.creative.template?.id!=='book-ad-systems-responsive'||row.creative.template?.version!=='e18-v1'||row.creative.template?.sha256!==p.source.delivery_template_sha256)throw new Error(`${id}: creative is not bound to canonical responsive E18 template`);
 if(!row.provenance?.source_payload_file)throw new Error(`${id}: source payload handoff missing`);
}
if(sourceSeen.size!==selectedIds.size)throw new Error(`selected-source coverage ${sourceSeen.size}/${selectedIds.size}`);

const byCreative=new Map(),renderIds=new Set(),audioIds=new Set(),audioArtifacts=new Set();let validatedCanonicalAudio=false;
for(const row of p.render_specs){
 const creative=p.creatives.find(x=>x.creative.creative_id===row.render.creative_id)?.creative;if(!creative)throw new Error(`render references missing creative ${row.render.creative_id}`);
 if(!selectedIds.has(row.provenance?.e15_creative_id)||reserveIds.has(row.provenance?.e15_creative_id))throw new Error(`render source is not selected ${row.provenance?.e15_creative_id}`);
 if(row.render.duration_ms!==12000||row.render.delivery?.duration_ms!==12000)throw new Error(`${row.render.render_spec_id}: explicit duration mismatch`);
 assertFactoryIds({creative,render:row.render});const expected=computeRenderSpecId(row.render);if(expected!==row.render.render_spec_id)throw new Error(`render identity mismatch ${row.render.render_spec_id}`);if(renderIds.has(expected))throw new Error(`duplicate render_spec_id ${expected}`);renderIds.add(expected);
 const audio=row.render.audio;if(!audio?.spec||!audio?.artifact)throw new Error(`${expected}: canonical audio missing`);assertAudioSpecId(audio.spec);
 if(audio.spec.audio_spec_id!==p.benchmark_audio.audio_spec_id)throw new Error(`${expected}: audio identity drift`);
 if(audio.spec.source_sha256!==p.benchmark_audio.source_sha256)throw new Error(`${expected}: audio source drift`);
 if(audio.spec.timing?.duration_ms!==12000||audio.spec.timing?.final_mux_duration_ms!==12000)throw new Error(`${expected}: audio duration drift`);
 if(audio.artifact.sha256!==p.benchmark_audio.canonical_artifact_sha256||audio.artifact.bytes!==p.benchmark_audio.canonical_artifact_bytes)throw new Error(`${expected}: canonical audio artifact drift`);
 if(!validatedCanonicalAudio){assertCanonicalAudioArtifact(audio.spec,audio.artifact,audioArtifactBytes);validatedCanonicalAudio=true;}
 audioIds.add(audio.spec.audio_spec_id);audioArtifacts.add(audio.artifact.sha256);
 const xs=byCreative.get(row.render.creative_id)||[];xs.push(row);byCreative.set(row.render.creative_id,xs);
 const sourceQa=row.qa_evidence?.find(x=>x.id==='e15-selected-source-artifact');if(sourceQa?.status!=='pass'||!sourceQa.details?.output_sha256?.match(/^[a-f0-9]{64}$/))throw new Error(`${expected}: source QA evidence missing`);
 const layoutQa=row.qa_evidence?.find(x=>x.id==='c18-responsive-layout-contract');if(layoutQa?.status!=='representative-pass'||layoutQa.details?.delivery_template_sha256!==p.source.delivery_template_sha256)throw new Error(`${expected}: responsive layout evidence/template identity missing`);
 const audioQa=row.qa_evidence?.find(x=>x.id==='i04-duration-audio-contract');if(audioQa?.status!=='pass'||audioQa.details?.audio_spec_id!==audio.spec.audio_spec_id||audioQa.details?.canonical_audio_sha256!==audio.artifact.sha256)throw new Error(`${expected}: I04 QA evidence missing`);
 const expectedDims={vertical:[1080,1920],square:[1080,1080],landscape:[1920,1080]}[row.profile];if(!expectedDims||row.render.delivery.width!==expectedDims[0]||row.render.delivery.height!==expectedDims[1])throw new Error(`${expected}: bad profile dimensions ${row.profile}`);
}
if(audioIds.size!==1||audioArtifacts.size!==1)throw new Error(`benchmark audio must be one pinned identity/artifact, got specs=${audioIds.size} artifacts=${audioArtifacts.size}`);
const wanted=p.request.requested_profiles;
for(const [creativeId,rows] of byCreative){const profiles=rows.map(x=>x.profile);if(JSON.stringify(profiles)!==JSON.stringify(wanted))throw new Error(`${creativeId}: profiles ${profiles} != ${wanted}`);if(new Set(rows.map(x=>x.render.creative_id)).size!==1)throw new Error(`${creativeId}: parent creative_id changed across profiles`);}
if(byCreative.size!==p.creatives.length)throw new Error(`render coverage ${byCreative.size}/${p.creatives.length}`);

const sample=structuredClone(p.render_specs[0].render),originalRenderId=sample.render_spec_id;sample.audio.spec.codec.bitrate_bps=128000;sample.audio.spec.audio_spec_id=computeAudioSpecId(sample.audio.spec);sample.audio.artifact.audio_spec_id=sample.audio.spec.audio_spec_id;sample.render_spec_id=computeRenderSpecId(sample);if(sample.render_spec_id===originalRenderId)throw new Error('render_spec_id did not change transitively with audio identity');
const durationDrift=structuredClone(p.render_specs[0].render);durationDrift.duration_ms=11999;let durationRejected=false;try{assertFactoryIds({creative:p.creatives.find(x=>x.creative.creative_id===durationDrift.creative_id).creative,render:durationDrift});}catch(e){durationRejected=/duration mismatch|duration_ms/.test(String(e.message));}if(!durationRejected)throw new Error('duration mismatch was not rejected');

if(optionalSingle){
 const s=JSON.parse(fs.readFileSync(optionalSingle,'utf8'));if(s.request.requested_profiles.length!==1||s.request.requested_profiles[0]!=='vertical')throw new Error('single-profile smoke must request vertical only');if(s.counts.render_specs!==s.counts.creative_specs)throw new Error('single-profile smoke emitted extra renders');if(s.render_specs.some(x=>x.profile!=='vertical'))throw new Error('unrequested delivery leaked into single-profile package');if(s.source?.delivery_template_sha256!==p.source.delivery_template_sha256)throw new Error('single-profile build changed delivery template identity');if(s.benchmark_audio?.audio_spec_id!==p.benchmark_audio.audio_spec_id||s.benchmark_audio?.canonical_artifact_sha256!==p.benchmark_audio.canonical_artifact_sha256)throw new Error('single-profile build changed audio identity');if(s.render_specs.some(x=>x.render.duration_ms!==12000||!x.render.audio))throw new Error('single-profile build lost I04 duration/audio');
}
console.log(JSON.stringify({status:'pass',packageSha256:sha(aBytes),deliveryTemplateSha256:p.source.delivery_template_sha256,durationMs:p.request.benchmark_duration_ms,audioSpecId:p.benchmark_audio.audio_spec_id,canonicalAudioSha256:p.benchmark_audio.canonical_artifact_sha256,books:p.counts.books,selectedCreativeSpecs:p.counts.creative_specs,requestedProfiles:wanted,renderSpecs:p.counts.render_specs,sourceReserves:p.source.reserve_source_creatives,reserveRenderSpecs:p.counts.reserve_render_specs,byteIdentical:true,singleProfileSmoke:!!optionalSingle,audioIdentityTransitive:true,durationMismatchRejected:true},null,2));
