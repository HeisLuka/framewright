#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/e17/batch.json'),'utf8'));
const outDir=path.resolve(process.argv[3]||'artifacts/e17/review');fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr.slice(-3000));}
const books=[...new Set(batch.results.map(x=>x.bookId))],profiles=['vertical','square','landscape'],times=[1.5,5.2,10.4],map={schema:'framewright-e17-review-v1',books:{}};
for(const book of books){map.books[book]={};const strips=[];for(const profile of profiles){const row=batch.results.find(x=>x.bookId===book&&x.profile===profile);if(!row)throw new Error(`missing ${book}/${profile}`);const cells=[];for(let i=0;i<times.length;i++){const cell=path.join(outDir,`${book}-${profile}-${i}.png`);run(['-hide_banner','-loglevel','error','-y','-ss',String(times[i]),'-i',path.resolve(row.output),'-frames:v','1','-vf',`scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=0x202020`,cell]);cells.push(cell);}const strip=path.join(outDir,`${book}-${profile}.png`);run(['-hide_banner','-loglevel','error','-y','-i',cells[0],'-i',cells[1],'-i',cells[2],'-filter_complex','[0:v][1:v][2:v]hstack=inputs=3[v]','-map','[v]','-frames:v','1',strip]);strips.push(strip);map.books[book][profile]=path.relative(process.cwd(),strip);}
const compare=path.join(outDir,`${book}-profiles.png`);run(['-hide_banner','-loglevel','error','-y','-i',strips[0],'-i',strips[1],'-i',strips[2],'-filter_complex','[0:v][1:v][2:v]vstack=inputs=3[v]','-map','[v]','-frames:v','1',compare]);map.books[book].compare=path.relative(process.cwd(),compare);}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));console.log(JSON.stringify(map,null,2));
