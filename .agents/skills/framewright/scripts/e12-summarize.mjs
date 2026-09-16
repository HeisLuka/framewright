#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'artifacts/e12/batch.json');
const outJson=path.resolve(process.argv[3]||'artifacts/e12/motion-summary.json');
const outMd=path.resolve(process.argv[4]||'artifacts/e12/summary.md');
const r=JSON.parse(fs.readFileSync(input,'utf8'));
const styles=['swiss','newspaper','paper'],modes=['baseline','active'];
function stat(xs){const s=[...xs].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))]||0;return{mean:s.reduce((a,b)=>a+b,0)/Math.max(1,s.length),p50:q(.5),p95:q(.95),max:q(1)};}
const groups={};
for(const style of styles){
  groups[style]={};
  for(const mode of modes){
    const xs=r.results.filter(x=>x.id.startsWith(`${mode}-${style}-`));
    const wall=xs.reduce((a,x)=>a+x.totalMs,0),bytes=xs.reduce((a,x)=>a+x.outputBytes,0);
    groups[style][mode]={count:xs.length,totalMs:+wall.toFixed(3),videosPerHour:+(xs.length*3600000/wall).toFixed(2),perVideoMs:stat(xs.map(x=>x.totalMs)),meanOutputKiB:+(bytes/Math.max(1,xs.length)/1024).toFixed(1),meanRenderMsPerFrame:+(xs.reduce((a,x)=>a+x.stages.renderMs.mean,0)/Math.max(1,xs.length)).toFixed(3),meanWriteWaitMsPerFrame:+(xs.reduce((a,x)=>a+x.stages.writeWaitMs.mean,0)/Math.max(1,xs.length)).toFixed(3),layoutWarningGroups:xs.reduce((a,x)=>a+x.layoutWarnings.length,0)};
  }
  const b=groups[style].baseline,a=groups[style].active;
  groups[style].comparison={throughputRatio:+(a.videosPerHour/b.videosPerHour).toFixed(3),outputSizeRatio:+(a.meanOutputKiB/b.meanOutputKiB).toFixed(3),renderCostRatio:+(a.meanRenderMsPerFrame/b.meanRenderMsPerFrame).toFixed(3),p95Ratio:+(a.perVideoMs.p95/b.perVideoMs.p95).toFixed(3)};
}
const out={schema:'framewright-e12-motion-summary-v1',host:r.host,width:r.width,height:r.height,preset:r.preset,crf:r.crf,totalVideos:r.count,layoutWarningGroups:r.layoutWarningGroups,styles:groups};
fs.mkdirSync(path.dirname(outJson),{recursive:true});fs.writeFileSync(outJson,JSON.stringify(out,null,2));
let md='# E12 motion grammar cost summary\n\n';
md+=`Workload: ${r.width}x${r.height}, ${r.count} videos, x264 ${r.preset}/CRF${r.crf}. Baseline and active are interleaved in one run.\n\n`;
md+='| system | baseline /h | active /h | active speed ratio | baseline p95 s | active p95 s | MP4 size ratio | render-cost ratio | warnings |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n';
for(const style of styles){const b=groups[style].baseline,a=groups[style].active,c=groups[style].comparison;md+=`| ${style} | ${b.videosPerHour.toFixed(2)} | ${a.videosPerHour.toFixed(2)} | ${c.throughputRatio.toFixed(3)}x | ${(b.perVideoMs.p95/1000).toFixed(3)} | ${(a.perVideoMs.p95/1000).toFixed(3)} | ${c.outputSizeRatio.toFixed(3)}x | ${c.renderCostRatio.toFixed(3)}x | ${b.layoutWarningGroups+a.layoutWarningGroups} |\n`;}
md+=`\nTotal layout warning groups: **${r.layoutWarningGroups}**.\n`;
fs.writeFileSync(outMd,md);console.log(md);
