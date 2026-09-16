#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas,Image,GlobalFonts} from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-c27.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-c27-render/manifest.json');
const reportPath=path.resolve(process.env.RENDER_AUDIT||'artifacts/c27/render-audit.json');
for(const [file,family] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']])if(fs.existsSync(file))GlobalFonts.registerFromPath(file,family);
const html=fs.readFileSync(htmlPath,'utf8'),m=html.match(/<script>([\s\S]*?)<\/script>/i);if(!m)throw new Error('inline template script missing');
const source=m[1],templateDir=path.dirname(htmlPath),manifestDir=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const TOL=12;
function sortValue(value){if(Array.isArray(value))return value.map(sortValue);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sortValue(value[k])]));return value;}const stable=x=>JSON.stringify(sortValue(x));
function inside(box,s){return box.x>=s.x-TOL&&box.y>=s.y-TOL&&box.x+box.w<=s.x+s.w+TOL&&box.y+box.h<=s.y+s.h+TOL;}
async function boot(entry){
  const payload=JSON.parse(fs.readFileSync(path.join(manifestDir,entry.payloadFile),'utf8')),expected=JSON.parse(fs.readFileSync(path.join(manifestDir,entry.planFile),'utf8'));
  if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(templateDir,payload.cover_url);
  const canvas=createCanvas(entry.width,entry.height),document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};
  const window={FRAMEWRIGHT_PAYLOAD:payload},location={search:`?f=0&w=${entry.width}&h=${entry.height}&s=${entry.seed}&profile=${entry.profile}`};
  const sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;
  vm.runInContext(source,vm.createContext(sandbox),{filename:htmlPath});const deadline=performance.now()+10000;while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!window.__ready)throw new Error(`${entry.id}: boot timeout`);if(window.__bootError)throw new Error(`${entry.id}: ${window.__bootError}`);return{window,expected};
}
const rows=[],errors=[];
for(let i=0;i<manifest.items.length;i++){
  const entry=manifest.items[i],{window,expected}=await boot(entry),actual=window.__C27_NARRATIVE_PLAN?.();if(!actual){errors.push(`${entry.id}: narrative API missing`);continue;}
  if(stable(actual)!==stable(expected))errors.push(`${entry.id}: NarrativePlan drift inside renderer`);
  if(window.RISO.total!==expected.total_frames)errors.push(`${entry.id}: RISO.total ${window.RISO.total} != ${expected.total_frames}`);
  const actualPlates=window.RISO.plates.map(x=>({role:x.name,frames:x.len})),expectedPlates=expected.roles.map(x=>({role:x.role,frames:x.frames}));if(stable(actualPlates)!==stable(expectedPlates))errors.push(`${entry.id}: plate schedule drift ${JSON.stringify(actualPlates)}`);
  const contract=window.__C27_RENDER_CONTRACT?.();if(!contract||contract.planId!==expected.narrative_plan_id||contract.totalFrames!==expected.total_frames)errors.push(`${entry.id}: renderer contract drift`);
  const p=window.RISO.payload;if(p.narrative_plan_id!==expected.narrative_plan_id)errors.push(`${entry.id}: payload narrative_plan_id drift`);if(p.duration_profile!==expected.duration_seconds)errors.push(`${entry.id}: duration_profile ${p.duration_profile}`);if(p.pacing?.mode!=='c27-narrative-v1'||p.pacing?.totalFrames!==expected.total_frames)errors.push(`${entry.id}: C27 pacing metadata missing`);if(p.visual_system!=='swiss'||p.platform_profile!=='generic')errors.push(`${entry.id}: controlled visual implementation drift`);
  const ui=window.__C26_PLATFORM_UI?.();if(!ui||!ui.safeRect)errors.push(`${entry.id}: inherited C26 safe-zone API missing`);
  let sampledFrames=0,eventCount=0,violationCount=0,cursor=0;
  for(const role of expected.roles){
    for(const frac of [.18,.50,.82]){
      const f=cursor+Math.min(role.frames-1,Math.max(0,Math.round((role.frames-1)*frac)));
      try{
        if(window.__C26_BEGIN_CAPTURE)window.__C26_BEGIN_CAPTURE();
        window.RISO.frame(f,entry.width,entry.seed);sampledFrames++;
        const cap=window.__C26_END_CAPTURE?window.__C26_END_CAPTURE():null;
        for(const e of cap?.events||[]){eventCount++;if(ui?.safeRect&&!inside(e.box,ui.safeRect)){violationCount++;errors.push(`${entry.id}/${role.role}@${f}: ${e.kind||'event'} outside safeRect`);}}
      }catch(e){errors.push(`${entry.id}/${role.role}@${f}: render failed ${e.message}`);}
    }
    cursor+=role.frames;
  }
  rows.push({id:entry.id,bookId:entry.bookId,angleId:entry.angleId,revealTiming:entry.revealTiming,narrativePlanId:entry.narrativePlanId,totalFrames:window.RISO.total,roles:actualPlates,revealFrame:expected.checkpoints.reveal,ctaFrame:expected.checkpoints.cta,sampledFrames,eventCount,violationCount});
  console.log(`${i+1}/${manifest.items.length} ${entry.id}: ${actualPlates.map(x=>`${x.role}:${x.frames}`).join(' > ')} safeViolations=${violationCount}`);
}
const books=[...new Set(rows.map(x=>x.bookId))],angleRevealCombos=new Set(rows.map(x=>`${x.bookId}/${x.angleId}/${x.revealTiming}`)).size,totalSafeViolations=rows.reduce((s,r)=>s+r.violationCount,0);
const report={schema:'framewright-c27-render-audit-v1',count:rows.length,books:books.length,angleRevealCombos,tolerancePx:TOL,totalSafeViolations,errors,rows};fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
if(rows.length!==36)throw new Error(`expected 36 render plans, got ${rows.length}`);if(books.length!==6||angleRevealCombos!==36)errors.push(`coverage books=${books.length} combos=${angleRevealCombos}`);if(totalSafeViolations!==0)errors.push(`safe-zone violations ${totalSafeViolations}`);if(errors.length)throw new Error(`C27 render audit failed:\n${errors.join('\n')}`);console.log(JSON.stringify({count:rows.length,books:books.length,angleRevealCombos,totalSafeViolations,errors:0},null,2));
