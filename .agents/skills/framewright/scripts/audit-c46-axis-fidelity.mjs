#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {loadMotionGrammarFamilyRegistry} from '../../../../contracts/motion-grammar-families-v2.mjs';

const inputDir=path.resolve(process.argv[2]||'.bench/c46/input');
const run1Dir=path.resolve(process.argv[3]||'.bench/c46/run1');
const run2Dir=path.resolve(process.argv[4]||'.bench/c46/run2');
const reviewDir=path.resolve(process.argv[5]||'.bench/c46/review');
const html=path.resolve(process.argv[6]||'examples/book-ad-systems/index-c45-template-variant.html');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const shaBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=file=>shaBytes(fs.readFileSync(file));
const manifest=read(path.join(inputDir,'variant-manifest.json'));
const campaign=read(path.join(inputDir,'campaign.json'));
const canonical1=read(path.join(run1Dir,'canonical-artifacts.json'));
const canonical2=read(path.join(run2Dir,'canonical-artifacts.json'));
const run1=read(path.join(run1Dir,'run.json'));
const run2=read(path.join(run2Dir,'run.json'));
assert.equal(manifest.schema,'c46-axis-fidelity-manifest-v1');
assert.equal(manifest.count,31);assert.equal(campaign.selected.length,31);assert.equal(campaign.reserves.length,1);
assert.equal(canonical1.selected_creatives,31);assert.equal(canonical1.render_specs,31);assert.equal(canonical1.reserves,1);assert.equal(canonical1.artifacts.length,31);
assert.equal(canonical2.artifacts.length,31);assert.equal(run1.cache_hits,0);assert.equal(run2.cache_hits,31);
assert.equal(canonical1.delivery_package_sha256,canonical2.delivery_package_sha256);
assert.deepEqual(canonical1.artifacts,canonical2.artifacts,'canonical artifact manifest must replay exactly from cache');
assert.equal(new Set(manifest.variants.map(v=>v.template_variant_id)).size,31);
assert.equal(new Set(manifest.variants.map(v=>v.scene_program_id)).size,31);
assert.equal(new Set(manifest.variants.map(v=>v.semantic_schedule_sha256)).size,1,'semantic schedule must be invariant');
assert.ok(canonical1.artifacts.every(a=>a.qa?.status==='pass'));
assert.equal(canonical1.artifacts.some(x=>x.selection_id==='c46-unrendered-control'),false);
const htmlText=fs.readFileSync(html,'utf8');
assert.equal(/fillText\([^\n]*template_variant_id/.test(htmlText),false,'template_variant_id must not be painted into visible pixels');
assert.equal(htmlText.includes('const MOTION='),false,'runtime must not own a second hard-coded C40 motion table');
assert.ok(htmlText.includes('const motion=S.motion_recipe'),'runtime must consume compiled motion recipe');
assert.ok(htmlText.includes('d.segments.map(mapBox)'),'runtime must consume resolved C41 graphic-device segments');

const motionFamilies=new Map(loadMotionGrammarFamilyRegistry().families.map(x=>[x.id,x]));
const baselineRow=manifest.variants.find(x=>x.axis_under_test==='baseline');
assert.ok(baselineRow,'baseline case missing');
const baselinePayload=read(path.join(inputDir,`${baselineRow.selection_id}.payload.json`));
const roles=baselinePayload.narrative_plan.roles;
const roleByName=new Map(roles.map(r=>[r.role,r]));
function sampleFrame(roleName,progress){const role=roleByName.get(roleName);assert.ok(role,`missing role ${roleName}`);return role.start_frame+Math.round((role.end_frame-role.start_frame-1)*progress);}
const samples=[
  {id:'hook_settled',role:'hook',progress:.72},
  {id:'reveal_enter',role:'book_reveal',progress:.08},
  {id:'reveal_motion',role:'book_reveal',progress:.30},
  {id:'reveal_settled',role:'book_reveal',progress:.72},
  {id:'tension_settled',role:'tension',progress:.72},
  {id:'desire_settled',role:'desire_payoff',progress:.72},
  {id:'cta_motion',role:'cta',progress:.30},
  {id:'cta_settled',role:'cta',progress:.72},
].map(x=>({...x,frame:sampleFrame(x.role,x.progress)}));
for(let i=1;i<samples.length;i++)assert.ok(samples[i].frame>samples[i-1].frame,'role-aware sample frames must be chronological');
const relevant={
  structural_layout:['hook_settled','reveal_settled','tension_settled','desire_settled','cta_settled'],
  visual_system:['hook_settled','reveal_settled','tension_settled','cta_settled'],
  typography:['hook_settled','reveal_settled','tension_settled','desire_settled','cta_settled'],
  motion_grammar:['reveal_enter','reveal_motion','cta_motion'],
  asset_staging:['reveal_settled','cta_settled'],
  graphic_devices:['hook_settled','reveal_settled','tension_settled','cta_settled'],
};
function changedAxes(a,b){
  const axes=['structural_layout','visual_system','typography','motion_grammar','asset_staging','graphic_devices'];
  return axes.filter(axis=>JSON.stringify(a[axis])!==JSON.stringify(b[axis]));
}
for(const row of manifest.variants){
  const payload=read(path.join(inputDir,`${row.selection_id}.payload.json`));
  const scene=payload.template_scene_program;
  assert.equal(scene.scene_program_id,row.scene_program_id);assert.equal(scene.semantic_schedule_sha256,baselineRow.semantic_schedule_sha256);
  assert.ok(scene.graphic_devices.every(d=>Array.isArray(d.segments)&&d.segments.length>0&&typeof d.device_state_id==='string'));
  const family=motionFamilies.get(scene.motion_recipe.family_id);assert.ok(family,`unknown motion family ${scene.motion_recipe.family_id}`);
  for(const key of ['family_version','signature','enter_fraction','settle_fraction','text','asset','cta']){
    const expected=key==='family_version'?family.version:family[key];assert.deepEqual(scene.motion_recipe[key],expected,`compiled motion token drift ${scene.motion_recipe.family_id}/${key}`);
  }
  const changes=changedAxes(manifest.baseline,row.axes);
  if(row.axis_under_test==='baseline')assert.equal(changes.length,0);
  else{assert.deepEqual(changes,[row.axis_under_test],`${row.selection_id} must vary exactly one axis`);const actual=row.axis_under_test==='graphic_devices'?row.axes.graphic_devices[0]:row.axes[row.axis_under_test];assert.equal(actual,row.option_id);}
}

fs.rmSync(reviewDir,{recursive:true,force:true});fs.mkdirSync(path.join(reviewDir,'samples'),{recursive:true});
const artifactBySelection=new Map(canonical1.artifacts.map(a=>[a.selection_id,a]));
const frameFilter='select='+samples.map(s=>`eq(n\\,${s.frame})`).join('+');
function extract(row){
  const artifact=artifactBySelection.get(row.selection_id);assert.ok(artifact,`artifact missing ${row.selection_id}`);
  const mp4=path.join(run1Dir,'video',`${artifact.render_spec_id}.mp4`);assert.ok(fs.existsSync(mp4));assert.equal(sha(mp4),artifact.output.sha256);
  const prefix=path.join(reviewDir,'samples',row.selection_id);
  const png=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',mp4,'-vf',frameFilter,'-vsync','0','-start_number','0',`${prefix}-%02d.png`],{encoding:'utf8'});assert.equal(png.status,0,png.stderr);
  const raw=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',mp4,'-vf',`${frameFilter},scale=32:32,format=gray`,'-vsync','0','-f','rawvideo','pipe:1'],{encoding:null,maxBuffer:4*1024*1024});assert.equal(raw.status,0,raw.stderr?.toString()||'');
  assert.equal(raw.stdout.length,samples.length*1024,`unexpected raw sample byte count ${row.selection_id}`);
  return{artifact,raw:samples.map((s,i)=>raw.stdout.subarray(i*1024,(i+1)*1024)),png:samples.map((s,i)=>`samples/${row.selection_id}-${String(i).padStart(2,'0')}.png`)};
}
function aHash(bytes){let sum=0;for(const b of bytes)sum+=b;const mean=sum/bytes.length;return Uint8Array.from(bytes,b=>b>=mean?1:0);}
function descriptor(base,current){
  let abs=0;for(let i=0;i<base.length;i++)abs+=Math.abs(base[i]-current[i]);
  const ah=aHash(base),bh=aHash(current);let h=0;for(let i=0;i<ah.length;i++)if(ah[i]!==bh[i])h++;
  return{pixel_l1_32:Number((abs/(base.length*255)).toFixed(8)),ahash_hamming_32:Number((h/ah.length).toFixed(8)),identical:Buffer.compare(base,current)===0};
}
const extracted=new Map();for(const row of manifest.variants)extracted.set(row.selection_id,extract(row));
const baseExtracted=extracted.get(baselineRow.selection_id);
const rows=[];
for(const row of manifest.variants){
  const ex=extracted.get(row.selection_id);
  const checkpoints=Object.fromEntries(samples.map((sample,i)=>[sample.id,{frame:sample.frame,png:ex.png[i],raw_sha256:shaBytes(ex.raw[i]),...descriptor(baseExtracted.raw[i],ex.raw[i])}]));
  rows.push({...row,render_spec_id:ex.artifact.render_spec_id,artifact_sha256:ex.artifact.output.sha256,checkpoints});
}
const axisSummary={};
for(const axis of Object.keys(relevant)){
  const axisRows=rows.filter(r=>r.axis_under_test===axis);
  const options=[];const collapsed=[];
  for(const row of axisRows){
    const ds=relevant[axis].map(id=>row.checkpoints[id]);
    const item={option_id:row.option_id,selection_id:row.selection_id,relevant_checkpoints:relevant[axis],exactly_collapsed:ds.every(d=>d.identical),pixel_l1_32:ds.map(d=>d.pixel_l1_32),ahash_hamming_32:ds.map(d=>d.ahash_hamming_32)};
    if(item.exactly_collapsed)collapsed.push(row.option_id);options.push(item);
  }
  axisSummary[axis]={baseline_option:axis==='graphic_devices'?manifest.baseline.graphic_devices[0]:manifest.baseline[axis],changed_option_count:axisRows.length,relevant_checkpoints:relevant[axis],exact_collapsed_options:collapsed,options};
  assert.equal(collapsed.length,0,`${axis} contains physically collapsed options: ${collapsed.join(', ')}`);
}
const reviewPhases={
  structural_layout:['hook_settled','reveal_settled'],visual_system:['hook_settled','reveal_settled'],typography:['hook_settled','reveal_settled'],
  motion_grammar:['reveal_enter','reveal_motion'],asset_staging:['reveal_settled','cta_settled'],graphic_devices:['hook_settled','cta_settled'],
};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function card(row,phaseIds){const pics=phaseIds.map(id=>`<figure><img src="${esc(row.checkpoints[id].png)}"><figcaption>${esc(id)}</figcaption></figure>`).join('');const d=phaseIds.map(id=>row.checkpoints[id]).map(x=>`L1 ${x.pixel_l1_32.toFixed(4)} · aHash ${x.ahash_hamming_32.toFixed(4)}`).join('<br>');return `<article>${pics}<h3>${esc(row.axis_under_test==='baseline'?'BASELINE':row.option_id)}</h3><p>${d}</p><label><input type="checkbox"> near-duplicate</label><label><input type="checkbox"> weak expression</label><label><input type="checkbox"> fidelity issue</label></article>`;}
const sections=Object.entries(reviewPhases).map(([axis,phaseIds])=>{const variants=rows.filter(r=>r.axis_under_test===axis);return `<section><h2>${esc(axis)}</h2><p>Controlled comparison: every non-tested axis is identical to baseline.</p><div class="grid">${card(rows.find(r=>r.axis_under_test==='baseline'),phaseIds)}${variants.map(r=>card(r,phaseIds)).join('')}</div></section>`;}).join('\n');
const htmlReport=`<!doctype html><meta charset="utf-8"><title>C46 controlled axis audit</title><style>body{font:14px system-ui;margin:24px;background:#eee;color:#111}header,section{max-width:1500px;margin:0 auto 32px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}article{background:#fff;padding:12px;border-radius:12px}figure{margin:0 0 8px}img{width:100%;height:auto;background:#ddd}figcaption{font:12px monospace;color:#555}h3{overflow-wrap:anywhere}label{display:block;margin-top:5px}.note{padding:12px;background:#fff6d9;border-radius:8px}</style><header><h1>C46 — controlled axis fidelity / perceptual audit</h1><p class="note">Same book, same C27 semantic schedule, same delivery, same seed, same trusted cover. Exactly one axis changes per card. L1/aHash are descriptive pixel diagnostics, not creativity or quality scores.</p><p>Visible variant-ID watermark is disabled. Samples are semantic-role/local-progress based rather than fixed wall-clock timestamps.</p></header>${sections}`;
fs.writeFileSync(path.join(reviewDir,'index.html'),htmlReport);
const report={schema:'c46-axis-fidelity-perceptual-acceptance-v1',campaign_id:campaign.campaign_id,count:31,narrative_plan_id:manifest.narrative_plan_id,semantic_schedule_sha256:baselineRow.semantic_schedule_sha256,baseline:{selection_id:baselineRow.selection_id,axes:manifest.baseline},sample_plan:samples,identity:{unique_template_variants:new Set(rows.map(r=>r.template_variant_id)).size,unique_scene_programs:new Set(rows.map(r=>r.scene_program_id)).size,visible_debug_variant_id:false},fidelity:{compiled_motion_tokens:true,resolved_graphic_device_segments:true,html_motion_table_absent:true},axis_summary:axisSummary,cache_replay:{first_run_hits:run1.cache_hits,second_run_hits:run2.cache_hits,canonical_manifest_equal:true},reserve_suppressed:true,human_review_pack:'review/index.html',rows};
fs.writeFileSync(path.join(reviewDir,'acceptance.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(reviewDir,'axis-summary.json'),JSON.stringify(axisSummary,null,2)+'\n');
console.log(JSON.stringify({...report,rows:undefined,axis_summary:Object.fromEntries(Object.entries(axisSummary).map(([k,v])=>[k,{baseline_option:v.baseline_option,changed_option_count:v.changed_option_count,exact_collapsed_options:v.exact_collapsed_options}]))},null,2));
