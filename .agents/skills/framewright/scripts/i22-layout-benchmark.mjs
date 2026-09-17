#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DIR=path.dirname(fileURLToPath(import.meta.url)),OBSERVER=path.join(DIR,'i22-observe-layout.mjs'),INFERER=path.join(DIR,'i22-infer-semantic-observation.mjs');
function parseArgs(){const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=1){if(!args[i].startsWith('--'))throw new Error(`unexpected ${args[i]}`);o[args[i].slice(2)]=args[++i];}for(const key of ['video-dir','input-dir','canonical-artifacts','work-dir'])if(!o[key])throw new Error(`--${key} required`);return o;}
function run(script,args){const r=spawnSync(process.execPath,[script,...args],{encoding:'utf8',maxBuffer:128*1024*1024});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${path.basename(script)} failed: ${(r.stderr||r.stdout).slice(-4000)}`);return r.stdout;}
const o=parseArgs(),videoDir=path.resolve(o['video-dir']),inputDir=path.resolve(o['input-dir']),canonicalPath=path.resolve(o['canonical-artifacts']),workDir=path.resolve(o['work-dir']);for(const file of [videoDir,inputDir,canonicalPath])if(!existsSync(file))throw new Error(`missing ${file}`);
rmSync(workDir,{recursive:true,force:true});mkdirSync(path.join(workDir,'observations'),{recursive:true});mkdirSync(path.join(workDir,'results'),{recursive:true});
const videos=readdirSync(videoDir).filter(x=>x.endsWith('.mp4')).sort();if(videos.length!==6)throw new Error(`expected six source videos, got ${videos.length}`);
// Phase A: observer/inferer see MP4 bytes only.
for(const name of videos){const id=name.slice(0,-4),video=path.join(videoDir,name),obs=path.join(workDir,'observations',`${id}.json`),result=path.join(workDir,'results',`${id}.json`);run(OBSERVER,['--video',video,'--out',obs]);run(INFERER,['--observation',obs,'--out',result]);}
// Phase B: hidden truth opens only after all results exist.
const canonical=JSON.parse(readFileSync(canonicalPath,'utf8')),rows=[];if(canonical.artifacts.length!==videos.length)throw new Error('artifact/video count mismatch');
for(const artifact of [...canonical.artifacts].sort((a,b)=>a.render_spec_id.localeCompare(b.render_spec_id))){
  const id=artifact.render_spec_id,selection=artifact.selection_id,obs=JSON.parse(readFileSync(path.join(workDir,'observations',`${id}.json`),'utf8')),sealed=JSON.parse(readFileSync(path.join(workDir,'results',`${id}.json`),'utf8')),payload=JSON.parse(readFileSync(path.join(inputDir,`${selection}.payload.json`),'utf8')),ground=payload.template_scene_program;
  const fit=sealed.inverse_result?.recovered?.structural_layout,accepted=fit?.accepted?.value||null,truth=ground?.resolved_layout?.family_id||null,serialized=JSON.stringify(sealed),leaks=[];if(ground?.scene_program_id&&serialized.includes(ground.scene_program_id))leaks.push('scene_program_id');if(ground?.template_variant_id&&serialized.includes(ground.template_variant_id))leaks.push('template_variant_id');
  rows.push({selection_id:selection,render_spec_id:id,source_hash_exact:obs.source_sha256===artifact.output?.sha256,ground_truth_layout:truth,inferred_layout:accepted,state:fit?.state||null,fit_residual:fit?.fit_residual??null,runner_up_margin:fit?.runner_up_margin??null,primary_anchor:obs.raw_measurements?.primary_text?.anchor||null,cta_box:obs.raw_measurements?.cta?.box||null,correct:accepted===truth,leakage_violations:leaks});
}
const accepted=rows.filter(r=>r.state==='accepted'),correct=rows.filter(r=>r.correct),summary={schema:'i22-physical-layout-benchmark-v1',version:1,videos:rows.length,hard_gates:{source_hash_exact:rows.filter(r=>r.source_hash_exact).length,accepted:accepted.length,correct:correct.length,leakage_violations:rows.reduce((n,r)=>n+r.leakage_violations.length,0)},rows};
if(summary.hard_gates.source_hash_exact!==rows.length)throw new Error('source hash gate failed');if(summary.hard_gates.accepted!==rows.length||summary.hard_gates.correct!==rows.length)throw new Error(`layout recovery gate failed accepted=${accepted.length}/${rows.length} correct=${correct.length}/${rows.length}`);if(summary.hard_gates.leakage_violations!==0)throw new Error('hidden identity leakage');
const output=JSON.stringify(summary,null,2)+'\n';if(o.out)writeFileSync(path.resolve(o.out),output);process.stdout.write(output);
