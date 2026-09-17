#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const publicBankFile=path.resolve(process.argv[2]||'.bench/c53/input/public-bank.json');
const canonicalFile=path.resolve(process.argv[3]||'.bench/c53/run/canonical-artifacts.json');
const runDir=path.resolve(process.argv[4]||'.bench/c53/run');
const outFile=path.resolve(process.argv[5]||'.bench/c53/phase-a-inference.json');
const publicBank=JSON.parse(fs.readFileSync(publicBankFile,'utf8'));
const canonical=JSON.parse(fs.readFileSync(canonicalFile,'utf8'));
if(publicBank.schema!=='c53-public-family-bank-v1')throw new Error('public bank schema');
const artifactBySelection=new Map(canonical.artifacts.map(x=>[x.selection_id,x]));
function frameVector(selectionId){
  const artifact=artifactBySelection.get(selectionId);if(!artifact)throw new Error(`artifact missing ${selectionId}`);
  const mp4=path.join(runDir,'video',`${artifact.render_spec_id}.mp4`);if(!fs.existsSync(mp4))throw new Error(`video missing ${mp4}`);
  const p=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-ss','1.5','-i',mp4,'-frames:v','1','-vf','scale=64:64:flags=area,format=gray','-f','rawvideo','pipe:1'],{encoding:null,maxBuffer:8*1024*1024});
  if(p.status!==0)throw new Error(`ffmpeg ${selectionId}: ${String(p.stderr||'')}`);if(p.stdout.length!==4096)throw new Error(`unexpected frame bytes ${selectionId}: ${p.stdout.length}`);return p.stdout;
}
const distance=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/(a.length*255);};
const refs=publicBank.references.map(r=>({...r,vector:frameVector(r.selection_id)}));
const families=[...new Set(refs.map(r=>r.family_id))].sort();
const targets=[];
for(const target of publicBank.targets){
  const v=frameVector(target.selection_id),scores=[];
  for(const family_id of families){
    const ds=refs.filter(r=>r.family_id===family_id).map(r=>distance(v,r.vector)).sort((a,b)=>a-b);
    const use=ds.slice(0,Math.min(2,ds.length));
    scores.push({family_id,residual:+(use.reduce((a,b)=>a+b,0)/use.length).toFixed(8),reference_residuals:ds.map(x=>+x.toFixed(8))});
  }
  scores.sort((a,b)=>a.residual-b.residual||a.family_id.localeCompare(b.family_id));
  const best=scores[0],runner=scores[1],margin=runner.residual-best.residual;
  const accepted=best.residual<=0.18&&margin>=0.01;
  targets.push({selection_id:target.selection_id,state:accepted?'accepted':'ambiguous',accepted_family_id:accepted?best.family_id:null,fit_residual:best.residual,runner_up_margin:+margin.toFixed(8),candidates:scores.slice(0,4)});
}
const report={schema:'c53-pixel-family-inference-v1',observer:{frame_seconds:1.5,width:64,height:64,pixel_format:'gray8',distance:'mean-absolute-luma',family_aggregation:'mean-best-2-of-3-reference-seeds',max_residual:0.18,min_margin:0.01},target_count:targets.length,reference_count:refs.length,family_count:families.length,targets};
fs.mkdirSync(path.dirname(outFile),{recursive:true});fs.writeFileSync(outFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({schema:report.schema,target_count:report.target_count,reference_count:report.reference_count,family_count:report.family_count,accepted:targets.filter(x=>x.state==='accepted').length,ambiguous:targets.filter(x=>x.state!=='accepted').length,outFile},null,2));
