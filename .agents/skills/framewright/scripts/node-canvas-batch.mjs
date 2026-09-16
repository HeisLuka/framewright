#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createCanvas, Image, GlobalFonts } from '@napi-rs/canvas';

const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-v0/index-e08.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-v0/generated-e08/manifest.json');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/e08/videos');
const reportPath=path.resolve(process.env.REPORT||'artifacts/e08/batch.json');
const width=+(process.env.WIDTH||1080), preset=process.env.PRESET||'veryfast', crf=+(process.env.CRF||22);
for(const [file,family] of [['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']]){
  if(!GlobalFonts.registerFromPath(file,family)) throw new Error(`failed to register ${file}`);
}
const html=fs.readFileSync(htmlPath,'utf8'), match=html.match(/<script>([\s\S]*?)<\/script>/i);
if(!match) throw new Error(`No inline script in ${htmlPath}`);
const source=match[1], templateDir=path.dirname(htmlPath), manifestDir=path.dirname(manifestPath);
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(!Array.isArray(manifest.items)||!manifest.items.length) throw new Error('manifest.items is empty');
fs.rmSync(outDir,{recursive:true,force:true}); fs.mkdirSync(outDir,{recursive:true}); fs.mkdirSync(path.dirname(reportPath),{recursive:true});

function stats(xs){const s=[...xs].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))]||0;return{mean:+(s.reduce((a,b)=>a+b,0)/Math.max(1,s.length)).toFixed(3),p50:+q(.5).toFixed(3),p95:+q(.95).toFixed(3),max:+q(1).toFixed(3)};}
function rssBytes(pid){try{const m=fs.readFileSync(`/proc/${pid}/status`,'utf8').match(/^VmRSS:\s+(\d+)\s+kB/m);return m?+m[1]*1024:0;}catch{return 0;}}
function resolvePayloadFile(rel){return path.isAbsolute(rel)?rel:path.resolve(manifestDir,rel);}
function uniqueWarnings(ws){const map=new Map();for(const w of ws){const key=JSON.stringify([w.type,w.text,w.maxW]);const v=map.get(key)||{...w,count:0,firstFrame:w.frame};v.count++;v.firstFrame=Math.min(v.firstFrame,w.frame);map.set(key,v);}return [...map.values()];}

async function makeContext(payload,seed){
  const mainCanvas=createCanvas(width,Math.round(width*16/9));
  const document={createElement(name){if(String(name).toLowerCase()!=='canvas')throw new Error(`Unsupported element ${name}`);return createCanvas(1,1);},getElementById(id){return id==='c'?mainCanvas:null;}};
  const window={FRAMEWRIGHT_PAYLOAD:payload};
  const sandbox={window,document,Image,URLSearchParams,location:{search:`?f=0&w=${width}&s=${seed}`},console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};
  sandbox.globalThis=sandbox; window.window=window; window.document=document; window.location=sandbox.location;
  const context=vm.createContext(sandbox); const t0=performance.now(); vm.runInContext(source,context,{filename:htmlPath});
  const deadline=performance.now()+10000; while(!window.__ready&&performance.now()<deadline) await new Promise(r=>setTimeout(r,10));
  if(!window.__ready) throw new Error('template boot timeout'); if(window.__bootError) throw new Error(window.__bootError);
  vm.runInContext(`
    globalThis.__layoutWarnings=[]; globalThis.__currentFrame=-1;
    const __fitBlock=fitBlock; fitBlock=function(g,text,o={}){const r=__fitBlock(g,text,o);font(g,r.size,o.weight||700);const maxW=o.maxW||900;const widest=Math.max(0,...r.lines.map(line=>g.measureText(line).width));if(r.overflow||widest>maxW+.5)__layoutWarnings.push({type:r.overflow?'block-overflow':'block-width-overflow',frame:__currentFrame,text:String(text).slice(0,160),maxW,measured:widest});return r;};
    const __fitSingleSize=fitSingleSize; fitSingleSize=function(g,text,maxW,start=92,min=18,weight=700){const s=__fitSingleSize(g,text,maxW,start,min,weight);font(g,s,weight);const measured=g.measureText(text).width;if(measured>maxW+.5)__layoutWarnings.push({type:'label-overflow',frame:__currentFrame,text:String(text).slice(0,160),maxW,measured});return s;};
    globalThis.__renderRaw=(n,w,s)=>{__currentFrame=n;renderFrame(n,w,s,MAIN);return MAIN.getContext('2d').getImageData(0,0,MAIN.width,MAIN.height).data;};
  `,context);
  return {context,window,mainCanvas,initMs:performance.now()-t0};
}

async function renderOne(entry,index){
  const payloadFile=resolvePayloadFile(entry.payloadFile), payload=JSON.parse(fs.readFileSync(payloadFile,'utf8'));
  if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url)) payload.cover_url=path.resolve(templateDir,payload.cover_url);
  const seed=+(entry.seed??7), id=entry.id||`item-${index+1}`, out=path.join(outDir,`${String(index+1).padStart(2,'0')}-${id}.mp4`);
  const {context,window,mainCanvas,initMs}=await makeContext(payload,seed); const total=window.RISO.total,fps=window.RISO.fps,height=mainCanvas.height;
  const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${width}x${height}`,'-r',String(fps),'-i','-','-c:v','libx264','-preset',preset,'-crf',String(crf),'-maxrate','14M','-bufsize','28M','-pix_fmt','yuv420p','-movflags','+faststart',out],{stdio:['pipe','ignore','pipe']});
  let ffErr='';ff.stderr.on('data',d=>ffErr+=d.toString()); const renderMs=[],writeWaitMs=[];let peakCombinedRss=0; const t0=performance.now();
  for(let i=0;i<total;i++){
    const a=performance.now(), rgba=context.__renderRaw(i,width,seed),b=performance.now();renderMs.push(b-a);
    const buf=Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength),w0=performance.now();if(!ff.stdin.write(buf))await new Promise(r=>ff.stdin.once('drain',r));writeWaitMs.push(performance.now()-w0);
    if(i%15===0) peakCombinedRss=Math.max(peakCombinedRss,rssBytes(process.pid)+rssBytes(ff.pid));
  }
  ff.stdin.end(); await new Promise((res,rej)=>{ff.on('error',rej);ff.on('close',code=>code===0?res():rej(new Error(`ffmpeg ${code}: ${ffErr}`)));});
  const totalMs=performance.now()-t0,warnings=uniqueWarnings(context.__layoutWarnings||[]); peakCombinedRss=Math.max(peakCombinedRss,rssBytes(process.pid));
  return {id,payloadFile:path.relative(process.cwd(),payloadFile),seed,initMs:+initMs.toFixed(3),totalMs:+totalMs.toFixed(3),fps:+(total/(totalMs/1000)).toFixed(3),outputBytes:fs.statSync(out).size,peakCombinedRssBytes:peakCombinedRss,nodeRssAfterBytes:rssBytes(process.pid),layoutWarnings:warnings,stages:{renderMs:stats(renderMs),writeWaitMs:stats(writeWaitMs)},output:path.relative(process.cwd(),out)};
}

const batchT0=performance.now(),results=[];let peakCombinedRss=0;
for(let i=0;i<manifest.items.length;i++){const r=await renderOne(manifest.items[i],i);results.push(r);peakCombinedRss=Math.max(peakCombinedRss,r.peakCombinedRssBytes);console.log(`${i+1}/${manifest.items.length} ${r.id}: ${(r.totalMs/1000).toFixed(2)}s, ${r.fps} fps, warnings=${r.layoutWarnings.length}`);}
const batchMs=performance.now()-batchT0,videoTimes=results.map(r=>r.totalMs),warningCount=results.reduce((a,r)=>a+r.layoutWarnings.length,0),cpu=os.cpus();
const report={schema:'framewright-e08-node-canvas-batch-v2',renderer:'@napi-rs/canvas',font:'DejaVu Sans pinned',host:{platform:process.platform,arch:process.arch,node:process.version,cpus:cpu.length,cpuModel:cpu[0]?.model||null,totalMemoryBytes:os.totalmem()},width,height:Math.round(width*16/9),preset,crf,count:results.length,batchMs:+batchMs.toFixed(3),videosPerHour:+(results.length*3600000/batchMs).toFixed(2),perVideoMs:stats(videoTimes),peakCombinedRssBytes:peakCombinedRss,layoutWarningGroups:warningCount,results};
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)); console.log(JSON.stringify({host:report.host,batchMs:report.batchMs,videosPerHour:report.videosPerHour,perVideoMs:report.perVideoMs,peakCombinedRssMiB:+(peakCombinedRss/1048576).toFixed(1),layoutWarningGroups:warningCount},null,2));
