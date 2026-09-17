#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const inferenceFile=path.resolve(process.argv[2]||'.bench/c53/phase-a-inference.json');
const truthFile=path.resolve(process.argv[3]||'.bench/c53/input/hidden-truth.json');
const outFile=path.resolve(process.argv[4]||'.bench/c53/evaluation.json');
const inference=JSON.parse(fs.readFileSync(inferenceFile,'utf8'));
const truth=JSON.parse(fs.readFileSync(truthFile,'utf8'));
if(inference.schema!=='c53-pixel-family-inference-v1')throw new Error('inference schema');
if(truth.schema!=='c53-hidden-family-truth-v1')throw new Error('truth schema');
const truthBySelection=new Map(truth.targets.map(x=>[x.selection_id,x]));
let accepted=0,correct=0,wrong=0,ambiguous=0;
const rows=[];
for(const row of inference.targets){
  const t=truthBySelection.get(row.selection_id);if(!t)throw new Error(`truth missing ${row.selection_id}`);
  let outcome='abstain';
  if(row.state==='accepted'){
    accepted++;if(row.accepted_family_id===t.family_id){correct++;outcome='correct';}else{wrong++;outcome='wrong';}
  }else ambiguous++;
  rows.push({selection_id:row.selection_id,hidden_family_id:t.family_id,state:row.state,accepted_family_id:row.accepted_family_id,outcome,fit_residual:row.fit_residual,runner_up_margin:row.runner_up_margin,candidates:row.candidates});
}
const accuracy=accepted?correct/accepted:0,coverage=rows.length?accepted/rows.length:0;
const perFamily=Object.fromEntries([...truthBySelection.values()].map(t=>{const r=rows.find(x=>x.selection_id===t.selection_id);return[t.family_id,{state:r.state,outcome:r.outcome,fit_residual:r.fit_residual,runner_up_margin:r.runner_up_margin,accepted_family_id:r.accepted_family_id}];}));
const report={schema:'c53-semantic-object-family-evaluation-v1',targets:rows.length,accepted,correct,wrong,ambiguous,coverage:+coverage.toFixed(6),accepted_accuracy:+accuracy.toFixed(6),per_family:perFamily,rows};
fs.mkdirSync(path.dirname(outFile),{recursive:true});fs.writeFileSync(outFile,JSON.stringify(report,null,2)+'\n');
if(wrong>0)throw new Error(`C53 wrong accepted families=${wrong}`);
if(accepted<1)throw new Error('C53 observer accepted no families; calibration needed');
console.log(JSON.stringify({...report,rows:undefined},null,2));
