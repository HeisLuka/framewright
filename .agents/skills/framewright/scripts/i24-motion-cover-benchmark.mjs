#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DIR=path.dirname(fileURLToPath(import.meta.url));
const OBSERVER=path.join(DIR,'i23-observe-motion.mjs');
const INFERER=path.join(DIR,'i22-infer-semantic-observation.mjs');
function parseArgs(){const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=1){if(!args[i].startsWith('--'))throw new Error(`unexpected ${args[i]}`);o[args[i].slice(2)]=args[++i];}for(const key of ['video-dir','input-dir','canonical-artifacts','work-dir'])if(!o[key])throw new Error(`--${key} required`);return o;}
function runMaybe(script,args){const r=spawnSync(process.execPath,[script,...args],{encoding:'utf8',maxBuffer:256*1024*1024});if(r.error)return{ok:false,error:r.error.message};if(r.status!==0)return{ok:false,error:`${path.basename(script)} failed (${r.status}): ${(r.stderr||r.stdout).slice(-5000)}`};return{ok:true,stdout:r.stdout};}
function truthRank(fit,truth){const index=(fit?.candidates||[]).findIndex(c=>c.value===truth);return index<0?null:index+1;}
function group(rows,key){const values={};for(const row of rows){const value=row[key]||'unknown';if(!values[value])values[value]={videos:0,phase_a_ok:0,accepted:0,correct:0,top1:0,top3:0,tracks_observed:0};const g=values[value];g.videos++;if(row.phase_a_ok)g.phase_a_ok++;if(row.state==='accepted')g.accepted++;if(row.correct)g.correct++;if(row.top1)g.top1++;if(row.top3)g.top3++;if(row.track_sample_count>=5)g.tracks_observed++;}return values;}

const o=parseArgs(),videoDir=path.resolve(o['video-dir']),inputDir=path.resolve(o['input-dir']),canonicalPath=path.resolve(o['canonical-artifacts']),workDir=path.resolve(o['work-dir']);
for(const file of [videoDir,inputDir,canonicalPath])if(!existsSync(file))throw new Error(`missing ${file}`);
rmSync(workDir,{recursive:true,force:true});mkdirSync(path.join(workDir,'observations'),{recursive:true});mkdirSync(path.join(workDir,'results'),{recursive:true});mkdirSync(path.join(workDir,'errors'),{recursive:true});
const videos=readdirSync(videoDir).filter(x=>x.endsWith('.mp4')).sort();if(videos.length!==36)throw new Error(`expected 36 holdout videos, got ${videos.length}`);
const phaseA=new Map();

// Phase A: every clip is attempted before any hidden forward payload is opened.
for(const name of videos){
  const id=name.slice(0,-4),video=path.join(videoDir,name),obsPath=path.join(workDir,'observations',`${id}.json`),resultPath=path.join(workDir,'results',`${id}.json`);
  const observed=runMaybe(OBSERVER,['--video',video,'--out',obsPath]);
  if(!observed.ok){const record={stage:'observer',error:observed.error};writeFileSync(path.join(workDir,'errors',`${id}.json`),JSON.stringify(record,null,2)+'\n');phaseA.set(id,{ok:false,...record});continue;}
  const inferred=runMaybe(INFERER,['--observation',obsPath,'--out',resultPath]);
  if(!inferred.ok){const record={stage:'inferer',error:inferred.error};writeFileSync(path.join(workDir,'errors',`${id}.json`),JSON.stringify(record,null,2)+'\n');phaseA.set(id,{ok:false,...record});continue;}
  phaseA.set(id,{ok:true});
}

// Phase B: hidden forward truth opens only after all 36 sealed attempts are persisted.
const canonical=JSON.parse(readFileSync(canonicalPath,'utf8')),rows=[];if(canonical.artifacts.length!==videos.length)throw new Error(`artifact/video mismatch ${canonical.artifacts.length}/${videos.length}`);
for(const artifact of [...canonical.artifacts].sort((a,b)=>a.render_spec_id.localeCompare(b.render_spec_id))){
  const id=artifact.render_spec_id,selection=artifact.selection_id,payloadPath=path.join(inputDir,`${selection}.payload.json`),payload=JSON.parse(readFileSync(payloadPath,'utf8')),ground=payload.template_scene_program,truth=ground?.motion_recipe?.family_id||null,bookId=String(payload.book_id||''),phase=phaseA.get(id)||{ok:false,stage:'missing_phase_a',error:'missing phase A record'};
  if(!phase.ok){rows.push({selection_id:selection,render_spec_id:id,book_id:bookId,ground_truth_motion_grammar:truth,phase_a_ok:false,phase_a_stage:phase.stage,phase_a_error:phase.error,source_hash_exact:false,state:null,reason:null,inferred_motion_grammar:null,fit_residual:null,runner_up_margin:null,motion_rank:null,top1:false,top3:false,track_sample_count:0,target_sample_count:0,detected_sample_count:0,motion_coverage:0,candidates:[],correct:false,leakage_violations:[]});continue;}
  const obs=JSON.parse(readFileSync(path.join(workDir,'observations',`${id}.json`),'utf8')),sealed=JSON.parse(readFileSync(path.join(workDir,'results',`${id}.json`),'utf8')),fit=sealed.inverse_result?.recovered?.motion_grammar,accepted=fit?.accepted?.value||null,rank=truthRank(fit,truth),serialized=JSON.stringify(sealed),leaks=[];
  if(ground?.scene_program_id&&serialized.includes(ground.scene_program_id))leaks.push('scene_program_id');
  if(ground?.template_variant_id&&serialized.includes(ground.template_variant_id))leaks.push('template_variant_id');
  for(const key of ['motion_recipe','resolved_layout','cover_staging','typography_fits'])if(serialized.includes(`\"${key}\"`))leaks.push(`forward_${key}`);
  const track=obs.semantic_observation?.motion_tracks?.find(t=>t.target==='asset'),raw=obs.raw_measurements?.samples||[],detected=raw.filter(x=>x.detected).length;
  rows.push({selection_id:selection,render_spec_id:id,book_id:bookId,ground_truth_motion_grammar:truth,phase_a_ok:true,phase_a_stage:null,phase_a_error:null,source_hash_exact:obs.source_sha256===artifact.output?.sha256,state:fit?.state||null,reason:fit?.reason||null,inferred_motion_grammar:accepted,fit_residual:fit?.fit_residual??null,runner_up_margin:fit?.runner_up_margin??null,motion_rank:rank,top1:rank===1,top3:rank!==null&&rank<=3,track_sample_count:track?.samples?.length||0,target_sample_count:raw.length,detected_sample_count:detected,motion_coverage:obs.semantic_observation?.coverage?.motion??0,candidates:(fit?.candidates||[]).map(c=>({value:c.value,residual:c.residual,confidence:c.confidence})),correct:accepted===truth,leakage_violations:[...new Set(leaks)]});
}
const n=rows.length,phaseAOk=rows.filter(r=>r.phase_a_ok).length,sourceExact=rows.filter(r=>r.source_hash_exact).length,tracks=rows.filter(r=>r.track_sample_count>=5).length,accepted=rows.filter(r=>r.state==='accepted').length,correct=rows.filter(r=>r.correct).length,top1=rows.filter(r=>r.top1).length,top3=rows.filter(r=>r.top3).length,leakage=rows.reduce((sum,r)=>sum+r.leakage_violations.length,0),mrr=rows.reduce((sum,r)=>sum+(r.motion_rank?1/r.motion_rank:0),0)/n;
const summary={schema:'i24-physical-motion-cover-holdout-v1',version:1,videos:n,hard_gates:{phase_a_completed:phaseAOk,source_hash_exact:sourceExact,tracks_observed:tracks,zero_forward_leakage:leakage===0},diagnostic:{accepted,correct,top1,top3,top1_rate:Number((top1/n).toFixed(6)),top3_rate:Number((top3/n).toFixed(6)),mean_reciprocal_rank:Number(mrr.toFixed(6)),mean_motion_coverage:Number((rows.reduce((s,r)=>s+r.motion_coverage,0)/n).toFixed(6)),by_book:group(rows,'book_id'),by_motion_family:group(rows,'ground_truth_motion_grammar')},rows};
const output=JSON.stringify(summary,null,2)+'\n';if(o.out)writeFileSync(path.resolve(o.out),output);process.stdout.write(output);
if(summary.hard_gates.phase_a_completed!==n)throw new Error(`phase A completion gate failed ${summary.hard_gates.phase_a_completed}/${n}`);
if(summary.hard_gates.source_hash_exact!==n)throw new Error(`source hash gate failed ${summary.hard_gates.source_hash_exact}/${n}`);
if(summary.hard_gates.tracks_observed!==n)throw new Error(`asset-track observation gate failed ${summary.hard_gates.tracks_observed}/${n}`);
if(!summary.hard_gates.zero_forward_leakage)throw new Error('forward identity/recipe leakage');
