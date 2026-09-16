#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas,Image,GlobalFonts} from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.HTML||process.argv[2]||'examples/book-ad-systems/index-c20.html');
const manifestPath=path.resolve(process.env.MANIFEST||process.argv[3]||'examples/book-ad-systems/generated-c20/manifest.json');
const reportPath=path.resolve(process.env.PALETTE_REPORT||process.argv[4]||'artifacts/c20/palette-audit.json');
for(const [file,family] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']])if(fs.existsSync(file))GlobalFonts.registerFromPath(file,family);
const html=fs.readFileSync(htmlPath,'utf8'),match=html.match(/<script>([\s\S]*?)<\/script>/i);if(!match)throw new Error('inline template script missing');
const source=match[1],templateDir=path.dirname(htmlPath),manifestDir=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
async function inspect(entry){
  const payloadPath=path.resolve(manifestDir,entry.payloadFile),payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'));if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(templateDir,payload.cover_url);
  const canvas=createCanvas(entry.width,entry.height),document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};
  const window={FRAMEWRIGHT_PAYLOAD:payload},location={search:`?f=0&w=${entry.width}&s=${entry.seed}&profile=${entry.profile}`};
  const sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;
  const ctx=vm.createContext(sandbox),t0=performance.now();vm.runInContext(source,ctx,{filename:htmlPath});const deadline=performance.now()+10000;while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!window.__ready)throw new Error(`${entry.id}: boot timeout`);if(window.__bootError)throw new Error(`${entry.id}: ${window.__bootError}`);
  const ad=JSON.parse(JSON.stringify(window.RISO.payload.art_direction||null));return{id:entry.id,bookId:entry.bookId,style:entry.style,seed:entry.seed,bootMs:+(performance.now()-t0).toFixed(3),artDirection:ad};
}
const adaptive=manifest.items.filter(x=>x.mode==='cover'),results=[];for(let i=0;i<adaptive.length;i++){const r=await inspect(adaptive[i]);results.push(r);console.log(`${i+1}/${adaptive.length} ${r.bookId}: ${r.artDirection?.accent||'n/a'} ${r.artDirection?.geometry||''}`);}
const failures=results.filter(x=>x.artDirection?.source!=='cover'),min=(k)=>Math.min(...results.map(x=>x.artDirection?.metrics?.[k]??Infinity));const signatures=new Set(results.map(x=>[x.artDirection?.background,x.artDirection?.accent,x.artDirection?.ink].join('|')));
const report={schema:'framewright-c20-palette-audit-v1',count:results.length,failures:failures.map(x=>({bookId:x.bookId,reason:x.artDirection?.failureReason||'unknown'})),uniquePaletteSignatures:signatures.size,minInkBackgroundContrast:+min('inkBackgroundContrast').toFixed(3),minAccentBackgroundContrast:+min('accentBackgroundContrast').toFixed(3),minWhiteAccentContrast:+min('whiteAccentContrast').toFixed(3),results};
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
if(report.count!==36)throw new Error(`expected 36 adaptive fixtures, got ${report.count}`);if(failures.length)throw new Error(`palette failures: ${JSON.stringify(report.failures)}`);if(report.uniquePaletteSignatures<20)throw new Error(`palette collapse: only ${report.uniquePaletteSignatures} signatures`);if(report.minInkBackgroundContrast<7)throw new Error(`ink/background contrast ${report.minInkBackgroundContrast}`);if(report.minAccentBackgroundContrast<3)throw new Error(`accent/background contrast ${report.minAccentBackgroundContrast}`);if(report.minWhiteAccentContrast<4.5)throw new Error(`white/accent contrast ${report.minWhiteAccentContrast}`);
console.log(JSON.stringify({count:report.count,unique:report.uniquePaletteSignatures,minInkBg:report.minInkBackgroundContrast,minAccentBg:report.minAccentBackgroundContrast,minWhiteAccent:report.minWhiteAccentContrast},null,2));
