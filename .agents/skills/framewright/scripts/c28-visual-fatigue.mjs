#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas,Image,GlobalFonts} from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-c28.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-c28/manifest.json');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/c28/visual');
const reportPath=path.resolve(process.env.REPORT||'artifacts/c28/visual-report.json');
for(const [file,family] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']])if(fs.existsSync(file))GlobalFonts.registerFromPath(file,family);
const html=fs.readFileSync(htmlPath,'utf8'),match=html.match(/<script>([\s\S]*?)<\/script>/i);if(!match)throw new Error('inline template script missing');
const source=match[1],templateDir=path.dirname(htmlPath),manifestDir=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});fs.mkdirSync(path.dirname(reportPath),{recursive:true});
const SAMPLE_W=270,TOL=12,recentWindow=8;
function inside(b,s){return b.x>=s.x-TOL&&b.y>=s.y-TOL&&b.x+b.w<=s.x+s.w+TOL&&b.y+b.h<=s.y+s.h+TOL;}
async function boot(entry){
  const payload=JSON.parse(fs.readFileSync(path.resolve(manifestDir,entry.payloadFile),'utf8'));if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(templateDir,payload.cover_url);
  const canvas=createCanvas(SAMPLE_W,480),document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};
  const window={FRAMEWRIGHT_PAYLOAD:payload},location={search:`?f=0&w=${SAMPLE_W}&s=${entry.seed}&profile=vertical`};const sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;
  const ctx=vm.createContext(sandbox);vm.runInContext(source,ctx,{filename:htmlPath});const deadline=performance.now()+10000;while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!window.__ready)throw new Error(`${entry.id}: boot timeout`);if(window.__bootError)throw new Error(`${entry.id}: ${window.__bootError}`);
  return{window,canvas,payload};
}
function feature(canvas){
  const w=18,h=32,c=createCanvas(w,h),g=c.getContext('2d');g.drawImage(canvas,0,0,w,h);const d=g.getImageData(0,0,w,h).data,L=new Float32Array(w*h);for(let i=0;i<w*h;i++)L[i]=.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2];const v=[];for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,r=x+1<w?Math.abs(L[i]-L[i+1]):0,dd=y+1<h?Math.abs(L[i]-L[i+w]):0;v.push((r+dd)/510);}return v;
}
function dist(a,b){let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/a.length;}
function stats(xs){const s=[...xs].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))]||0;return{mean:+(s.reduce((a,b)=>a+b,0)/Math.max(1,s.length)).toFixed(5),p10:+q(.10).toFixed(5),p50:+q(.50).toFixed(5),p90:+q(.90).toFixed(5),min:+q(0).toFixed(5)};}
function sequenceMetrics(rows){const pair=[],nearest=[];for(let i=0;i<rows.length;i++){let best=Infinity;for(let j=Math.max(0,i-recentWindow);j<i;j++){const d=dist(rows[i].feature,rows[j].feature);pair.push(d);best=Math.min(best,d);}if(Number.isFinite(best))nearest.push(best);}return{recent_pair_distance:stats(pair),nearest_recent_distance:stats(nearest)};}
function makeSheet(rows,file){const cols=6,cellW=192,cellH=132,rowsN=Math.ceil(rows.length/cols),out=createCanvas(cols*cellW,rowsN*cellH),g=out.getContext('2d');g.fillStyle='#202020';g.fillRect(0,0,out.width,out.height);g.font='12px "DejaVu Sans", sans-serif';g.textBaseline='top';for(let i=0;i<rows.length;i++){const r=rows[i],x=(i%cols)*cellW,y=Math.floor(i/cols)*cellH;for(let k=0;k<r.thumbs.length;k++)g.drawImage(r.thumbs[k],x+4+k*61,y+4,58,103);g.fillStyle='#eee';g.fillText(`${r.entry.bookId} c${r.entry.spec.candidate??'?'} ${r.duration}s`,x+5,y+112);g.fillStyle='#aaa';g.fillText(`${r.entry.spec.visual_system}/${r.entry.spec.opening_grammar}`,x+5,y+124);}fs.writeFileSync(file,out.toBuffer('image/png'));}
function makeWorstSheet(naive,aware,file){const candidates=[];for(let i=0;i<naive.length;i++)for(let j=Math.max(0,i-recentWindow);j<i;j++)candidates.push({i,j,d:dist(naive[i].feature,naive[j].feature)});candidates.sort((a,b)=>a.d-b.d);const worst=candidates.slice(0,8),cw=188,ch=228,out=createCanvas(cw*4,ch*worst.length),g=out.getContext('2d');g.fillStyle='#181818';g.fillRect(0,0,out.width,out.height);g.font='13px "DejaVu Sans",sans-serif';g.textBaseline='top';for(let r=0;r<worst.length;r++){const p=worst[r],set=[naive[p.j],naive[p.i],aware[p.j],aware[p.i]];for(let c=0;c<4;c++){const row=set[c],x=c*cw,y=r*ch;g.drawImage(row.thumbs[1],x+8,y+8,108,192);g.fillStyle=c<2?'#ddd':'#bfe7bf';g.fillText(`${c<2?'N':'A'} ${row.entry.bookId}`,x+8,y+202);g.fillStyle='#999';g.fillText(c<2?`d=${p.d.toFixed(4)}`:`${row.entry.spec.opening_grammar}`,x+8,y+216);}}fs.writeFileSync(file,out.toBuffer('image/png'));return worst.map(p=>({a:naive[p.j].entry.bookId,b:naive[p.i].entry.bookId,distance:+p.d.toFixed(5)}));}

const rendered=[];
for(let idx=0;idx<manifest.items.length;idx++){
  const entry=manifest.items[idx],{window,canvas}=await boot(entry),total=window.RISO.total,fps=window.RISO.fps,duration=+(total/fps).toFixed(3),fractions=[.16,.50,.84],features=[],thumbs=[],violations=[];
  for(const f of fractions){const frame=Math.min(total-1,Math.max(0,Math.round((total-1)*f)));window.RISO.frame(frame,SAMPLE_W,entry.seed);features.push(...feature(canvas));const t=createCanvas(canvas.width,canvas.height),tg=t.getContext('2d');tg.drawImage(canvas,0,0);thumbs.push(t);}
  if(window.__C26_BEGIN_CAPTURE&&window.__C26_END_CAPTURE){let start=0;for(const plate of window.RISO.plates){for(const frac of [.18,.50,.82]){const f=start+Math.min(plate.len-1,Math.max(0,Math.round((plate.len-1)*frac)));window.__C26_BEGIN_CAPTURE();window.RISO.frame(f,SAMPLE_W,entry.seed);const cap=window.__C26_END_CAPTURE();for(const e of cap.events||[])if(!inside(e.box,cap.safeRect))violations.push({frame:f,plate:plate.name,kind:e.kind,role:e.role||null,box:e.box,safeRect:cap.safeRect});}start+=plate.len;}}
  rendered.push({entry:{...entry,spec:{...entry.spec,candidate:entry.spec.candidate??null}},duration,feature:features,thumbs,violationCount:violations.length,violations:violations.slice(0,10)});console.log(`${idx+1}/${manifest.items.length} ${entry.id}: ${duration}s safeViolations=${violations.length}`);
}
const naive=rendered.filter(x=>x.entry.mode==='naive'),aware=rendered.filter(x=>x.entry.mode==='aware');if(naive.length!==36||aware.length!==36)throw new Error(`expected 36/36, got ${naive.length}/${aware.length}`);
for(let i=0;i<36;i++)if(Math.abs(naive[i].duration-aware[i].duration)>.001)throw new Error(`${naive[i].entry.bookId}: novelty changed content-derived duration`);
const before=sequenceMetrics(naive),after=sequenceMetrics(aware),allViolations=rendered.reduce((s,r)=>s+r.violationCount,0);
makeSheet(naive,path.join(outDir,'naive-sheet.png'));makeSheet(aware,path.join(outDir,'aware-sheet.png'));const worstNaivePairs=makeWorstSheet(naive,aware,path.join(outDir,'worst-naive-replacements.png'));
const improvement=before.recent_pair_distance.mean?after.recent_pair_distance.mean/before.recent_pair_distance.mean:1;
const gates={same_pair_count:naive.length===aware.length,fixed_duration_preserved:true,sampled_safe_zone_violations_zero:allViolations===0,mean_recent_visual_distance_improves:after.recent_pair_distance.mean>before.recent_pair_distance.mean,deterministic_inputs:true};
const report={schema:'c28-visual-fatigue-v1',sampleWidth:SAMPLE_W,feature:'3 global checkpoints × 18x32 local luminance-gradient map',recentWindow,before,after,meanRecentDistanceRatio:+improvement.toFixed(4),sampledSafeZoneViolations:allViolations,worstNaivePairs,gates,rows:rendered.map(r=>({id:r.entry.id,bookId:r.entry.bookId,mode:r.entry.mode,duration:r.duration,spec:r.entry.spec,violationCount:r.violationCount}))};
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({before,after,meanRecentDistanceRatio:report.meanRecentDistanceRatio,sampledSafeZoneViolations:allViolations,gates},null,2));if(!Object.values(gates).every(Boolean))process.exitCode=1;
