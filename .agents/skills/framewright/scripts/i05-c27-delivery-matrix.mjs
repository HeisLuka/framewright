#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas,Image,GlobalFonts} from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.C27_HTML||'examples/book-ad-systems/index-c27-i05.html');
const fixtureDir=path.resolve(process.env.C27_FIXTURES||'artifacts/i05/c27-fixtures');
const reportPath=path.resolve(process.env.DELIVERY_REPORT||'artifacts/i05/c27-delivery-matrix.json');
const renderWidth=Number(process.env.MATRIX_WIDTH||540);
const styles=['swiss','newspaper','paper'];
const platforms=['generic','youtube_shorts','instagram_reels','tiktok'];
const fractions=[.18,.50,.82];
const TOL=12;

for(const [file,family] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']])if(fs.existsSync(file))GlobalFonts.registerFromPath(file,family);
const html=fs.readFileSync(htmlPath,'utf8'),m=html.match(/<script>([\s\S]*?)<\/script>/i);if(!m)throw new Error('inline template script missing');const source=m[1],templateDir=path.dirname(htmlPath);
const manifest=JSON.parse(fs.readFileSync(path.join(fixtureDir,'manifest.json'),'utf8'));
if(manifest.schema!=='framewright-c27-narrative-fixtures-v1')throw new Error('wrong C27 fixture schema');

function inside(box,s){return box.x>=s.x-TOL&&box.y>=s.y-TOL&&box.x+box.w<=s.x+s.w+TOL&&box.y+box.h<=s.y+s.h+TOL;}
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v;}
const stableJson=v=>JSON.stringify(stable(v));
async function boot(payload,seed){payload=structuredClone(payload);if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(templateDir,payload.cover_url);const canvas=createCanvas(1080,1920),document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};const window={FRAMEWRIGHT_PAYLOAD:payload},location={search:`?f=0&w=1080&s=${seed}&profile=vertical`};const sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;vm.runInContext(source,vm.createContext(sandbox),{filename:htmlPath});const deadline=performance.now()+10000;while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!window.__ready)throw new Error('boot timeout');if(window.__bootError)throw new Error(window.__bootError);return{window,canvas};}

let chosen=null;
for(const item of manifest.items){const plan=JSON.parse(fs.readFileSync(path.join(fixtureDir,item.planFile),'utf8'));if(plan.roles.length===5){chosen={item,plan,input:JSON.parse(fs.readFileSync(path.join(fixtureDir,item.inputFile),'utf8'))};break;}}
if(!chosen)throw new Error('no 5-role C27 plan in fixture set');
const {item,plan,input}=chosen,coverBase=path.basename(String(input.book.cover_url||''));if(!coverBase)throw new Error('chosen C27 plan has no cover');
const expectedPlates=plan.roles.map(r=>({role:r.role,frames:r.frames}));
const rows=[],errors=[];let sampledFrames=0,totalEvents=0,safeViolations=0;
for(const style of styles){for(const platform of platforms){const payload={...input.book,cover_url:`../book-ad-v0/generated-e08/${coverBase}`,visual_system:style,creative_variant:'hook-first',delivery_profile:'vertical',art_direction_mode:'cover',cover_composition_mode:'adaptive',opening_grammar:'hook-led',motion_density:'choreography-v2',typography_system:'baseline',pacing_mode:'c27-narrative-v1',platform_profile:platform,narrative_plan:plan};const {window}=await boot(payload,plan.seed),contract=window.__C27_RENDER_CONTRACT?.(),actualPlan=window.__C27_NARRATIVE_PLAN?.(),ui=window.__C26_PLATFORM_UI?.();if(!contract||contract.planId!==plan.narrative_plan_id||contract.totalFrames!==plan.total_frames)errors.push(`${style}/${platform}: render contract drift`);if(stableJson(actualPlan)!==stableJson(plan))errors.push(`${style}/${platform}: NarrativePlan mutated in renderer`);if(window.RISO.total!==plan.total_frames)errors.push(`${style}/${platform}: total ${window.RISO.total} != ${plan.total_frames}`);const actualPlates=window.RISO.plates.map(x=>({role:x.name,frames:x.len}));if(stableJson(actualPlates)!==stableJson(expectedPlates))errors.push(`${style}/${platform}: plate schedule drift`);if(window.RISO.payload.visual_system!==style)errors.push(`${style}/${platform}: style drift ${window.RISO.payload.visual_system}`);if(window.RISO.payload.platform_profile!==platform)errors.push(`${style}/${platform}: platform drift ${window.RISO.payload.platform_profile}`);if(!ui?.safeRect)errors.push(`${style}/${platform}: C26 safe profile missing`);let cursor=0,sceneEvents=0,sceneViolations=0;for(const role of plan.roles){for(const frac of fractions){const f=cursor+Math.min(role.frames-1,Math.max(0,Math.round((role.frames-1)*frac)));if(window.__C26_BEGIN_CAPTURE)window.__C26_BEGIN_CAPTURE();window.RISO.frame(f,renderWidth,plan.seed);const cap=window.__C26_END_CAPTURE?window.__C26_END_CAPTURE():{events:[]};sampledFrames++;for(const e of cap.events||[]){sceneEvents++;totalEvents++;if(ui?.safeRect&&!inside(e.box,ui.safeRect)){sceneViolations++;safeViolations++;errors.push(`${style}/${platform}/${role.role}@${f}: ${e.kind||'event'} outside safeRect ${JSON.stringify(e.box)}`);}}}cursor+=role.frames;}rows.push({style,platform,narrativePlanId:plan.narrative_plan_id,roles:actualPlates,totalFrames:window.RISO.total,safeRect:ui?.safeRect||null,sampledFrames:plan.roles.length*fractions.length,eventCount:sceneEvents,violationCount:sceneViolations});console.log(`${style}/${platform}: roles=${actualPlates.map(x=>`${x.role}:${x.frames}`).join('>')} events=${sceneEvents} violations=${sceneViolations}`);}}
const coverage={styles:Object.fromEntries(styles.map(s=>[s,rows.filter(r=>r.style===s).length])),platforms:Object.fromEntries(platforms.map(p=>[p,rows.filter(r=>r.platform===p).length]))};
const report={schema:'framewright-i05-c27-delivery-matrix-v1',sourcePlan:{id:item.id,bookId:item.bookId,angleId:item.angleId,revealTiming:item.revealTiming,narrativePlanId:plan.narrative_plan_id,roles:expectedPlates,totalFrames:plan.total_frames},scenes:rows.length,coverage,sampledFrames,totalEvents,safeViolations,errors,passed:errors.length===0,rows};
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({sourcePlan:report.sourcePlan,scenes:report.scenes,coverage,sampledFrames,totalEvents,safeViolations,errors:errors.length,passed:report.passed},null,2));if(errors.length)throw new Error(`I05 C27 delivery matrix failed with ${errors.length} errors`);
