#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const inputDir=path.resolve(process.argv[2]||'.bench/c46/input');
const run1Dir=path.resolve(process.argv[3]||'.bench/c46/run1');
const run2Dir=path.resolve(process.argv[4]||'.bench/c46/run2');
const reviewDir=path.resolve(process.argv[5]||'.bench/c46/review');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const shaBuffer=buffer=>createHash('sha256').update(buffer).digest('hex');
const shaFile=file=>shaBuffer(fs.readFileSync(file));
const manifest=read(path.join(inputDir,'axis-manifest.json'));
const campaign=read(path.join(inputDir,'campaign.json'));
const canonical1=read(path.join(run1Dir,'canonical-artifacts.json'));
const canonical2=read(path.join(run2Dir,'canonical-artifacts.json'));
const run1=read(path.join(run1Dir,'run.json'));
const run2=read(path.join(run2Dir,'run.json'));
assert.equal(manifest.schema,'c46-axis-sensitivity-manifest-v1');
assert.equal(campaign.selected.length,manifest.count);
assert.equal(canonical1.selected_creatives,manifest.count);assert.equal(canonical1.render_specs,manifest.count);assert.equal(canonical1.artifacts.length,manifest.count);
assert.equal(canonical2.artifacts.length,manifest.count);assert.equal(run1.cache_hits,0);assert.equal(run2.cache_hits,manifest.count);
assert.equal(canonical1.delivery_package_sha256,canonical2.delivery_package_sha256);assert.deepEqual(canonical1.artifacts,canonical2.artifacts,'canonical artifact manifest must replay exactly');
assert.ok(canonical1.artifacts.every(a=>a.qa?.status==='pass'));
assert.ok(canonical1.artifacts.every(a=>a.output.frame_count===270));
assert.ok(canonical1.artifacts.every(a=>Math.abs(a.output.duration_ms-9000)<=40));
assert.equal(new Set(manifest.cases.map(x=>x.semantic_schedule_sha256)).size,1,'semantic schedule must remain invariant');
assert.equal(new Set(manifest.cases.map(x=>x.template_variant_id)).size,manifest.count,'OFAT variants must have distinct template identity');
assert.equal(new Set(manifest.cases.map(x=>x.scene_program_id)).size,manifest.count,'OFAT variants must have distinct scene identity');
for(const row of manifest.cases){
  const payload=read(path.join(inputDir,`${row.selection_id}.payload.json`));
  const scene=payload.template_scene_program;
  assert.equal(scene.scene_program_id,row.scene_program_id);
  assert.equal(scene.motion_recipe.family_id,row.selection.motion_grammar);
  assert.deepEqual(scene.motion_recipe,row.motion_recipe,'runtime motion must be the resolved C40 recipe carried by SceneProgram');
  assert.deepEqual(scene.graphic_devices,row.graphic_devices,'runtime graphic-device states must be the resolved C41 states carried by SceneProgram');
  assert.ok(scene.graphic_devices.every(d=>Array.isArray(d.segments)&&d.segments.length>0));
}
fs.rmSync(reviewDir,{recursive:true,force:true});fs.mkdirSync(path.join(reviewDir,'samples'),{recursive:true});
const artifactBySelection=new Map(canonical1.artifacts.map(a=>[a.selection_id,a]));
const roles=manifest.semantic_projection.roles;
const roleMap=new Map(roles.map(r=>[r.role,r]));
for(const role of ['hook','book_reveal','cta'])assert.ok(roleMap.has(role),`required role missing: ${role}`);
const checkpoints=[];
for(const roleName of ['hook','book_reveal','cta']){
  const role=roleMap.get(roleName),span=role.end_frame-role.start_frame;
  for(const [phase,fraction] of [['entry',.12],['settled',.72]]){
    const frame=Math.min(role.end_frame-1,role.start_frame+Math.max(1,Math.round((span-1)*fraction)));
    checkpoints.push({name:`${roleName}_${phase}`,role:roleName,phase,fraction,frame,time_seconds:Number((frame/30).toFixed(6))});
  }
}
function extractPng(mp4,checkpoint,out){
  const p=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(checkpoint.time_seconds),'-i',mp4,'-frames:v','1',out],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);
}
function grayVector(mp4,checkpoint,size=32){
  const p=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(checkpoint.time_seconds),'-i',mp4,'-frames:v','1','-vf',`scale=${size}:${size}:flags=area,format=gray`,'-f','rawvideo','-pix_fmt','gray','pipe:1'],{encoding:null,maxBuffer:8*1024*1024});
  assert.equal(p.status,0,String(p.stderr||''));assert.equal(p.stdout.length,size*size);return Uint8Array.from(p.stdout);
}
function meanAbs(a,b){assert.equal(a.length,b.length);let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length/255;}
function averageHash(v){let mean=0;for(const x of v)mean+=x;mean/=v.length;return Array.from(v,x=>x>=mean?1:0);}
function hamming(a,b){assert.equal(a.length,b.length);let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return n/a.length;}
const sampleByCase=new Map();
for(const row of manifest.cases){
  const artifact=artifactBySelection.get(row.selection_id);assert.ok(artifact,`artifact missing ${row.selection_id}`);
  const mp4=path.join(run1Dir,'video',`${artifact.render_spec_id}.mp4`);assert.ok(fs.existsSync(mp4));assert.equal(shaFile(mp4),artifact.output.sha256);
  const samples=[];
  for(const checkpoint of checkpoints){
    const out=path.join(reviewDir,'samples',`${row.selection_id}-${checkpoint.name}.png`);extractPng(mp4,checkpoint,out);
    const gray=grayVector(mp4,checkpoint);samples.push({checkpoint:checkpoint.name,png:path.relative(reviewDir,out).split(path.sep).join('/'),png_sha256:shaFile(out),gray,ahash:averageHash(gray)});
  }
  sampleByCase.set(row.selection_id,{artifact,samples});
}
const baselineRow=manifest.cases.find(x=>x.axis==='baseline');assert.ok(baselineRow,'baseline case required');
const baselineSamples=sampleByCase.get(baselineRow.selection_id).samples;
const rows=[];
for(const row of manifest.cases){
  const sample=sampleByCase.get(row.selection_id);
  const distances=sample.samples.map((s,i)=>({checkpoint:s.checkpoint,mean_abs:Number(meanAbs(s.gray,baselineSamples[i].gray).toFixed(8)),ahash_hamming:Number(hamming(s.ahash,baselineSamples[i].ahash).toFixed(8)),png_equal:s.png_sha256===baselineSamples[i].png_sha256,png:s.png,png_sha256:s.png_sha256}));
  rows.push({...row,render_spec_id:sample.artifact.render_spec_id,artifact_sha256:sample.artifact.output.sha256,distances});
}
const changedRows=rows.filter(x=>x.axis!=='baseline');
for(const row of changedRows)assert.ok(row.distances.some(d=>!d.png_equal),`${row.axis}:${row.option} collapsed to baseline at all role-aware checkpoints`);
for(const row of changedRows.filter(x=>x.axis==='motion_grammar'))assert.ok(row.distances.filter(d=>d.checkpoint.endsWith('_entry')).some(d=>!d.png_equal),`motion family ${row.option} did not affect any entry checkpoint`);
for(const row of changedRows.filter(x=>x.axis==='asset_staging'))assert.ok(row.distances.filter(d=>d.checkpoint.startsWith('book_reveal_')||d.checkpoint.startsWith('cta_')).some(d=>!d.png_equal),`staging family ${row.option} did not affect reveal/CTA`);
const axisNames=['structural_layout','visual_system','typography','motion_grammar','asset_staging','graphic_devices'];
const axisSummary={};
const lowSeparation=[];
for(const axis of axisNames){
  const axisRows=rows.filter(x=>x.axis===axis);
  const withBaseline=[rows.find(x=>x.axis==='baseline'),...axisRows];
  const signatures=new Map();
  for(const row of withBaseline){const signature=row.distances.map(d=>d.png_sha256).join(':');if(signatures.has(signature))throw new Error(`sampled physical collapse within ${axis}: ${signatures.get(signature)} == ${row.option}`);signatures.set(signature,row.option);}
  const checkpointSummary={};
  for(const checkpoint of checkpoints){
    const values=axisRows.map(r=>r.distances.find(d=>d.checkpoint===checkpoint.name).mean_abs).sort((a,b)=>a-b);
    checkpointSummary[checkpoint.name]={min:values.length?values[0]:0,median:values.length?values[Math.floor(values.length/2)]:0,max:values.length?values.at(-1):0};
  }
  const maxByOption=axisRows.map(r=>({option:r.option,max_mean_abs:Math.max(...r.distances.map(d=>d.mean_abs)),max_ahash_hamming:Math.max(...r.distances.map(d=>d.ahash_hamming))}));
  for(const item of maxByOption)if(item.max_mean_abs<.02)lowSeparation.push({axis,...item,reason:'max 32x32 grayscale mean-absolute separation from baseline < 0.02; descriptive review flag only'});
  axisSummary[axis]={option_count:manifest.options[axis].length,changed_case_count:axisRows.length,sampled_signatures:withBaseline.length,checkpoint_summary:checkpointSummary,options:maxByOption};
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const groups=axisNames.map(axis=>{
  const axisRows=[rows.find(x=>x.axis==='baseline'),...rows.filter(x=>x.axis===axis)];
  const cards=axisRows.map(r=>`<article><h3>${esc(r.axis==='baseline'?'baseline':r.option)}</h3><div class="samples">${r.distances.map(d=>`<figure><img src="${esc(d.png)}"><figcaption>${esc(d.checkpoint)}<br>MAD ${d.mean_abs.toFixed(4)} · aHash ${d.ahash_hamming.toFixed(3)}</figcaption></figure>`).join('')}</div></article>`).join('\n');
  return `<section><h2>${esc(axis)}</h2><p>Only this axis changes relative to the same baseline. Metrics are descriptive, not quality scores.</p>${cards}</section>`;
}).join('\n');
const html=`<!doctype html><meta charset="utf-8"><title>C46 axis sensitivity review</title><style>body{font:14px system-ui;margin:24px;background:#eee;color:#161616}header,section{max-width:1500px;margin:0 auto 28px}section{background:white;padding:18px;border-radius:14px}article{border-top:1px solid #ddd;padding:14px 0}.samples{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px}figure{margin:0}img{width:100%;height:auto;background:#ddd}figcaption{font-size:11px;line-height:1.35;margin-top:4px}code{overflow-wrap:anywhere}@media(max-width:900px){.samples{grid-template-columns:repeat(3,1fr)}}</style><header><h1>C46 — controlled axis sensitivity</h1><p>Same book, narrative, seed, delivery and all non-tested axes. Entry and settled frames are sampled for hook, book reveal and CTA. Visible variant IDs are forbidden from rendered pixels.</p><p>Perceptual measurements are diagnostic only; human review decides whether a family is useful.</p></header>${groups}`;
fs.writeFileSync(path.join(reviewDir,'index.html'),html);
const report={schema:'c46-axis-fidelity-perceptual-audit-v1',count:manifest.count,narrative_plan_id:manifest.narrative_plan_id,semantic_schedule_sha256:manifest.cases[0].semantic_schedule_sha256,baseline:manifest.baseline,checkpoints,axis_summary:axisSummary,low_separation_candidates:lowSeparation,cache_replay:{first_run_hits:run1.cache_hits,second_run_hits:run2.cache_hits,canonical_manifest_equal:true},fidelity:{resolved_motion_recipe_bound:true,resolved_graphic_device_segments_bound:true,visible_variant_id_in_pixels:false,all_changed_cases_affect_sampled_pixels:true},human_review_pack:'review/index.html',rows};
fs.writeFileSync(path.join(reviewDir,'acceptance.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,rows:undefined},null,2));
