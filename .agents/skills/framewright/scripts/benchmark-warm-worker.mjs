#!/usr/bin/env node
// Benchmark a long-lived Chromium worker with N warm pages processing complete videos.
// HTML=... PAYLOAD=... node benchmark-warm-worker.mjs [out.json] [jobs=12] [concurrency=1] [width=1080] [bitrate=1200000]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { startRssSampler, durationStats } from './worker-bench-util.mjs';

const [,,outArg='warm-worker.json',jobsS='12',concurrencyS='1',widthS='1080',bitrateS='1200000']=process.argv;
const out=path.resolve(outArg),jobs=Math.max(1,+jobsS),concurrency=Math.max(1,+concurrencyS),width=+widthS,bitrate=+bitrateS;
const html=path.resolve(process.env.HTML||'index.html'),payloadPath=path.resolve(process.env.PAYLOAD||'payload.json');
if(!fs.existsSync(html)||!fs.existsSync(payloadPath)){console.error('HTML and PAYLOAD must exist');process.exit(2);}
const payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'));
const tmp=path.resolve(process.env.TMP_DIR||`.lab-warm-c${concurrency}`);fs.rmSync(tmp,{recursive:true,force:true});fs.mkdirSync(tmp,{recursive:true});

const root=path.dirname(html),htmlName=path.basename(html);
const mime={'.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=http.createServer((req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost'),rel=u.pathname==='/'?htmlName:decodeURIComponent(u.pathname.replace(/^\//,'')),file=path.resolve(root,rel);
    if(!(file===root||file.startsWith(root+path.sep))||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('not found');return;}
    res.writeHead(200,{'content-type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res);
  }catch(e){res.writeHead(500);res.end(String(e));}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port,pageUrl=`http://127.0.0.1:${port}/${htmlName}?f=0&w=320&s=7`;

function muxH264(buffer,outPath,fps){return new Promise((resolve,reject)=>{
  const setts=`setts=time_base=1/${fps}:pts=N:dts=N:duration=1`,args=['-hide_banner','-loglevel','error','-y','-f','h264','-r',String(fps),'-i','pipe:0','-c:v','copy','-bsf:v',setts,'-video_track_timescale',String(Math.round(fps*1000)),'-movflags','+faststart',outPath];
  const t0=performance.now(),cp=spawn('ffmpeg',args,{stdio:['pipe','ignore','pipe']});let err='';cp.stderr.on('data',d=>{if(err.length<20000)err+=d;});
  cp.on('error',reject);cp.on('exit',code=>code===0?resolve(performance.now()-t0):reject(new Error(err||`ffmpeg exit ${code}`)));cp.stdin.end(buffer);
});}

const sampler=startRssSampler(200),setupT0=performance.now();
const browserArgs=['--allow-file-access-from-files'];if(process.env.CI)browserArgs.push('--no-sandbox','--disable-setuid-sandbox');
const launchT0=performance.now(),browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:browserArgs}),chromeLaunchMs=performance.now()-launchT0;
async function initPage(workerId){
  const t0=performance.now(),p=await browser.newPage();p.on('pageerror',e=>console.error(`PAGE ERROR w${workerId}`,e.message));
  await p.evaluateOnNewDocument(v=>{window.FRAMEWRIGHT_PAYLOAD=v;},payload);await p.goto(pageUrl,{waitUntil:'load',timeout:120000});await p.waitForFunction('window.__ready===true',{timeout:120000});
  const err=await p.evaluate(()=>window.__bootError||null);if(err)throw new Error(err);return{page:p,initMs:performance.now()-t0};
}
const initialized=await Promise.all(Array.from({length:concurrency},(_,i)=>initPage(i))),setupMs=performance.now()-setupT0;
const codecCandidates=['avc1.4d002a','avc1.42002a','avc1.4d0028','avc1.420028'];

async function encodeOnPage(page,seed){
  return await page.evaluate(async({seed,width,bitrate,codecCandidates})=>{
    const canvas=document.getElementById('c'),total=window.RISO.total,fps=window.RISO.fps||30,height=Math.round(width*16/9/2)*2;
    let selected=null;for(const codec of codecCandidates){const config={codec,width,height,bitrate,framerate:fps,bitrateMode:'variable',latencyMode:'quality',avc:{format:'annexb'}};try{const s=await VideoEncoder.isConfigSupported(config);if(s.supported){selected=s.config||config;break;}}catch{}}
    if(!selected)throw new Error('no supported H.264 WebCodecs config');
    const chunks=[];let totalBytes=0,encoderError=null;
    const enc=new VideoEncoder({output(chunk){const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);chunks.push(bytes);totalBytes+=bytes.length;},error(e){encoderError=String(e);}});enc.configure(selected);
    const original=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(){return'data:,';};
    let renderMs=0,videoFrameMs=0,enqueueMs=0,maxQueue=0;const t0=performance.now();
    try{
      for(let n=0;n<total;n++){
        let t=performance.now();window.RISO.frame(n,width,seed);renderMs+=performance.now()-t;
        t=performance.now();const vf=new VideoFrame(canvas,{timestamp:Math.round(n*1_000_000/fps),duration:Math.round(1_000_000/fps)});videoFrameMs+=performance.now()-t;
        t=performance.now();enc.encode(vf,{keyFrame:n===0||n%(fps*4)===0});enqueueMs+=performance.now()-t;vf.close();maxQueue=Math.max(maxQueue,enc.encodeQueueSize);
        while(enc.encodeQueueSize>8)await new Promise(resolve=>setTimeout(resolve,0));
      }
      await enc.flush();
    }finally{HTMLCanvasElement.prototype.toDataURL=original;enc.close();}
    const browserWallMs=performance.now()-t0;if(encoderError)throw new Error(encoderError);
    const all=new Uint8Array(totalBytes);let off=0;for(const c of chunks){all.set(c,off);off+=c.length;}
    const b64T0=performance.now();let binary='';const STEP=0x8000;for(let i=0;i<all.length;i+=STEP)binary+=String.fromCharCode(...all.subarray(i,i+STEP));const base64=btoa(binary),base64Ms=performance.now()-b64T0;
    return{base64,meta:{total,fps,width,height,encodedBytes:totalBytes,browserWallMs,renderMs,videoFrameMs,enqueueMs,base64Ms,maxQueue,codec:selected.codec}};
  },{seed,width,bitrate,codecCandidates});
}

let next=0,failed=0;const rows=[],batchT0=performance.now();
async function worker(workerId,page){
  while(true){
    const index=next++;if(index>=jobs)return;const seed=1000+index,jobT0=performance.now(),evalT0=performance.now();
    try{
      const r=await encodeOnPage(page,seed),evaluateMs=performance.now()-evalT0,decodeT0=performance.now(),buf=Buffer.from(r.base64,'base64'),decodeMs=performance.now()-decodeT0,mp4=path.join(tmp,`job-${String(index).padStart(3,'0')}.mp4`),muxMs=await muxH264(buf,mp4,r.meta.fps),mp4Bytes=fs.statSync(mp4).size;
      rows.push({index,workerId,seed,wallMs:+(performance.now()-jobT0).toFixed(3),evaluateMs:+evaluateMs.toFixed(3),browserWallMs:r.meta.browserWallMs,renderMs:r.meta.renderMs,videoFrameMs:r.meta.videoFrameMs,enqueueMs:r.meta.enqueueMs,encodedBytes:r.meta.encodedBytes,decodeMs:+decodeMs.toFixed(3),muxMs:+muxMs.toFixed(3),mp4Bytes,failed:false});fs.rmSync(mp4,{force:true});
    }catch(e){failed++;rows.push({index,workerId,seed,wallMs:+(performance.now()-jobT0).toFixed(3),failed:true,error:String(e)});}
  }
}
await Promise.all(initialized.map((x,i)=>worker(i,x.page)));
const batchMs=performance.now()-batchT0;for(const x of initialized)await x.page.close();await browser.close();await new Promise(resolve=>server.close(resolve));const memory=sampler.stop();
rows.sort((a,b)=>a.index-b.index);const good=rows.filter(r=>!r.failed),lat=good.map(r=>r.wallMs),steadyVph=batchMs>0?(good.length*3600000)/batchMs:0,amortizedMs=setupMs+batchMs;
const summary={schema:'framewright-warm-worker-benchmark-v1',createdAt:new Date().toISOString(),mode:'warm-browser-pages',host:{platform:process.platform,arch:process.arch,node:process.version,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model||null,totalMemoryBytes:os.totalmem()},config:{html,payload:payloadPath,jobs,concurrency,width,bitrate},setup:{totalMs:+setupMs.toFixed(3),chromeLaunchMs:+chromeLaunchMs.toFixed(3),pageInitMs:initialized.map((x,i)=>({workerId:i,ms:+x.initMs.toFixed(3)}))},batch:{wallMs:+batchMs.toFixed(3),amortizedWallMs:+amortizedMs.toFixed(3),videosSucceeded:good.length,videosFailed:failed,steadyVideosPerHour:+steadyVph.toFixed(3),amortizedVideosPerHour:amortizedMs>0?+((good.length*3600000)/amortizedMs).toFixed(3):0,latency:durationStats(lat)},memory,jobs:rows};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(summary,null,2));fs.rmSync(tmp,{recursive:true,force:true});console.log(JSON.stringify(summary,null,2));if(failed)process.exit(1);
