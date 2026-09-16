#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/e18/batch.json'),'utf8'));
const outDir=path.resolve(process.argv[3]||'artifacts/e18/review');fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const books=[...new Set(batch.results.map(x=>x.bookId))],profiles=['vertical','square','landscape'],variants=['hook-first','cover-first','title-first','hook-title'];
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr.slice(-3000));}
const map={schema:'framewright-e18-review-v1',books:{}};
for(const book of books){map.books[book]={};const profileRows=[];for(const profile of profiles){const cells=[];for(const variant of variants){const row=batch.results.find(x=>x.bookId===book&&x.profile===profile&&x.variant===variant);if(!row)throw new Error(`missing ${book}/${profile}/${variant}`);const cell=path.join(outDir,`${book}-${profile}-${variant}.png`);run(['-hide_banner','-loglevel','error','-y','-ss','1.5','-i',path.resolve(row.output),'-frames:v','1','-vf','scale=280:280:force_original_aspect_ratio=decrease,pad=280:280:(ow-iw)/2:(oh-ih)/2:color=0x202020',cell]);cells.push(cell);}const strip=path.join(outDir,`${book}-${profile}.png`);run(['-hide_banner','-loglevel','error','-y','-i',cells[0],'-i',cells[1],'-i',cells[2],'-i',cells[3],'-filter_complex','[0:v][1:v][2:v][3:v]hstack=inputs=4[v]','-map','[v]','-frames:v','1',strip]);profileRows.push(strip);map.books[book][profile]=path.relative(process.cwd(),strip);}const compare=path.join(outDir,`${book}-all.png`);run(['-hide_banner','-loglevel','error','-y','-i',profileRows[0],'-i',profileRows[1],'-i',profileRows[2],'-filter_complex','[0:v][1:v][2:v]vstack=inputs=3[v]','-map','[v]','-frames:v','1',compare]);map.books[book].compare=path.relative(process.cwd(),compare);}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));console.log(JSON.stringify(map,null,2));
