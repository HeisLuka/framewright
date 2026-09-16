#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/c20/batch.json'),'utf8'));
const outDir=path.resolve(process.argv[3]||'artifacts/c20/review');fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr.slice(-3000));}
const map={schema:'framewright-c20-review-v1',styles:{}};
for(const style of ['swiss','newspaper','paper']){
  const books=[...new Set(batch.results.filter(x=>x.style===style).map(x=>x.bookId))];map.styles[style]=[];
  for(let page=0;page<Math.ceil(books.length/6);page++){
    const group=books.slice(page*6,page*6+6),rows=[];
    for(const book of group){
      const generic=batch.results.find(x=>x.bookId===book&&x.id.endsWith('-generic')),adaptive=batch.results.find(x=>x.bookId===book&&x.id.endsWith('-cover'));if(!generic||!adaptive)throw new Error(`missing pair ${book}`);
      const cells=[];for(const [kind,row] of [['generic',generic],['adaptive',adaptive]]){const cell=path.join(outDir,`${book}-${kind}.png`);run(['-hide_banner','-loglevel','error','-y','-ss','5.2','-i',path.resolve(row.output),'-frames:v','1','-vf',`scale=300:534,drawbox=x=0:y=0:w=iw:h=52:color=black@0.72:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${book} ${kind}':x=12:y=14:fontsize=22:fontcolor=white`,cell]);cells.push(cell);}const rowFile=path.join(outDir,`${book}-pair.png`);run(['-hide_banner','-loglevel','error','-y','-i',cells[0],'-i',cells[1],'-filter_complex','[0:v][1:v]hstack=inputs=2[v]','-map','[v]','-frames:v','1',rowFile]);rows.push(rowFile);
    }
    const sheet=path.join(outDir,`${style}-${String(page+1).padStart(2,'0')}.png`),args=['-hide_banner','-loglevel','error','-y'];for(const r of rows)args.push('-i',r);args.push('-filter_complex',rows.map((_,i)=>`[${i}:v]`).join('')+`vstack=inputs=${rows.length}[v]`,'-map','[v]','-frames:v','1',sheet);run(args);map.styles[style].push(path.relative(process.cwd(),sheet));
  }
}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));console.log(JSON.stringify(map,null,2));
