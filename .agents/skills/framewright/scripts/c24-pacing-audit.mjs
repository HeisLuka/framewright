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
  return{id:entry.id,bookId:entry.bookId,copyProfile:entry.copyProfile,mode:entry.mode,style:entry.style,total:window.RISO.total,plates:window.RISO.plates,pacing:JSON.parse(JSON.stringify(window.RISO.payload.pacing||null))};
}
const results=[];for(let i=0;i<manifest.items.length;i++){const r=await inspect(manifest.items[i]);results.push(r);console.log(`${i+1}/${manifest.items.length} ${r.id}: ${r.plates.map(x=>`${x.name}=${x.len}`).join(' ')} total=${r.total}`);}
const errors=[];for(const r of results){if(r.total!==360)errors.push(`${r.id}: total ${r.total}`);const f=Object.fromEntries(r.plates.map(x=>[x.name,x.len]));if(r.mode==='fixed'&&(f.hook!==90||f.book!==150||f.cta!==120))errors.push(`${r.id}: fixed drift ${JSON.stringify(f)}`);if(r.mode==='adaptive'&&(f.hook<72||f.hook>126||f.book<120||f.book>174||f.cta<90||f.cta>132))errors.push(`${r.id}: adaptive bounds ${JSON.stringify(f)}`);}
for(const style of ['swiss','newspaper','paper']){
  const get=p=>results.find(x=>x.style===style&&x.copyProfile===p&&x.mode==='adaptive')?.pacing?.frames;
  const s=get('short-en'),m=get('medium-en'),l=get('long-en'),mr=get('medium-ru'),lr=get('long-ru');if(!s||!m||!l||!mr||!lr){errors.push(`${style}: missing adaptive profile`);continue;}
  if(!(l.hook>m.hook&&m.hook>s.hook))errors.push(`${style}: EN hook dwell not monotonic ${s.hook}/${m.hook}/${l.hook}`);
  if(!(lr.hook>mr.hook))errors.push(`${style}: RU long hook dwell not greater ${mr.hook}/${lr.hook}`);
  if(!(l.book>=m.book&&m.book>=s.book))errors.push(`${style}: EN book dwell not monotonic ${s.book}/${m.book}/${l.book}`);
}
const report={schema:'framewright-c24-pacing-audit-v1',count:results.length,errors,results};fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));if(results.length!==30)throw new Error(`expected 30 rows, got ${results.length}`);if(errors.length)throw new Error(`C24 pacing audit failed:\n${errors.join('\n')}`);console.log(JSON.stringify({count:results.length,errors:errors.length,adaptive:Object.fromEntries(['swiss','newspaper','paper'].map(style=>[style,results.filter(x=>x.style===style&&x.mode==='adaptive').map(x=>({profile:x.copyProfile,frames:x.pacing.frames}))]))},null,2));
