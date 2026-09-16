#!/usr/bin/env node
// E08: representative real RIS TV stage profile inside the pinned worker.
// Samples each plate at deterministic positions after one cold frame initializes
// resolution-dependent CRT caches. PNG transport is measured but excluded from
// the estimated renderer compute because production uses WebCodecs.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

const [,, outArg='ris-tv-profile.json', widthArg='1920', seedArg='7'] = process.argv;
const out=path.resolve(outArg), width=+widthArg, seed=+seedArg;
const html=path.resolve(process.env.HTML||'examples/ris-tv/index.html');
if(!fs.existsSync(html)) throw new Error(`missing HTML: ${html}`);
fs.mkdirSync(path.dirname(out),{recursive:true});

const browserArgs=['--allow-file-access-from-files'];
if(process.env.CI||process.env.FRAMEWRIGHT_NO_SANDBOX) browserArgs.push('--no-sandbox','--disable-setuid-sandbox');
const launchT0=performance.now();
const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:browserArgs});
const chromeLaunchMs=performance.now()-launchT0;
const page=await browser.newPage();
page.on('pageerror',e=>console.error('PAGE ERROR',e.message));
const url='file://'+html+`?f=0&w=320&s=${seed}`;
const loadT0=performance.now();
await page.goto(url,{waitUntil:'load',timeout:120000});
await page.waitForFunction('window.__ready===true',{timeout:120000});
const pageLoadMs=performance.now()-loadT0;

const meta=await page.evaluate(()=>({total:window.RISO.total,fps:30,plates:window.RISO.plates}));
await page.evaluate(()=>{
  const state={last:null}; window.__RIS_PROFILE=state;
  const crt0=window.crt;
  window.crt=function(...args){const t=performance.now();try{return crt0.apply(this,args)}finally{if(state.last)state.last.crtMs+=performance.now()-t;}};
  const toDataURL0=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL=function(...args){const t=performance.now();try{return toDataURL0.apply(this,args)}finally{if(state.last)state.last.pngEncodeMs+=performance.now()-t;}};
  const frame0=window.RISO.frame.bind(window.RISO);
  window.RISO.frame=function(...args){state.last={browserTotalMs:0,crtMs:0,pngEncodeMs:0};const t=performance.now();const result=frame0(...args);state.last.browserTotalMs=performance.now()-t;state.last.sceneMs=Math.max(0,state.last.browserTotalMs-state.last.crtMs-state.last.pngEncodeMs);return result;};
});

async function measure(frame,kind,plate,local){
  const wallT0=performance.now();
  const r=await page.evaluate((f,w,s)=>{const dataUrl=window.RISO.frame(f,w,s);return{p:window.__RIS_PROFILE.last,pngChars:dataUrl.length};},frame,width,seed);
  return{kind,plate,frame,local,nodeWallMs:+(performance.now()-wallT0).toFixed(3),browserTotalMs:+r.p.browserTotalMs.toFixed(3),sceneMs:+r.p.sceneMs.toFixed(3),crtMs:+r.p.crtMs.toFixed(3),pngEncodeMs:+r.p.pngEncodeMs.toFixed(3),pngChars:r.pngChars};
}

// One cold render measures resolution-dependent map allocation. All production
// estimates below use warm samples because the map is cached for the worker page.
const cold=await measure(0,'cold','cold',0);
const samples=[]; let start=0;
for(const p of meta.plates){
  const locals=[0,Math.round((p.len-1)*.25),Math.round((p.len-1)*.5),Math.round((p.len-1)*.75),p.len-1];
  for(const local of [...new Set(locals)]) samples.push(await measure(start+local,'sample',p.name,local));
  start+=p.len;
}

function stats(v){const s=[...v].sort((a,b)=>a-b),sum=v.reduce((a,b)=>a+b,0),pick=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))];return{count:v.length,mean:+(sum/v.length).toFixed(3),p50:+pick(.5).toFixed(3),p95:+pick(.95).toFixed(3),min:+s[0].toFixed(3),max:+s.at(-1).toFixed(3)};}
const byPlate=[]; start=0;
for(const p of meta.plates){
  const s=samples.filter(x=>x.plate===p.name);
  const render=s.map(x=>x.sceneMs+x.crtMs), scene=s.map(x=>x.sceneMs), crt=s.map(x=>x.crtMs);
  byPlate.push({name:p.name,len:p.len,startFrame:start,sampleFrames:s.map(x=>x.frame),renderMs:stats(render),sceneMs:stats(scene),crtMs:stats(crt),estimatedPlateComputeMs:+(stats(render).mean*p.len).toFixed(1)});
  start+=p.len;
}
const estimatedFullComputeMs=byPlate.reduce((a,p)=>a+p.estimatedPlateComputeMs,0);
const allRender=samples.map(x=>x.sceneMs+x.crtMs);
const report={
  schema:'framewright-ris-tv-sampled-profile-v1',createdAt:new Date().toISOString(),
  config:{html,width,seed,totalFrames:meta.total,fps:meta.fps,durationSeconds:meta.total/meta.fps,samplesPerPlate:5},
  host:{platform:process.platform,arch:process.arch,node:process.version,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model||null,totalMemoryBytes:os.totalmem()},
  startup:{chromeLaunchMs:+chromeLaunchMs.toFixed(3),pageLoadMs:+pageLoadMs.toFixed(3)},
  cold,
  summary:{sampleCount:samples.length,renderMs:stats(allRender),sceneMs:stats(samples.map(x=>x.sceneMs)),crtMs:stats(samples.map(x=>x.crtMs)),pngEncodeMs:stats(samples.map(x=>x.pngEncodeMs)),estimatedFullComputeMs:+estimatedFullComputeMs.toFixed(1),estimatedFullComputeSeconds:+(estimatedFullComputeMs/1000).toFixed(3),estimatedComputeFps:+(meta.total*1000/estimatedFullComputeMs).toFixed(3)},
  byPlate,samples
};
fs.writeFileSync(out,JSON.stringify(report,null,2));
console.log(JSON.stringify({config:report.config,cold:report.cold,summary:report.summary,byPlate:report.byPlate},null,2));
await browser.close();
