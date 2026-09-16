#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas,Image,GlobalFonts} from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-c26.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-c26/manifest.json');
const policyPath=path.resolve(process.env.POLICY||'examples/book-ad-systems/platform-ui-profiles.v1.json');
const reportPath=path.resolve(process.env.AUDIT_REPORT||'artifacts/c26/safe-zone-audit.json');
for(const [file,family] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']])if(fs.existsSync(file))GlobalFonts.registerFromPath(file,family);
const html=fs.readFileSync(htmlPath,'utf8'),m=html.match(/<script>([\s\S]*?)<\/script>/i);if(!m)throw new Error('inline template script missing');const source=m[1],templateDir=path.dirname(htmlPath),manifestDir=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),policy=JSON.parse(fs.readFileSync(policyPath,'utf8'));
const TOL=12;
function inside(box,s){return box.x>=s.x-TOL&&box.y>=s.y-TOL&&box.x+box.w<=s.x+s.w+TOL&&box.y+box.h<=s.y+s.h+TOL;}
async function boot(entry){
  const payload=JSON.parse(fs.readFileSync(path.resolve(manifestDir,entry.payloadFile),'utf8'));if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(templateDir,payload.cover_url);
  const canvas=createCanvas(1080,1920),document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};
  const window={FRAMEWRIGHT_PAYLOAD:payload},location={search:`?f=0&w=1080&s=${entry.seed}&profile=vertical`};const sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;
  vm.runInContext(source,vm.createContext(sandbox),{filename:htmlPath});const deadline=performance.now()+10000;while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!window.__ready)throw new Error(`${entry.id}: boot timeout`);if(window.__bootError)throw new Error(`${entry.id}: ${window.__bootError}`);return window;
}
const results=[],errors=[];
for(let i=0;i<manifest.items.length;i++){
  const entry=manifest.items[i],window=await boot(entry),ui=window.__C26_PLATFORM_UI?.();if(!ui)throw new Error(`${entry.id}: C26 profile API missing`);const expected=policy.profiles[entry.platform];if(!expected){errors.push(`${entry.id}: unknown policy ${entry.platform}`);continue;}
  if(ui.version!==policy.version)errors.push(`${entry.id}: version ${ui.version} != ${policy.version}`);if(ui.profile!==entry.platform)errors.push(`${entry.id}: active profile ${ui.profile} != ${entry.platform}`);if(JSON.stringify(ui.safeRect)!==JSON.stringify(expected.safeRect))errors.push(`${entry.id}: safeRect drift ${JSON.stringify(ui.safeRect)}`);
  const duration=window.RISO.total/30;if(Math.abs(duration-entry.expectedDuration)>.01)errors.push(`${entry.id}: duration ${duration}s expected ${entry.expectedDuration}s`);
  const areaRatio=ui.safeRect.w*ui.safeRect.h/(1080*1920);if(areaRatio<.48)errors.push(`${entry.id}: safe area over-shrunk ${areaRatio.toFixed(4)}`);
  let start=0,sampled=0,eventCount=0;const violations=[];
  for(const plate of window.RISO.plates){
    for(const frac of [.18,.50,.82]){
      const f=start+Math.min(plate.len-1,Math.max(0,Math.round((plate.len-1)*frac)));window.__C26_BEGIN_CAPTURE();window.RISO.frame(f,1080,entry.seed);const cap=window.__C26_END_CAPTURE();sampled++;for(const e of cap.events||[]){eventCount++;if(!inside(e.box,ui.safeRect))violations.push({frame:f,plate:plate.name,kind:e.kind,role:e.role||null,box:e.box});}
    }
    start+=plate.len;
  }
  if(violations.length)errors.push(`${entry.id}: ${violations.length} critical boxes outside ${entry.platform} safeRect`);
  const row={id:entry.id,bookId:entry.bookId,style:entry.style,copyProfile:entry.copyProfile,platform:entry.platform,durationSeconds:duration,profileVersion:ui.version,safeRect:ui.safeRect,safeAreaRatio:+areaRatio.toFixed(4),sampledFrames:sampled,eventCount,violationCount:violations.length,violations:violations.slice(0,20)};results.push(row);console.log(`${i+1}/${manifest.items.length} ${entry.id}: ${duration}s safe=${JSON.stringify(ui.safeRect)} events=${eventCount} violations=${violations.length}`);
}
const platformCounts=Object.fromEntries(manifest.platforms.map(p=>[p,results.filter(r=>r.platform===p).length])),safeAreaRatios=Object.fromEntries(manifest.platforms.map(p=>[p,results.find(r=>r.platform===p)?.safeAreaRatio||0]));
for(const p of manifest.platforms)if(platformCounts[p]!==6)errors.push(`platform ${p}: ${platformCounts[p]} rows expected 6`);
const report={schema:'framewright-c26-platform-safe-audit-v1',policyVersion:policy.version,count:results.length,tolerancePx:TOL,platformCounts,safeAreaRatios,totalViolations:results.reduce((s,r)=>s+r.violationCount,0),errors,results};fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));if(results.length!==24)throw new Error(`expected 24 rows, got ${results.length}`);if(errors.length)throw new Error(`C26 safe-zone audit failed:\n${errors.join('\n')}`);console.log(JSON.stringify({count:results.length,platformCounts,safeAreaRatios,totalViolations:report.totalViolations},null,2));
