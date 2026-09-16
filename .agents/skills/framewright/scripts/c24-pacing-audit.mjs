#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas,Image,GlobalFonts} from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-c24.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-c24/manifest.json');
const reportPath=path.resolve(process.env.AUDIT_REPORT||'artifacts/c24/pacing-audit.json');
for(const [file,family] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']])if(fs.existsSync(file))GlobalFonts.registerFromPath(file,family);
const html=fs.readFileSync(htmlPath,'utf8'),m=html.match(/<script>([\s\S]*?)<\/script>/i);if(!m)throw new Error('inline template script missing');const source=m[1],templateDir=path.dirname(htmlPath),manifestDir=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
async function inspect(entry){
  const payload=JSON.parse(fs.readFileSync(path.resolve(manifestDir,entry.payloadFile),'utf8'));if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(templateDir,payload.cover_url);
  const canvas=createCanvas(1080,1920),document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};
  const window={FRAMEWRIGHT_PAYLOAD:payload},location={search:`?f=0&w=1080&s=${entry.seed}&profile=vertical`};const sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;
  vm.runInContext(source,vm.createContext(sandbox),{filename:htmlPath});const deadline=performance.now()+10000;while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!window.__ready)throw new Error(`${entry.id}: boot timeout`);if(window.__bootError)throw new Error(`${entry.id}: ${window.__bootError}`);
  return{id:entry.id,bookId:entry.bookId,copyProfile:entry.copyProfile,mode:entry.mode,style:entry.style,expectedAdaptiveSeconds:entry.expectedAdaptiveSeconds,total:window.RISO.total,plates:window.RISO.plates,pacing:JSON.parse(JSON.stringify(window.RISO.payload.pacing||null))};
}
const results=[];for(let i=0;i<manifest.items.length;i++){const r=await inspect(manifest.items[i]);results.push(r);console.log(`${i+1}/${manifest.items.length} ${r.id}: ${r.plates.map(x=>`${x.name}=${x.len}`).join(' ')} total=${r.total} profile=${r.pacing?.profileSeconds}s`);}
const errors=[];
for(const r of results){
  const by=Object.fromEntries(r.plates.map(x=>[x.name,x.len]));
  if(r.mode==='baseline12'){
    if(r.total!==360)errors.push(`${r.id}: baseline total ${r.total}`);
    if(by.hook!==90||by.book!==150||by.cta!==120)errors.push(`${r.id}: baseline schedule drift ${JSON.stringify(by)}`);
    if(r.pacing?.profileSeconds!==12||r.pacing?.grammar!=='full')errors.push(`${r.id}: baseline metadata drift`);
    continue;
  }
  const expected=r.expectedAdaptiveSeconds,target=expected*30;if(r.total!==target)errors.push(`${r.id}: total ${r.total} != ${target}`);if(r.pacing?.profileSeconds!==expected)errors.push(`${r.id}: policy selected ${r.pacing?.profileSeconds}s expected ${expected}s`);if(r.pacing?.totalFrames!==target)errors.push(`${r.id}: metadata totalFrames ${r.pacing?.totalFrames}`);
  const f=r.pacing?.frames||{},sum=(f.hook||0)+(f.book||0)+(f.cta||0);if(sum!==target)errors.push(`${r.id}: frame metadata sum ${sum} != ${target}`);
  if(expected===3){if(r.pacing?.grammar!=='teaser-hook'||r.plates.length!==1||by.hook!==90||f.book!==0||f.cta!==0)errors.push(`${r.id}: invalid 3s teaser ${JSON.stringify({plates:r.plates,frames:f})}`);}
  else if(expected===5){if(r.pacing?.grammar!=='hook-book'||r.plates.length!==2||!by.hook||!by.book||by.cta)errors.push(`${r.id}: invalid 5s hook-book ${JSON.stringify({plates:r.plates,frames:f})}`);if((f.hook||0)<54||(f.book||0)<72)errors.push(`${r.id}: 5s visible plate starved ${JSON.stringify(f)}`);}
  else{if(r.pacing?.grammar!=='full'||r.plates.length!==3||!by.hook||!by.book||!by.cta)errors.push(`${r.id}: invalid full grammar ${JSON.stringify({plates:r.plates,frames:f})}`);if((f.hook||0)<60||(f.book||0)<90||(f.cta||0)<30)errors.push(`${r.id}: visible plate starved ${JSON.stringify(f)}`);}
  if(!Array.isArray(r.pacing?.reasons)||!r.pacing.reasons.some(x=>String(x).startsWith('copy-load:')))errors.push(`${r.id}: missing explainability reasons`);
}
const adaptive=results.filter(x=>x.mode==='adaptive'),distribution=Object.fromEntries([3,5,7,9,12,15].map(s=>[s,adaptive.filter(x=>x.pacing?.profileSeconds===s).length]));for(const s of [3,5,7,9,12,15])if(distribution[s]!==3)errors.push(`duration ${s}s count ${distribution[s]} expected 3`);
// Fresh second boot for every adaptive payload: the selected plan must be deterministic, not just the scene frames.
for(const entry of manifest.items.filter(x=>x.mode==='adaptive')){const again=await inspect(entry),first=adaptive.find(x=>x.id===entry.id);if(JSON.stringify(first?.pacing)!==JSON.stringify(again.pacing))errors.push(`${entry.id}: pacing plan is not deterministic`);}
const report={schema:'framewright-c24-organic-duration-audit-v2',count:results.length,adaptiveCount:adaptive.length,durationDistribution:distribution,errors,results};fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));if(results.length!==36)throw new Error(`expected 36 rows, got ${results.length}`);if(errors.length)throw new Error(`C24 duration audit failed:\n${errors.join('\n')}`);console.log(JSON.stringify({count:results.length,durationDistribution:distribution,errors:errors.length},null,2));
