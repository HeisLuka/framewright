#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createCanvas, Image, GlobalFonts } from '@napi-rs/canvas';

const ROOT = process.cwd();
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-v0/index.html');
const payloadPath = path.resolve(process.env.PAYLOAD || 'examples/book-ad-v0/payload.example.json');
const output = path.resolve(process.env.OUT || '.bench/i02/browserless.mp4');
const reportPath = path.resolve(process.env.REPORT || '.bench/i02/browserless.json');
const samplesDir = path.resolve(process.env.SAMPLES_DIR || '.bench/i02/node-samples');
const width = Number(process.env.WIDTH || 1080);
const height = Number(process.env.HEIGHT || 1920);
const fps = Number(process.env.FPS || 30);
const totalFrames = Number(process.env.TOTAL_FRAMES || 360);
const seed = Number(process.env.SEED || 7);
const bitrate = Number(process.env.BITRATE || 3000000);
const preset = process.env.X264_PRESET || 'veryfast';
const sampleFrames = String(process.env.SAMPLE_FRAMES || '0,89,90,239,240,359').split(',').map(Number).filter(Number.isFinite);

for (const [file, family] of [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'Arial'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'Arial'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'DejaVu Sans'],
]) {
  if (fs.existsSync(file)) GlobalFonts.registerFromPath(file, family);
}

function stat(values) {
  const xs = [...values].sort((a,b)=>a-b);
  const mean = xs.reduce((a,b)=>a+b,0) / Math.max(1,xs.length);
  const q = p => xs[Math.min(xs.length-1, Math.floor((xs.length-1)*p))] ?? 0;
  return { mean:+mean.toFixed(3), p50:+q(.5).toFixed(3), p95:+q(.95).toFixed(3), max:+q(1).toFixed(3) };
}
function cgroupCpuUsec() {
  try { const m=fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8').match(/^usage_usec\s+(\d+)/m); return m?Number(m[1]):null; } catch { return null; }
}
function procTreeRssBytes(rootPid=process.pid) {
  try {
    const pids=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)).map(Number), parent=new Map(), rss=new Map();
    for (const pid of pids) { try { const s=fs.readFileSync(`/proc/${pid}/status`,'utf8'); const p=s.match(/^PPid:\s+(\d+)/m), r=s.match(/^VmRSS:\s+(\d+)\s+kB/m); if(p)parent.set(pid,Number(p[1])); if(r)rss.set(pid,Number(r[1])*1024); } catch {} }
    const wanted=new Set([rootPid]); let changed=true;
    while(changed){changed=false; for(const [pid,ppid] of parent){if(wanted.has(ppid)&&!wanted.has(pid)){wanted.add(pid);changed=true;}}}
    let total=0; for(const pid of wanted) total+=rss.get(pid)||0; return total;
  } catch { return 0; }
}

const html = await fsp.readFile(htmlPath,'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!match) throw new Error('inline scene script not found');
const sceneSource = match[1];
const payload = JSON.parse(await fsp.readFile(payloadPath,'utf8'));
if (payload.cover_url && !/^[a-z]+:/i.test(payload.cover_url) && !path.isAbsolute(payload.cover_url)) payload.cover_url=path.resolve(path.dirname(htmlPath),payload.cover_url);

const canvas=createCanvas(width,height);
const document={
  createElement(name){if(String(name).toLowerCase()!=='canvas')throw new Error(`unsupported element ${name}`); return createCanvas(1,1);},
  getElementById(id){return id==='c'?canvas:null;},
};
const window={FRAMEWRIGHT_PAYLOAD:payload};
const location={search:`?f=0&w=${width}&h=${height}&s=${seed}`};
const sandbox={window,document,Image,URLSearchParams,location,console,performance,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}};
sandbox.globalThis=sandbox; window.window=window; window.document=document; window.location=location;
const ctx=vm.createContext(sandbox);
const init0=performance.now();
vm.runInContext(sceneSource,ctx,{filename:htmlPath});
const deadline=performance.now()+10000;
while(!window.__ready && performance.now()<deadline) await new Promise(r=>setTimeout(r,10));
if(!window.__ready) throw new Error('node scene boot timeout');
if(window.__bootError) throw new Error(window.__bootError);
vm.runInContext(`globalThis.__i02Render=(n,w,s)=>{renderFrame(n,w,s,document.getElementById('c'));return document.getElementById('c');};`,ctx);
const initMs=performance.now()-init0;
if(Number(window.RISO?.fps)!==fps || Number(window.RISO?.total)!==totalFrames) throw new Error(`scene timeline mismatch: ${JSON.stringify(window.RISO)}`);

await fsp.mkdir(path.dirname(output),{recursive:true});
await fsp.mkdir(samplesDir,{recursive:true});
const args=['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${width}x${height}`,'-r',String(fps),'-i','-','-an','-c:v','libx264','-preset',preset,'-b:v',String(bitrate),'-maxrate',String(bitrate),'-bufsize',String(bitrate*2),'-pix_fmt','yuv420p','-movflags','+faststart',output];
const ff=spawn('ffmpeg',args,{cwd:ROOT,stdio:['pipe','ignore','pipe']});
let fferr=''; ff.stderr.on('data',d=>fferr+=d);
const renderMs=[], writeMs=[];
let peakRss=procTreeRssBytes(); const cpu0=cgroupCpuUsec();
const sampler=setInterval(()=>{peakRss=Math.max(peakRss,procTreeRssBytes());},20); sampler.unref?.();
const wall0=performance.now();
for(let frame=0;frame<totalFrames;frame+=1){
  const r0=performance.now(); const rendered=ctx.__i02Render(frame,width,seed); renderMs.push(performance.now()-r0);
  if(sampleFrames.includes(frame)) await fsp.writeFile(path.join(samplesDir,`${String(frame).padStart(3,'0')}.png`),rendered.toBuffer('image/png'));
  const rgba=rendered.getContext('2d').getImageData(0,0,rendered.width,rendered.height).data;
  const buf=Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength);
  const w0=performance.now(); if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r)); writeMs.push(performance.now()-w0);
}
ff.stdin.end();
await new Promise((resolve,reject)=>{ff.once('error',reject);ff.once('close',code=>code===0?resolve():reject(new Error(`ffmpeg exited ${code}: ${fferr.slice(-4000)}`)));});
clearInterval(sampler); peakRss=Math.max(peakRss,procTreeRssBytes());
const cpu1=cgroupCpuUsec(); const wallMs=performance.now()-wall0;
const report={
  schema:'i02-browserless-reference-v1',backend:'@napi-rs/canvas -> raw RGBA -> FFmpeg libx264',
  input:{html:path.relative(ROOT,htmlPath),payload:path.relative(ROOT,payloadPath),width,height,fps,totalFrames,seed,bitrate,preset},
  timing:{init_ms:+initMs.toFixed(3),wall_ms:+wallMs.toFixed(3),videos_per_hour:+(3600000/wallMs).toFixed(2),render_frame_ms:stat(renderMs),write_wait_ms:stat(writeMs)},
  resources:{peak_process_tree_rss_mib:+(peakRss/1048576).toFixed(2),cgroup_cpu_ms:cpu0!=null&&cpu1!=null?+((cpu1-cpu0)/1000).toFixed(3):null},
  output:{path:output,bytes:fs.statSync(output).size},samples:sampleFrames,
};
await fsp.writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify(report,null,2));
