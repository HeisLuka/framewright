#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const basePath=path.resolve(process.env.BASELINE_REPORT||'artifacts/r44/baseline/report.json');
const cachedPath=path.resolve(process.env.CACHED_REPORT||'artifacts/r44/cached/report.json');
const parityPath=path.resolve(process.env.PARITY_REPORT||'artifacts/r44/parity.json');
const outPath=path.resolve(process.env.REPORT||'artifacts/r44/report.json');
const summaryPath=path.resolve(process.env.SUMMARY||'artifacts/r44/summary.md');
const [baseline,cached,crossParity]=await Promise.all([basePath,cachedPath,parityPath].map(async p=>JSON.parse(await fs.readFile(p,'utf8'))));
const profiles=['vertical','square','landscape'];
const pick=(r,p)=>r.results.find(x=>x.profile===p&&x.concurrency===2);
const ratio=(a,b)=>b? a/b-1:0;
const q=(xs,p)=>{const a=[...xs].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor((a.length-1)*p))]||0;};
function summarize(r){
  const rows=profiles.map(p=>pick(r,p));
  if(rows.some(x=>!x)) throw new Error('missing c2 profile result');
  const all=rows.flatMap(x=>x.rows||[]);
  const jobs=rows.reduce((a,x)=>a+x.jobs,0), wall=rows.reduce((a,x)=>a+x.scenarioWallMs,0);
  return {jobs,serialMixVideosPerHour:jobs*3600000/wall,p95JobMs:q(all.map(x=>x.wallMs),.95),cpuMsPerVideo:rows.reduce((a,x)=>a+x.cpuMsPerVideo*x.jobs,0)/jobs,drawMsPerVideo:all.reduce((a,x)=>a+x.drawMs,0)/Math.max(1,all.length),peakRssBytes:Math.max(...rows.map(x=>x.peakRssBytes)),h264BytesPerVideo:all.reduce((a,x)=>a+x.h264Bytes,0)/Math.max(1,all.length),failures:rows.reduce((a,x)=>a+x.failures.length,0),parity:rows.every(x=>x.preflightParity)};
}
const b=summarize(baseline),c=summarize(cached);
const perProfile=Object.fromEntries(profiles.map(p=>{const x=pick(baseline,p),y=pick(cached,p);return[p,{baselineVph:x.videosPerHour,cachedVph:y.videosPerHour,throughputDelta:ratio(y.videosPerHour,x.videosPerHour),baselineP95:x.p95JobMs,cachedP95:y.p95JobMs,p95Delta:ratio(y.p95JobMs,x.p95JobMs),baselineRss:x.peakRssBytes,cachedRss:y.peakRssBytes,rssDelta:ratio(y.peakRssBytes,x.peakRssBytes),baselineCpu:x.cpuMsPerVideo,cachedCpu:y.cpuMsPerVideo,cpuDelta:ratio(y.cpuMsPerVideo,x.cpuMsPerVideo),parity:y.preflightParity,failures:y.failures.length}]}));
const aggregate={throughputDelta:ratio(c.serialMixVideosPerHour,b.serialMixVideosPerHour),p95Delta:ratio(c.p95JobMs,b.p95JobMs),cpuDelta:ratio(c.cpuMsPerVideo,b.cpuMsPerVideo),drawDelta:ratio(c.drawMsPerVideo,b.drawMsPerVideo),rssDelta:ratio(c.peakRssBytes,b.peakRssBytes),bytesDelta:ratio(c.h264BytesPerVideo,b.h264BytesPerVideo)};
const videosPerGiBBaseline=b.serialMixVideosPerHour/(b.peakRssBytes/2**30),videosPerGiBCached=c.serialMixVideosPerHour/(c.peakRssBytes/2**30);
aggregate.videosPerGiBDelta=ratio(videosPerGiBCached,videosPerGiBBaseline);
const correctness=crossParity.pass===true&&crossParity.failures?.length===0&&c.failures===0&&c.parity&&profiles.every(p=>perProfile[p].parity&&!perProfile[p].failures);
const noProfileCliff=profiles.every(p=>perProfile[p].throughputDelta>=-.05&&perProfile[p].p95Delta<=.20&&perProfile[p].rssDelta<=.30);
const promoted=correctness&&aggregate.throughputDelta>=.10&&aggregate.p95Delta<=.20&&aggregate.rssDelta<=.30&&aggregate.videosPerGiBDelta>=0&&noProfileCliff;
const report={schema:'nightwill-r44-static-layer-cache-v1',candidate:'per-document physical-raster background cache, one cached bitmap per plate',gate:{throughput:0.10,p95Max:0.20,rssMax:0.30,videosPerGiBMin:0,profileThroughputFloor:-0.05},crossParity:{samples:crossParity.samples,failures:crossParity.failures?.length||0,pass:crossParity.pass},baseline:b,cached:c,aggregate,perProfile,correctness,promoted,decision:promoted?'PROMOTE background layer cache to production experiment':'KILL/hold: background layer cache does not clear end-to-end gate'};
await fs.mkdir(path.dirname(outPath),{recursive:true});await fs.writeFile(outPath,JSON.stringify(report,null,2)+'\n');
const pct=x=>(x*100).toFixed(1)+'%';
const lines=['# R44 static layer/subtree cache scout','',`Decision: **${report.decision}**`,'',`- baseline ↔ cached sampled pixel parity: ${crossParity.pass?'PASS':'FAIL'} (${crossParity.samples} samples)`,`- mixed-profile throughput: ${b.serialMixVideosPerHour.toFixed(2)} -> ${c.serialMixVideosPerHour.toFixed(2)} videos/h (${pct(aggregate.throughputDelta)})`,`- p95 job: ${b.p95JobMs.toFixed(2)} -> ${c.p95JobMs.toFixed(2)} ms (${pct(aggregate.p95Delta)})`,`- draw/video: ${b.drawMsPerVideo.toFixed(2)} -> ${c.drawMsPerVideo.toFixed(2)} ms (${pct(aggregate.drawDelta)})`,`- CPU/video: ${b.cpuMsPerVideo.toFixed(2)} -> ${c.cpuMsPerVideo.toFixed(2)} ms (${pct(aggregate.cpuDelta)})`,`- peak RSS: ${(b.peakRssBytes/2**20).toFixed(1)} -> ${(c.peakRssBytes/2**20).toFixed(1)} MiB (${pct(aggregate.rssDelta)})`,`- videos/hour/GiB: ${videosPerGiBBaseline.toFixed(2)} -> ${videosPerGiBCached.toFixed(2)} (${pct(aggregate.videosPerGiBDelta)})`,`- correctness: ${correctness?'PASS':'FAIL'}`,'',...profiles.map(p=>`- ${p}: throughput ${pct(perProfile[p].throughputDelta)}, p95 ${pct(perProfile[p].p95Delta)}, RSS ${pct(perProfile[p].rssDelta)}`),''];
await fs.writeFile(summaryPath,lines.join('\n'));console.log(lines.join('\n'));
