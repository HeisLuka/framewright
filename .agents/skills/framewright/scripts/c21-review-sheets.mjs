#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batchPath=path.resolve(process.argv[2]||'artifacts/c21/batch.json');
const manifestPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-c21/manifest.json');
const outDir=path.resolve(process.argv[4]||'artifacts/c21/review');
const batch=JSON.parse(fs.readFileSync(batchPath,'utf8')),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),byId=new Map(batch.results.map(x=>[x.id,x]));
const grammars=['hook-led','cover-led','title-led','progressive-hook'],times=[0.45,1.05,1.65,2.4],books=[...new Set(manifest.items.map(x=>x.bookId))];
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8',maxBuffer:32*1024*1024});if(r.status!==0)throw new Error(r.stderr.slice(-4000));}
function still(row,time,label,file){run(['-hide_banner','-loglevel','error','-y','-ss',String(time),'-i',path.resolve(row.output),'-frames:v','1','-vf',`scale=180:320:force_original_aspect_ratio=decrease,pad=180:320:(ow-iw)/2:(oh-ih)/2:color=0x202020,drawbox=x=0:y=0:w=iw:h=38:color=black@0.75:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${label}':x=7:y=9:fontsize=13:fontcolor=white`,file]);}
const map={schema:'framewright-c21-review-v1',cellTimes:times,grammarOrder:grammars,books:{}};
for(const bookId of books){
  const items=manifest.items.filter(x=>x.bookId===bookId),rows=[];
  for(const grammar of grammars){
    const item=items.find(x=>x.grammar===grammar);if(!item)throw new Error(`${bookId}: missing ${grammar}`);const row=byId.get(item.id);if(!row)throw new Error(`missing batch row ${item.id}`);
    const cells=[];for(const t of times){const f=path.join(outDir,`${bookId}-${grammar}-${String(t).replace('.','p')}.png`);still(row,t,`${grammar} ${t}s`,f);cells.push(f);}
    const strip=path.join(outDir,`${bookId}-${grammar}.png`),args=['-hide_banner','-loglevel','error','-y'];for(const f of cells)args.push('-i',f);args.push('-filter_complex',cells.map((_,i)=>`[${i}:v]`).join('')+`hstack=inputs=${cells.length}[v]`,'-map','[v]','-frames:v','1',strip);run(args);rows.push(strip);
  }
  const compare=path.join(outDir,`${bookId}-opening.png`),args=['-hide_banner','-loglevel','error','-y'];for(const f of rows)args.push('-i',f);args.push('-filter_complex',rows.map((_,i)=>`[${i}:v]`).join('')+`vstack=inputs=${rows.length}[v]`,'-map','[v]','-frames:v','1',compare);run(args);
  map.books[bookId]={style:items[0].style,compare:path.relative(process.cwd(),compare)};
}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));console.log(JSON.stringify({books:books.length,grammarOrder:grammars,cellTimes:times},null,2));
