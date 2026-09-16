#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createCanvas,Image,GlobalFonts} from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-e17.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-e17/manifest.json');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/e17/videos');
const reportPath=path.resolve(process.env.REPORT||'artifacts/e17/batch.json');
const preset=process.env.PRESET||'veryfast',crf=+(process.env.CRF||22);
for(const [file,family] of [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf','DejaVu Sans Condensed'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf','DejaVu Sans Condensed'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf','DejaVu Serif'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf','DejaVu Serif']
])if(!GlobalFonts.registerFromPath(file,family))throw new Error(`failed to register ${file}`);
const html=fs.readFileSync(htmlPath,'utf8'),match=html.match(/<script>([\s\S]*?)<\/script>/i);if(!match)throw new Error('inline template script missing');
const source=match[1],templateDir=path.dirname(htmlPath),manifestDir=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});fs.mkdirSync(path.dirname(reportPath),{recursive:true});
function stats(xs){const s=[...xs].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))]||0;return{mean:+(s.reduce((a,b)=>a+b,0)/Math.max(1,s.length)).toFixed(3),p50:+q(.5).toFixed(3),p95:+q(.95).toFixed(3),max:+q(1).toFixed(3)};}
function rss(pid){try{const m=fs.readFileSync(`/proc/${pid}/status`,'utf8').match(/^VmRSS:\s+(\d+)\s+kB/m);return m?+m[1]*1024:0;}catch{return 0;}}
function warnings(ws){const m=new Map();for(const w of ws){const k=JSON.stringify([w.type,w.text,w.maxW]);const x=m.get(k)||{...w,count:0,firstFrame:w.frame};x.count++;x.firstFrame=Math.min(x.firstFrame,w.frame);m.set(k,x);}return[...m.values()];}
async function contextFor(payload,entry){
  const canvas=createCanvas(entry.width,entry.height),document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};
  const window={FRAMEWRIGHT_PAYLOAD:payload},location={search:`?f=0&w=${entry.width}&h=${entry.height}&s=${entry.seed}&profile=${entry.profile}`};
  const sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;
  const ctx=vm.createContext(sandbox),t0=performance.now();vm.runInContext(source,ctx,{filename:htmlPath});const deadline=performance.now()+10000;while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!window.__ready)throw new Error('boot timeout');if(window.__bootError)throw new Error(window.__bootError);
  vm.runInContext(`globalThis.__layoutWarnings=[];globalThis.__currentFrame=-1;const __fitBlock=fitBlock;fitBlock=function(g,text,o={}){const r=__fitBlock(g,text,o);font(g,r.size,o.weight||700);const maxW=o.maxW||900,widest=Math.max(0,...r.lines.map(line=>g.measureText(line).width));if(r.overflow||widest>maxW+.5)__layoutWarnings.push({type:r.overflow?'block-overflow':'block-width-overflow',frame:__currentFrame,text:String(text).slice(0,160),maxW,measured:widest});return r;};const __fitSingleSize=fitSingleSize;fitSingleSize=function(g,text,maxW,start=92,min=18,weight=700){const s=__fitSingleSize(g,text,maxW,start,min,weight);font(g,s,weight);const measured=g.measureText(text).width;if(measured>maxW+.5)__layoutWarnings.push({type:'label-overflow',frame:__currentFrame,text:String(text).slice(0,160),maxW,measured});return s;};globalThis.__renderRaw=(n,w,s)=>{__currentFrame=n;renderFrame(n,w,s,MAIN);return MAIN.getContext('2d').getImageData(0,0,MAIN.width,MAIN.height).data;};`,ctx);
  return{ctx,window,canvas,initMs:performance.now()-t0};
}
async function render(entry,index){
  const payloadPath=path.resolve(manifestDir,entry.payloadFile),payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'));if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(templateDir,payload.cover_url);
  const {ctx,window,initMs}=await contextFor(payload,entry),fps=window.RISO.fps,frames=window.RISO.totalFrames,output=path.join(outDir,`${entry.id}.mp4`),started=performance.now();
  const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${entry.width}x${entry.height}`,'-r',String(fps),'-i','-','-an','-c:v','libx264','-preset',preset,'-crf',String(crf),'-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:['pipe','pipe','pipe']});let err='',peak=process.memoryUsage().rss+rss(ff.pid);ff.stderr.on('data',d=>err+=d);const write=b=>new Promise((res,rej)=>{if(ff.stdin.write(b))res();else ff.stdin.once('drain',res);ff.stdin.once('error',rej);});for(let n=0;n<frames;n++){const rgba=ctx.__renderRaw(n,entry.width,entry.seed);await write(Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength));peak=Math.max(peak,process.memoryUsage().rss+rss(ff.pid));}ff.stdin.end();const code=await new Promise((res,rej)=>{ff.once('error',rej);ff.once('close',res);});if(code!==0)throw new Error(`${entry.id}: ffmpeg ${code}: ${err.slice(-2000)}`);const totalMs=performance.now()-started,stages=window.__C23_COMPOSITION?window.__C23_COMPOSITION():null;
  return{...entry,initMs:+initMs.toFixed(3),totalMs:+totalMs.toFixed(3),fps,outputBytes:fs.statSync(output).size,peakCombinedRssBytes:peak,nodeRssAfterBytes:process.memoryUsage().rss,layoutWarnings:warnings(ctx.__layoutWarnings),stages,output:path.relative(process.cwd(),output)};
}
const started=performance.now(),results=[];let peak=0;for(let i=0;i<manifest.items.length;i++){const r=await render(manifest.items[i],i);results.push(r);peak=Math.max(peak,r.peakCombinedRssBytes);console.log(`${i+1}/${manifest.items.length} ${r.id}: ${(r.totalMs/1000).toFixed(2)}s warnings=${r.layoutWarnings.length}`);}const wallMs=performance.now()-started,report={schema:'framewright-profile-batch-v1',count:results.length,wallMs:+wallMs.toFixed(3),videosPerHour:+(results.length*3600000/wallMs).toFixed(2),layoutWarnings:results.reduce((a,r)=>a+r.layoutWarnings.length,0),peakCombinedRssBytes:peak,host:{cpus:os.cpus().length},results};fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({count:report.count,videosPerHour:report.videosPerHour,layoutWarnings:report.layoutWarnings,peakMiB:+(report.peakCombinedRssBytes/1048576).toFixed(1)},null,2));
