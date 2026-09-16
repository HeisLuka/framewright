#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batchPath=path.resolve(process.argv[2]||'artifacts/e13/batch.json');
const manifestPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-e13/manifest.json');
const outPath=path.resolve(process.argv[4]||'artifacts/e13/diversity.json');
const batch=JSON.parse(fs.readFileSync(batchPath,'utf8')),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const W=90,H=160,FRAME=W*H,times=[1.5,5.8,10.2];
function frame(video,t){const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(t),'-i',video,'-frames:v','1','-vf',`scale=${W}:${H}:flags=bilinear,format=gray`,'-f','rawvideo','-pix_fmt','gray','-'],{maxBuffer:4*1024*1024});if(r.status!==0)throw new Error(String(r.stderr));return r.stdout;}
function diff(a,b){let s=0;for(let i=0;i<Math.min(a.length,b.length,FRAME);i++)s+=Math.abs(a[i]-b[i]);return s/(FRAME*255);}
const byId=new Map(batch.results.map(x=>[x.id,x]));
const books=[...new Set(manifest.items.map(x=>x.bookId))],rows=[];
for(const bookId of books){
  const items=manifest.items.filter(x=>x.bookId===bookId).sort((a,b)=>a.rank-b.rank),frames=new Map();
  for(const item of items){const row=byId.get(item.id);if(!row)throw new Error(`missing batch row ${item.id}`);frames.set(item.id,times.map(t=>frame(path.resolve(row.output),t)));}
  const pairs=[];
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
    const ds=times.map((_,k)=>diff(frames.get(items[i].id)[k],frames.get(items[j].id)[k]));
    pairs.push({a:items[i].style,b:items[j].style,mean:+(ds.reduce((x,y)=>x+y,0)/ds.length).toFixed(6),plateDiffs:ds.map(x=>+x.toFixed(6))});
  }
  rows.push({bookId,meanPairwiseDiff:+(pairs.reduce((a,x)=>a+x.mean,0)/pairs.length).toFixed(6),minPairwiseDiff:+Math.min(...pairs.map(x=>x.mean)).toFixed(6),pairs});
}
const out={schema:'framewright-e13-diversity-v1',sampleSize:[W,H],times,books:rows,meanAcrossBooks:+(rows.reduce((a,x)=>a+x.meanPairwiseDiff,0)/rows.length).toFixed(6),minAcrossBooks:+Math.min(...rows.map(x=>x.minPairwiseDiff)).toFixed(6)};
fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
