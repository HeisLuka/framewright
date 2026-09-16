#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const soakScript=path.resolve('.agents/skills/framewright/scripts/node-canvas-soak.mjs');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/e10/concurrency');
const totalVideos=Math.max(8,+(process.env.TOTAL_VIDEOS||30));
const cases=(process.env.CONCURRENCY_CASES||'1,2,4').split(',').map(Number).filter(n=>Number.isInteger(n)&&n>0);
fs.rmSync(outDir,{recursive:true,force:true});
fs.mkdirSync(outDir,{recursive:true});

function procSnapshot(){
  const rows=new Map();
  let dirs=[];try{dirs=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x));}catch{return rows;}
  for(const d of dirs){
    try{
      const text=fs.readFileSync(`/proc/${d}/status`,'utf8');
      const ppid=+(text.match(/^PPid:\s+(\d+)/m)?.[1]||0);
      const rssKb=+(text.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1]||0);
      rows.set(+d,{ppid,rssBytes:rssKb*1024});
    }catch{}
  }
  return rows;
}
function treeRss(rootPid){
  const rows=procSnapshot(),wanted=new Set([rootPid]);let changed=true;
  while(changed){changed=false;for(const [pid,row] of rows){if(!wanted.has(pid)&&wanted.has(row.ppid)){wanted.add(pid);changed=true;}}}
  let bytes=0;for(const pid of wanted)bytes+=rows.get(pid)?.rssBytes||0;return bytes;
}
function stats(xs){const s=[...xs].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))]||0;return{mean:+(s.reduce((a,b)=>a+b,0)/Math.max(1,s.length)).toFixed(3),p50:+q(.5).toFixed(3),p95:+q(.95).toFixed(3),max:+q(1).toFixed(3)};}

function runWorker(concurrency,workerIndex,videos){
  const report=path.join(outDir,`c${concurrency}-w${workerIndex}.json`);
  const env={...process.env,SOAK_VIDEOS:String(videos),REPORT:report};
  return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[soakScript],{env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);
    p.on('error',reject);p.on('close',code=>{
      if(code!==0)return reject(new Error(`worker c${concurrency}#${workerIndex} exited ${code}: ${stderr.slice(-3000)}`));
      const data=JSON.parse(fs.readFileSync(report,'utf8'));resolve({report,data,stdout:stdout.slice(-2000)});
    });
  });
}

const matrix=[];
for(const concurrency of cases){
  const base=Math.floor(totalVideos/concurrency),rem=totalVideos%concurrency;
  const counts=Array.from({length:concurrency},(_,i)=>base+(i<rem?1:0)).filter(Boolean);
  let peakProcessTreeRssBytes=treeRss(process.pid),samples=0,sumTreeRss=0;
  const sampler=setInterval(()=>{const rss=treeRss(process.pid);peakProcessTreeRssBytes=Math.max(peakProcessTreeRssBytes,rss);sumTreeRss+=rss;samples++;},100);
  const t0=performance.now();
  let workers;
  try{workers=await Promise.all(counts.map((n,i)=>runWorker(concurrency,i,n)));}
  finally{clearInterval(sampler);}
  const wallMs=performance.now()-t0,rendered=workers.reduce((a,w)=>a+w.data.count,0);
  const sumWorkerPeakRssBytes=workers.reduce((a,w)=>a+w.data.peakCombinedRssBytes,0);
  const allTimes=workers.flatMap(w=>w.data.results.map(r=>r.totalMs));
  const layoutWarningGroups=workers.reduce((a,w)=>a+w.data.layoutWarningGroups,0);
  const result={concurrency,workers:workers.length,videos:rendered,wallMs:+wallMs.toFixed(3),videosPerHour:+(rendered*3600000/wallMs).toFixed(2),perVideoMs:stats(allTimes),peakProcessTreeRssBytes,meanSampledProcessTreeRssBytes:samples?Math.round(sumTreeRss/samples):null,sumWorkerPeakRssBytes,layoutWarningGroups,workerThroughputs:workers.map(w=>w.data.videosPerHour),workerP95Ms:workers.map(w=>w.data.perVideoMs.p95),reports:workers.map(w=>path.relative(process.cwd(),w.report))};
  matrix.push(result);console.log(JSON.stringify(result));
  await new Promise(r=>setTimeout(r,1000));
}
const baseline=matrix.find(x=>x.concurrency===1)||matrix[0];
for(const x of matrix){x.speedupVsC1=+(x.videosPerHour/baseline.videosPerHour).toFixed(3);x.parallelEfficiency=+(x.videosPerHour/(baseline.videosPerHour*x.concurrency)).toFixed(3);}
const best=[...matrix].sort((a,b)=>b.videosPerHour-a.videosPerHour)[0],cpu=os.cpus();
const out={schema:'framewright-e10-concurrency-v1',host:{platform:process.platform,arch:process.arch,node:process.version,cpus:cpu.length,cpuModel:cpu[0]?.model||null,totalMemoryBytes:os.totalmem()},totalVideosPerCase:totalVideos,cases:matrix,bestConcurrency:best.concurrency,bestVideosPerHour:best.videosPerHour,bestSpeedupVsC1:best.speedupVsC1};
fs.writeFileSync(path.join(outDir,'matrix.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
