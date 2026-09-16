#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batchPath=path.resolve(process.argv[2]||'artifacts/e14/batch.json');
const manifestPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-e14/manifest.json');
const outDir=path.resolve(process.argv[4]||'artifacts/e14/review');
const batch=JSON.parse(fs.readFileSync(batchPath,'utf8')),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const byId=new Map(batch.results.map(x=>[x.id,x]));
const books=['river-station','city-seven','long-title'];
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
function run(args){const r=spawnSync('ffmpeg',args,{stdio:'pipe',encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr.slice(-3000));}
const map={schema:'framewright-e14-review-v1',books:{}};
for(const bookId of books){
  const items=manifest.items.filter(x=>x.bookId===bookId);
  const strips=[];
  for(const item of items){
    const row=byId.get(item.id);if(!row)throw new Error(`missing ${item.id}`);
    const strip=path.join(outDir,`${bookId}-${item.variant}.png`);
    run(['-hide_banner','-loglevel','error','-y','-i',path.resolve(row.output),'-vf','fps=0.5,scale=180:320:flags=lanczos,tile=6x1','-frames:v','1',strip]);
    strips.push({item,strip});
  }
  const compare=path.join(outDir,`${bookId}-compare.png`),args=['-hide_banner','-loglevel','error','-y'];
  for(const s of strips)args.push('-i',s.strip);
  args.push('-filter_complex','[0:v][1:v][2:v][3:v]vstack=inputs=4[v]','-map','[v]','-frames:v','1',compare);run(args);
  map.books[bookId]={style:items[0]?.style,order:items.map(x=>x.variant),compare:path.relative(process.cwd(),compare)};
}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));console.log(JSON.stringify(map,null,2));
