#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const reportPath=path.resolve(process.argv[2]||'artifacts/e12/batch.json');
const outPath=path.resolve(process.argv[3]||'artifacts/e12/motion-activity.json');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const styles=['swiss','newspaper','paper'],modes=['baseline','active'];
const books=['night-archive','winter-map','long-title'];
const windows=[{name:'hook-hold',start:1.0,duration:1.4},{name:'book-hold',start:4.7,duration:2.1},{name:'cta-hold',start:9.5,duration:1.8}];
const W=90,H=160,FPS=5,frameBytes=W*H;

function decode(video,start,duration){
  const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(start),'-t',String(duration),'-i',video,'-vf',`fps=${FPS},scale=${W}:${H}:flags=bilinear,format=gray`,'-f','rawvideo','-pix_fmt','gray','-'],{maxBuffer:16*1024*1024});
  if(r.status!==0)throw new Error(`ffmpeg motion sample failed: ${String(r.stderr).slice(-2000)}`);
  return r.stdout;
}
function activity(buf){
  const frames=Math.floor(buf.length/frameBytes);if(frames<2)return 0;
  let sum=0,pairs=0;
  for(let f=1;f<frames;f++){
    const a=(f-1)*frameBytes,b=f*frameBytes;let d=0;
    for(let i=0;i<frameBytes;i++)d+=Math.abs(buf[a+i]-buf[b+i]);
    sum+=d/(frameBytes*255);pairs++;
  }
  return sum/Math.max(1,pairs);
}
function find(style,mode,book){const row=report.results.find(x=>x.id===`${mode}-${style}-${book}`);if(!row)throw new Error(`missing ${mode}-${style}-${book}`);return path.resolve(row.output);}

const result={schema:'framewright-e12-motion-activity-v1',sampleFps:FPS,sampleSize:[W,H],books,windows,styles:{}};
for(const style of styles){
  result.styles[style]={};
  for(const mode of modes){
    const rows=[];
    for(const book of books){
      const video=find(style,mode,book),perWindow={};let total=0;
      for(const win of windows){const v=activity(decode(video,win.start,win.duration));perWindow[win.name]=+v.toFixed(6);total+=v;}
      rows.push({book,mean:+(total/windows.length).toFixed(6),windows:perWindow});
    }
    result.styles[style][mode]={mean:+(rows.reduce((a,x)=>a+x.mean,0)/rows.length).toFixed(6),books:rows};
  }
  const b=result.styles[style].baseline.mean,a=result.styles[style].active.mean;
  result.styles[style].activeVsBaseline=b?+(a/b).toFixed(3):null;
}
fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
