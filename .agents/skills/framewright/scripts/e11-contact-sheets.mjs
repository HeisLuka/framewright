#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const reportPath=path.resolve(process.argv[2]||'artifacts/e11/batch.json');
const outDir=path.resolve(process.argv[3]||'artifacts/e11/review');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const styles=['swiss','newspaper','paper'];
const books=['night-archive','winter-map','long-title'];
const columns=[{plate:'hook',time:1.5},{plate:'book',time:6.0},{plate:'cta',time:10.5}];
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
function run(args){const r=spawnSync('ffmpeg',args,{stdio:'pipe',encoding:'utf8'});if(r.status!==0)throw new Error(`ffmpeg failed: ${r.stderr.slice(-3000)}`);}
const map={rows:books,columns:columns.map(x=>x.plate),times:columns.map(x=>x.time),sheets:{}};
for(const style of styles){
  const tmp=path.join(outDir,`.tmp-${style}`);fs.mkdirSync(tmp,{recursive:true});let k=0;
  for(const book of books){
    const row=report.results.find(x=>x.id===`${style}-${book}`);if(!row)throw new Error(`missing ${style}-${book}`);
    const video=path.resolve(row.output);
    for(const col of columns){const file=path.join(tmp,`${String(k++).padStart(2,'0')}.png`);run(['-hide_banner','-loglevel','error','-y','-i',video,'-ss',String(col.time),'-frames:v','1','-vf','scale=360:640:flags=lanczos',file]);}
  }
  const sheet=path.join(outDir,`sheet-${style}.png`);run(['-hide_banner','-loglevel','error','-y','-framerate','1','-start_number','0','-i',path.join(tmp,'%02d.png'),'-vf','tile=3x3','-frames:v','1',sheet]);
  fs.rmSync(tmp,{recursive:true,force:true});map.sheets[style]=path.relative(process.cwd(),sheet);
}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));
console.log(JSON.stringify(map,null,2));
