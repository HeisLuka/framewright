#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const soakScript=path.resolve('.agents/skills/framewright/scripts/node-canvas-soak.mjs');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/e09/concurrency');
const totalVideos=Math.max(4,+(process.env.TOTAL_VIDEOS||24));
const cases=(process.env.CONCURRENCY_CASES||'1,2,4').split(',').map(Number).filter(n=>n>0);
fs.mkdirSync(outDir,{recursive:true});

function runWorker(concurrency,workerIndex,videos){
  const report=path.join(outDir,`c${concurrency}-w${workerIndex}.json`);
  const env={...process.env,SOAK_VIDEOS:String(videos),REPORT:report};
  return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[soakScript],{env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);
    p.on('error',reject);p.on('close',code=>{
      if(code!==0)return reject(new Error(`worker c${concurrency}#${workerIndex} exited ${code}: ${stderr.slice(-2000)}`));
      const data=JSON.parse(fs.readFileSync(report,'utf8'));resolve({report,data,stdout:stdout.slice(-2000)});
    });
  });
}

const matrix=[];
for(const concurrency of cases){
  const base=Math.floor(totalVideos/concurrency),rem=totalVideos%concurrency;
  const counts=Array.from({length:concurrency},(_,i)=>base+(i<rem?1:0)).filter(Boolean);
  const t0=performance.now();
  const workers=await Promise.all(counts.map((n,i)=>runWorker(concurrency,i,n)));
  const wallMs=performance.now()-t0,rendered=workers.reduce((a,w)=>a+w.data.count,0),peakRssSum=workers.reduce((a,w)=>a+w.data.peakCombinedRssBytes,0);
  const result={concurrency,workers:workers.length,videos:rendered,wallMs:+wallMs.toFixed(3),videosPerHour:+(rendered*3600000/wallMs).toFixed(2),sumWorkerPeakRssBytes:peakRssSum,workerThroughputs:workers.map(w=>w.data.videosPerHour),workerP95Ms:workers.map(w=>w.data.perVideoMs.p95),reports:workers.map(w=>path.relative(process.cwd(),w.report))};
  matrix.push(result);console.log(result);
}
const best=[...matrix].sort((a,b)=>b.videosPerHour-a.videosPerHour)[0];
const out={schema:'framewright-e09-concurrency-v1',totalVideosPerCase:totalVideos,cases:matrix,bestConcurrency:best.concurrency,bestVideosPerHour:best.videosPerHour};
fs.writeFileSync(path.join(outDir,'matrix.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
