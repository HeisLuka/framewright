#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const adaptation=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/e16/adaptation.json'),'utf8'));
const outDir=path.resolve(process.argv[3]||'artifacts/e16/review');
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr.slice(-3000));}
const books=[...new Set(adaptation.results.map(x=>x.bookId))];
const map={schema:'framewright-e16-review-v1',books:{}};
for(const bookId of books){
  map.books[bookId]={};
  for(const format of ['square','landscape']){
    const strips=[];
    for(const strategy of ['contain','cover']){
      const row=adaptation.results.find(x=>x.bookId===bookId&&x.format===format&&x.strategy===strategy);if(!row)throw new Error(`missing ${bookId}/${format}/${strategy}`);
      const out=path.join(outDir,`${bookId}-${format}-${strategy}.png`);
      run(['-hide_banner','-loglevel','error','-y','-i',path.resolve(row.output),'-vf','fps=1/4,scale=360:-2:flags=lanczos,tile=3x1','-frames:v','1',out]);strips.push(out);
    }
    const compare=path.join(outDir,`${bookId}-${format}-compare.png`);
    run(['-hide_banner','-loglevel','error','-y','-i',strips[0],'-i',strips[1],'-filter_complex','[0:v][1:v]vstack=inputs=2[v]','-map','[v]','-frames:v','1',compare]);
    map.books[bookId][format]=path.relative(process.cwd(),compare);
  }
}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));console.log(JSON.stringify(map,null,2));
