#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas,Image,GlobalFonts} from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.HTML||process.argv[2]||'examples/book-ad-systems/index-c21.html');
const manifestPath=path.resolve(process.env.MANIFEST||process.argv[3]||'examples/book-ad-systems/generated-c21/manifest.json');
const outPath=path.resolve(process.env.AUDIT_REPORT||process.argv[4]||'artifacts/c21/opening-audit.json');
for(const [file,family] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']])if(fs.existsSync(file))GlobalFonts.registerFromPath(file,family);

const html=fs.readFileSync(htmlPath,'utf8'),match=html.match(/<script>([\s\S]*?)<\/script>/i);if(!match)throw new Error('inline template script missing');
const source=match[1],templateDir=path.dirname(htmlPath),manifestDir=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const OPENING_TIMES=[0.45,1.05,1.65],CONVERGENCE_TIME=2.4,SW=72,SH=128;

function cleanPayload(p){const q=structuredClone(p);delete q.opening_grammar;return JSON.stringify(q);}
function thumb(rgba,w,h){
  const out=new Uint8Array(SW*SH);let k=0;
  for(let y=0;y<SH;y++)for(let x=0;x<SW;x++){
    const sx=Math.min(w-1,Math.floor((x+.5)*w/SW)),sy=Math.min(h-1,Math.floor((y+.5)*h/SH)),i=(sy*w+sx)*4;
    out[k++]=Math.round(rgba[i]*.2126+rgba[i+1]*.7152+rgba[i+2]*.0722);
  }
  return out;
}
function diff(a,b){let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/(a.length*255);}
async function inspect(entry){
  const payloadPath=path.resolve(manifestDir,entry.payloadFile),payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'));
  if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(templateDir,payload.cover_url);
  const canvas=createCanvas(entry.width,entry.height),document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};
  const window={FRAMEWRIGHT_PAYLOAD:payload},location={search:`?f=0&w=${entry.width}&h=${entry.height}&s=${entry.seed}&profile=${entry.profile}`};
  const sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;
  const ctx=vm.createContext(sandbox);vm.runInContext(source,ctx,{filename:htmlPath});const deadline=performance.now()+10000;
  while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));
  if(!window.__ready)throw new Error(`${entry.id}: boot timeout`);if(window.__bootError)throw new Error(`${entry.id}: ${window.__bootError}`);
  vm.runInContext(`globalThis.__c21Raw=(n,w,s)=>{renderFrame(n,w,s,MAIN);return MAIN.getContext('2d').getImageData(0,0,MAIN.width,MAIN.height).data;};`,ctx);
  const fps=window.RISO.fps;
  const samples=[...OPENING_TIMES,CONVERGENCE_TIME].map(t=>thumb(ctx.__c21Raw(Math.round(t*fps),entry.width,entry.seed),entry.width,entry.height));
  return{entry,payload,clean:cleanPayload(payload),samples};
}

if(manifest.items.length!==40)throw new Error(`expected 40 C21 items, got ${manifest.items.length}`);
const inspected=[];for(let i=0;i<manifest.items.length;i++){const x=await inspect(manifest.items[i]);inspected.push(x);console.log(`${i+1}/${manifest.items.length} ${x.entry.id}`);}
const grammars=['hook-led','cover-led','title-led','progressive-hook'],books=[...new Set(manifest.items.map(x=>x.bookId))],rows=[];
for(const bookId of books){
  const xs=inspected.filter(x=>x.entry.bookId===bookId);
  if(xs.length!==4)throw new Error(`${bookId}: expected 4 grammars, got ${xs.length}`);
  if(new Set(xs.map(x=>x.entry.style)).size!==1)throw new Error(`${bookId}: style changed across opening grammar`);
  if(new Set(xs.map(x=>x.entry.seed)).size!==1)throw new Error(`${bookId}: seed changed across opening grammar`);
  if(new Set(xs.map(x=>x.clean)).size!==1)throw new Error(`${bookId}: payload changed beyond opening_grammar`);
  const got=new Set(xs.map(x=>x.entry.grammar));for(const g of grammars)if(!got.has(g))throw new Error(`${bookId}: missing grammar ${g}`);
  const pairs=[];
  for(let i=0;i<xs.length;i++)for(let j=i+1;j<xs.length;j++){
    const ds=OPENING_TIMES.map((_,k)=>diff(xs[i].samples[k],xs[j].samples[k]));
    const convergence=diff(xs[i].samples[OPENING_TIMES.length],xs[j].samples[OPENING_TIMES.length]);
    pairs.push({a:xs[i].entry.grammar,b:xs[j].entry.grammar,openingMean:+(ds.reduce((a,b)=>a+b,0)/ds.length).toFixed(6),openingDiffs:ds.map(x=>+x.toFixed(6)),convergence:+convergence.toFixed(6)});
  }
  rows.push({bookId,style:xs[0].entry.style,minOpeningPairwise:+Math.min(...pairs.map(x=>x.openingMean)).toFixed(6),meanOpeningPairwise:+(pairs.reduce((a,x)=>a+x.openingMean,0)/pairs.length).toFixed(6),maxConvergence:+Math.max(...pairs.map(x=>x.convergence)).toFixed(6),pairs});
}
const report={schema:'framewright-c21-opening-audit-v1',sampleSize:[SW,SH],openingTimes:OPENING_TIMES,convergenceTime:CONVERGENCE_TIME,books:rows,meanOpeningAcrossBooks:+(rows.reduce((a,x)=>a+x.meanOpeningPairwise,0)/rows.length).toFixed(6),minOpeningAcrossBooks:+Math.min(...rows.map(x=>x.minOpeningPairwise)).toFixed(6),maxConvergenceAcrossBooks:+Math.max(...rows.map(x=>x.maxConvergence)).toFixed(6)};
fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(report,null,2));
if(report.meanOpeningAcrossBooks<.05)throw new Error(`opening grammar too similar: mean ${report.meanOpeningAcrossBooks} < .05`);
if(report.minOpeningAcrossBooks<.02)throw new Error(`opening grammar pair collapsed: min ${report.minOpeningAcrossBooks} < .02`);
if(report.maxConvergenceAcrossBooks!==0)throw new Error(`opening grammar leaked past convergence: max raw diff ${report.maxConvergenceAcrossBooks}`);
console.log(JSON.stringify({books:rows.length,meanOpening:report.meanOpeningAcrossBooks,minOpening:report.minOpeningAcrossBooks,maxConvergence:report.maxConvergenceAcrossBooks},null,2));
