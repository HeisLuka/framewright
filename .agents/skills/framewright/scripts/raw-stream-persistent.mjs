#!/usr/bin/env node
// E06: keep one HTTP request open for the whole video and stream raw RGBA
// from Chromium Canvas into FFmpeg stdin. This removes per-frame request setup.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const [,, outArg='raw-stream-persistent.mp4', seedArg='7', widthArg='1080'] = process.argv;
const out=path.resolve(outArg), seed=+seedArg, width=+widthArg;
const html=path.resolve(process.env.HTML||'index.html');
const payloadPath=process.env.PAYLOAD?path.resolve(process.env.PAYLOAD):null;
const reportPath=path.resolve(process.env.REPORT||'raw-stream-persistent.json');
const preset=process.env.PRESET||'veryfast', crf=+(process.env.CRF||22);
const maxrate=process.env.MAXRATE||'14M', bufsize=process.env.BUFSIZE||'28M';
if(!fs.existsSync(html)){console.error(`no HTML: ${html}`);process.exit(1)}
let payload=null;
if(payloadPath){try{payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'))}catch(e){console.error(`bad payload: ${e.message}`);process.exit(1)}}
fs.mkdirSync(path.dirname(out),{recursive:true}); fs.rmSync(out,{force:true});

const totalT0=performance.now();
const browserArgs=['--allow-file-access-from-files'];
if(process.env.CI)browserArgs.push('--no-sandbox','--disable-setuid-sandbox');
const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:browserArgs});
const page=await browser.newPage();
page.on('pageerror',e=>console.error('PAGE ERROR',e.message));
if(payload)await page.evaluateOnNewDocument(v=>{window.FRAMEWRIGHT_PAYLOAD=v},payload);
await page.goto('file://'+html+`?f=0&w=320&s=${seed}`,{waitUntil:'load',timeout:120000});
await page.waitForFunction('window.__ready===true',{timeout:120000});
const bootError=await page.evaluate(()=>window.__bootError||null); if(bootError)throw new Error(bootError);
const meta=await page.evaluate(()=>({total:window.RISO.total,fps:window.RISO.fps||30}));
const height=Math.round(width*16/9/2)*2, frameBytes=width*height*4, expectedBytes=frameBytes*meta.total;

const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${width}x${height}`,'-r',String(meta.fps),'-i','-','-c:v','libx264','-preset',preset,'-crf',String(crf),'-maxrate',maxrate,'-bufsize',bufsize,'-pix_fmt','yuv420p','-color_range','tv','-color_primaries','bt709','-color_trc','iec61966-2-1','-movflags','+faststart',out],{stdio:['pipe','inherit','inherit']});

let receivedBytes=0, chunks=0, pauseCount=0, drainWaitMs=0, serverError=null;
let streamResolve, streamReject;
const streamDone=new Promise((resolve,reject)=>{streamResolve=resolve;streamReject=reject});
const server=http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return}
  if(req.method!=='POST' || req.url!=='/stream'){res.statusCode=405;res.end();return}
  const requestT0=performance.now();
  let pendingDrain=Promise.resolve();
  req.on('data',chunk=>{
    chunks++; receivedBytes+=chunk.length;
    if(!ff.stdin.write(chunk)){
      pauseCount++; req.pause(); const t=performance.now();
      pendingDrain=new Promise(resolve=>ff.stdin.once('drain',()=>{drainWaitMs+=performance.now()-t;req.resume();resolve()}));
    }
  });
  req.on('end',async()=>{
    try{
      await pendingDrain;
      if(receivedBytes!==expectedBytes)throw new Error(`expected ${expectedBytes} bytes, got ${receivedBytes}`);
      res.statusCode=204; res.end();
      streamResolve({requestMs:performance.now()-requestT0});
    }catch(e){serverError=e.message;res.statusCode=500;res.end(e.message);streamReject(e)}
  });
  req.on('error',e=>{serverError=e.message;streamReject(e)});
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
const endpoint=`http://127.0.0.1:${server.address().port}/stream`;

const browserReport=await page.evaluate(async ({endpoint,total,width,seed})=>{
  const stream=new TransformStream();
  const writer=stream.writable.getWriter();
  const uploadT0=performance.now();
  const uploadPromise=fetch(endpoint,{method:'POST',mode:'cors',body:stream.readable,duplex:'half'});
  const samples=[]; const loopT0=performance.now();
  for(let n=0;n<total;n++){
    const frameT0=performance.now();
    const target=document.getElementById('c');
    const t0=performance.now(); renderFrame(n,width,seed,target); const renderMs=performance.now()-t0;
    const t1=performance.now();
    const g=target.getContext('2d',{willReadFrequently:true});
    const data=g.getImageData(0,0,target.width,target.height).data;
    const readbackMs=performance.now()-t1;
    const t2=performance.now(); await writer.write(data.buffer); const writeWaitMs=performance.now()-t2;
    samples.push({frame:n,wallMs:performance.now()-frameT0,renderMs,readbackMs,writeWaitMs,bytes:data.byteLength});
  }
  await writer.close();
  const response=await uploadPromise;
  if(!response.ok)throw new Error(`persistent raw transport HTTP ${response.status}: ${await response.text()}`);
  return{loopMs:performance.now()-loopT0,uploadMs:performance.now()-uploadT0,samples};
},{endpoint,total:meta.total,width,seed});

const serverReport=await streamDone;
await browser.close();
await new Promise(resolve=>server.close(resolve));
if(serverError)throw new Error(serverError);
ff.stdin.end();
const ffCode=await new Promise((resolve,reject)=>{ff.once('error',reject);ff.once('close',resolve)});
if(ffCode!==0)throw new Error(`ffmpeg exited ${ffCode}`);

function stat(key){const v=browserReport.samples.map(x=>x[key]).sort((a,b)=>a-b);const sum=v.reduce((a,b)=>a+b,0);const pick=p=>v[Math.min(v.length-1,Math.floor((v.length-1)*p))];return{mean:+(sum/v.length).toFixed(3),p50:+pick(.5).toFixed(3),p95:+pick(.95).toFixed(3),max:+v.at(-1).toFixed(3)}}
const totalMs=performance.now()-totalT0;
const report={schema:'framewright-raw-stream-persistent-v1',createdAt:new Date().toISOString(),config:{html,payloadPath,seed,width,height,fps:meta.fps,totalFrames:meta.total,frameBytes,expectedBytes,preset,crf,maxrate,bufsize},summary:{loopMs:+browserReport.loopMs.toFixed(3),uploadMs:+browserReport.uploadMs.toFixed(3),totalMs:+totalMs.toFixed(3),fps:+(meta.total*1000/browserReport.loopMs).toFixed(3),receivedBytes,chunks,pauseCount,drainWaitMs:+drainWaitMs.toFixed(3),serverRequestMs:+serverReport.requestMs.toFixed(3),outputBytes:fs.statSync(out).size,stages:{wallMs:stat('wallMs'),renderMs:stat('renderMs'),readbackMs:stat('readbackMs'),writeWaitMs:stat('writeWaitMs')}},samples:browserReport.samples};
fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify(report.summary,null,2));
