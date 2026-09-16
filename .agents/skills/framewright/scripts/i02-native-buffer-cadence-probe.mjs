#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas, Image, GlobalFonts} from '@napi-rs/canvas';
import {VideoEncoder, VideoFrame} from '@napi-rs/webcodecs';

const root=process.cwd();
const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-e18-for-i02.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-i02/manifest.json');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/i02-cadence');
const cadence=Math.max(1,Math.min(120,Math.trunc(Number(process.env.YIELD_EVERY||1))));
const bitrate=Math.max(250000,Math.trunc(Number(process.env.BITRATE||2000000)));
const queueLimit=Math.max(0,Math.min(64,Math.trunc(Number(process.env.QUEUE||8))));
const selector={bookId:process.env.BOOK_ID||'river-station',variant:process.env.VARIANT||'hook-first',profile:process.env.PROFILE||'vertical'};
for(const[file,family]of[['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','DejaVu Sans'],['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVu Sans']])GlobalFonts.registerFromPath(file,family);
await fsp.mkdir(outDir,{recursive:true});
const manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'));
const entry=manifest.items.find(x=>x.bookId===selector.bookId&&x.variant===selector.variant&&x.profile===selector.profile);
if(!entry)throw new Error(`fixture not found ${JSON.stringify(selector)}`);
const payload=JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath),entry.payloadFile),'utf8'));
if(payload.cover_url&&!/^[a-z]+:/i.test(payload.cover_url)&&!path.isAbsolute(payload.cover_url))payload.cover_url=path.resolve(path.dirname(htmlPath),payload.cover_url);
const html=await fsp.readFile(htmlPath,'utf8'),match=html.match(/<script>([\s\S]*?)<\/script>/i);if(!match)throw new Error('inline scene script not found');
const yieldTurn=()=>new Promise(r=>setImmediate(r));
function rss(){const m=fs.readFileSync('/proc/self/status','utf8').match(/^VmRSS:\s+(\d+)\s+kB/m);return m?Number(m[1])*1024:process.memoryUsage().rss;}
function cpuUsec(){try{const m=fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8').match(/^usage_usec\s+(\d+)/m);return m?Number(m[1]):null;}catch{return null;}}
function stat(xs){const v=[...xs].sort((a,b)=>a-b),q=p=>v[Math.min(v.length-1,Math.floor((v.length-1)*p))]||0,mean=v.reduce((a,b)=>a+b,0)/Math.max(1,v.length);return{mean:+mean.toFixed(3),p50:+q(.5).toFixed(3),p95:+q(.95).toFixed(3),min:+q(0).toFixed(3),max:+q(1).toFixed(3)};}
async function context(){const canvas=createCanvas(entry.width,entry.height);const document={createElement(n){if(String(n).toLowerCase()!=='canvas')throw new Error(`unsupported ${n}`);return createCanvas(1,1);},getElementById(id){return id==='c'?canvas:null;}};const window={FRAMEWRIGHT_PAYLOAD:structuredClone(payload)},location={search:`?f=0&w=${entry.width}&h=${entry.height}&s=${entry.seed}&profile=${entry.profile}`},sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};sandbox.globalThis=sandbox;window.window=window;window.document=document;window.location=location;const ctx=vm.createContext(sandbox);vm.runInContext(match[1],ctx,{filename:htmlPath});const deadline=performance.now()+10000;while(!window.__ready&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!window.__ready||window.__bootError)throw new Error(window.__bootError||'boot timeout');vm.runInContext(`globalThis.__render=(n,w,s)=>{renderFrame(n,w,s,document.getElementById('c'));return document.getElementById('c');};`,ctx);return{ctx,window,canvas};}
const start=performance.now(),cpu0=cpuUsec(),{ctx,window,canvas}=await context(),total=Number(window.RISO.total),fps=Number(window.RISO.fps),frameDur=Math.trunc(1e6/fps);
let peak=rss(),maxQueue=0,error=null,encodedBytes=0,chunks=0;const checkpoints=[{frame:-1,rssMiB:+(peak/1048576).toFixed(2)}],draw=[],extract=[],yieldMs=[];
const sampler=setInterval(()=>{peak=Math.max(peak,rss());},20);sampler.unref?.();
const encoder=new VideoEncoder({output(chunk){encodedBytes+=chunk.byteLength;chunks++;},error(e){error=e;}});
encoder.configure({codec:'avc1.420028',width:canvas.width,height:canvas.height,bitrate,framerate:fps,latencyMode:'realtime',hardwareAcceleration:'prefer-software'});
for(let frame=0;frame<total;frame++){
  const d0=performance.now(),rendered=ctx.__render(frame,entry.width,entry.seed);draw.push(performance.now()-d0);
  const e0=performance.now();{
    const rgba=rendered.getContext('2d').getImageData(0,0,rendered.width,rendered.height).data;
    const bytes=new Uint8Array(rgba.buffer,rgba.byteOffset,rgba.byteLength);
    const vf=new VideoFrame(bytes,{format:'RGBA',codedWidth:rendered.width,codedHeight:rendered.height,timestamp:Math.trunc(frame*1e6/fps),duration:frameDur});
    encoder.encode(vf,{keyFrame:frame===0||frame%Math.max(1,Math.round(fps*2))===0});vf.close();
  }
  extract.push(performance.now()-e0);maxQueue=Math.max(maxQueue,encoder.encodeQueueSize);
  const shouldYield=((frame+1)%cadence===0)||frame===total-1||encoder.encodeQueueSize>queueLimit;
  if(shouldYield){const y0=performance.now();await yieldTurn();yieldMs.push(performance.now()-y0);if(error)throw error;}
  if(frame%30===29||frame===total-1){const r=rss();peak=Math.max(peak,r);checkpoints.push({frame,rssMiB:+(r/1048576).toFixed(2),queue:encoder.encodeQueueSize});}
}
await encoder.flush();if(error)throw error;encoder.close();clearInterval(sampler);await yieldTurn();const end=performance.now(),endRss=rss(),cpu1=cpuUsec();peak=Math.max(peak,endRss);
const result={schema:'framewright-i02-native-buffer-cadence-v1',cadence,queueLimit,fixture:entry.id,frames:total,fps,bitrate,wallMs:+(end-start).toFixed(3),videosPerHour:+(3600000/(end-start)).toFixed(2),cpuMs:cpu0!=null&&cpu1!=null?+((cpu1-cpu0)/1000).toFixed(3):null,startRssMiB:checkpoints[0].rssMiB,endRssMiB:+(endRss/1048576).toFixed(2),peakRssMiB:+(peak/1048576).toFixed(2),maxQueue,encodedBytes,chunks,drawMs:stat(draw),extractMs:stat(extract),yieldMs:stat(yieldMs),yieldCount:yieldMs.length,checkpoints};
await fsp.writeFile(path.join(outDir,`cadence-${cadence}.json`),`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result));
