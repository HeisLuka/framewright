#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadSemanticSceneObjectFamilyRegistry} from '../../../../contracts/semantic-scene-object-families-v1.mjs';

const inferenceFile=path.resolve(process.argv[2]||'.bench/c53/phase2-parameter-inference.json');
const truthFile=path.resolve(process.argv[3]||'.bench/c53/phase2-input/hidden-truth.json');
const targetCanonicalFile=path.resolve(process.argv[4]||'.bench/c53/phase2-target-run/canonical-artifacts.json');
const targetRunDir=path.resolve(process.argv[5]||'.bench/c53/phase2-target-run');
const mappingFile=path.resolve(process.argv[6]||'.bench/c53/phase2-recon-input/mapping.json');
const reconCanonicalFile=path.resolve(process.argv[7]||'.bench/c53/phase2-recon-run/canonical-artifacts.json');
const reconRunDir=path.resolve(process.argv[8]||'.bench/c53/phase2-recon-run');
const outFile=path.resolve(process.argv[9]||'.bench/c53/phase2-evaluation.json');
const MAX_RECON_RESIDUAL=.08,MAX_NORMALIZED_NUMBER_ERROR=.13;
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
for(const f of [inferenceFile,truthFile,targetCanonicalFile,mappingFile,reconCanonicalFile])if(!fs.existsSync(f))throw new Error(`missing Phase2 evaluation input ${f}`);
const inference=read(inferenceFile),truth=read(truthFile),targetsCanonical=read(targetCanonicalFile),mapping=read(mappingFile),reconCanonical=read(reconCanonicalFile);
if(inference.schema!=='c53-parameter-pixel-inference-v1'||truth.schema!=='c53-parameter-target-truth-v1'||mapping.schema!=='c53-parameter-reconstruction-map-v1')throw new Error('Phase2 evaluation schema');
const truthById=new Map(truth.targets.map(x=>[x.selection_id,x])),mapByTarget=new Map(mapping.rows.map(x=>[x.source_target_selection_id,x]));
const targetArtifact=new Map(targetsCanonical.artifacts.map(x=>[x.selection_id,x])),reconArtifact=new Map(reconCanonical.artifacts.map(x=>[x.selection_id,x]));
const registry=loadSemanticSceneObjectFamilyRegistry(),familyById=new Map(registry.families.map(f=>[f.id,f]));
function mp4(artifacts,selectionId,runDir){const a=artifacts.get(selectionId);if(!a)throw new Error(`artifact missing ${selectionId}`);const f=path.join(runDir,'video',`${a.render_spec_id}.mp4`);if(!fs.existsSync(f))throw new Error(`video missing ${f}`);return f;}
function vector(file){const p=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-ss','1.5','-i',file,'-frames:v','1','-vf','scale=64:64:flags=area,format=gray','-f','rawvideo','pipe:1'],{encoding:null,maxBuffer:8*1024*1024});if(p.status!==0)throw new Error(`ffmpeg ${file}: ${String(p.stderr||'')}`);if(p.stdout.length!==4096)throw new Error(`bad frame bytes ${file}`);return p.stdout;}
const distance=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/(a.length*255);};
function valueCorrect(spec,inferred,target){
 if(spec.type==='number')return {correct:Math.abs(Number(inferred)-Number(target))/Math.max(1e-12,spec.max-spec.min)<=MAX_NORMALIZED_NUMBER_ERROR,error:Math.abs(Number(inferred)-Number(target))/Math.max(1e-12,spec.max-spec.min)};
 return {correct:Object.is(inferred,target),error:Object.is(inferred,target)?0:1};
}
let accepted=0,ambiguous=0,correct=0,wrong=0,reconstructionPass=0,seedMatches=0;const rows=[];
for(const row of inference.rows){
 const t=truthById.get(row.selection_id);if(!t)throw new Error(`truth missing ${row.selection_id}`);
 if(row.state!=='accepted'||!row.inferred){ambiguous++;rows.push({selection_id:row.selection_id,state:'ambiguous',family_id:t.family_id,parameter_name:t.parameter_name,reason:row.reason||'abstain'});continue;}
 accepted++;
 const family=familyById.get(t.family_id),spec=family?.parameters?.[t.parameter_name];if(!spec)throw new Error(`truth parameter schema missing ${t.family_id}/${t.parameter_name}`);
 const familyCorrect=row.inferred.family_id===t.family_id,param=valueCorrect(spec,row.inferred.value,t.target_value),seedMatch=row.inferred.seed===t.target_seed;if(seedMatch)seedMatches++;
 const m=mapByTarget.get(row.selection_id);if(!m)throw new Error(`reconstruction mapping missing ${row.selection_id}`);
 const targetVec=vector(mp4(targetArtifact,row.selection_id,targetRunDir)),reconVec=vector(mp4(reconArtifact,m.reconstruction_selection_id,reconRunDir)),reconResidual=distance(targetVec,reconVec),reconOk=reconResidual<=MAX_RECON_RESIDUAL;if(reconOk)reconstructionPass++;
 const ok=familyCorrect&&param.correct&&reconOk;if(ok)correct++;else wrong++;
 rows.push({selection_id:row.selection_id,state:'accepted',family_id:t.family_id,parameter_name:t.parameter_name,parameter_type:t.parameter_type,target_value:t.target_value,inferred_value:row.inferred.value,normalized_parameter_error:+param.error.toFixed(8),target_seed:t.target_seed,inferred_seed:row.inferred.seed,seed_match:seedMatch,family_correct:familyCorrect,parameter_correct:param.correct,reconstruction_selection_id:m.reconstruction_selection_id,reconstruction_residual:+reconResidual.toFixed(8),reconstruction_pass:reconOk,outcome:ok?'correct':'wrong'});
}
const report={schema:'c53-semantic-object-parameter-evaluation-v1',targets:inference.rows.length,accepted,ambiguous,correct,wrong,accepted_accuracy:accepted?+(correct/accepted).toFixed(6):0,coverage:inference.rows.length?+(accepted/inference.rows.length).toFixed(6):0,reconstruction_pass:reconstructionPass,seed_matches:seedMatches,thresholds:{max_normalized_number_error:MAX_NORMALIZED_NUMBER_ERROR,max_reconstruction_residual:MAX_RECON_RESIDUAL},rows};
fs.mkdirSync(path.dirname(outFile),{recursive:true});fs.writeFileSync(outFile,JSON.stringify(report,null,2)+'\n');
if(wrong>0)throw new Error(`C53 Phase2 wrong accepted parameter/reconstruction cases=${wrong}`);
if(accepted<1)throw new Error('C53 Phase2 accepted no parameter cases');
console.log(JSON.stringify({...report,rows:undefined},null,2));
