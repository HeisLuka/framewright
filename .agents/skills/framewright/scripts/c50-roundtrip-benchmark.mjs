#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMotionGrammarFamilyRegistry } from '../../../../contracts/motion-grammar-families-v2.mjs';

const SCRIPT_DIR=path.dirname(fileURLToPath(import.meta.url));
const OBSERVER=path.join(SCRIPT_DIR,'c50-observe-video.mjs');
const INFERER=path.join(SCRIPT_DIR,'c50-infer-observation.mjs');
function parseArgs(){const args=process.argv.slice(2),out={};for(let i=0;i<args.length;i+=1){const key=args[i];if(!key.startsWith('--'))throw new Error(`unexpected positional ${key}`);out[key.slice(2)]=args[++i];}for(const key of ['video-dir','input-dir','canonical-artifacts','work-dir'])if(!out[key])throw new Error(`--${key} required`);return out;}
function run(script,args){const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:128*1024*1024});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${path.basename(script)} failed: ${(result.stderr||result.stdout).slice(-4000)}`);return result.stdout;}
function exactDelivery(actual,expected){const fpsClose=Math.abs(Number(actual.fps)-Number(expected.fps))<1e-6,durationClose=Math.abs(Number(actual.duration_seconds)-Number(expected.duration_seconds))<=Math.max(1/Number(expected.fps),0.04);return actual.aspect===expected.aspect&&Number(actual.width)===Number(expected.width)&&Number(actual.height)===Number(expected.height)&&fpsClose&&durationClose;}
function rankOf(candidates,value){const index=candidates.findIndex(item=>item.value===value);return index<0?null:index+1;}

const options=parseArgs();
const videoDir=path.resolve(options['video-dir']),inputDir=path.resolve(options['input-dir']),canonicalPath=path.resolve(options['canonical-artifacts']),workDir=path.resolve(options['work-dir']);
for(const [label,file] of [['video-dir',videoDir],['input-dir',inputDir],['canonical-artifacts',canonicalPath]])if(!existsSync(file))throw new Error(`missing ${label} ${file}`);
rmSync(workDir,{recursive:true,force:true});mkdirSync(path.join(workDir,'observations'),{recursive:true});mkdirSync(path.join(workDir,'results'),{recursive:true});

// Phase A is sealed: only MP4 bytes are available to observer/inferer child processes.
const videos=readdirSync(videoDir).filter(name=>name.endsWith('.mp4')).sort();
if(!videos.length)throw new Error(`no MP4 files in ${videoDir}`);
for(const name of videos){
  const renderSpecId=name.slice(0,-4),video=path.join(videoDir,name),observation=path.join(workDir,'observations',`${renderSpecId}.json`),result=path.join(workDir,'results',`${renderSpecId}.json`);
  run(OBSERVER,['--video',video,'--out',observation]);
  run(INFERER,['--observation',observation,'--out',result]);
}

// Phase B starts only after every inference result has been persisted.
const canonical=JSON.parse(readFileSync(canonicalPath,'utf8'));
const artifacts=canonical.artifacts||[];
if(artifacts.length!==videos.length)throw new Error(`artifact/video count mismatch ${artifacts.length} != ${videos.length}`);
const allowedMotion=new Set(loadMotionGrammarFamilyRegistry().families.map(item=>item.id));
const rows=[];
for(const artifact of [...artifacts].sort((a,b)=>a.render_spec_id.localeCompare(b.render_spec_id))){
  const renderSpecId=artifact.render_spec_id,selectionId=artifact.selection_id;
  const observationPath=path.join(workDir,'observations',`${renderSpecId}.json`),resultPath=path.join(workDir,'results',`${renderSpecId}.json`),payloadPath=path.join(inputDir,`${selectionId}.payload.json`);
  for(const file of [observationPath,resultPath,payloadPath])if(!existsSync(file))throw new Error(`missing benchmark evidence ${file}`);
  const observation=JSON.parse(readFileSync(observationPath,'utf8')),result=JSON.parse(readFileSync(resultPath,'utf8')),payload=JSON.parse(readFileSync(payloadPath,'utf8'));
  const ground=payload.template_scene_program;if(!ground)throw new Error(`${selectionId}: template_scene_program missing`);
  const candidates=result.recovered?.motion_grammar||[];
  if(candidates.some(item=>!allowedMotion.has(item.value)))throw new Error(`${renderSpecId}: inferred unknown C40 family`);
  const groundMotion=ground.motion_recipe?.family_id,rank=rankOf(candidates,groundMotion);
  const serialized=JSON.stringify(result),leaks=[];
  if(ground.scene_program_id&&serialized.includes(ground.scene_program_id))leaks.push('scene_program_id');
  if(ground.template_variant_id&&serialized.includes(ground.template_variant_id))leaks.push('template_variant_id');
  const expectedDelivery={aspect:ground.delivery.aspect,width:ground.delivery.width,height:ground.delivery.height,fps:ground.delivery.fps,duration_seconds:ground.delivery.duration_seconds};
  const unresolved=new Set((result.unresolved||[]).map(item=>item.axis));
  rows.push({
    selection_id:selectionId,render_spec_id:renderSpecId,scene_program_id:ground.scene_program_id,ground_truth_motion_grammar:groundMotion,
    observed_source_sha256:observation.source_sha256,canonical_output_sha256:artifact.output?.sha256||null,source_hash_exact:observation.source_sha256===artifact.output?.sha256,
    delivery_exact:exactDelivery(result.recovered?.delivery||{},expectedDelivery),motion_rank:rank,motion_top1:rank===1,motion_top3:rank!=null&&rank<=3,motion_candidates:candidates.map(item=>({value:item.value,confidence:item.confidence,model_error:item.evidence?.model_error??null})),
    unresolved_axes:[...unresolved].sort(),honest_unresolved:['structural_layout','typography','asset_staging','graphic_devices','visual_system'].every(axis=>unresolved.has(axis)),leakage_violations:leaks,
  });
}
const count=rows.length,sum=selector=>rows.filter(selector).length;
const knownRanks=rows.map(row=>row.motion_rank).filter(Number.isInteger);
const summary={
  schema:'newboo-c50-roundtrip-benchmark-v1',version:1,videos:count,
  hard_gates:{source_hash_exact:sum(row=>row.source_hash_exact),delivery_exact:sum(row=>row.delivery_exact),honest_unresolved:sum(row=>row.honest_unresolved),leakage_violations:rows.reduce((n,row)=>n+row.leakage_violations.length,0)},
  diagnostic:{motion_top1:sum(row=>row.motion_top1),motion_top3:sum(row=>row.motion_top3),motion_top1_rate:Number((sum(row=>row.motion_top1)/count).toFixed(6)),motion_top3_rate:Number((sum(row=>row.motion_top3)/count).toFixed(6)),mean_reciprocal_rank:Number((knownRanks.reduce((n,rank)=>n+1/rank,0)/count).toFixed(6))},
  rows,
};
if(summary.hard_gates.source_hash_exact!==count)throw new Error('benchmark source-hash gate failed');
if(summary.hard_gates.delivery_exact!==count)throw new Error('benchmark delivery gate failed');
if(summary.hard_gates.honest_unresolved!==count)throw new Error('benchmark unresolved-honesty gate failed');
if(summary.hard_gates.leakage_violations!==0)throw new Error('benchmark provenance leakage gate failed');
const output=`${JSON.stringify(summary,null,2)}\n`;if(options.out)writeFileSync(path.resolve(options.out),output);process.stdout.write(output);
