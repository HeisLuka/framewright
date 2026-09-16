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
const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-e18-for-r42.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-r42/manifest.json');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/r42');
const audioPath=path.resolve(process.env.AUDIO||path.join(outDir,'track.m4a'));
const reportPath=path.resolve(process.env.REPORT||path.join(outDir,'report.json'));
const jobsN=Math.max(8,Math.min(32,Number(process.env.JOBS||12)));
const concurrencies=String(process.env.CONCURRENCIES||'1,2,3,4').split(',').map(Number).filter(x=>Number.isInteger(x)&&x>=1&&x<=8);
const bitrate=Number(process.env.BITRATE||3_000_000), queueLimit=8;
const profiles=['vertical','square','landscape'];
const wanted=['river-station','city-seven','long-title'];
await fsp.mkdir(outDir,{recursive:true});
for(const f of [htmlPath,manifestPath,audioPath]) if(!fs.existsSync(f)) throw new Error(`missing ${f}`);
const manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'));
const manifestDir=path.dirname(manifestPath);
const entries={};
for(const profile of profiles){
  entries[profile]=wanted.map(bookId=>manifest.items.find(x=>x.bookId===bookId&&x.variant==='hook-first'&&x.profile===profile)).filter(Boolean);
  if(entries[profile].length!==3) throw new Error(`expected 3 fixtures for ${profile}, got ${entries[profile].length}`);
  for(const e of entries[profile]) e.payload=JSON.parse(await fsp.readFile(path.resolve(manifestDir,e.payloadFile),'utf8'));
}
const html=await fsp.readFile(htmlPath,'utf8');
const uploads=new Map();
function ctype(f){return ({'.html':'text/html; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[path.extname(f).toLowerCase()]||'application/octet-stream';}
const server=http.createServer((req,res)=>{
  const u=new URL(req.url||'/','http://127.0.0.1');
  if(req.method==='POST'&&u.pathname.startsWith('/__r42_h264/')){const id=decodeURIComponent(u.pathname.slice('/__r42_h264/'.length)),a=[];req.on('data',d=>a.push(d));req.on('end',()=>{uploads.set(id,Buffer.concat(a));res.writeHead(204);res.end();});return;}
  if(u.pathname==='/examples/book-ad-systems/__r42_scene.html'){
    const profile=u.searchParams.get('profile'), idx=Number(u.searchParams.get('fixture')), e=entries[profile]?.[idx];
    if(!e){res.writeHead(404);res.end();return;}
    const injected=html.replace('<script>',`<script>window.FRAMEWRIGHT_PAYLOAD=${JSON.stringify(e.payload)};<\/script>\n<script>`);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(injected);return;
  }
  const rel=decodeURIComponent(u.pathname).replace(/^\/+/,''),file=path.resolve(root,rel||'.');
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.stat(file,(err,st)=>{if(err||!st.isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':ctype(file),'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);});
});
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
const origin=`http://127.0.0.1:${server.address().port}`;
function run(cmd,args){return new Promise((ok,no)=>{const p=spawn(cmd,args,{cwd:root,stdio:['ignore','pipe','pipe']});let o='',e='';p.stdout.on('data',d=>o+=d);p.stderr.on('data',d=>e+=d);p.once('error',no);p.once('close',c=>c===0?ok(o):no(new Error(`${cmd} ${c}\n${e.slice(-3000)}`)));});}
function cpuUsec(){try{return Number(fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8').match(/^usage_usec\s+(\d+)/m)?.[1]||0)}catch{return 0}}
function processTreeRss(){try{const rows=[];for(const n of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){try{const s=fs.readFileSync(`/proc/${n}/status`,'utf8');rows.push({pid:Number(n),ppid:Number(s.match(/^PPid:\s+(\d+)/m)?.[1]||0),rss:Number(s.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1]||0)*1024});}catch{}}const kids=new Map();for(const r of rows){if(!kids.has(r.ppid))kids.set(r.ppid,[]);kids.get(r.ppid).push(r.pid);}const keep=new Set([process.pid]),stack=[process.pid];while(stack.length){for(const k of kids.get(stack.pop())||[])if(!keep.has(k)){keep.add(k);stack.push(k);}}return rows.filter(r=>keep.has(r.pid)).reduce((a,r)=>a+r.rss,0);}catch{return 0}}
const hashRows=rows=>rows.map(x=>({f:x.f,sha256:crypto.createHash('sha256').update(Buffer.from(x.png.split(',')[1],'base64')).digest('hex')}));
function urlFor(profile,idx,seed){const e=entries[profile][idx],u=new URL('/examples/book-ad-systems/__r42_scene.html',origin);u.searchParams.set('profile',profile);u.searchParams.set('fixture',idx);u.searchParams.set('f','0');u.searchParams.set('w',String(e.width));u.searchParams.set('h',String(e.height));u.searchParams.set('s',String(seed));return u.href;}
async function navigate(page,profile,idx,seed){const t=performance.now();await page.goto(urlFor(profile,idx,seed),{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});return performance.now()-t;}
async function visualHashes(page,seed){return page.evaluate(async seed=>{const c=document.getElementById('c'),r=window.RISO,total=r.total,frames=[0,Math.floor(total*.25),Math.floor(total*.66),total-1],out=[];for(const f of frames){window.renderFrame(f,c.width,seed,c);out.push({f,png:c.toDataURL('image/png')});}return out;},seed);}
async function encode(page,id,e,seed){uploads.delete(id);const r=await page.evaluate(async({id,width,seed,bitrate,queueLimit})=>{const c=document.getElementById('c'),rt=window.RISO,total=rt.total,fps=rt.fps;window.renderFrame(0,width,seed,c);const cfg={codec:'avc1.420028',width:c.width,height:c.height,bitrate,framerate:fps,latencyMode:'realtime',avc:{format:'annexb'}},chunks=[];let bytes=0,drawMs=0;const enc=new VideoEncoder({output(ch){const b=new Uint8Array(ch.byteLength);ch.copyTo(b);chunks.push(b);bytes+=b.length},error(e){throw e}});enc.configure(cfg);const t0=performance.now();for(let f=0;f<total;f++){const d=performance.now();window.renderFrame(f,width,seed,c);drawMs+=performance.now()-d;const vf=new VideoFrame(c,{timestamp:Math.trunc(f*1e6/fps)});enc.encode(vf,{keyFrame:f===0||f%(fps*2)===0});vf.close();while(enc.encodeQueueSize>queueLimit)await new Promise(ok=>enc.addEventListener('dequeue',ok,{once:true}));}await enc.flush();const encodeMs=performance.now()-t0;enc.close();const body=new Uint8Array(bytes);let off=0;for(const b of chunks){body.set(b,off);off+=b.length}const u0=performance.now();const resp=await fetch(`/__r42_h264/${encodeURIComponent(id)}`,{method:'POST',body});if(!resp.ok)throw new Error(`upload ${resp.status}`);return{total,fps,encodeMs,drawMs,uploadMs:performance.now()-u0,bytes};},{id,width:e.width,seed,bitrate,queueLimit});const h=uploads.get(id);if(!h)throw new Error('upload missing');uploads.delete(id);return{...r,h};}
async function finish(id,x){const h=path.join(outDir,`${id}.h264`),m=path.join(outDir,`${id}.mp4`);await fsp.writeFile(h,x.h);const t=performance.now();await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-fflags','+genpts','-r',String(x.fps),'-i',h,'-i',audioPath,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','copy','-t',String(x.total/x.fps),'-movflags','+faststart',m]);const muxMs=performance.now()-t;await fsp.rm(h,{force:true});await fsp.rm(m,{force:true});return muxMs;}
async function buildRefs(){const b=await puppeteer.launch({headless:true,protocolTimeout:600000,args:['--no-sandbox','--disable-setuid-sandbox']});const refs={};try{for(const profile of profiles){refs[profile]=[];for(let i=0;i<3;i++){const e=entries[profile][i],p=await b.newPage();await navigate(p,profile,i,e.seed);refs[profile].push(hashRows(await visualHashes(p,e.seed)));await p.close();}}return refs;}finally{await b.close();}}
function quantile(xs,p){const a=[...xs].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor((a.length-1)*p))]||0;}
async function scenario(profile,concurrency,refs){const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:['--no-sandbox','--disable-setuid-sandbox']}),rows=[],failures=[];let peak=0;const pages=await Promise.all(Array.from({length:concurrency},()=>browser.newPage()));
  // warm page objects without encoding; steady-state wall begins after this.
  await Promise.all(pages.map((p,w)=>navigate(p,profile,w%3,entries[profile][w%3].seed)));
  const c0=cpuUsec(),t0=performance.now(),timer=setInterval(()=>{peak=Math.max(peak,processTreeRss())},40);
  try{await Promise.all(pages.map(async(p,w)=>{for(let j=w;j<jobsN;j+=concurrency){const idx=j%3,e=entries[profile][idx],seed=e.seed,start=performance.now();try{const loadMs=await navigate(p,profile,idx,seed);const got=hashRows(await visualHashes(p,seed)),parity=got.every((x,k)=>x.sha256===refs[profile][idx][k].sha256);if(!parity)throw new Error(`visual parity failed ${profile}/${e.bookId}`);const enc=await encode(p,`${profile}-c${concurrency}-${j}`,e,seed);const muxMs=await finish(`${profile}-c${concurrency}-${j}`,enc);rows.push({j,bookId:e.bookId,loadMs,encodeMs:enc.encodeMs,drawMs:enc.drawMs,uploadMs:enc.uploadMs,muxMs,wallMs:performance.now()-start,parity,h264Bytes:enc.bytes});}catch(err){failures.push({j,bookId:e.bookId,error:String(err?.stack||err)});}}}));}
  finally{clearInterval(timer);for(const p of pages)await p.close().catch(()=>{});await browser.close();}
  const scenarioWallMs=performance.now()-t0,cpuMs=(cpuUsec()-c0)/1000;return{profile,concurrency,jobs:rows.length,failures,scenarioWallMs:+scenarioWallMs.toFixed(2),videosPerHour:+(rows.length*3600000/scenarioWallMs).toFixed(2),p50JobMs:+quantile(rows.map(r=>r.wallMs),.5).toFixed(2),p95JobMs:+quantile(rows.map(r=>r.wallMs),.95).toFixed(2),cpuMsPerVideo:+(cpuMs/Math.max(1,rows.length)).toFixed(2),peakRssBytes:peak,allParity:rows.every(r=>r.parity),rows};}
try{const refs=await buildRefs(),results=[];for(const profile of profiles){for(const c of concurrencies){console.log(`R42 ${profile} c${c}`);const r=await scenario(profile,c,refs);results.push(r);console.log(JSON.stringify({profile,c,vph:r.videosPerHour,p50:r.p50JobMs,p95:r.p95JobMs,cpu:r.cpuMsPerVideo,rss:r.peakRssBytes,failures:r.failures.length},null,2));}}
  const decisions={};for(const profile of profiles){const rows=results.filter(r=>r.profile===profile),base=rows.find(r=>r.concurrency===2);if(!base)throw new Error(`c2 baseline missing ${profile}`);const eligible=rows.filter(r=>{const gain=r.videosPerHour/base.videosPerHour-1,p95=r.p95JobMs/base.p95JobMs-1,rss=r.peakRssBytes/base.peakRssBytes-1;return r.concurrency!==2&&gain>=.10&&p95<=.20&&rss<=.30&&!r.failures.length&&r.allParity;}).sort((a,b)=>b.videosPerHour-a.videosPerHour);const best=eligible[0]||base;decisions[profile]={baselineConcurrency:2,selectedConcurrency:best.concurrency,selectedVideosPerHour:best.videosPerHour,gainVsC2:+(best.videosPerHour/base.videosPerHour-1).toFixed(4),p95DeltaVsC2:+(best.p95JobMs/base.p95JobMs-1).toFixed(4),rssDeltaVsC2:+(best.peakRssBytes/base.peakRssBytes-1).toFixed(4),profileSpecificPromoted:best.concurrency!==2};}
  const report={schema:'nightwill-r42-profile-concurrency-v1',fixtures:Object.fromEntries(profiles.map(p=>[p,entries[p].map(e=>({id:e.id,bookId:e.bookId,style:e.style,width:e.width,height:e.height,seed:e.seed}))])),config:{jobsPerScenario:jobsN,concurrencies,bitrate,queueLimit,audio:'cached AAC stream-copy'},results,decisions};await fsp.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');const md=['# R42 delivery-profile concurrency matrix','',...profiles.map(p=>{const d=decisions[p];return `- ${p}: selected c${d.selectedConcurrency}; ${d.selectedVideosPerHour} videos/h; ${(d.gainVsC2*100).toFixed(1)}% vs c2; ${d.profileSpecificPromoted?'PROMOTE':'keep global c2'}`;}),''];await fsp.writeFile(path.join(outDir,'summary.md'),md.join('\n'));console.log(md.join('\n'));}finally{await new Promise(ok=>server.close(ok));}
