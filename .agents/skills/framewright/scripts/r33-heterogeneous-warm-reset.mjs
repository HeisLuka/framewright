#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';

const root=process.cwd();
const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-e18-for-r33.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-r33/manifest.json');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/r33');
const audioPath=path.resolve(process.env.AUDIO||path.join(outDir,'track.m4a'));
const reportPath=path.resolve(process.env.REPORT||path.join(outDir,'report.json'));
const jobsN=Math.max(6,Math.min(60,Number(process.env.JOBS||18)));
const concurrency=2, bitrate=Number(process.env.BITRATE||2000000), queueLimit=8;
await fsp.mkdir(outDir,{recursive:true});
for(const f of [htmlPath,manifestPath,audioPath]) if(!fs.existsSync(f)) throw new Error(`missing ${f}`);
const manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'));
const wanted=['river-station','city-seven','long-title'];
const entries=wanted.map(bookId=>manifest.items.find(x=>x.bookId===bookId&&x.variant==='hook-first'&&x.profile==='vertical')).filter(Boolean);
if(entries.length!==3) throw new Error(`expected 3 heterogeneous fixtures, got ${entries.length}`);
for(const e of entries) e.payload=JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath),e.payloadFile),'utf8'));
const html=await fsp.readFile(htmlPath,'utf8');
const uploads=new Map();
function ctype(f){return ({'.html':'text/html; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[path.extname(f).toLowerCase()]||'application/octet-stream';}
const server=http.createServer((req,res)=>{
 const u=new URL(req.url||'/','http://127.0.0.1');
 if(req.method==='POST'&&u.pathname.startsWith('/__r33_h264/')){const id=decodeURIComponent(u.pathname.slice(12)),a=[];req.on('data',d=>a.push(d));req.on('end',()=>{uploads.set(id,Buffer.concat(a));res.writeHead(204);res.end();});return;}
 if(u.pathname==='/examples/book-ad-systems/__r33_scene.html'){
   const idx=Number(u.searchParams.get('fixture')); const e=entries[idx]; if(!e){res.writeHead(404);res.end();return;}
   const injected=html.replace('<script>',`<script>window.FRAMEWRIGHT_PAYLOAD=${JSON.stringify(e.payload)};<\/script>\n<script>`);
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(injected);return;
 }
 const rel=decodeURIComponent(u.pathname).replace(/^\/+/,''), file=path.resolve(root,rel||'.');
 if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 fs.stat(file,(err,st)=>{if(err||!st.isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':ctype(file),'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);});
});
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
const origin=`http://127.0.0.1:${server.address().port}`;
function run(cmd,args){return new Promise((ok,no)=>{const p=spawn(cmd,args,{cwd:root,stdio:['ignore','pipe','pipe']});let o='',e='';p.stdout.on('data',d=>o+=d);p.stderr.on('data',d=>e+=d);p.once('error',no);p.once('close',c=>c===0?ok(o):no(new Error(`${cmd} ${c}\n${e.slice(-3000)}`)));});}
function cpu(){try{return Number(fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8').match(/^usage_usec\s+(\d+)/m)?.[1]||0)}catch{return 0}}
function rss(){try{let sum=0;for(const n of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){try{const s=fs.readFileSync(`/proc/${n}/status`,'utf8');const p=Number(s.match(/^PPid:\s+(\d+)/m)?.[1]),r=Number(s.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1]||0)*1024;if(Number(n)===process.pid||p===process.pid)sum+=r;}catch{}}return sum}catch{return 0}}
async function launch(){return puppeteer.launch({headless:true,protocolTimeout:600000,args:['--no-sandbox','--disable-setuid-sandbox']});}
function urlFor(idx,seed){const u=new URL('/examples/book-ad-systems/__r33_scene.html',origin);u.searchParams.set('fixture',idx);u.searchParams.set('f','0');u.searchParams.set('w',String(entries[idx].width));u.searchParams.set('s',String(seed));u.searchParams.set('profile','vertical');return u.href;}
async function navigate(page,idx,seed){const t=performance.now();await page.goto(urlFor(idx,seed),{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});return performance.now()-t;}
async function visualHashes(page){return page.evaluate(async()=>{const c=document.getElementById('c'),r=window.RISO,total=r.total;const frames=[0,Math.floor(total*.25),Math.floor(total*.66),total-1];const out=[];for(const f of frames){window.renderFrame(f,c.width,7,c);out.push({f,png:c.toDataURL('image/png')});}return out;});}
const hashRows=rows=>rows.map(x=>({f:x.f,sha256:crypto.createHash('sha256').update(Buffer.from(x.png.split(',')[1],'base64')).digest('hex')}));
async function encode(page,id,entry,seed){uploads.delete(id);const r=await page.evaluate(async({id,width,seed,bitrate,queueLimit})=>{const c=document.getElementById('c'),rt=window.RISO,total=rt.total,fps=rt.fps;window.renderFrame(0,width,seed,c);const cfg={codec:'avc1.420028',width:c.width,height:c.height,bitrate,framerate:fps,latencyMode:'realtime',avc:{format:'annexb'}};const chunks=[];let bytes=0,drawMs=0;const enc=new VideoEncoder({output(ch){const b=new Uint8Array(ch.byteLength);ch.copyTo(b);chunks.push(b);bytes+=b.length},error(e){throw e}});enc.configure(cfg);const t0=performance.now();for(let f=0;f<total;f++){const d=performance.now();window.renderFrame(f,width,seed,c);drawMs+=performance.now()-d;const vf=new VideoFrame(c,{timestamp:Math.trunc(f*1e6/fps)});enc.encode(vf,{keyFrame:f===0||f%(fps*2)===0});vf.close();while(enc.encodeQueueSize>queueLimit)await new Promise(ok=>enc.addEventListener('dequeue',ok,{once:true}));}await enc.flush();const encodeMs=performance.now()-t0;enc.close();const body=new Uint8Array(bytes);let off=0;for(const b of chunks){body.set(b,off);off+=b.length}const u0=performance.now();const resp=await fetch(`/__r33_h264/${encodeURIComponent(id)}`,{method:'POST',body});if(!resp.ok)throw new Error(`upload ${resp.status}`);return{total,fps,encodeMs,drawMs,uploadMs:performance.now()-u0};},{id,width:entry.width,seed,bitrate,queueLimit});const h=uploads.get(id);if(!h)throw new Error('upload missing');uploads.delete(id);return{...r,h};}
async function finish(id,x){const h=path.join(outDir,`${id}.h264`),m=path.join(outDir,`${id}.mp4`);await fsp.writeFile(h,x.h);const t=performance.now();await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-fflags','+genpts','-r',String(x.fps),'-i',h,'-i',audioPath,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','copy','-t',String(x.total/x.fps),'-movflags','+faststart',m]);const muxMs=performance.now()-t;await fsp.rm(h,{force:true});await fsp.rm(m,{force:true});return muxMs;}
async function referenceHashes(browser){const refs=[];for(let i=0;i<entries.length;i++){const p=await browser.newPage();await navigate(p,i,7);refs.push(hashRows(await visualHashes(p)));await p.close();}return refs;}
async function scenario(mode){const browser=await launch(), refs=await referenceHashes(browser), rows=[],failures=[];let peak=0;const c0=cpu(),t0=performance.now();const timer=setInterval(()=>peak=Math.max(peak,rss()),40);try{const workers=await Promise.all(Array.from({length:concurrency},async()=>mode==='navigate'?browser.newPage():null));await Promise.all(Array.from({length:concurrency},async(_,w)=>{for(let j=w;j<jobsN;j+=concurrency){const idx=j%entries.length,e=entries[idx],seed=e.seed+(j%5),start=performance.now();let p=workers[w];try{if(mode==='fresh')p=await browser.newPage();const loadMs=await navigate(p,idx,seed);const got=hashRows(await visualHashes(p));const parity=got.every((x,k)=>x.sha256===refs[idx][k].sha256);if(!parity)throw new Error(`visual parity failed ${e.bookId}`);const en=await encode(p,`${mode}-${j}`,e,seed);const muxMs=await finish(`${mode}-${j}`,en);rows.push({j,bookId:e.bookId,loadMs,encodeMs:en.encodeMs,muxMs,wallMs:performance.now()-start,parity});}catch(err){failures.push({j,bookId:e.bookId,error:String(err?.stack||err)})}finally{if(mode==='fresh'&&p)await p.close().catch(()=>{})}}}));for(const p of workers)if(p)await p.close().catch(()=>{});}finally{clearInterval(timer);await browser.close();}const wall=performance.now()-t0,cpuMs=(cpu()-c0)/1000;const vals=rows.map(x=>x.wallMs).sort((a,b)=>a-b),q=p=>vals[Math.min(vals.length-1,Math.floor((vals.length-1)*p))]||0;const loads=rows.map(x=>x.loadMs).sort((a,b)=>a-b),ql=p=>loads[Math.min(loads.length-1,Math.floor((loads.length-1)*p))]||0;return{mode,jobs:rows.length,failures,scenarioWallMs:+wall.toFixed(2),videosPerHour:+(rows.length*3600000/wall).toFixed(2),p50JobMs:+q(.5).toFixed(2),p95JobMs:+q(.95).toFixed(2),p50LoadMs:+ql(.5).toFixed(2),p95LoadMs:+ql(.95).toFixed(2),cpuMs:+cpuMs.toFixed(2),cpuMsPerVideo:+(cpuMs/Math.max(1,rows.length)).toFixed(2),peakRssBytes:peak,allParity:rows.every(x=>x.parity),rows};}
try{
 console.log('R33 heterogeneous fixtures',entries.map(e=>`${e.bookId}:${e.style}`).join(', '));
 const fresh=await scenario('fresh'); console.log('fresh',fresh);
 const navigateReuse=await scenario('navigate'); console.log('navigate',navigateReuse);
 const gain=fresh.videosPerHour?navigateReuse.videosPerHour/fresh.videosPerHour-1:0;
 const residualNavigationCeiling=navigateReuse.p50JobMs?navigateReuse.p50LoadMs/navigateReuse.p50JobMs:0;
 const correctnessPass=fresh.allParity&&navigateReuse.allParity&&!fresh.failures.length&&!navigateReuse.failures.length;
 const deepSwapWorthTesting=correctnessPass&&residualNavigationCeiling>=.10;
 const report={schema:'framewright-r33-heterogeneous-warm-reset-v2',fixtures:entries.map(e=>({id:e.id,bookId:e.bookId,style:e.style,width:e.width,height:e.height,seed:e.seed})),config:{jobs:jobsN,concurrency,bitrate},results:{fresh,navigateReuse},decision:{navigateGainVsFresh:+gain.toFixed(4),residualNavigationCeiling:+residualNavigationCeiling.toFixed(4),correctnessPass,deepSwapWorthTesting}};
 await fsp.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
 const md=`# R33 heterogeneous warm reset\n\nFresh-page c2: **${fresh.videosPerHour} videos/h**; same page-object + full document navigation c2: **${navigateReuse.videosPerHour} videos/h** (${(gain*100).toFixed(1)}%).\n\nVisual parity against fresh per-book references: **${correctnessPass?'PASS':'FAIL'}**.\n\nNavigation is only **${navigateReuse.p50LoadMs.toFixed(1)} ms p50** of a **${navigateReuse.p50JobMs.toFixed(1)} ms p50** job, so the optimistic residual ceiling for eliminating navigation is about **${(residualNavigationCeiling*100).toFixed(1)}%** before accounting for the work a mutable reset would still need.\n\nDecision: ${deepSwapWorthTesting?'mutable in-document reset still clears the 10% residual ceiling and earns a deep pass':'keep full document navigation as the safe heterogeneous reset contract; mutable in-document payload swapping does not clear the deep-pass gate'}.\n`;
 await fsp.writeFile(path.join(outDir,'summary.md'),md); console.log(md);
}finally{await new Promise(ok=>server.close(ok));}
