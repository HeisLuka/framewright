#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batchPath=path.resolve(process.argv[2]||'artifacts/c22/batch.json');
const manifestPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-c22/manifest.json');
const outDir=path.resolve(process.argv[4]||'artifacts/c22/review');
const batch=JSON.parse(fs.readFileSync(batchPath,'utf8')),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),byId=new Map(batch.results.map(x=>[x.id,x]));
const modes=['e12-active','c22-v2'],times=[.25,.65,1.55,2.30,3.25,3.80,5.90,7.20,8.25,8.80,9.60,10.80],books=[...new Set(manifest.items.map(x=>x.bookId))];
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8',maxBuffer:32*1024*1024});if(r.status!==0)throw new Error(r.stderr.slice(-4000));}
function still(row,time,label,file){run(['-hide_banner','-loglevel','error','-y','-ss',String(time),'-i',path.resolve(row.output),'-frames:v','1','-vf',`scale=140:249:force_original_aspect_ratio=decrease,pad=140:249:(ow-iw)/2:(oh-ih)/2:color=0x202020,drawbox=x=0:y=0:w=iw:h=30:color=black@0.78:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${label}':x=5:y=7:fontsize=10:fontcolor=white`,file]);}
const map={schema:'framewright-c22-review-v1',times,modes,books:{}};
for(const bookId of books){
  const items=manifest.items.filter(x=>x.bookId===bookId),rows=[];
  for(const mode of modes){
    const item=items.find(x=>x.mode===mode);if(!item)throw new Error(`${bookId}: missing ${mode}`);const row=byId.get(item.id);if(!row)throw new Error(`missing batch row ${item.id}`);
    const cells=[];for(const t of times){const f=path.join(outDir,`${bookId}-${mode}-${String(t).replace('.','p')}.png`);still(row,t,`${mode} ${t}s`,f);cells.push(f);}
    const strip=path.join(outDir,`${bookId}-${mode}.png`),args=['-hide_banner','-loglevel','error','-y'];for(const f of cells)args.push('-i',f);args.push('-filter_complex',cells.map((_,i)=>`[${i}:v]`).join('')+`hstack=inputs=${cells.length}[v]`,'-map','[v]','-frames:v','1',strip);run(args);rows.push(strip);
  }
  const compare=path.join(outDir,`${bookId}-motion.png`),args=['-hide_banner','-loglevel','error','-y'];for(const f of rows)args.push('-i',f);args.push('-filter_complex',rows.map((_,i)=>`[${i}:v]`).join('')+`vstack=inputs=${rows.length}[v]`,'-map','[v]','-frames:v','1',compare);run(args);
  map.books[bookId]={style:items[0].style,compare:path.relative(process.cwd(),compare)};
}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));console.log(JSON.stringify({books:books.length,modes,times},null,2));
