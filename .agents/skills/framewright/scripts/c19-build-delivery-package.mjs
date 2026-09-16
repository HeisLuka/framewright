#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeCreativeId,computeRenderSpecId,assertFactoryIds} from '../../../../contracts/factory-identity-v1.mjs';
import {assertAudioSpecId,assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';

const e15Dir=path.resolve(process.argv[2]||'artifacts/e15/package');
const e14ManifestPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-e14/manifest.json');
const outPath=path.resolve(process.argv[4]||'artifacts/c19/delivery-package.json');
const requestedRaw=process.argv[5]||process.env.DELIVERY_PROFILES||'vertical,square,landscape';
const deliveryTemplatePath=path.resolve(process.argv[6]||process.env.DELIVERY_TEMPLATE||'examples/book-ad-systems/index-e18-for-c19.html');
const audioFixturePath=process.argv[7]?path.resolve(process.argv[7]):(process.env.AUDIO_FIXTURE?path.resolve(process.env.AUDIO_FIXTURE):null);
const campaignPath=path.join(e15Dir,'campaign-manifest.json');
const catalogPath=path.join(e15Dir,'candidate-catalog.json');
for(const f of[campaignPath,catalogPath,e14ManifestPath,deliveryTemplatePath])if(!fs.existsSync(f))throw new Error(`missing input ${f}`);
if(audioFixturePath&&!fs.existsSync(audioFixturePath))throw new Error(`missing audio fixture ${audioFixturePath}`);

const DURATION_MS=12000;
const PROFILE_ORDER=['vertical','square','landscape'];
const PROFILES={
 vertical:{id:'vertical-1080x1920-v1',width:1080,height:1920,fps:30,duration_ms:DURATION_MS},
 square:{id:'square-1080x1080-v1',width:1080,height:1080,fps:30,duration_ms:DURATION_MS},
 landscape:{id:'landscape-1920x1080-v1',width:1920,height:1080,fps:30,duration_ms:DURATION_MS}
};
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=stable(v[k]);return o;}return v;}
function stablePretty(v){return JSON.stringify(stable(v),null,2)+'\n';}
function shaFile(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
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

let canonicalAudio=null;
if(audioFixturePath){
 const fixture=JSON.parse(fs.readFileSync(audioFixturePath,'utf8'));
 if(fixture.schema!=='framewright-c19-audio-fixture-v1'||!fixture.spec||!fixture.artifact)throw new Error(`invalid C19 audio fixture ${audioFixturePath}`);
 assertAudioSpecId(fixture.spec);assertCanonicalAudioArtifact(fixture.spec,fixture.artifact);
 if(fixture.spec.timing?.duration_ms!==DURATION_MS||fixture.spec.timing?.final_mux_duration_ms!==DURATION_MS)throw new Error('audio fixture duration does not match C19 benchmark duration');
 canonicalAudio={spec:fixture.spec,artifact:fixture.artifact,scope:String(fixture.scope||'benchmark fixture')};
}

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
const runtimeBase={
 class:'FAST',scene_contract_version:'canvas-scene-v1',
 environment_id:`e15-${String(campaign.renderer?.renderEnvironmentHash||'').slice(0,24)}`,
 renderer:{id:'napi-canvas-ffmpeg-x264',version:'e15-v1'},
 encoder:{video_codec:'libx264',crf:Number(campaign.renderer?.profile?.crf??22),preset:String(campaign.renderer?.profile?.preset||'veryfast'),pixel_format:String(campaign.renderer?.profile?.pixelFormat||'yuv420p')}
};
if(!runtimeBase.environment_id.match(/^e15-[a-f0-9]{24}$/))throw new Error('invalid E15 render environment hash');

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
   const runtime=structuredClone(runtimeBase);if(canonicalAudio)runtime.muxer={id:'ffmpeg-mp4-aac',version:'r32-canonical-aac-v1'};
   const render={schema:'newboo-render-spec-v1',render_spec_id:'',creative_id:row.creative.creative_id,duration_ms:DURATION_MS,delivery:{...PROFILES[profileKey]},runtime,assets:[],artifact_policy:{reuse:'prefer-existing',canonical_key:'render_spec_id'}};
   if(canonicalAudio)render.audio={spec:structuredClone(canonicalAudio.spec),artifact:structuredClone(canonicalAudio.artifact)};
   render.render_spec_id=computeRenderSpecId(render);assertFactoryIds({creative:row.creative,render});
   const i04Details={duration_ms:DURATION_MS,audio_mode:canonicalAudio?'benchmark-fixture':'none'};
   if(canonicalAudio){i04Details.audio_spec_id=canonicalAudio.spec.audio_spec_id;i04Details.canonical_audio_sha256=canonicalAudio.artifact.sha256;}
   render_specs.push({
     render,profile:profileKey,provenance:{e15_creative_id:row.provenance.e15_creative_id,source_payload_file:row.provenance.source_payload_file},
     qa_evidence:[
       {id:'e15-selected-source-artifact',status:'pass',details:{output_sha256:row.provenance.source_output.sha256,bytes:row.provenance.source_output.bytes}},
       {id:'c18-responsive-layout-contract',status:'representative-pass',details:{evidence_ref:'LAB-C18-RESPONSIVE-VARIANTS-RESULTS.md',delivery_template_sha256:deliveryTemplateSha,profile:profileKey,note:'C18 validated this responsive semantic template construction across all four structural variants and delivery profiles on representative systems; this is inherited layout evidence, not QA of an unrendered C19 artifact.'}},
       {id:'i04-duration-audio-contract',status:'pass',details:i04Details}
     ]
   });
 }
}
render_specs.sort((a,b)=>a.render.creative_id.localeCompare(b.render.creative_id)||PROFILE_ORDER.indexOf(a.profile)-PROFILE_ORDER.indexOf(b.profile));
const reserveIds=new Set(reserve.map(x=>x.creativeId));for(const row of creatives)if(reserveIds.has(row.provenance.e15_creative_id))throw new Error(`reserve leaked into creative specs: ${row.provenance.e15_creative_id}`);
for(const row of render_specs)if(reserveIds.has(row.provenance.e15_creative_id))throw new Error(`reserve leaked into render specs: ${row.provenance.e15_creative_id}`);

const audio_workload=canonicalAudio?{mode:'benchmark-fixture',audio_spec_id:canonicalAudio.spec.audio_spec_id,source_sha256:canonicalAudio.spec.source_sha256,canonical_artifact_sha256:canonicalAudio.artifact.sha256,canonical_artifact_bytes:canonicalAudio.artifact.bytes,policy:canonicalAudio.spec.codec.policy,scope:canonicalAudio.scope}:{mode:'none',scope:'No campaign soundtrack is selected by E15/C19; audio is optional in I04 and benchmark adoption is exercised in a separate C19 fixture package.'};
const out={
 schema:'framewright-c19-delivery-package-v1',
 contract:{bundle_schema:'newboo-video-factory-bundle-v1',identity:'contracts/factory-identity-v1.mjs',audio_identity:'contracts/audio-identity-v1.mjs',json_schema:'contracts/video-factory-v1.schema.json',producer_contract:'i04-duration-audio-v1'},
 request:{requested_profiles:requested,benchmark_duration_ms:DURATION_MS,profile_definitions:Object.fromEntries(requested.map(x=>[x,PROFILES[x]]))},
 source:{e15_campaign_schema:campaign.schema,e15_catalog_schema:catalog.schema,e15_campaign_sha256:shaFile(campaignPath),e15_catalog_sha256:shaFile(catalogPath),e14_manifest_sha256:shaFile(e14ManifestPath),e15_source_template_sha256:String(campaign.template?.sha256||selected[0]?.identity?.templateSha256||''),delivery_template_contract:'book-ad-systems-e18-v1',delivery_template_sha256:deliveryTemplateSha,selected_source_creatives:selected.length,reserve_source_creatives:reserve.length,suppressed_source_creatives:suppressed.length},
 audio_workload,
 reference_runtime:{purpose:canonicalAudio?'I02 benchmark/control runtime identity with canonical R32-style AAC fixture; not campaign soundtrack policy':'E15-compatible reference video runtime; campaign audio intentionally unspecified',runtime:{...runtimeBase,...(canonicalAudio?{muxer:{id:'ffmpeg-mp4-aac',version:'r32-canonical-aac-v1'}}:{})}},
 counts:{books:new Set(creatives.map(x=>x.creative.book_id)).size,creative_specs:creatives.length,render_specs:render_specs.length,requested_profiles:requested.length,reserve_render_specs:0},
 delivery_qa_context:{status:'representative-pass',evidence_ref:'LAB-C18-RESPONSIVE-VARIANTS-RESULTS.md',delivery_template_sha256:deliveryTemplateSha,claim_scope:'responsive semantic layout mechanics for all structural variants, not per-C19-artifact QA'},
 creatives,render_specs
};
if(out.counts.render_specs!==out.counts.creative_specs*out.counts.requested_profiles)throw new Error('unbounded or missing delivery expansion');
fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,stablePretty(out));
console.log(JSON.stringify({schema:out.schema,books:out.counts.books,creativeSpecs:out.counts.creative_specs,requestedProfiles:requested,renderSpecs:out.counts.render_specs,sourceReserve:out.source.reserve_source_creatives,reserveRenderSpecs:out.counts.reserve_render_specs,durationMs:DURATION_MS,audioMode:audio_workload.mode,audioSpecId:audio_workload.audio_spec_id||null,canonicalAudioSha256:audio_workload.canonical_artifact_sha256||null,deliveryTemplateSha256:deliveryTemplateSha,sha256:shaFile(outPath)},null,2));
