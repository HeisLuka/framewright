#!/usr/bin/env node
// Stage-profiler variant of render.mjs. It does not modify the video HTML.
// node profile-render.mjs [dir=frames] [seed=7] [width=1920] [tabs=5]
// Env: HTML, PAYLOAD(optional JSON), AR, START, END, RESUME, PROFILE_OUT=render-profile.json
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const [,, dir='frames', seedS='7', widthS='1920', tabsS='5'] = process.argv;
const seed=+seedS, width=+widthS, tabs=Math.max(1,+tabsS);
const html=path.resolve(process.env.HTML || 'index.html');
const payloadPath=process.env.PAYLOAD ? path.resolve(process.env.PAYLOAD) : null;
const profileOut=path.resolve(process.env.PROFILE_OUT || 'render-profile.json');
if(!fs.existsSync(html)){ console.error(`no such file: ${html} (set HTML=path)`); process.exit(1); }
let injectedPayload=null,payloadSha256=null;
if(payloadPath){
  if(!fs.existsSync(payloadPath)){ console.error(`no such payload: ${payloadPath}`); process.exit(1); }
  const raw=fs.readFileSync(payloadPath,'utf8');
  try{injectedPayload=JSON.parse(raw);}catch(e){console.error(`bad payload JSON: ${e.message}`);process.exit(1);}
  payloadSha256=createHash('sha256').update(raw).digest('hex');
}
fs.mkdirSync(dir,{recursive:true});
const url='file://'+html+`?f=0&w=320&s=${seed}`+(process.env.AR?`&ar=${process.env.AR}`:'');
const runT0=performance.now(), usage0=process.resourceUsage();

const profile={
  schema:'framewright-render-profile-v1', createdAt:new Date().toISOString(),
  config:{html,payloadPath,payloadSha256,dir:path.resolve(dir),seed,width,tabs,ar:process.env.AR||null,start:+(process.env.START||0),endRequested:process.env.END==null?null:+process.env.END,resume:Boolean(process.env.RESUME)},
  host:{platform:process.platform,arch:process.arch,node:process.version,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model||null,totalMemoryBytes:os.totalmem()},
  startup:{chromeLaunchMs:0,metadataPageMs:0,workerPageMs:[]}, samples:[]
};

function deltaUsage(a,b){
  const keys=['userCPUTime','systemCPUTime','minorPageFault','majorPageFault','fsRead','fsWrite','voluntaryContextSwitches','involuntaryContextSwitches'];
  return Object.fromEntries(keys.map(k=>[k,(b[k]??0)-(a[k]??0)]));
}
function stats(v){
  if(!v.length) return {count:0,sum:0,mean:0,min:0,p50:0,p95:0,max:0};
  const s=[...v].sort((a,b)=>a-b), sum=v.reduce((a,b)=>a+b,0), pick=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))];
  return {count:v.length,sum:+sum.toFixed(3),mean:+(sum/v.length).toFixed(3),min:+s[0].toFixed(3),p50:+pick(.5).toFixed(3),p95:+pick(.95).toFixed(3),max:+s.at(-1).toFixed(3)};
}
async function installProfiler(p){
  return await p.evaluate(()=>{
    if(window.__FW_PROFILE_INSTALLED) return window.__FW_PROFILE_STATE?.postFunctions||[];
    const state={last:null,postFunctions:[]}; window.__FW_PROFILE_STATE=state;
    const wrap=name=>{ const original=window[name]; if(typeof original!=='function') return; window[name]=function(...args){ const t0=performance.now(); try{return original.apply(this,args);} finally{if(state.last) state.last.postMs+=performance.now()-t0;} }; state.postFunctions.push(name); };
    wrap('post'); wrap('crt');
    const toDataURL=HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL=function(...args){ const t0=performance.now(); try{return toDataURL.apply(this,args);} finally{if(state.last) state.last.pngEncodeMs+=performance.now()-t0;} };
    const frame=window.RISO.frame.bind(window.RISO);
    window.RISO.frame=function(...args){ state.last={browserTotalMs:0,postMs:0,pngEncodeMs:0,sceneEngineMs:0}; const t0=performance.now(); const out=frame(...args); state.last.browserTotalMs=performance.now()-t0; state.last.sceneEngineMs=Math.max(0,state.last.browserTotalMs-state.last.postMs-state.last.pngEncodeMs); return out; };
    window.__FW_PROFILE_INSTALLED=true; return [...state.postFunctions];
  });
}

let t=performance.now();
const b=await puppeteer.launch({headless:true,protocolTimeout:600000,args:['--allow-file-access-from-files']});
profile.startup.chromeLaunchMs=+(performance.now()-t).toFixed(3);
async function preparedPage(){
  const p=await b.newPage();
  p.on('pageerror',e=>console.error('PAGE ERROR',e.message));
  if(injectedPayload!==null) await p.evaluateOnNewDocument(v=>{window.FRAMEWRIGHT_PAYLOAD=v;},injectedPayload);
  return p;
}
async function loadPreparedPage(){
  const p=await preparedPage();
  await p.goto(url,{waitUntil:'load',timeout:120000});
  await p.waitForFunction('window.__ready===true',{timeout:120000});
  const bootError=await p.evaluate(()=>window.__bootError||null); if(bootError) throw new Error(bootError);
  return p;
}
t=performance.now();
const p0=await loadPreparedPage();
const meta=await p0.evaluate(()=>({total:window.RISO.total,fps:window.RISO.fps||30,plates:window.RISO.plates})); await p0.close();
profile.startup.metadataPageMs=+(performance.now()-t).toFixed(3);
const START=+(process.env.START||0), END=Math.min(meta.total,+(process.env.END||meta.total)), count=END-START;
Object.assign(profile.config,{total:meta.total,fps:meta.fps,end:END,count}); profile.plates=meta.plates;
console.log(`frames ${meta.total} (${(meta.total/meta.fps).toFixed(1)} s), rendering ${START}..${END-1}, tabs ${tabs}, width ${width}, seed ${seed}`);
console.log(meta.plates.map(p=>`${p.name}:${p.len}`).join('  '));

let next=START,done=0,failed=0; const renderT0=performance.now();
async function worker(workerId){
  const initT0=performance.now(), p=await loadPreparedPage();
  const postFunctions=await installProfiler(p); profile.startup.workerPageMs.push({workerId,ms:+(performance.now()-initT0).toFixed(3),postFunctions});
  while(true){
    const n=next++; if(n>=END) break; const out=path.join(dir,`f${String(n).padStart(5,'0')}.png`);
    if(process.env.RESUME&&fs.existsSync(out)){done++;continue;}
    try{
      const frameT0=performance.now(), evalT0=performance.now();
      const result=await p.evaluate((n,w,s)=>{ const dataUrl=window.RISO.frame(n,w,s); return {dataUrl,profile:window.__FW_PROFILE_STATE?.last??null}; },n,width,seed);
      const evaluateWallMs=performance.now()-evalT0, u=result.dataUrl, browser=result.profile||{};
      const decodeT0=performance.now(), buf=Buffer.from(u.split(',')[1],'base64'), base64DecodeMs=performance.now()-decodeT0;
      const writeT0=performance.now(); fs.writeFileSync(out,buf); const diskWriteMs=performance.now()-writeT0;
      const browserTotalMs=browser.browserTotalMs||0;
      profile.samples.push({frame:n,workerId,frameWallMs:+(performance.now()-frameT0).toFixed(3),browserTotalMs:+browserTotalMs.toFixed(3),sceneEngineMs:+(browser.sceneEngineMs||0).toFixed(3),postMs:+(browser.postMs||0).toFixed(3),pngEncodeMs:+(browser.pngEncodeMs||0).toFixed(3),cdpTransferMs:+Math.max(0,evaluateWallMs-browserTotalMs).toFixed(3),base64DecodeMs:+base64DecodeMs.toFixed(3),diskWriteMs:+diskWriteMs.toFixed(3),dataUrlChars:u.length,pngBytes:buf.byteLength});
    }catch(e){failed++;console.error('frame',n,'failed:',e.message);}
    done++; if(done%60===0){const el=(performance.now()-renderT0)/1000;console.log(`${done}/${count}  ${el.toFixed(0)} s, ~${(el/done*(count-done)).toFixed(0)} s left`);}
  }
  await p.close();
}
await Promise.all(Array.from({length:tabs},(_,i)=>worker(i))); await b.close();
const renderLoopMs=performance.now()-renderT0;
console.log(`done: ${done-failed} frames in ${(renderLoopMs/1000).toFixed(1)} s${failed?`, ${failed} failed`:''}`);

const stages={};
for(const key of ['frameWallMs','browserTotalMs','sceneEngineMs','postMs','pngEncodeMs','cdpTransferMs','base64DecodeMs','diskWriteMs']) stages[key]=stats(profile.samples.map(s=>s[key]));
profile.summary={framesAttempted:done,framesSucceeded:done-failed,framesFailed:failed,renderLoopMs:+renderLoopMs.toFixed(3),totalRunMs:+(performance.now()-runT0).toFixed(3),fps:renderLoopMs>0?+(((done-failed)*1000)/renderLoopMs).toFixed(3):0,pngBytes:profile.samples.reduce((a,s)=>a+s.pngBytes,0),dataUrlChars:profile.samples.reduce((a,s)=>a+s.dataUrlChars,0),stages,postFunctions:[...new Set(profile.startup.workerPageMs.flatMap(w=>w.postFunctions||[]))]};
const usage1=process.resourceUsage(); profile.nodeResourceUsageDelta=deltaUsage(usage0,usage1); profile.nodeResourceUsageEnd=usage1; profile.nodeMemoryEnd=process.memoryUsage();
fs.mkdirSync(path.dirname(profileOut),{recursive:true}); fs.writeFileSync(profileOut,JSON.stringify(profile,null,2)); console.log(`profile ${profileOut}`);
if(failed) process.exit(1);
