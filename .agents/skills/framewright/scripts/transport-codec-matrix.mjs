#!/usr/bin/env node
// Compare per-frame browser transport codecs on the same deterministic workload.
// HTML=examples/book-ad-v0/index.html PAYLOAD=examples/book-ad-v0/payload.example.json node transport-codec-matrix.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const html=path.resolve(process.env.HTML||'index.html');
const payloadPath=process.env.PAYLOAD?path.resolve(process.env.PAYLOAD):null;
const width=+(process.env.WIDTH||1080), seed=+(process.env.SEED||7), outDir=path.resolve(process.env.OUT_DIR||'transport-matrix');
const modes=[
  {name:'png',mime:'image/png',quality:null,ext:'png'},
  {name:'jpeg95',mime:'image/jpeg',quality:.95,ext:'jpg'},
  {name:'jpeg85',mime:'image/jpeg',quality:.85,ext:'jpg'},
  {name:'webp90',mime:'image/webp',quality:.90,ext:'webp'}
];
if(!fs.existsSync(html)){console.error(`no HTML: ${html}`);process.exit(1)}
let payload=null;if(payloadPath){payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'));}
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});

function stats(v){const s=[...v].sort((a,b)=>a-b),sum=v.reduce((a,b)=>a+b,0),pick=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))];return{mean:+(sum/v.length).toFixed(3),p50:+pick(.5).toFixed(3),p95:+pick(.95).toFixed(3)}}
function run(cmd,args){const t0=performance.now(),r=spawnSync(cmd,args,{encoding:'utf8'});return{status:r.status,wallMs:+(performance.now()-t0).toFixed(3),stdout:r.stdout||'',stderr:r.stderr||''}}
function metric(text,re){let m,last=null;while((m=re.exec(text)))last=+m[1];return last}

const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:['--allow-file-access-from-files',...(process.env.CI?['--no-sandbox','--disable-setuid-sandbox']:[])]});
const rows=[];let totalFrames=0,fps=30;
for(const mode of modes){
  const page=await browser.newPage();
  if(payload) await page.evaluateOnNewDocument(v=>{window.FRAMEWRIGHT_PAYLOAD=v},payload);
  const url='file://'+html+`?f=0&w=320&s=${seed}`;
  await page.goto(url,{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});
  const meta=await page.evaluate(()=>({total:window.RISO.total,fps:window.RISO.fps||30}));totalFrames=meta.total;fps=meta.fps;
  await page.evaluate(({mime,quality})=>{
    const original=HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL=function(){return quality==null?original.call(this,mime):original.call(this,mime,quality)};
  },mode);
  const dir=path.join(outDir,mode.name);fs.mkdirSync(dir,{recursive:true});
  const inner=[],wall=[],decode=[],write=[];let bytes=0;
  for(let n=0;n<meta.total;n++){
    const t0=performance.now();
    const r=await page.evaluate((n,w,s)=>{const t=performance.now();const u=window.RISO.frame(n,w,s);return{u,innerMs:performance.now()-t}},n,width,seed);
    const evalDone=performance.now();
    const t1=performance.now(),buf=Buffer.from(r.u.split(',')[1],'base64');decode.push(performance.now()-t1);
    const t2=performance.now();fs.writeFileSync(path.join(dir,`f${String(n).padStart(5,'0')}.${mode.ext}`),buf);write.push(performance.now()-t2);
    inner.push(r.innerMs);wall.push(evalDone-t0);bytes+=buf.length;
  }
  rows.push({mode:mode.name,mime:mode.mime,quality:mode.quality,ext:mode.ext,totalBytes:bytes,innerMs:stats(inner),evaluateWallMs:stats(wall),base64DecodeMs:stats(decode),diskWriteMs:stats(write)});
  await page.close();
}
await browser.close();

for(const row of rows){
  const video=path.join(outDir,`${row.mode}.mp4`), input=path.join(outDir,row.mode,`f%05d.${row.ext}`);
  const enc=run('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate',String(fps),'-i',input,'-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',video]);
  row.encodeMs=enc.wallMs;row.videoBytes=enc.status===0?fs.statSync(video).size:null;row.video=video;
}
const ref=path.join(outDir,'png.mp4');
for(const row of rows){
  if(row.mode==='png'){row.ssim=1;row.psnr=null;continue;}
  const q=run('ffmpeg',['-hide_banner','-i',ref,'-i',row.video,'-lavfi','[0:v]setpts=PTS-STARTPTS[ref];[1:v]setpts=PTS-STARTPTS[test];[ref][test]ssim','-f','null','-']);
  const p=run('ffmpeg',['-hide_banner','-i',ref,'-i',row.video,'-lavfi','[0:v]setpts=PTS-STARTPTS[ref];[1:v]setpts=PTS-STARTPTS[test];[ref][test]psnr','-f','null','-']);
  row.ssim=metric(q.stderr,/All:([0-9.]+)/g);row.psnr=metric(p.stderr,/average:([0-9.]+)/g);
}
const report={schema:'framewright-transport-codec-matrix-v1',createdAt:new Date().toISOString(),config:{html,payloadPath,width,seed,totalFrames,fps},rows};
fs.writeFileSync(path.join(outDir,'matrix.json'),JSON.stringify(report,null,2));
let md='| mode | frame MB | inner ms | eval wall ms | encode s | MP4 KiB | SSIM vs PNG MP4 | PSNR |\n|---|---:|---:|---:|---:|---:|---:|---:|\n';
for(const r of rows)md+=`| ${r.mode} | ${(r.totalBytes/1024/1024).toFixed(2)} | ${r.innerMs.mean} | ${r.evaluateWallMs.mean} | ${(r.encodeMs/1000).toFixed(3)} | ${(r.videoBytes/1024).toFixed(1)} | ${r.ssim??''} | ${r.psnr??''} |\n`;
fs.writeFileSync(path.join(outDir,'matrix.md'),md);console.log(md);
