#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compileDeliveryPackage,serializeDeliveryPackage} from '../../../../contracts/c19-delivery-package-v1.mjs';
import {canonicalJson} from '../../../../contracts/factory-identity-v1.mjs';

const SCRIPT_DIR=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(SCRIPT_DIR,'../../../..');
const EXECUTOR=path.join(ROOT,'.agents/skills/framewright/scripts/render-factory-fast.mjs');
function parseArgs(argv){const o={};for(let i=0;i<argv.length;i++){const t=argv[i];if(!t.startsWith('--'))throw new Error(`unexpected positional argument ${t}`);const k=t.slice(2),n=argv[i+1];if(n!=null&&!n.startsWith('--')){o[k]=n;i++;}else o[k]=true;}return o;}
function shaBytes(bytes){return createHash('sha256').update(bytes).digest('hex');}
function run(command,args,env={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:ROOT,env:{...process.env,...env},stdio:'inherit'});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`${command} exited with ${code??signal}`)));});}
async function writeJson(file,value){await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.writeFile(file,JSON.stringify(value,null,2)+'\n');}
const opts=parseArgs(process.argv.slice(2));
const campaignPath=path.resolve(String(opts.campaign||''));
const executionMapPath=path.resolve(String(opts['execution-map']||''));
const outDir=path.resolve(String(opts['out-dir']||'artifacts/i03/run'));
if(!fs.existsSync(campaignPath))throw new Error('--campaign is required');
if(!fs.existsSync(executionMapPath))throw new Error('--execution-map is required');
const request=JSON.parse(await fsp.readFile(campaignPath,'utf8'));
const executionMap=JSON.parse(await fsp.readFile(executionMapPath,'utf8'));
if(executionMap.schema!=='framewright-i03-execution-map-v1')throw new Error(`unexpected execution map schema ${executionMap.schema}`);
const deliveryPackage=compileDeliveryPackage(request);
const serializedPackage=serializeDeliveryPackage(request);
const packageSha256=shaBytes(serializedPackage);
await fsp.mkdir(outDir,{recursive:true});
await fsp.writeFile(path.join(outDir,'delivery-package.json'),serializedPackage,'utf8');
const artifactDir=path.join(outDir,'artifacts');
await fsp.mkdir(artifactDir,{recursive:true});

const results=[];
for(const row of deliveryPackage.renders){
  const selected=deliveryPackage.selected.find(x=>x.selection_id===row.selection_id);
  if(!selected)throw new Error(`${row.selection_id}: compiled creative missing`);
  const exec=executionMap.selections?.[row.selection_id];
  if(!exec)throw new Error(`${row.selection_id}: execution mapping missing`);
  const actualPayloadSha=shaBytes(await fsp.readFile(path.resolve(exec.payload)));
  if(actualPayloadSha!==selected.creative.payload_sha256)throw new Error(`${row.selection_id}: CreativeSpec payload_sha256 mismatch: expected ${selected.creative.payload_sha256}, got ${actualPayloadSha}`);
  const bundle={schema:'newboo-video-factory-bundle-v1',creative:selected.creative,render:row.render};
  const stem=row.render.render_spec_id;
  const bundleFile=path.join(outDir,`${stem}.bundle.json`);
  const firstOut=path.join(outDir,`${stem}.first.mp4`),secondOut=path.join(outDir,`${stem}.second.mp4`);
  const firstReceipt=path.join(outDir,`${stem}.first.json`),secondReceipt=path.join(outDir,`${stem}.second.json`);
  await writeJson(bundleFile,bundle);
  const common=['--bundle',bundleFile,'--artifact-dir',artifactDir];
  if(row.render.audio&&!exec.audio)throw new Error(`${row.selection_id}: RenderSpec declares audio but execution audio path missing`);
  const audioArgs=row.render.audio?['--audio',path.resolve(exec.audio)]:[];
  const env={CI:process.env.CI||'1',HTML:path.resolve(exec.html),PAYLOAD:path.resolve(exec.payload)};
  await run(process.execPath,[EXECUTOR,...common,...audioArgs,'--out',firstOut,'--receipt-out',firstReceipt],env);
  await run(process.execPath,[EXECUTOR,...common,...audioArgs,'--out',secondOut,'--receipt-out',secondReceipt],env);
  const a=JSON.parse(await fsp.readFile(firstReceipt,'utf8')),b=JSON.parse(await fsp.readFile(secondReceipt,'utf8'));
  if(a.render_spec_id!==row.render.render_spec_id||b.render_spec_id!==row.render.render_spec_id)throw new Error(`${stem}: receipt identity drift`);
  if(a.qa?.status!=='pass'||b.qa?.status!=='pass')throw new Error(`${stem}: QA did not pass`);
  if(a.invocation?.cache_hit!==false)throw new Error(`${stem}: first invocation unexpectedly hit cache`);
  if(b.invocation?.cache_hit!==true)throw new Error(`${stem}: second invocation did not hit cache`);
  if(a.output?.sha256!==b.output?.sha256)throw new Error(`${stem}: cache replay SHA mismatch`);
  if(a.output?.frame_count!==row.render.frame_count)throw new Error(`${stem}: frame count mismatch`);
  if(Math.abs(Number(a.output?.duration_ms)-row.render.duration_ms)>40)throw new Error(`${stem}: duration mismatch ${a.output?.duration_ms} vs ${row.render.duration_ms}`);
  const audioCheck=a.qa.checks?.find(x=>x.id==='audio-stream');
  if(Boolean(audioCheck?.details?.present)!==Boolean(row.render.audio))throw new Error(`${stem}: audio presence mismatch`);
  if(row.render.audio&&audioCheck?.details?.audio_spec_id!==row.render.audio.spec.audio_spec_id)throw new Error(`${stem}: audio identity missing from receipt`);
  const profileCheck=a.qa.checks?.find(x=>x.id==='delivery-platform-profile');
  if(row.render.delivery.platform_ui_profile){
    if(profileCheck?.status!=='pass')throw new Error(`${stem}: platform binding QA missing`);
    if(profileCheck.details?.expected!==row.render.delivery.platform_ui_profile||profileCheck.details?.bound!==row.render.delivery.platform_ui_profile)throw new Error(`${stem}: platform profile was not materialized from RenderSpec`);
  }
  results.push({selection_id:row.selection_id,delivery_profile_id:row.delivery_profile_id,render_spec_id:stem,creative_id:row.render.creative_id,platform_ui_profile:row.render.delivery.platform_ui_profile||null,narrative_plan_id:exec.narrative_plan_id||null,scene_payload_sha256:a.metrics?.scene_payload_sha256||null,audio_spec_id:row.render.audio?.spec?.audio_spec_id||null,artifact:{sha256:a.output.sha256,bytes:a.output.bytes,mime_type:a.output.mime_type,duration_ms:a.output.duration_ms,frame_count:a.output.frame_count,storage_uri:`artifacts/${stem}.mp4`},first_cache_hit:a.invocation.cache_hit,replay_cache_hit:b.invocation.cache_hit,qa:a.qa});
}
const renderIds=new Set(results.map(x=>x.render_spec_id));
if(renderIds.size!==results.length)throw new Error('duplicate render_spec_id in compiled campaign');
const expectedProfiles=new Set(results.map(x=>x.platform_ui_profile).filter(Boolean));
if(expectedProfiles.size>1){
  const payloadDigests=new Set(results.map(x=>x.scene_payload_sha256));
  if(payloadDigests.size!==results.length)throw new Error('distinct platform profiles did not produce distinct bound scene payloads');
  const outputDigests=new Set(results.map(x=>x.artifact.sha256));
  if(outputDigests.size!==results.length)throw new Error('distinct platform-safe RenderSpecs produced byte-identical MP4 artifacts');
}
const artifactLookup=Object.fromEntries(results.map(x=>[x.render_spec_id,{sha256:x.artifact.sha256,storage_uri:x.artifact.storage_uri,bytes:x.artifact.bytes}]));
const manifest={
  schema:'newboo-i03-campaign-run-v1',campaign_id:request.campaign_id,
  input:{campaign_sha256:shaBytes(canonicalJson(request)),delivery_package_sha256:packageSha256},
  compiler:{schema:deliveryPackage.schema,policy_version:deliveryPackage.compiler_policy_version},
  counts:{selected_creatives:deliveryPackage.counts.selected_creatives,render_specs:deliveryPackage.counts.render_specs,reserves:deliveryPackage.counts.reserves,artifacts:results.length},
  renders:results,reserves:deliveryPackage.reserves,artifact_lookup:artifactLookup,
  qa:{status:'pass',checks:[
    {id:'selected-only-rendering',status:'pass',details:{selected:deliveryPackage.counts.selected_creatives,reserves:deliveryPackage.counts.reserves,rendered:results.length}},
    {id:'factory-identity',status:'pass',details:{distinct_render_spec_ids:renderIds.size}},
    {id:'render-receipts',status:'pass',details:{all_qa_pass:results.every(x=>x.qa.status==='pass')}},
    {id:'cache-replay',status:'pass',details:{all_second_invocations_hit_cache:results.every(x=>x.replay_cache_hit===true)}},
    {id:'delivery-binding',status:'pass',details:{platform_profiles:[...expectedProfiles],distinct_scene_payloads:new Set(results.map(x=>x.scene_payload_sha256)).size}},
    {id:'canonical-audio',status:'pass',details:{audio_spec_ids:[...new Set(results.map(x=>x.audio_spec_id).filter(Boolean))],all_present:results.every(x=>x.qa.checks.find(c=>c.id==='audio-stream')?.details?.present===Boolean(x.audio_spec_id))}},
  ]},
  provenance:{c19:'c19-delivery-package-v1',executor:'render-factory-fast-v1',git_sha:process.env.GITHUB_SHA||null},
};
await writeJson(path.join(outDir,'campaign-manifest.json'),manifest);
console.log(JSON.stringify({campaignId:manifest.campaign_id,counts:manifest.counts,renderSpecIds:results.map(x=>x.render_spec_id),platformProfiles:results.map(x=>x.platform_ui_profile),scenePayloadSha256:results.map(x=>x.scene_payload_sha256),artifactSha256:results.map(x=>x.artifact.sha256),audioSpecIds:results.map(x=>x.audio_spec_id),cacheReplay:results.map(x=>x.replay_cache_hit),qa:manifest.qa.status},null,2));
