#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'artifacts/e11/batch.json');
const outJson=path.resolve(process.argv[3]||'artifacts/e11/style-summary.json');
const outMd=path.resolve(process.argv[4]||'artifacts/e11/summary.md');
const r=JSON.parse(fs.readFileSync(input,'utf8'));
const styles=['swiss','newspaper','paper'];
const stat=xs=>{const s=[...xs].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))]||0;return{mean:s.reduce((a,b)=>a+b,0)/Math.max(1,s.length),p50:q(.5),p95:q(.95),max:q(1)};};
const groups={};
for(const style of styles){
  const xs=r.results.filter(x=>x.id.startsWith(style+'-'));
  const wall=xs.reduce((a,x)=>a+x.totalMs,0),bytes=xs.reduce((a,x)=>a+x.outputBytes,0),warnings=xs.reduce((a,x)=>a+x.layoutWarnings.length,0);
  groups[style]={count:xs.length,totalMs:+wall.toFixed(3),videosPerHour:+(xs.length*3600000/wall).toFixed(2),perVideoMs:stat(xs.map(x=>x.totalMs)),meanOutputKiB:+(bytes/Math.max(1,xs.length)/1024).toFixed(1),meanRenderMsPerFrame:+(xs.reduce((a,x)=>a+x.stages.renderMs.mean,0)/Math.max(1,xs.length)).toFixed(3),meanWriteWaitMsPerFrame:+(xs.reduce((a,x)=>a+x.stages.writeWaitMs.mean,0)/Math.max(1,xs.length)).toFixed(3),layoutWarningGroups:warnings};
}
const baseline=groups.swiss.videosPerHour;
for(const style of styles){groups[style].relativeThroughputVsSwiss=+(groups[style].videosPerHour/baseline).toFixed(3);}
const out={schema:'framewright-e11-style-summary-v1',host:r.host,width:r.width,height:r.height,preset:r.preset,crf:r.crf,totalVideos:r.count,layoutWarningGroups:r.layoutWarningGroups,styles:groups};
fs.mkdirSync(path.dirname(outJson),{recursive:true});fs.writeFileSync(outJson,JSON.stringify(out,null,2));
let md='# E11 visual systems summary\n\n';md+=`Workload: ${r.width}x${r.height}, ${r.count} videos, x264 ${r.preset}/CRF${r.crf}.\n\n`;
md+='| system | videos/hour | vs Swiss | p50 s | p95 s | mean MP4 KiB | render ms/frame | write wait ms/frame | layout warnings |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n';
for(const style of styles){const x=groups[style];md+=`| ${style} | ${x.videosPerHour.toFixed(2)} | ${x.relativeThroughputVsSwiss.toFixed(3)}x | ${(x.perVideoMs.p50/1000).toFixed(3)} | ${(x.perVideoMs.p95/1000).toFixed(3)} | ${x.meanOutputKiB.toFixed(1)} | ${x.meanRenderMsPerFrame.toFixed(3)} | ${x.meanWriteWaitMsPerFrame.toFixed(3)} | ${x.layoutWarningGroups} |\n`;}
md+=`\nTotal layout warning groups: **${r.layoutWarningGroups}**.\n`;
fs.writeFileSync(outMd,md);console.log(md);
