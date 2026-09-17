#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {categoricalTemplateDistance} from '../../../../contracts/batch-template-diversity-v1.mjs';
import {macroTemplateDistance} from '../../../../contracts/batch-template-diversity-v2.mjs';

const inputDir=path.resolve(process.argv[2]||'.bench/c48/input');
const run1Dir=path.resolve(process.argv[3]||'.bench/c48/run1');
const run2Dir=path.resolve(process.argv[4]||'.bench/c48/run2');
const reviewDir=path.resolve(process.argv[5]||'.bench/c48/review');
const htmlPath=path.resolve(process.argv[6]||'examples/book-ad-systems/index-c45-template-variant.html');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const shaBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const shaFile=file=>shaBytes(fs.readFileSync(file));
const manifest=read(path.join(inputDir,'variant-manifest.json'));
const batch=read(path.join(inputDir,'batch-receipt-v2.json'));
const v1Control=read(path.join(inputDir,'batch-receipt-v1-control.json'));
const campaign=read(path.join(inputDir,'campaign.json'));
const canonical1=read(path.join(run1Dir,'canonical-artifacts.json'));
const canonical2=read(path.join(run2Dir,'canonical-artifacts.json'));
const run1=read(path.join(run1Dir,'run.json'));
const run2=read(path.join(run2Dir,'run.json'));

assert.equal(manifest.schema,'c48-variant-manifest-v1');
assert.equal(batch.schema,'newboo-batch-template-diversity-receipt-v2');
assert.equal(v1Control.schema,'newboo-batch-template-diversity-receipt-v1');
assert.equal(manifest.count,40);assert.equal(batch.batch_size,40);assert.equal(campaign.selected.length,40);assert.equal(campaign.reserves.length,1);
assert.deepEqual(batch.macro_axes,['asset_staging','structural_layout','visual_system']);
assert.ok(batch.min_observed_lookback_distance>=3);assert.ok(batch.min_observed_macro_lookback_distance>=1);
assert.equal(canonical1.selected_creatives,40);assert.equal(canonical1.render_specs,40);assert.equal(canonical1.reserves,1);assert.equal(canonical1.artifacts.length,40);
assert.equal(canonical2.artifacts.length,40);assert.equal(run1.cache_hits,0);assert.equal(run2.cache_hits,40);
assert.equal(canonical1.delivery_package_sha256,canonical2.delivery_package_sha256);
assert.deepEqual(canonical1.artifacts,canonical2.artifacts,'canonical artifact manifest must replay exactly from cache');
assert.equal(new Set(manifest.variants.map(v=>v.template_variant_id)).size,40);
assert.equal(new Set(manifest.variants.map(v=>v.scene_program_id)).size,40);
assert.equal(new Set(manifest.variants.map(v=>v.payload_sha256)).size,40);
assert.equal(new Set(manifest.variants.map(v=>v.semantic_schedule_sha256)).size,1,'semantic schedule must be invariant');
assert.equal(new Set(canonical1.artifacts.map(a=>a.creative_id)).size,40);
assert.equal(new Set(canonical1.artifacts.map(a=>a.render_spec_id)).size,40);
assert.equal(new Set(canonical1.artifacts.map(a=>a.output.sha256)).size,40,'physical MP4s must not collapse to identical bytes');
assert.ok(canonical1.artifacts.every(a=>a.qa?.status==='pass'));
assert.ok(canonical1.artifacts.every(a=>a.output.frame_count===270));
assert.ok(canonical1.artifacts.every(a=>Math.abs(a.output.duration_ms-9000)<=40));
assert.equal(canonical1.artifacts.some(x=>x.selection_id==='c48-unrendered-control'),false);
const html=fs.readFileSync(htmlPath,'utf8');
assert.equal(/fillText\([^\n]*template_variant_id/.test(html),false,'template/debug identity must not be painted into visible pixels');

const batchByCandidate=new Map(batch.assignments.map(x=>[x.candidate_id,x]));
for(const row of manifest.variants){
  const assignment=batchByCandidate.get(row.candidate_id);assert.ok(assignment,`missing batch assignment ${row.candidate_id}`);
  assert.equal(assignment.template_variant_id,row.template_variant_id);assert.deepEqual(assignment.axes,row.axes);
  const payload=read(path.join(inputDir,`${row.selection_id}.payload.json`));
  assert.equal(payload.template_scene_program.scene_program_id,row.scene_program_id);
  assert.equal(payload.template_scene_program.template_variant_id,row.template_variant_id);
  assert.equal(payload.template_scene_program.semantic_schedule_sha256,row.semantic_schedule_sha256);
  assert.equal(payload.narrative_plan.narrative_plan_id,manifest.narrative_plan_id);
}

const firstPayload=read(path.join(inputDir,manifest.variants[0].selection_id+'.payload.json'));
const roles=firstPayload.narrative_plan.roles;
const roleByName=new Map(roles.map(role=>[role.role,role]));
function sampleFrame(roleName,progress=.72){
  const role=roleByName.get(roleName);assert.ok(role,`missing semantic role ${roleName}`);
  return role.start_frame+Math.round((role.end_frame-role.start_frame-1)*progress);
}
const samples=[
  {id:'hook_settled',role:'hook',progress:.72,frame:sampleFrame('hook')},
  {id:'book_reveal_settled',role:'book_reveal',progress:.72,frame:sampleFrame('book_reveal')},
  {id:'cta_settled',role:'cta',progress:.72,frame:sampleFrame('cta')},
];
assert.ok(samples[0].frame<samples[1].frame&&samples[1].frame<samples[2].frame);

fs.rmSync(reviewDir,{recursive:true,force:true});fs.mkdirSync(path.join(reviewDir,'samples'),{recursive:true});
const artifactBySelection=new Map(canonical1.artifacts.map(a=>[a.selection_id,a]));
const selectFilter='select='+samples.map(s=>`eq(n\\,${s.frame})`).join('+');
function averageHash(bytes){let sum=0;for(const b of bytes)sum+=b;const mean=sum/bytes.length;return Uint8Array.from(bytes,b=>b>=mean?1:0);}
function descriptor(left,right){
  let absolute=0;for(let i=0;i<left.length;i++)absolute+=Math.abs(left[i]-right[i]);
  const a=averageHash(left),b=averageHash(right);let hamming=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])hamming+=1;
  return{pixel_l1_32:Number((absolute/(left.length*255)).toFixed(8)),ahash_hamming_32:Number((hamming/a.length).toFixed(8)),identical_32:Buffer.compare(left,right)===0};
}
function extract(row){
  const artifact=artifactBySelection.get(row.selection_id);assert.ok(artifact,`artifact missing ${row.selection_id}`);
  const mp4=path.join(run1Dir,'video',`${artifact.render_spec_id}.mp4`);assert.ok(fs.existsSync(mp4),`video missing ${mp4}`);assert.equal(shaFile(mp4),artifact.output.sha256);
  const prefix=path.join(reviewDir,'samples',row.selection_id);
  const png=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',mp4,'-vf',selectFilter,'-vsync','0','-start_number','0',`${prefix}-%02d.png`],{encoding:'utf8'});assert.equal(png.status,0,png.stderr);
  const raw=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',mp4,'-vf',`${selectFilter},scale=32:32,format=gray`,'-vsync','0','-f','rawvideo','pipe:1'],{encoding:null,maxBuffer:4*1024*1024});assert.equal(raw.status,0,raw.stderr?.toString()||'');
  assert.equal(raw.stdout.length,samples.length*1024,`unexpected raw sample bytes for ${row.selection_id}`);
  return{
    artifact,
    raw:samples.map((sample,index)=>raw.stdout.subarray(index*1024,(index+1)*1024)),
    sample_sha256:samples.map((sample,index)=>shaFile(`${prefix}-${String(index).padStart(2,'0')}.png`)),
    sample_files:samples.map((sample,index)=>`samples/${row.selection_id}-${String(index).padStart(2,'0')}.png`),
  };
}
const extracted=new Map();for(const row of manifest.variants)extracted.set(row.selection_id,extract(row));
const threeCheckpointSignatures=new Set(manifest.variants.map(row=>extracted.get(row.selection_id).sample_sha256.join(':')));

const pairEvidence=[];
for(let i=0;i<manifest.variants.length;i+=1){
  const current=manifest.variants[i];
  for(let back=1;back<=3&&i-back>=0;back+=1){
    const previous=manifest.variants[i-back];
    const categorical=categoricalTemplateDistance(previous.axes,current.axes);
    const macro=macroTemplateDistance(previous.axes,current.axes,batch.macro_axes);
    assert.ok(categorical.distance>=3,`C47 categorical invariant failed at ${i-back}->${i}`);
    assert.ok(macro.distance>=1,`C47 macro invariant failed at ${i-back}->${i}`);
    const left=extracted.get(previous.selection_id),right=extracted.get(current.selection_id);
    const checkpoints=Object.fromEntries(samples.map((sample,index)=>[sample.id,{
      left_sha256:left.sample_sha256[index],right_sha256:right.sample_sha256[index],identical_full:left.sample_sha256[index]===right.sample_sha256[index],...descriptor(left.raw[index],right.raw[index]),
    }]));
    const physicalChanged=Object.values(checkpoints).some(item=>!item.identical_full);
    assert.equal(physicalChanged,true,`macro-separated lookback pair physically collapsed ${i-back}->${i}`);
    pairEvidence.push({left_index:i-back,right_index:i,left_selection_id:previous.selection_id,right_selection_id:current.selection_id,categorical_distance:categorical.distance,macro_distance:macro.distance,changed_macro_axes:Object.entries(macro.components).filter(([,changed])=>changed).map(([axis])=>axis),checkpoints,physical_changed:true});
  }
}
assert.equal(pairEvidence.length,114);

let v1MacroZeroLookbackPairs=0;const v1PairEvidence=[];
for(let i=0;i<v1Control.assignments.length;i+=1){
  for(let back=1;back<=3&&i-back>=0;back+=1){
    const left=v1Control.assignments[i-back],right=v1Control.assignments[i];
    const categorical=categoricalTemplateDistance(left.axes,right.axes),macro=macroTemplateDistance(left.axes,right.axes,batch.macro_axes);
    if(macro.distance===0)v1MacroZeroLookbackPairs+=1;
    v1PairEvidence.push({left_index:i-back,right_index:i,categorical_distance:categorical.distance,macro_distance:macro.distance});
  }
}

const rows=manifest.variants.map((row,index)=>{
  const ex=extracted.get(row.selection_id),previous=index?manifest.variants[index-1]:null;
  const macroFromPrevious=previous?macroTemplateDistance(previous.axes,row.axes,batch.macro_axes):null;
  return{...row,render_spec_id:ex.artifact.render_spec_id,artifact_sha256:ex.artifact.output.sha256,samples:Object.fromEntries(samples.map((sample,i)=>[sample.id,{frame:sample.frame,file:ex.sample_files[i],sha256:ex.sample_sha256[i]}])),changed_macro_axes_from_previous:macroFromPrevious?Object.entries(macroFromPrevious.components).filter(([,changed])=>changed).map(([axis])=>axis):[]};
});
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const cards=rows.map(row=>`<article><div class="shots">${samples.map(sample=>`<figure><img src="${esc(row.samples[sample.id].file)}"><figcaption>${esc(sample.id)}</figcaption></figure>`).join('')}</div><h2>${esc(row.selection_id)}</h2><p><strong>macro Δ prev:</strong> ${esc(row.changed_macro_axes_from_previous.join(', ')||'—')}</p><dl>${Object.entries(row.axes).map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(Array.isArray(value)?value.join(', '):value)}</dd>`).join('')}</dl><label><input type="checkbox"> near-duplicate</label><label><input type="checkbox"> weak macro expression</label><label><input type="checkbox"> unreadable</label><label><input type="checkbox"> weak composition</label></article>`).join('\n');
const reviewHtml=`<!doctype html><meta charset="utf-8"><title>C48 macro-aware physical review</title><style>body{font:14px system-ui;margin:24px;background:#eee;color:#111}header{max-width:1000px;margin:auto auto 24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px}article{background:#fff;padding:12px;border-radius:12px}.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}figure{margin:0}img{width:100%;height:auto;background:#ddd}figcaption{font:11px monospace;color:#555}dl{display:grid;grid-template-columns:120px 1fr;gap:3px 8px}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}label{display:block;margin-top:5px}.note{background:#fff6d9;padding:12px;border-radius:8px}</style><header><h1>C48 — macro-aware 40-video review</h1><p class="note">Same book, same canonical 9s C27 semantic schedule, same delivery and seed. The batch is ordered exactly as C47 v2 selected it. Every lookback pair is required to have total categorical distance ≥3 and at least one changed macro axis. Pixel diagnostics are descriptive only; this page does not assign a creativity/quality score.</p><p>Frames are role-aware: settled hook, settled book reveal and settled CTA.</p></header><main class="grid">${cards}</main>`;
fs.writeFileSync(path.join(reviewDir,'index.html'),reviewHtml);
fs.writeFileSync(path.join(reviewDir,'pair-evidence.json'),JSON.stringify({schema:'c48-macro-lookback-pair-evidence-v1',batch_id:batch.batch_id,lookback_window:3,macro_axes:batch.macro_axes,samples,pairs:pairEvidence,v1_control:{batch_id:v1Control.batch_id,macro_zero_lookback_pairs:v1MacroZeroLookbackPairs,pairs:v1PairEvidence}},null,2)+'\n');
const report={
  schema:'c48-macro-aware-physical-acceptance-v1',campaign_id:campaign.campaign_id,count:40,narrative_plan_id:manifest.narrative_plan_id,semantic_schedule_sha256:manifest.variants[0].semantic_schedule_sha256,
  batch:{batch_id:batch.batch_id,policy_id:batch.policy_id,macro_axes:batch.macro_axes,min_observed_lookback_distance:batch.min_observed_lookback_distance,min_observed_macro_lookback_distance:batch.min_observed_macro_lookback_distance,lookback_pair_count:pairEvidence.length,physical_noncollapsed_lookback_pairs:pairEvidence.filter(pair=>pair.physical_changed).length},
  v1_control:{batch_id:v1Control.batch_id,macro_zero_lookback_pairs:v1MacroZeroLookbackPairs,total_lookback_pairs:v1PairEvidence.length},
  unique:{template_variants:new Set(rows.map(r=>r.template_variant_id)).size,scene_programs:new Set(rows.map(r=>r.scene_program_id)).size,payloads:new Set(rows.map(r=>r.payload_sha256)).size,creative_ids:new Set(canonical1.artifacts.map(a=>a.creative_id)).size,render_specs:new Set(canonical1.artifacts.map(a=>a.render_spec_id)).size,artifact_sha256:new Set(canonical1.artifacts.map(a=>a.output.sha256)).size,three_checkpoint_signatures:threeCheckpointSignatures.size},
  sample_plan:samples,cache_replay:{first_run_hits:run1.cache_hits,second_run_hits:run2.cache_hits,canonical_manifest_equal:true},reserve_suppressed:true,visible_debug_variant_id:false,human_review_pack:'review/index.html',pair_evidence:'review/pair-evidence.json',rows,
};
fs.writeFileSync(path.join(reviewDir,'acceptance.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,rows:undefined},null,2));
