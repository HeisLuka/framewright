#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas,Image,GlobalFonts} from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-c25.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-c25/manifest.json');
const outPath=path.resolve(process.env.AUDIT_REPORT||'artifacts/c25/typography-audit.json');
for(const [file,family] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']])if(fs.existsSync(file))GlobalFonts.registerFromPath(file,family);
const html=fs.readFileSync(htmlPath,'utf8'),m=html.match(/<script>([\s\S]*?)<\/script>/i);if(!m)throw new Error('inline template script missing');
const source=m[1],templateDir=path.dirname(htmlPath),manifestDir=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const TIMES=[1.65,5.2,9.6],SW=72,SH=128;
function cleanPayload(p){const q=structuredClone(p);delete q.typography_system;return JSON.stringify(q);}
function thumb(rgba,w,h){const out=new Uint8Array(SW*SH);let k=0;for(let y=0;y<SH;y++)for(let x=0;x<SW;x++){const sx=Math.min(w-1,Math.floor((x+.5)*w/SW)),sy=Math.min(h-1,Math.floor((y+.5)*h/SH)),i=(sy*w+sx)*4;out[k++]=Math.round(rgba[i]*.2126+rgba[i+1]*.7152+rgba[i+2]*.0722);}return out;}
function diff(a,b){let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/(a.length*255);}
async function inspect(entry){
 const payload=JSON.parse(fs.readFileSync(path.resolve(manifestDir,entry.payloadFile),'utf8'));if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(templateDir,payload.cover_url);
 const canvas=createCanvas(entry.width,entry.height),document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};
 const window={FRAMEWRIGHT_PAYLOAD:payload},location={search:`?f=0&w=${entry.width}&h=${entry.height}&s=${entry.seed}&profile=${entry.profile}`},sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;
 const ctx=vm.createContext(sandbox);vm.runInContext(source,ctx,{filename:htmlPath});const deadline=performance.now()+10000;while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!window.__ready)throw new Error(`${entry.id}: boot timeout`);if(window.__bootError)throw new Error(`${entry.id}: ${window.__bootError}`);
 vm.runInContext(`globalThis.__c25Raw=(n,w,s)=>{renderFrame(n,w,s,MAIN);return MAIN.getContext('2d').getImageData(0,0,MAIN.width,MAIN.height).data;};`,ctx);const fps=window.RISO.fps,samples=TIMES.map(t=>thumb(ctx.__c25Raw(Math.round(t*fps),entry.width,entry.seed),entry.width,entry.height));const policy=window.__C25_TYPOGRAPHY();return{entry,payload,clean:cleanPayload(payload),samples,policy};
}
if(manifest.items.length!==40)throw new Error(`expected 40 C25 items, got ${manifest.items.length}`);const xs=[];for(let i=0;i<manifest.items.length;i++){xs.push(await inspect(manifest.items[i]));console.log(`${i+1}/${manifest.items.length} ${manifest.items[i].id}`);}
const systems=['baseline','display-led','editorial','compact-dense'],books=[...new Set(manifest.items.map(x=>x.bookId))],rows=[];
for(const bookId of books){const b=xs.filter(x=>x.entry.bookId===bookId);if(b.length!==4)throw new Error(`${bookId}: expected 4 typography systems`);if(new Set(b.map(x=>x.entry.style)).size!==1||new Set(b.map(x=>x.entry.seed)).size!==1||new Set(b.map(x=>x.clean)).size!==1)throw new Error(`${bookId}: non-typography variable changed`);for(const s of systems)if(!b.some(x=>x.entry.typography===s))throw new Error(`${bookId}: missing ${s}`);const pairs=[];for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){const ds=b[i].samples.map((a,k)=>diff(a,b[j].samples[k]));pairs.push({a:b[i].entry.typography,b:b[j].entry.typography,mean:+(ds.reduce((x,y)=>x+y,0)/ds.length).toFixed(6),samples:ds.map(x=>+x.toFixed(6))});}rows.push({bookId,style:b[0].entry.style,language:b[0].entry.language,minPair:+Math.min(...pairs.map(x=>x.mean)).toFixed(6),meanPair:+(pairs.reduce((a,x)=>a+x.mean,0)/pairs.length).toFixed(6),pairs});}
const report={schema:'framewright-c25-typography-audit-v1',times:TIMES,books:rows,meanAcrossBooks:+(rows.reduce((a,x)=>a+x.meanPair,0)/rows.length).toFixed(6),minAcrossBooks:+Math.min(...rows.map(x=>x.minPair)).toFixed(6)};fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(report,null,2));if(report.meanAcrossBooks<.012)throw new Error(`typography systems too similar: mean ${report.meanAcrossBooks}`);if(report.minAcrossBooks<.003)throw new Error(`typography pair collapsed: min ${report.minAcrossBooks}`);console.log(JSON.stringify({books:rows.length,mean:report.meanAcrossBooks,min:report.minAcrossBooks},null,2));
