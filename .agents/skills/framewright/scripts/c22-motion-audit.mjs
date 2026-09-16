#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas,Image,GlobalFonts} from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.HTML||process.argv[2]||'examples/book-ad-systems/index-c22-final.html');
const manifestPath=path.resolve(process.env.MANIFEST||process.argv[3]||'examples/book-ad-systems/generated-c22/manifest.json');
const outPath=path.resolve(process.env.AUDIT_REPORT||process.argv[4]||'artifacts/c22/motion-audit.json');
for(const [file,family] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']])if(fs.existsSync(file))GlobalFonts.registerFromPath(file,family);

const html=fs.readFileSync(htmlPath,'utf8'),match=html.match(/<script>([\s\S]*?)<\/script>/i);if(!match)throw new Error('inline template script missing');
const source=match[1],templateDir=path.dirname(htmlPath),manifestDir=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const SAMPLE_FPS=10,SW=54,SH=96,DURATION=12;
const WINDOWS={
  hookEntrance:[[.10,.75]],
  bookEntrance:[[3.10,3.90]],
  ctaEntrance:[[8.10,8.85]],
  hookFocus:[[1.30,1.80]],
  bookFocus:[[5.45,6.30]],
  ctaFocus:[[9.25,9.95]],
  settle:[[.90,1.20],[2.00,2.40],[4.20,5.10],[6.65,7.55],[10.20,11.20]]
};
function cleanPayload(p){const q=structuredClone(p);delete q.motion_density;return JSON.stringify(q);}
function thumb(rgba,w,h){const out=new Uint8Array(SW*SH);let k=0;for(let y=0;y<SH;y++)for(let x=0;x<SW;x++){const sx=Math.min(w-1,Math.floor((x+.5)*w/SW)),sy=Math.min(h-1,Math.floor((y+.5)*h/SH)),i=(sy*w+sx)*4;out[k++]=Math.round(rgba[i]*.2126+rgba[i+1]*.7152+rgba[i+2]*.0722);}return out;}
function diff(a,b){let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/(a.length*255);}
function inWindows(t,ws){return ws.some(([a,b])=>t>=a&&t<=b);}
function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function round(v,n=6){return +v.toFixed(n);}
function energyFor(series,ws){return mean(series.filter(x=>inWindows(x.t,ws)).map(x=>x.e));}
function activeFraction(series,ws,threshold=.0004){const xs=series.filter(x=>inWindows(x.t,ws));return xs.length?xs.filter(x=>x.e>threshold).length/xs.length:0;}

async function inspect(entry){
  const payloadPath=path.resolve(manifestDir,entry.payloadFile),payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'));
  if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(templateDir,payload.cover_url);
  const canvas=createCanvas(entry.width,entry.height),document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};
  const window={FRAMEWRIGHT_PAYLOAD:payload},location={search:`?f=0&w=${entry.width}&h=${entry.height}&s=${entry.seed}&profile=${entry.profile}`};
  const sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;
  const ctx=vm.createContext(sandbox);vm.runInContext(source,ctx,{filename:htmlPath});const deadline=performance.now()+10000;
  while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));
  if(!window.__ready)throw new Error(`${entry.id}: boot timeout`);if(window.__bootError)throw new Error(`${entry.id}: ${window.__bootError}`);
  vm.runInContext(`globalThis.__c22Raw=(n,w,s)=>{renderFrame(n,w,s,MAIN);return MAIN.getContext('2d').getImageData(0,0,MAIN.width,MAIN.height).data;};`,ctx);
  const renderFps=window.RISO.fps,series=[];let prev=null;
  for(let j=0;j<DURATION*SAMPLE_FPS;j++){
    const t=j/SAMPLE_FPS,fr=Math.round(t*renderFps),cur=thumb(ctx.__c22Raw(fr,entry.width,entry.seed),entry.width,entry.height);
    if(prev)series.push({t,e:diff(prev,cur)});prev=cur;
  }
  const metrics={};for(const [name,ws] of Object.entries(WINDOWS))metrics[name]=round(energyFor(series,ws));
  metrics.settleActiveFraction=round(activeFraction(series,WINDOWS.settle));
  metrics.focusMean=round(mean([metrics.hookFocus,metrics.bookFocus,metrics.ctaFocus]));
  metrics.entranceMean=round(mean([metrics.hookEntrance,metrics.bookEntrance,metrics.ctaEntrance]));
  metrics.focusToSettle=round(metrics.focusMean/Math.max(metrics.settle,1e-7));
  return{entry,payload,clean:cleanPayload(payload),metrics};
}

if(manifest.items.length!==20)throw new Error(`expected 20 C22 items, got ${manifest.items.length}`);
const inspected=[];for(let i=0;i<manifest.items.length;i++){const x=await inspect(manifest.items[i]);inspected.push(x);console.log(`${i+1}/${manifest.items.length} ${x.entry.id}`);}
const books=[...new Set(manifest.items.map(x=>x.bookId))],rows=[];
for(const bookId of books){
  const xs=inspected.filter(x=>x.entry.bookId===bookId),a=xs.find(x=>x.entry.mode==='e12-active'),v=xs.find(x=>x.entry.mode==='c22-v2');
  if(!a||!v)throw new Error(`${bookId}: missing paired motion mode`);if(a.entry.style!==v.entry.style||a.entry.seed!==v.entry.seed)throw new Error(`${bookId}: style/seed changed`);if(a.clean!==v.clean)throw new Error(`${bookId}: payload changed beyond motion_density`);
  const ratio=(x,y)=>x/Math.max(y,1e-7);
  rows.push({bookId,style:a.entry.style,baseline:a.metrics,c22:v.metrics,ratios:{settleEnergy:round(ratio(v.metrics.settle,a.metrics.settle)),settleActiveFraction:round(ratio(v.metrics.settleActiveFraction,a.metrics.settleActiveFraction)),focusContrastGain:round(ratio(v.metrics.focusToSettle,a.metrics.focusToSettle)),hookEntrance:round(ratio(v.metrics.hookEntrance,a.metrics.hookEntrance)),ctaEntrance:round(ratio(v.metrics.ctaEntrance,a.metrics.ctaEntrance)),hookFocus:round(ratio(v.metrics.hookFocus,a.metrics.hookFocus)),bookFocus:round(ratio(v.metrics.bookFocus,a.metrics.bookFocus)),ctaFocus:round(ratio(v.metrics.ctaFocus,a.metrics.ctaFocus))}});
}
const avg=k=>mean(rows.map(x=>x.ratios[k]));
const aggregate={settleEnergyRatio:round(avg('settleEnergy')),settleActiveFractionRatio:round(avg('settleActiveFraction')),focusContrastGain:round(avg('focusContrastGain')),hookEntranceRatio:round(avg('hookEntrance')),ctaEntranceRatio:round(avg('ctaEntrance')),hookFocusRatio:round(avg('hookFocus')),bookFocusRatio:round(avg('bookFocus')),ctaFocusRatio:round(avg('ctaFocus'))};
const report={schema:'framewright-c22-motion-audit-v1',sampleFps:SAMPLE_FPS,sampleSize:[SW,SH],duration:DURATION,windows:WINDOWS,books:rows,aggregate};
fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(report,null,2));
if(aggregate.settleEnergyRatio>.75)throw new Error(`settle motion not reduced enough: ${aggregate.settleEnergyRatio} > .75`);
if(aggregate.settleActiveFractionRatio>.70)throw new Error(`settle active fraction not reduced enough: ${aggregate.settleActiveFractionRatio} > .70`);
if(aggregate.focusContrastGain<1.25)throw new Error(`motion not concentrated enough: focus contrast gain ${aggregate.focusContrastGain} < 1.25`);
if(aggregate.hookEntranceRatio<.55)throw new Error(`hook entrance became too dead: ${aggregate.hookEntranceRatio} < .55`);
if(aggregate.ctaEntranceRatio<.55)throw new Error(`CTA entrance became too dead: ${aggregate.ctaEntranceRatio} < .55`);
if(aggregate.hookFocusRatio<.45||aggregate.bookFocusRatio<.45||aggregate.ctaFocusRatio<.45)throw new Error(`focal event too weak: ${JSON.stringify({hook:aggregate.hookFocusRatio,book:aggregate.bookFocusRatio,cta:aggregate.ctaFocusRatio})}`);
console.log(JSON.stringify(aggregate,null,2));
