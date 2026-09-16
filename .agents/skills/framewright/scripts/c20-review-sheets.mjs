#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/c20/batch.json'),'utf8'));
const outDir=path.resolve(process.argv[3]||'artifacts/c20/review');fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8',maxBuffer:16*1024*1024});if(r.status!==0)throw new Error(r.stderr.slice(-4000));}
function still(row,time,label,file){run(['-hide_banner','-loglevel','error','-y','-ss',String(time),'-i',path.resolve(row.output),'-frames:v','1','-vf',`scale=240:426:force_original_aspect_ratio=decrease,pad=240:426:(ow-iw)/2:(oh-ih)/2:color=0x202020,drawbox=x=0:y=0:w=iw:h=44:color=black@0.72:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${label}':x=10:y=11:fontsize=18:fontcolor=white`,file]);}
const books=[...new Set(batch.results.map(x=>x.bookId))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
const map={schema:'framewright-c20-review-v2',cellOrder:['generic hook @1.5s','adaptive hook @1.5s','generic book @5.2s','adaptive book @5.2s'],pages:[]};
const strips=[];
for(const book of books){
  const generic=batch.results.find(x=>x.bookId===book&&x.id.endsWith('-generic')),adaptive=batch.results.find(x=>x.bookId===book&&x.id.endsWith('-cover'));if(!generic||!adaptive)throw new Error(`missing pair ${book}`);
  const cells=[path.join(outDir,`${book}-g-hook.png`),path.join(outDir,`${book}-a-hook.png`),path.join(outDir,`${book}-g-book.png`),path.join(outDir,`${book}-a-book.png`)];
  still(generic,1.5,`${book} generic hook`,cells[0]);still(adaptive,1.5,`${book} adaptive hook`,cells[1]);still(generic,5.2,`${book} generic book`,cells[2]);still(adaptive,5.2,`${book} adaptive book`,cells[3]);
  const strip=path.join(outDir,`${book}-compare.png`);run(['-hide_banner','-loglevel','error','-y','-i',cells[0],'-i',cells[1],'-i',cells[2],'-i',cells[3],'-filter_complex','[0:v][1:v][2:v][3:v]hstack=inputs=4[v]','-map','[v]','-frames:v','1',strip]);strips.push({bookId:book,style:generic.style,strip});
}
for(let i=0;i<strips.length;i+=6){const group=strips.slice(i,i+6),page=path.join(outDir,`page-${String(i/6+1).padStart(2,'0')}.png`),args=['-hide_banner','-loglevel','error','-y'];for(const x of group)args.push('-i',x.strip);args.push('-filter_complex',group.map((_,j)=>`[${j}:v]`).join('')+`vstack=inputs=${group.length}[v]`,'-map','[v]','-frames:v','1',page);run(args);map.pages.push({page:path.relative(process.cwd(),page),books:group.map(x=>({bookId:x.bookId,style:x.style}))});}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));console.log(JSON.stringify({books:books.length,pages:map.pages.length,cellOrder:map.cellOrder},null,2));
