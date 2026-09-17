#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const inputDir=path.resolve(process.argv[2]||'.bench/c45/input');
const run1Dir=path.resolve(process.argv[3]||'.bench/c45/run1');
const run2Dir=path.resolve(process.argv[4]||'.bench/c45/run2');
const reviewDir=path.resolve(process.argv[5]||'.bench/c45/review');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest=read(path.join(inputDir,'variant-manifest.json'));
const batch=read(path.join(inputDir,'batch-receipt.json'));
const campaign=read(path.join(inputDir,'campaign.json'));
const canonical1=read(path.join(run1Dir,'canonical-artifacts.json'));
const canonical2=read(path.join(run2Dir,'canonical-artifacts.json'));
const run1=read(path.join(run1Dir,'run.json'));
const run2=read(path.join(run2Dir,'run.json'));
assert.equal(manifest.schema,'c45-variant-manifest-v1');
assert.equal(manifest.count,40);assert.equal(batch.batch_size,40);assert.equal(campaign.selected.length,40);assert.equal(campaign.reserves.length,1);
assert.equal(canonical1.selected_creatives,40);assert.equal(canonical1.render_specs,40);assert.equal(canonical1.reserves,1);assert.equal(canonical1.artifacts.length,40);
assert.equal(canonical2.artifacts.length,40);assert.equal(run1.cache_hits,0);assert.equal(run2.cache_hits,40);
assert.equal(canonical1.delivery_package_sha256,canonical2.delivery_package_sha256);
assert.deepEqual(canonical1.artifacts,canonical2.artifacts,'canonical artifact manifest must replay exactly from cache');
assert.equal(new Set(manifest.variants.map(v=>v.template_variant_id)).size,40);
assert.equal(new Set(manifest.variants.map(v=>v.scene_program_id)).size,40);
assert.equal(new Set(manifest.variants.map(v=>v.payload_sha256)).size,40);
assert.equal(new Set(manifest.variants.map(v=>v.semantic_schedule_sha256)).size,1,'semantic schedule must be invariant across template variants');
assert.equal(new Set(canonical1.artifacts.map(a=>a.creative_id)).size,40);
assert.equal(new Set(canonical1.artifacts.map(a=>a.render_spec_id)).size,40);
assert.equal(new Set(canonical1.artifacts.map(a=>a.output.sha256)).size,40,'physical MP4s must not collapse to identical bytes');
assert.ok(canonical1.artifacts.every(a=>a.qa?.status==='pass'));
assert.ok(canonical1.artifacts.every(a=>a.output.frame_count===150));
assert.ok(canonical1.artifacts.every(a=>Math.abs(a.output.duration_ms-5000)<=40));
assert.equal(campaign.selected.some(x=>x.selection_id==='c45-unrendered-control'),false);
assert.equal(canonical1.artifacts.some(x=>x.selection_id==='c45-unrendered-control'),false);
const batchByCandidate=new Map(batch.assignments.map(x=>[x.candidate_id,x]));
for(const row of manifest.variants){
  const b=batchByCandidate.get(row.candidate_id);assert.ok(b,`missing batch assignment ${row.candidate_id}`);assert.equal(b.template_variant_id,row.template_variant_id);assert.deepEqual(b.axes,row.axes);
  const payload=read(path.join(inputDir,`${row.selection_id}.payload.json`));assert.equal(payload.template_scene_program.scene_program_id,row.scene_program_id);assert.equal(payload.template_scene_program.template_variant_id,row.template_variant_id);assert.equal(payload.template_scene_program.semantic_schedule_sha256,row.semantic_schedule_sha256);assert.equal(payload.narrative_plan.narrative_plan_id,manifest.narrative_plan_id);
}
fs.rmSync(reviewDir,{recursive:true,force:true});fs.mkdirSync(path.join(reviewDir,'thumbs'),{recursive:true});fs.mkdirSync(path.join(reviewDir,'samples'),{recursive:true});
const artifactBySelection=new Map(canonical1.artifacts.map(a=>[a.selection_id,a]));
const sampleTimes=[0.55,2.5,4.35];
const rows=[];const checkpointHashes=sampleTimes.map(()=>new Set());const signatures=new Set();
for(const row of manifest.variants){
  const artifact=artifactBySelection.get(row.selection_id);assert.ok(artifact,`artifact missing ${row.selection_id}`);
  const mp4=path.join(run1Dir,'video',`${artifact.render_spec_id}.mp4`);assert.ok(fs.existsSync(mp4),`video missing ${mp4}`);assert.equal(sha(mp4),artifact.output.sha256);
  const hashes=[];
  for(let i=0;i<sampleTimes.length;i++){
    const out=path.join(reviewDir,'samples',`${row.selection_id}-${i}.png`);
    const p=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(sampleTimes[i]),'-i',mp4,'-frames:v','1',out],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);const h=sha(out);hashes.push(h);checkpointHashes[i].add(h);
  }
  const thumb=path.join(reviewDir,'thumbs',`${row.selection_id}.jpg`);
  const t=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss','2.5','-i',mp4,'-frames:v','1','-vf','scale=270:-2','-q:v','3',thumb],{encoding:'utf8'});assert.equal(t.status,0,t.stderr);
  const signature=hashes.join(':');signatures.add(signature);
  rows.push({...row,render_spec_id:artifact.render_spec_id,artifact_sha256:artifact.output.sha256,sample_sha256:hashes,thumbnail:`thumbs/${row.selection_id}.jpg`});
}
assert.equal(signatures.size,40,'three-checkpoint physical signatures must be unique across all 40 variants');
assert.ok(checkpointHashes[0].size>=18,`hook checkpoint diversity too low: ${checkpointHashes[0].size}`);
assert.ok(checkpointHashes[1].size>=18,`middle checkpoint diversity too low: ${checkpointHashes[1].size}`);
assert.ok(checkpointHashes[2].size>=18,`late checkpoint diversity too low: ${checkpointHashes[2].size}`);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cards=rows.map(r=>`<article><img src="${esc(r.thumbnail)}"><h2>${esc(r.selection_id)}</h2><p><code>${esc(r.template_variant_id.slice(-12))}</code></p><dl>${Object.entries(r.axes).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(Array.isArray(v)?v.join(', '):v)}</dd>`).join('')}</dl><label><input type="checkbox"> near-duplicate</label><label><input type="checkbox"> unreadable</label><label><input type="checkbox"> weak composition</label><label><input type="checkbox"> motion indistinct</label></article>`).join('\n');
const html=`<!doctype html><meta charset="utf-8"><title>C45 human review</title><style>body{font:14px system-ui;margin:24px;background:#eee}header{max-width:900px;margin:auto auto 24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:18px}article{background:white;padding:12px;border-radius:12px}img{width:100%;height:auto;background:#ddd}h2{margin:.5em 0}dl{display:grid;grid-template-columns:110px 1fr;gap:3px 8px}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}label{display:block;margin-top:6px}</style><header><h1>C45 — 40-video template diversity review</h1><p>Same book + same C27 semantic schedule. Review visual distinctness only. Machine checks are descriptive; this sheet does not assign a creativity score.</p><p>Flag near-duplicates, unreadable combinations, weak compositions, or motion that is visually indistinguishable despite a different family ID.</p></header><main class="grid">${cards}</main>`;
fs.writeFileSync(path.join(reviewDir,'index.html'),html);
const report={schema:'c45-template-diversity-physical-acceptance-v1',campaign_id:campaign.campaign_id,count:40,narrative_plan_id:manifest.narrative_plan_id,semantic_schedule_sha256:manifest.variants[0].semantic_schedule_sha256,unique:{template_variants:40,scene_programs:40,payloads:40,creative_ids:40,render_specs:40,artifact_sha256:40,three_checkpoint_signatures:signatures.size},checkpoint_unique_png_sha256:checkpointHashes.map(x=>x.size),batch_id:batch.batch_id,diversity_policy_id:batch.policy_id,min_transition_distance:batch.min_observed_transition_distance,axis_distribution:batch.axis_distribution,cache_replay:{first_run_hits:run1.cache_hits,second_run_hits:run2.cache_hits,canonical_manifest_equal:true},reserve_suppressed:true,human_review_pack:'review/index.html',rows};
fs.writeFileSync(path.join(reviewDir,'acceptance.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,rows:undefined},null,2));
