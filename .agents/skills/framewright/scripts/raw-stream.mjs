#!/usr/bin/env node
// E05: render Canvas frames in Chromium, send raw RGBA over local binary HTTP,
// and stream directly into FFmpeg stdin. No PNG, dataURL, base64, or temp frames.
//
// HTML=examples/book-ad-v0/index.html PAYLOAD=examples/book-ad-v0/payload.example.json \
//   node raw-stream.mjs [out=raw-stream.mp4] [seed=7] [width=1080]
// Env: PRESET=veryfast CRF=22 MAXRATE=14M BUFSIZE=28M REPORT=raw-stream.json
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const [,, outArg='raw-stream.mp4', seedArg='7', widthArg='1080'] = process.argv;
const out=path.resolve(outArg), seed=+seedArg, width=+widthArg;
const html=path.resolve(process.env.HTML||'index.html');
const payloadPath=process.env.PAYLOAD?path.resolve(process.env.PAYLOAD):null;
const reportPath=path.resolve(process.env.REPORT||'raw-stream.json');
const preset=process.env.PRESET||'veryfast', crf=+(process.env.CRF||22), maxrate=process.env.MAXRATE||'14M', bufsize=process.env.BUFSIZE||'28M';
if(!fs.existsSync(html)){console.error(`no HTML: ${html}`);process.exit(1)}
let payload=null;if(payloadPath){try{payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'))}catch(e){console.error(`bad payload: ${e.message}`);process.exit(1)}}
fs.mkdirSync(path.dirname(out),{recursive:true});fs.rmSync(out,{force:true});

const browserArgs=['--allow-file-access-from-files'];if(process.env.CI)browserArgs.push('--no-sandbox','--disable-setuid-sandbox');
const totalT0=performance.now();
const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:browserArgs});
const page=await browser.newPage();
page.on('pageerror',e=>console.error('PAGE ERROR',e.message));
if(payload)await page.evaluateOnNewDocument(v=>{window.FRAMEWRIGHT_PAYLOAD=v},payload);
const url='file://'+html+`?f=0&w=320&s=${seed}`;
await page.goto(url,{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});
const bootError=await page.evaluate(()=>window.__bootError||null);if(bootError)throw new Error(bootError);
const meta=await page.evaluate(()=>({total:window.RISO.total,fps:window.RISO.fps||30}));
const height=Math.round(width*16/9/2)*2, frameBytes=width*height*4;

const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${width}x${height}`,'-r',String(meta.fps),'-i','-','-c:v','libx264','-preset',preset,'-crf',String(crf),'-maxrate',maxrate,'-bufsize',bufsize,'-pix_fmt','yuv420p','-movflags','+faststart',out],{stdio:['pipe','inherit','inherit']});
let receivedFrames=0,receivedBytes=0,serverError=null;
const server=http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return}
  if(req.method!=='POST'){res.statusCode=405;res.end();return}
  let bytes=0;let failed=false;
  req.on('data',chunk=>{
    bytes+=chunk.length;receivedBytes+=chunk.length;
    if(!ff.stdin.write(chunk)){req.pause();ff.stdin.once('drain',()=>req.resume())}
  });
  req.on('end',()=>{
    if(bytes!==frameBytes){failed=true;serverError=`frame ${receivedFrames}: expected ${frameBytes} bytes, got ${bytes}`}
    if(!failed)receivedFrames++;
    res.statusCode=failed?500:204;res.end(failed?serverError:undefined);
  });
  req.on('error',e=>{serverError=e.message;res.statusCode=500;res.end(e.message)});
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
const address=server.address(), endpoint=`http://127.0.0.1:${address.port}/frame`;

await page.evaluate(()=>{
  window.__FW_RAW_SEND=async function(n,w,s,endpoint){
    const t0=performance.now();
    const target=document.getElementById('c');
    renderFrame(n,w,s,target);
    const renderMs=performance.now()-t0;
    const t1=performance.now();
    const g=target.getContext('2d',{willReadFrequently:true});
    const data=g.getImageData(0,0,target.width,target.height).data;
    const readbackMs=performance.now()-t1;
    const t2=performance.now();
    const r=await fetch(endpoint,{method:'POST',mode:'cors',body:data.buffer});
    if(!r.ok)throw new Error(`raw transport HTTP ${r.status}: ${await r.text()}`);
    return{renderMs,readbackMs,sendMs:performance.now()-t2,bytes:data.byteLength};
  };
});

const samples=[];const loopT0=performance.now();
for(let n=0;n<meta.total;n++){
  const t0=performance.now();
  const s=await page.evaluate((n,w,seed,endpoint)=>window.__FW_RAW_SEND(n,w,seed,endpoint),n,width,seed,endpoint);
  samples.push({frame:n,wallMs:+(performance.now()-t0).toFixed(3),renderMs:+s.renderMs.toFixed(3),readbackMs:+s.readbackMs.toFixed(3),sendMs:+s.sendMs.toFixed(3),bytes:s.bytes});
  if((n+1)%60===0)console.log(`${n+1}/${meta.total}`);
}
const loopMs=performance.now()-loopT0;
await browser.close();
await new Promise(resolve=>server.close(resolve));
if(serverError)throw new Error(serverError);
ff.stdin.end();
const ffCode=await new Promise((resolve,reject)=>{ff.once('error',reject);ff.once('close',resolve)});
if(ffCode!==0)throw new Error(`ffmpeg exited ${ffCode}`);
if(receivedFrames!==meta.total)throw new Error(`expected ${meta.total} frames, received ${receivedFrames}`);

function stat(key){const v=samples.map(x=>x[key]).sort((a,b)=>a-b),sum=v.reduce((a,b)=>a+b,0),pick=p=>v[Math.min(v.length-1,Math.floor((v.length-1)*p))];return{mean:+(sum/v.length).toFixed(3),p50:+pick(.5).toFixed(3),p95:+pick(.95).toFixed(3),max:+v.at(-1).toFixed(3)}}
const report={schema:'framewright-raw-stream-v1',createdAt:new Date().toISOString(),config:{html,payloadPath,seed,width,height,fps:meta.fps,totalFrames:meta.total,frameBytes,preset,crf,maxrate,bufsize},summary:{loopMs:+loopMs.toFixed(3),totalMs:+(performance.now()-totalT0).toFixed(3),fps:+(meta.total*1000/loopMs).toFixed(3),receivedFrames,receivedBytes,outputBytes:fs.statSync(out).size,stages:{wallMs:stat('wallMs'),renderMs:stat('renderMs'),readbackMs:stat('readbackMs'),sendMs:stat('sendMs')}},samples};
fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify(report.summary,null,2));
