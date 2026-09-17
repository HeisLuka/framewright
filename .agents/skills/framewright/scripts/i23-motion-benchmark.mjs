#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DIR=path.dirname(fileURLToPath(import.meta.url));
const OBSERVER=path.join(DIR,'i23-observe-motion.mjs');
const INFERER=path.join(DIR,'i22-infer-semantic-observation.mjs');
function parseArgs(){const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=1){if(!args[i].startsWith('--'))throw new Error(`unexpected ${args[i]}`);o[args[i].slice(2)]=args[++i];}for(const key of ['video-dir','input-dir','canonical-artifacts','work-dir'])if(!o[key])throw new Error(`--${key} required`);return o;}
function run(script,args){const r=spawnSync(process.execPath,[script,...args],{encoding:'utf8',maxBuffer:256*1024*1024});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${path.basename(script)} failed: ${(r.stderr||r.stdout).slice(-5000)}`);return r.stdout;}
function truthRank(fit,truth){const index=(fit?.candidates||[]).findIndex(c=>c.value===truth);return index<0?null:index+1;}

const o=parseArgs(),videoDir=path.resolve(o['video-dir']),inputDir=path.resolve(o['input-dir']),canonicalPath=path.resolve(o['canonical-artifacts']),workDir=path.resolve(o['work-dir']);
for(const file of [videoDir,inputDir,canonicalPath])if(!existsSync(file))throw new Error(`missing ${file}`);
rmSync(workDir,{recursive:true,force:true});mkdirSync(path.join(workDir,'observations'),{recursive:true});mkdirSync(path.join(workDir,'results'),{recursive:true});
const videos=readdirSync(videoDir).filter(x=>x.endsWith('.mp4')).sort();if(videos.length!==6)throw new Error(`expected six source videos, got ${videos.length}`);

// Phase A: observer and inferer receive only MP4 bytes / derived semantic observations.
for(const name of videos){const id=name.slice(0,-4),video=path.join(videoDir,name),obs=path.join(workDir,'observations',`${id}.json`),result=path.join(workDir,'results',`${id}.json`);run(OBSERVER,['--video',video,'--out',obs]);run(INFERER,['--observation',obs,'--out',result]);}

// Phase B: hidden forward truth is opened only after every sealed result exists on disk.
const canonical=JSON.parse(readFileSync(canonicalPath,'utf8')),rows=[];if(canonical.artifacts.length!==videos.length)throw new Error('artifact/video count mismatch');
for(const artifact of [...canonical.artifacts].sort((a,b)=>a.render_spec_id.localeCompare(b.render_spec_id))){
  const id=artifact.render_spec_id,selection=artifact.selection_id,obs=JSON.parse(readFileSync(path.join(workDir,'observations',`${id}.json`),'utf8')),sealed=JSON.parse(readFileSync(path.join(workDir,'results',`${id}.json`),'utf8')),payload=JSON.parse(readFileSync(path.join(inputDir,`${selection}.payload.json`),'utf8')),ground=payload.template_scene_program;
  const fit=sealed.inverse_result?.recovered?.motion_grammar,truth=ground?.motion_recipe?.family_id||null,accepted=fit?.accepted?.value||null,rank=truthRank(fit,truth),serialized=JSON.stringify(sealed),leaks=[];
  if(ground?.scene_program_id&&serialized.includes(ground.scene_program_id))leaks.push('scene_program_id');
  if(ground?.template_variant_id&&serialized.includes(ground.template_variant_id))leaks.push('template_variant_id');
  for(const key of ['motion_recipe','resolved_layout','cover_staging','typography_fits'])if(serialized.includes(`\"${key}\"`))leaks.push(`forward_${key}`);
  const track=obs.semantic_observation?.motion_tracks?.find(t=>t.target==='asset'),raw=obs.raw_measurements?.samples||[],detected=raw.filter(x=>x.detected).length;
  rows.push({selection_id:selection,render_spec_id:id,source_hash_exact:obs.source_sha256===artifact.output?.sha256,ground_truth_motion_grammar:truth,inferred_motion_grammar:accepted,state:fit?.state||null,reason:fit?.reason||null,fit_residual:fit?.fit_residual??null,runner_up_margin:fit?.runner_up_margin??null,motion_rank:rank,top1:rank===1,top3:rank!==null&&rank<=3,track_sample_count:track?.samples?.length||0,target_sample_count:raw.length,detected_sample_count:detected,motion_coverage:obs.semantic_observation?.coverage?.motion??0,observed_asset_track:track?.samples||[],candidates:(fit?.candidates||[]).map(c=>({value:c.value,residual:c.residual,confidence:c.confidence})),correct:accepted===truth,leakage_violations:[...new Set(leaks)]});
}
const top1=rows.filter(r=>r.top1).length,top3=rows.filter(r=>r.top3).length,accepted=rows.filter(r=>r.state==='accepted').length,correct=rows.filter(r=>r.correct).length,correctTop1=rows.filter(r=>r.correct&&r.top1).length,mrr=rows.reduce((sum,r)=>sum+(r.motion_rank?1/r.motion_rank:0),0)/rows.length;
const summary={schema:'i23-physical-motion-benchmark-v1',version:1,videos:rows.length,hard_gates:{source_hash_exact:rows.filter(r=>r.source_hash_exact).length,tracks_observed:rows.filter(r=>r.track_sample_count>=5).length,zero_forward_leakage:rows.reduce((n,r)=>n+r.leakage_violations.length,0)===0,motion_accepted:accepted,motion_correct:correct,motion_correct_top1:correctTop1},diagnostic:{accepted,correct,top1,top3,top1_rate:Number((top1/rows.length).toFixed(6)),top3_rate:Number((top3/rows.length).toFixed(6)),mean_reciprocal_rank:Number(mrr.toFixed(6)),mean_motion_coverage:Number((rows.reduce((s,r)=>s+r.motion_coverage,0)/rows.length).toFixed(6))},rows};
if(summary.hard_gates.source_hash_exact!==rows.length)throw new Error('source hash gate failed');
if(summary.hard_gates.tracks_observed!==rows.length)throw new Error(`asset-track observation gate failed ${summary.hard_gates.tracks_observed}/${rows.length}`);
if(!summary.hard_gates.zero_forward_leakage)throw new Error('forward identity/recipe leakage');
if(summary.hard_gates.motion_accepted!==rows.length)throw new Error(`C40 acceptance gate failed ${summary.hard_gates.motion_accepted}/${rows.length}`);
if(summary.hard_gates.motion_correct!==rows.length)throw new Error(`C40 correctness gate failed ${summary.hard_gates.motion_correct}/${rows.length}`);
if(summary.hard_gates.motion_correct_top1!==rows.length)throw new Error(`C40 top-1 gate failed ${summary.hard_gates.motion_correct_top1}/${rows.length}`);
const output=JSON.stringify(summary,null,2)+'\n';if(o.out)writeFileSync(path.resolve(o.out),output);process.stdout.write(output);
