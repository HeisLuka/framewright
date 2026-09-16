#!/usr/bin/env node
// Benchmark complete cold video jobs: every job starts its own Node + Chromium process.
// HTML=... PAYLOAD=... node benchmark-cold-worker.mjs [out.json] [jobs=12] [concurrency=1] [width=1080] [bitrate=1200000]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { startRssSampler, durationStats } from './worker-bench-util.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const [,,outArg='cold-worker.json',jobsS='12',concurrencyS='1',widthS='1080',bitrateS='1200000']=process.argv;
const out=path.resolve(outArg),jobs=Math.max(1,+jobsS),concurrency=Math.max(1,+concurrencyS),width=+widthS,bitrate=+bitrateS;
const html=process.env.HTML,payload=process.env.PAYLOAD;
if(!html||!payload){console.error('HTML and PAYLOAD are required');process.exit(2);}
const tmp=path.resolve(process.env.TMP_DIR||`.lab-cold-c${concurrency}`);fs.rmSync(tmp,{recursive:true,force:true});fs.mkdirSync(tmp,{recursive:true});
const renderScript=path.join(HERE,'render-webcodecs.mjs');
const sampler=startRssSampler(200),batchT0=performance.now();
let next=0,failed=0;const rows=[];
function runJob(index,workerId){return new Promise(resolve=>{
  const seed=1000+index,mp4=path.join(tmp,`job-${String(index).padStart(3,'0')}.mp4`),report=path.join(tmp,`job-${String(index).padStart(3,'0')}.json`);
  const t0=performance.now();let stdout='',stderr='';
  const cp=spawn(process.execPath,[renderScript,mp4,String(seed),String(width),String(bitrate)],{env:{...process.env,REPORT_OUT:report},stdio:['ignore','pipe','pipe']});
  cp.stdout.on('data',d=>{if(stdout.length<200000)stdout+=d;});cp.stderr.on('data',d=>{if(stderr.length<200000)stderr+=d;});
  cp.on('exit',(code,signal)=>{
    const wallMs=performance.now()-t0;
    if(code!==0){failed++;rows.push({index,workerId,seed,wallMs:+wallMs.toFixed(3),failed:true,code,signal,stderr:stderr.slice(-4000)});resolve();return;}
    let r=null;try{r=JSON.parse(fs.readFileSync(report,'utf8'));}catch(e){failed++;rows.push({index,workerId,seed,wallMs:+wallMs.toFixed(3),failed:true,error:String(e)});resolve();return;}
    rows.push({index,workerId,seed,wallMs:+wallMs.toFixed(3),reportedTotalMs:r.totalRunMs,browserWallMs:r.browser?.browserWallMs,renderMs:r.browser?.renderMs,videoFrameMs:r.browser?.videoFrameMs,encodedBytes:r.browser?.encodedBytes,mp4Bytes:r.output?.mp4Bytes,muxMs:r.node?.muxMs,chromeLaunchMs:r.startup?.chromeLaunchMs,pageLoadMs:r.startup?.pageLoadMs,failed:false});
    fs.rmSync(mp4,{force:true});fs.rmSync(report,{force:true});resolve();
  });
});}
async function worker(workerId){while(true){const i=next++;if(i>=jobs)return;await runJob(i,workerId);}}
await Promise.all(Array.from({length:concurrency},(_,i)=>worker(i)));
const batchMs=performance.now()-batchT0,memory=sampler.stop();
rows.sort((a,b)=>a.index-b.index);const good=rows.filter(r=>!r.failed),lat=good.map(r=>r.wallMs);
const summary={schema:'framewright-cold-worker-benchmark-v1',createdAt:new Date().toISOString(),mode:'cold-process-per-video',host:{platform:process.platform,arch:process.arch,node:process.version,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model||null,totalMemoryBytes:os.totalmem()},config:{html:path.resolve(html),payload:path.resolve(payload),jobs,concurrency,width,bitrate},batch:{wallMs:+batchMs.toFixed(3),videosSucceeded:good.length,videosFailed:failed,videosPerHour:batchMs>0?+((good.length*3600000)/batchMs).toFixed(3):0,latency:durationStats(lat)},memory,jobs:rows};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(summary,null,2));fs.rmSync(tmp,{recursive:true,force:true});console.log(JSON.stringify(summary,null,2));if(failed)process.exit(1);
