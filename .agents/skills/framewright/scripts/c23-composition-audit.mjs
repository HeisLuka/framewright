#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas,Image,GlobalFonts} from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-c23.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-c23/manifest.json');
const reportPath=path.resolve(process.env.AUDIT_REPORT||'artifacts/c23/composition-audit.json');
for(const [file,family] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']])if(fs.existsSync(file))GlobalFonts.registerFromPath(file,family);
const html=fs.readFileSync(htmlPath,'utf8'),match=html.match(/<script>([\s\S]*?)<\/script>/i);if(!match)throw new Error('inline template script missing');
const source=match[1],templateDir=path.dirname(htmlPath),manifestDir=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
async function inspect(entry){
  const payload=JSON.parse(fs.readFileSync(path.resolve(manifestDir,entry.payloadFile),'utf8'));if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(templateDir,payload.cover_url);
  const canvas=createCanvas(entry.width,entry.height),document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};
  const window={FRAMEWRIGHT_PAYLOAD:payload},location={search:`?f=0&w=${entry.width}&s=${entry.seed}&profile=${entry.profile}`};
  const sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;
  vm.runInContext(source,vm.createContext(sandbox),{filename:htmlPath});const deadline=performance.now()+10000;while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!window.__ready)throw new Error(`${entry.id}: boot timeout`);if(window.__bootError)throw new Error(`${entry.id}: ${window.__bootError}`);
  return{id:entry.id,bookId:entry.bookId,style:entry.style,composition:JSON.parse(JSON.stringify(window.RISO.payload.cover_composition||null))};
}
const adaptive=manifest.items.filter(x=>x.mode==='adaptive'),results=[];for(let i=0;i<adaptive.length;i++){const r=await inspect(adaptive[i]);results.push(r);console.log(`${i+1}/${adaptive.length} ${r.bookId}: side=${r.composition?.textSide} focus=${r.composition?.focusX},${r.composition?.focusY} conf=${r.composition?.confidence} zoom=${r.composition?.zoom}`);}
const failures=results.filter(x=>x.composition?.source!=='cover');const left=results.filter(x=>x.composition?.textSide==='left').length,right=results.filter(x=>x.composition?.textSide==='right').length;const confidences=results.map(x=>x.composition?.confidence||0),retentions=results.map(x=>x.composition?.zoomRetention??0),zooms=results.map(x=>x.composition?.zoom??99);const report={schema:'framewright-c23-composition-audit-v2',count:results.length,failures:failures.map(x=>x.bookId),sides:{left,right},confidence:{min:Math.min(...confidences),max:Math.max(...confidences),mean:+(confidences.reduce((a,b)=>a+b,0)/confidences.length).toFixed(4)},zoom:{min:Math.min(...zooms),max:Math.max(...zooms),minRetention:Math.min(...retentions)},results};
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));if(report.count!==36)throw new Error(`expected 36 adaptive covers, got ${report.count}`);if(failures.length)throw new Error(`analysis failures: ${failures.length}`);if(left<4)throw new Error(`placement policy collapsed: only ${left} left-text decisions`);if(right<4)throw new Error(`placement policy collapsed: only ${right} right-text decisions`);if(report.zoom.max>1.0601)throw new Error(`zoom exceeded bound: ${report.zoom.max}`);if(report.zoom.minRetention<.889)throw new Error(`adaptive zoom retention too low: ${report.zoom.minRetention}`);console.log(JSON.stringify(report,null,2));
