#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const reportPath=path.resolve(process.argv[2]||'artifacts/e12/batch.json');
const outDir=path.resolve(process.argv[3]||'artifacts/e12/review');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const styles=['swiss','newspaper','paper'],book='winter-map';
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
function run(args){const r=spawnSync('ffmpeg',args,{stdio:'pipe',encoding:'utf8'});if(r.status!==0)throw new Error(`ffmpeg failed: ${r.stderr.slice(-3000)}`);}
function video(style,mode){const row=report.results.find(x=>x.id===`${mode}-${style}-${book}`);if(!row)throw new Error(`missing ${mode}-${style}-${book}`);return path.resolve(row.output);}
const map={book,order:'compare sheets: baseline on top, active on bottom',sampleRateFps:2,styles:{}};
for(const style of styles){
  const base=path.join(outDir,`${style}-baseline.png`),active=path.join(outDir,`${style}-active.png`),compare=path.join(outDir,`${style}-compare.png`);
  for(const [mode,file] of [['baseline',base],['active',active]]){
    run(['-hide_banner','-loglevel','error','-y','-i',video(style,mode),'-vf','fps=2,scale=180:320:flags=lanczos,tile=6x4','-frames:v','1',file]);
  }
  run(['-hide_banner','-loglevel','error','-y','-i',base,'-i',active,'-filter_complex','[0:v][1:v]vstack=inputs=2[v]','-map','[v]','-frames:v','1',compare]);
  map.styles[style]={baseline:path.relative(process.cwd(),base),active:path.relative(process.cwd(),active),compare:path.relative(process.cwd(),compare)};
}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));
console.log(JSON.stringify(map,null,2));
