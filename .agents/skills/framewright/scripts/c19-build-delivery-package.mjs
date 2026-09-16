#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeCreativeId,computeRenderSpecId,assertFactoryIds} from '../../../../contracts/factory-identity-v1.mjs';
import {computeAudioSpecId,assertAudioSpecId,assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';

const e15Dir=path.resolve(process.argv[2]||'artifacts/e15/package');
const e14ManifestPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-e14/manifest.json');
const outPath=path.resolve(process.argv[4]||'artifacts/c19/delivery-package.json');
const requestedRaw=process.argv[5]||process.env.DELIVERY_PROFILES||'vertical,square,landscape';
const deliveryTemplatePath=path.resolve(process.argv[6]||process.env.DELIVERY_TEMPLATE||'examples/book-ad-systems/index-e18-for-c19.html');
const audioSourcePath=path.resolve(process.argv[7]||process.env.AUDIO_SOURCE||'artifacts/c19/audio/track.wav');
const audioArtifactPath=path.resolve(process.argv[8]||process.env.AUDIO_ARTIFACT||'artifacts/c19/audio/canonical.m4a');
const campaignPath=path.join(e15Dir,'campaign-manifest.json');
const catalogPath=path.join(e15Dir,'candidate-catalog.json');
for(const f of[campaignPath,catalogPath,e14ManifestPath,deliveryTemplatePath,audioSourcePath,audioArtifactPath])if(!fs.existsSync(f))throw new Error(`missing input ${f}`);

const DURATION_MS=12000;
const PROFILE_ORDER=['vertical','square','landscape'];
const PROFILES={
 vertical:{id:'vertical-1080x1920-v1',width:1080,height:1920,fps:30,duration_ms:DURATION_MS},
 square:{id:'square-1080x1080-v1',width:1080,height:1080,fps:30,duration_ms:DURATION_MS},
 landscape:{id:'landscape-1920x1080-v1',width:1920,height:1080,fps:30,duration_ms:DURATION_MS}
};
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=stable(v[k]);return o;}return v;}
function stablePretty(v){return JSON.stringify(stable(v),null,2)+'\n';}
function shaBytes(bytes){return createHash('sha256').update(bytes).digest('hex');}
function shaFile(file){return shaBytes(fs.readFileSync(file));}
function mediaType(src){const ext=path.extname(String(src||'')).toLowerCase();return ext==='.svg'?'image/svg+xml':ext==='.png'?'image/png':ext==='.webp'?'image/webp':ext==='.jpg'||ext==='.jpeg'?'image/jpeg':'application/octet-stream';}
function parseProfiles(raw){const xs=String(raw).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);if(!xs.length)throw new Error('at least one delivery profile is required');for(const x of xs)if(!PROFILES[x])throw new Error(`unknown delivery profile ${x}`);const set=new Set(xs);return PROFILE_ORDER.filter(x=>set.has(x));}
function color(v,fallback){return /^#[0-9a-f]{6}$/i.test(v||'')?v:fallback;}

const requested=parseProfiles(requestedRaw);
const campaign=JSON.parse(fs.readFileSync(campaignPath,'utf8'));
const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
const e14=JSON.parse(fs.readFileSync(e14ManifestPath,'utf8'));
const deliveryTemplateSha=shaFile(deliveryTemplatePath);
if(campaign.schema!=='framewright-selected-campaign-manifest-v1')throw new Error(`unexpected campaign schema ${campaign.schema}`);
if(catalog.schema!=='framewright-campaign-package-v1')throw new Error(`unexpected catalog schema ${catalog.schema}`);

const audioSourceBytes=fs.readFileSync(audioSourcePath),audioArtifactBytes=fs.readFileSync(audioArtifactPath);
const audioSpec={
 schema:'framewright-audio-spec-v1',audio_spec_id:'',version:1,source_sha256:shaBytes(audioSourceBytes),
 timing:{trim_start_ms:0,duration_ms:DURATION_MS,final_mux_duration_ms:DURATION_MS},
 mix:{gain_db:0,fades:null},
 codec:{name:'aac',bitrate_bps:192000,container:'m4a',policy:'aac-lc-ffmpeg-192k-v2-explicit-duration'}
};
audioSpec.audio_spec_id=computeAudioSpecId(audioSpec);assertAudioSpecId(audioSpec);
const audioArtifact={
 schema:'framewright-canonical-audio-v1',audio_spec_id:audioSpec.audio_spec_id,sha256:shaBytes(audioArtifactBytes),bytes:audioArtifactBytes.byteLength,media_type:'audio/mp4',
 provenance:{producer:'c19-benchmark-audio-fixture-v1',source:'lavfi-sine-110hz-48khz-12s-volume-0.06',encoder:'ffmpeg-aac-192k',policy:audioSpec.codec.policy}
};
assertCanonicalAudioArtifact(audioSpec,audioArtifact,audioArtifactBytes);
const canonicalAudio={spec:audioSpec,artifact:audioArtifact};

const selected=campaign.creatives||[];
const catalogSelected=(catalog.creatives||[]).filter(x=>x.selection?.status==='selected');
const reserve=(catalog.creatives||[]).filter(x=>x.selection?.status==='reserve');
const suppressed=(catalog.creatives||[]).filter(x=>x.selection?.status==='suppressed');
if(selected.length!==catalogSelected.length)throw new Error(`E15 selected mismatch ${selected.length} vs ${catalogSelected.length}`);
const selectedIds=new Set(selected.map(x=>x.creativeId));for(const x of catalogSelected)if(!selectedIds.has(x.creativeId))throw new Error(`campaign manifest missing selected ${x.creativeId}`);
const e14ByKey=new Map((e14.items||[]).map(x=>[[x.bookId,x.style,x.variant,x.seed].join('|'),x]));
const manifestDir=path.dirname(e14ManifestPath);
const fonts=campaign.renderer?.environment?.fonts||[];
const regular=fonts.find(x=>/DejaVuSans\.ttf$/i.test(x.file||'')),bold=fonts.find(x=>/DejaVuSans-Bold\.ttf$/i.test(x.file||''));
if(!regular?.sha256||!bold?.sha256)throw new Error('pinned E15 font hashes missing');
const runtime={
 class:'FAST',scene_contract_version:'canvas-scene-v1',
 environment_id:`e15-${String(campaign.renderer?.renderEnvironmentHash||'').slice(0,24)}`,
 renderer:{id:'napi-canvas-ffmpeg-x264',version:'e15-v1'},
 encoder:{video_codec:'libx264',crf:Number(campaign.renderer?.profile?.crf??22),preset:String(campaign.renderer?.profile?.preset||'veryfast'),pixel_format:String(campaign.renderer?.profile?.pixelFormat||'yuv420p')},
 muxer:{id:'ffmpeg-mp4-aac',version:'r32-canonical-aac-v1'}
};
if(!runtime.environment_id.match(/^e15-[a-f0-9]{24}$/))throw new Error('invalid E15 render environment hash');

const creatives=[];
for(const src of selected){
 const key=[src.bookId,src.visualSystem,src.variant,src.seed].join('|'),entry=e14ByKey.get(key);if(!entry)throw new Error(`no E14 payload for selected ${key}`);
 const payload=JSON.parse(fs.readFileSync(path.resolve(manifestDir,entry.payloadFile),'utf8'));
 const coverSha=src.identity?.coverSha256,payloadSha=src.identity?.payloadSha256,sourceTemplateSha=src.identity?.templateSha256;
 for(const [name,v] of Object.entries({coverSha,payloadSha,sourceTemplateSha,deliveryTemplateSha}))if(!/^[a-f0-9]{64}$/.test(v||''))throw new Error(`${src.creativeId}: invalid ${name}`);
 const assets=[
   {role:'cover',sha256:coverSha,media_type:mediaType(payload.cover_url)},
   {role:'font_regular',sha256:regular.sha256,media_type:'font/ttf'},
   {role:'font_bold',sha256:bold.sha256,media_type:'font/ttf'}
 ];
 const background=color(payload.background,'#f2eadf'),ink=color(payload.ink,'#111111'),accent=color(payload.accent,'#ff4b2b');
 const creative={
   schema:'newboo-creative-spec-v1',creative_id:'',book_id:src.bookId,payload_sha256:payloadSha,
   template:{id:'book-ad-systems-responsive',version:'e18-v1',sha256:deliveryTemplateSha},
   visual_system:{id:src.visualSystem,version:'v1'},structural_variant:src.variant,
   hook:{source:'payload_field',text:String(payload.hook||'').trim(),source_ref:'BookPayload.hook'},
   motion:{profile:String(payload.motion_density||'active'),version:'e12-v1'},
   art_direction:{mode:'template-default',algorithm:'payload-colors-compat-v1',source_cover_sha256:coverSha,palette:{background,surface:background,ink,accent,secondary:accent}},
   seed:Number(src.seed),assets
 };
 if(!creative.hook.text)throw new Error(`${src.creativeId}: empty hook`);
 creative.creative_id=computeCreativeId(creative);
 creatives.push({
   creative,
   provenance:{e15_creative_id:src.creativeId,e15_render_id:src.renderId,book_id:src.bookId,variant:src.variant,visual_system:src.visualSystem,selection:src.selection,source_output:{sha256:src.output?.sha256,bytes:src.output?.bytes},source_template_sha256:sourceTemplateSha,delivery_template_sha256:deliveryTemplateSha,source_payload_file:entry.payloadFile,route:src.route,dedupe:src.dedupe}
 });
}
creatives.sort((a,b)=>a.creative.book_id.localeCompare(b.creative.book_id)||a.creative.creative_id.localeCompare(b.creative.creative_id));
if(new Set(creatives.map(x=>x.creative.creative_id)).size!==creatives.length)throw new Error('nvc1 creative_id collision');

const render_specs=[];
for(const row of creatives){
 for(const profileKey of requested){
   const render={schema:'newboo-render-spec-v1',render_spec_id:'',creative_id:row.creative.creative_id,duration_ms:DURATION_MS,delivery:{...PROFILES[profileKey]},runtime:structuredClone(runtime),assets:[],audio:structuredClone(canonicalAudio),artifact_policy:{reuse:'prefer-existing',canonical_key:'render_spec_id'}};
   render.render_spec_id=computeRenderSpecId(render);assertFactoryIds({creative:row.creative,render});
   render_specs.push({
     render,profile:profileKey,provenance:{e15_creative_id:row.provenance.e15_creative_id,source_payload_file:row.provenance.source_payload_file},
     qa_evidence:[
       {id:'e15-selected-source-artifact',status:'pass',details:{output_sha256:row.provenance.source_output.sha256,bytes:row.provenance.source_output.bytes}},
       {id:'c18-responsive-layout-contract',status:'representative-pass',details:{evidence_ref:'LAB-C18-RESPONSIVE-VARIANTS-RESULTS.md',delivery_template_sha256:deliveryTemplateSha,profile:profileKey,note:'C18 validated this responsive semantic template construction across all four structural variants and delivery profiles on representative systems; this is inherited layout evidence, not QA of an unrendered C19 artifact.'}},
       {id:'i04-duration-audio-contract',status:'pass',details:{duration_ms:DURATION_MS,audio_spec_id:audioSpec.audio_spec_id,canonical_audio_sha256:audioArtifact.sha256,note:'Pinned 12s benchmark/control audio identity for I02 workload; not a universal product duration or soundtrack policy.'}}
     ]
   });
 }
}
render_specs.sort((a,b)=>a.render.creative_id.localeCompare(b.render.creative_id)||PROFILE_ORDER.indexOf(a.profile)-PROFILE_ORDER.indexOf(b.profile));
const reserveIds=new Set(reserve.map(x=>x.creativeId));for(const row of creatives)if(reserveIds.has(row.provenance.e15_creative_id))throw new Error(`reserve leaked into creative specs: ${row.provenance.e15_creative_id}`);
for(const row of render_specs)if(reserveIds.has(row.provenance.e15_creative_id))throw new Error(`reserve leaked into render specs: ${row.provenance.e15_creative_id}`);

const out={
 schema:'framewright-c19-delivery-package-v1',
 contract:{bundle_schema:'newboo-video-factory-bundle-v1',identity:'contracts/factory-identity-v1.mjs',audio_identity:'contracts/audio-identity-v1.mjs',json_schema:'contracts/video-factory-v1.schema.json',producer_contract:'i04-duration-audio'},
 request:{requested_profiles:requested,benchmark_duration_ms:DURATION_MS,profile_definitions:Object.fromEntries(requested.map(x=>[x,PROFILES[x]]))},
 source:{e15_campaign_schema:campaign.schema,e15_catalog_schema:catalog.schema,e15_campaign_sha256:shaFile(campaignPath),e15_catalog_sha256:shaFile(catalogPath),e14_manifest_sha256:shaFile(e14ManifestPath),e15_source_template_sha256:String(campaign.template?.sha256||selected[0]?.identity?.templateSha256||''),delivery_template_contract:'book-ad-systems-e18-v1',delivery_template_sha256:deliveryTemplateSha,selected_source_creatives:selected.length,reserve_source_creatives:reserve.length,suppressed_source_creatives:suppressed.length},
 benchmark_audio:{audio_spec_id:audioSpec.audio_spec_id,source_sha256:audioSpec.source_sha256,canonical_artifact_sha256:audioArtifact.sha256,canonical_artifact_bytes:audioArtifact.bytes,policy:audioSpec.codec.policy,scope:'I02 apples-to-apples 12s benchmark/control workload; campaign/runtime policy may choose another duration/audio identity'},
 reference_runtime:{purpose:'concrete E15-compatible video + R32 canonical-audio RenderSpec identity only; I02 substitutes candidate-specific renderer/encoder while preserving CreativeSpec, DeliveryProfile, duration and audio workload',runtime},
 counts:{books:new Set(creatives.map(x=>x.creative.book_id)).size,creative_specs:creatives.length,render_specs:render_specs.length,requested_profiles:requested.length,reserve_render_specs:0},
 delivery_qa_context:{status:'representative-pass',evidence_ref:'LAB-C18-RESPONSIVE-VARIANTS-RESULTS.md',delivery_template_sha256:deliveryTemplateSha,claim_scope:'responsive semantic layout mechanics for all structural variants, not per-C19-artifact QA'},
 creatives,render_specs
};
if(out.counts.render_specs!==out.counts.creative_specs*out.counts.requested_profiles)throw new Error('unbounded or missing delivery expansion');
fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,stablePretty(out));
console.log(JSON.stringify({schema:out.schema,books:out.counts.books,creativeSpecs:out.counts.creative_specs,requestedProfiles:requested,renderSpecs:out.counts.render_specs,sourceReserve:out.source.reserve_source_creatives,reserveRenderSpecs:out.counts.reserve_render_specs,durationMs:DURATION_MS,audioSpecId:audioSpec.audio_spec_id,canonicalAudioSha256:audioArtifact.sha256,deliveryTemplateSha256:deliveryTemplateSha,sha256:shaFile(outPath)},null,2));
