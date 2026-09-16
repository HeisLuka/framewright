#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';

const root=process.cwd();
const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-e18-for-r31.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-r31/manifest.json');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/r31');
const reportPath=path.resolve(process.env.REPORT||path.join(outDir,'report.json'));
const bitrates=String(process.env.BITRATES||'2000000,3000000,4000000,5000000').split(',').map(Number).filter(Number.isFinite);
const queueLimit=8;
await fsp.mkdir(outDir,{recursive:true});
for(const f of [htmlPath,manifestPath]) if(!fs.existsSync(f)) throw new Error(`missing ${f}`);
const manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'));
const entry=manifest.items.find(x=>x.bookId==='river-station'&&x.variant==='hook-first'&&x.profile==='vertical');
if(!entry) throw new Error('river-station hook-first vertical fixture missing');
const payload=JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath),entry.payloadFile),'utf8'));
if(entry.style!=='paper') throw new Error(`expected paper style, got ${entry.style}`);

function run(cmd,args,{stdin}={}){return new Promise((ok,no)=>{const p=spawn(cmd,args,{cwd:root,stdio:['pipe','pipe','pipe']});let o='',e='';p.stdout.on('data',d=>o+=d);p.stderr.on('data',d=>e+=d);p.once('error',no);p.once('close',c=>c===0?ok({stdout:o,stderr:e}):no(new Error(`${cmd} exited ${c}\n${e.slice(-5000)}`)));if(stdin){(async()=>{try{for await(const b of stdin){if(!p.stdin.write(b))await new Promise(r=>p.stdin.once('drain',r));}p.stdin.end();}catch(err){p.stdin.destroy(err);}})();}else p.stdin.end();});}
function ctype(f){return ({'.html':'text/html; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[path.extname(f).toLowerCase()]||'application/octet-stream';}
const uploads=new Map();
const server=http.createServer((req,res)=>{const u=new URL(req.url||'/','http://127.0.0.1');if(req.method==='POST'&&u.pathname.startsWith('/__r31_h264/')){const id=decodeURIComponent(u.pathname.slice('/__r31_h264/'.length)),a=[];req.on('data',d=>a.push(d));req.on('end',()=>{uploads.set(id,Buffer.concat(a));res.writeHead(204);res.end();});return;}const rel=decodeURIComponent(u.pathname).replace(/^\/+/,''),f=path.resolve(root,rel||'.');if(f!==root&&!f.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.stat(f,(err,st)=>{if(err||!st.isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':ctype(f),'Cache-Control':'no-store'});fs.createReadStream(f).pipe(res);});});
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});const origin=`http://127.0.0.1:${server.address().port}`;

function clampRoi(r,w,h){const x=Math.max(0,Math.min(w-2,Math.round(r.x))),y=Math.max(0,Math.min(h-2,Math.round(r.y)));return{...r,x,y,w:Math.max(2,Math.min(w-x,Math.round(r.w))),h:Math.max(2,Math.min(h-y,Math.round(r.h)))};}
const ROI={
 hook:{frame:45,rect:{x:76,y:620,w:928,h:700}},
 book_cover:{frame:165,rect:{x:120,y:450,w:430,h:650}},
 book_title:{frame:165,rect:{x:570,y:540,w:434,h:470}},
 book_hook:{frame:195,rect:{x:490,y:1120,w:514,h:320}},
 cta_cover:{frame:285,rect:{x:350,y:500,w:380,h:560}},
 cta_title:{frame:300,rect:{x:60,y:1080,w:960,h:300}},
 cta_button:{frame:330,rect:{x:160,y:1340,w:760,h:220}},
};

async function metric(kind,ref,cand,roi){const crop=`crop=${roi.w}:${roi.h}:${roi.x}:${roi.y}`;const filt=kind==='ssim'?`[0:v]${crop}[a];[1:v]${crop}[b];[a][b]ssim`:`[0:v]${crop}[a];[1:v]${crop}[b];[a][b]psnr`;const {stderr}=await run('ffmpeg',['-hide_banner','-loglevel','info','-i',ref,'-i',cand,'-lavfi',filt,'-f','null','-']);const re=kind==='ssim'?/All:([0-9.]+)/g:/average:([0-9.]+)/g;const m=[...stderr.matchAll(re)].at(-1);return m?Number(m[1]):null;}
async function decodeFrame(video,frame,out){await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',video,'-vf',`select=eq(n\\,${frame})`,'-vsync','0','-frames:v','1',out]);}

let browser;
try{
 browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:['--no-sandbox','--disable-setuid-sandbox']});
 const page=await browser.newPage();
 await page.evaluateOnNewDocument(p=>{window.FRAMEWRIGHT_PAYLOAD=p;},payload);
 const rel=path.relative(root,htmlPath).split(path.sep).map(encodeURIComponent).join('/');const url=new URL(`/${rel}`,origin);url.searchParams.set('f','0');url.searchParams.set('w',String(entry.width));url.searchParams.set('s',String(entry.seed));url.searchParams.set('profile',entry.profile);
 await page.goto(url.href,{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});
 const scene=await page.evaluate(()=>({total:Number(window.RISO.total),fps:Number(window.RISO.fps),width:document.getElementById('c').width,height:document.getElementById('c').height,plates:window.RISO.plates}));
 const rois=Object.fromEntries(Object.entries(ROI).map(([k,v])=>[k,{frame:v.frame,rect:clampRoi(v.rect,scene.width,scene.height)}]));
 const refs=path.join(outDir,'refs');const decoded=path.join(outDir,'decoded');await fsp.mkdir(refs,{recursive:true});await fsp.mkdir(decoded,{recursive:true});
 for(const [name,r] of Object.entries(rois)){const data=await page.evaluate(({f,w,s})=>{const c=document.getElementById('c');window.renderFrame(f,w,s,c);return c.toDataURL('image/png');},{f:r.frame,w:entry.width,s:entry.seed});await fsp.writeFile(path.join(refs,`${name}.png`),Buffer.from(data.split(',')[1],'base64'));}

 // Exact same Chromium Canvas raster -> x264 CRF22 reference. PNG pipe is intentionally slow but happens once in this quality scout.
 const x264=path.join(outDir,'x264-crf22.mp4');
 async function* pngFrames(){for(let f=0;f<scene.total;f++){const data=await page.evaluate(({f,w,s})=>{const c=document.getElementById('c');window.renderFrame(f,w,s,c);return c.toDataURL('image/png');},{f,w:entry.width,s:entry.seed});yield Buffer.from(data.split(',')[1],'base64');}}
 const x0=performance.now();await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','png','-framerate',String(scene.fps),'-i','-','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-an','-movflags','+faststart',x264],{stdin:pngFrames()});const x264WallMs=performance.now()-x0;

 const candidates=[{id:'x264-crf22',path:x264,bytes:fs.statSync(x264).size,encodeMs:x264WallMs,kind:'x264'}];
 for(const bitrate of bitrates){const id=`wc-${Math.round(bitrate/1e6)}m`;uploads.delete(id);const enc=await page.evaluate(async({id,width,seed,bitrate,queueLimit})=>{const c=document.getElementById('c'),total=Number(window.RISO.total),fps=Number(window.RISO.fps);window.renderFrame(0,width,seed,c);const cfg={codec:'avc1.420028',width:c.width,height:c.height,bitrate,framerate:fps,latencyMode:'realtime',avc:{format:'annexb'}};const support=await VideoEncoder.isConfigSupported(cfg);if(!support.supported)throw new Error('unsupported');const chunks=[];let bytes=0;const encoder=new VideoEncoder({output(ch){const b=new Uint8Array(ch.byteLength);ch.copyTo(b);chunks.push(b);bytes+=b.length;},error(e){throw e;}});encoder.configure(cfg);const t0=performance.now();for(let f=0;f<total;f++){window.renderFrame(f,width,seed,c);const vf=new VideoFrame(c,{timestamp:Math.trunc(f*1e6/fps)});encoder.encode(vf,{keyFrame:f===0||f%(fps*2)===0});vf.close();while(encoder.encodeQueueSize>queueLimit)await new Promise(ok=>encoder.addEventListener('dequeue',ok,{once:true}));}await encoder.flush();const encodeMs=performance.now()-t0;encoder.close();const body=new Uint8Array(bytes);let off=0;for(const b of chunks){body.set(b,off);off+=b.length;}const resp=await fetch(`/__r31_h264/${encodeURIComponent(id)}`,{method:'POST',body});if(!resp.ok)throw new Error(`upload ${resp.status}`);return{encodeMs,bytes,total,fps};},{id,width:entry.width,seed:entry.seed,bitrate,queueLimit});const h=uploads.get(id);if(!h)throw new Error(`missing ${id}`);const hp=path.join(outDir,`${id}.h264`),mp=path.join(outDir,`${id}.mp4`);await fsp.writeFile(hp,h);await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-fflags','+genpts','-r',String(scene.fps),'-i',hp,'-c:v','copy','-an','-movflags','+faststart',mp]);await fsp.rm(hp,{force:true});candidates.push({id,path:mp,bytes:fs.statSync(mp).size,encodeMs:enc.encodeMs,kind:'webcodecs',bitrate});}

 const rows=[];
 for(const c of candidates){const metrics={};for(const [name,r] of Object.entries(rois)){const dec=path.join(decoded,`${c.id}-${name}.png`);await decodeFrame(c.path,r.frame,dec);const ref=path.join(refs,`${name}.png`);metrics[name]={ssim:await metric('ssim',ref,dec,r.rect),psnr:await metric('psnr',ref,dec,r.rect)};}rows.push({...c,path:undefined,metrics});}
 const x=rows.find(r=>r.id==='x264-crf22');
 for(const r of rows){const vals=Object.values(r.metrics);r.summary={ssimMean:+(vals.reduce((a,b)=>a+b.ssim,0)/vals.length).toFixed(6),ssimWorst:+Math.min(...vals.map(v=>v.ssim)).toFixed(6),psnrMean:+(vals.reduce((a,b)=>a+b.psnr,0)/vals.length).toFixed(3),psnrWorst:+Math.min(...vals.map(v=>v.psnr)).toFixed(3)};r.passVsX264=Object.keys(rois).every(k=>r.metrics[k].ssim>=x.metrics[k].ssim);}
 const passes=rows.filter(r=>r.kind==='webcodecs'&&r.passVsX264).sort((a,b)=>a.bytes-b.bytes);
 const best=passes[0]||null;
 const report={schema:'framewright-r31-semantic-roi-codec-v1',fixture:{id:entry.id,bookId:entry.bookId,style:entry.style,variant:entry.variant,profile:entry.profile,width:entry.width,height:entry.height,seed:entry.seed},scene,rois,rows,decision:{x264Bytes:x.bytes,bestFixedBitratePass:best?{id:best.id,bitrate:best.bitrate,bytes:best.bytes,bytesVsX264:+(best.bytes/x.bytes-1).toFixed(4)}:null,quantizerEarned:!best}};
 await fsp.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
 const lines=rows.map(r=>`| ${r.id} | ${(r.bytes/1048576).toFixed(2)} MiB | ${(r.encodeMs/1000).toFixed(2)} s | ${r.summary.ssimMean} | ${r.summary.ssimWorst} | ${r.passVsX264?'PASS':'FAIL'} |`).join('\n');
 const md=`# R31 semantic ROI codec scout\n\nSame Chromium Canvas raster is used as the lossless reference for both x264 CRF22 and WebCodecs. Semantic ROIs cover hook, book cover/title/hook, and CTA cover/title/button.\n\n| policy | bytes | encode wall | ROI SSIM mean | ROI SSIM worst | every ROI >= x264 |\n|---|---:|---:|---:|---:|---|\n${lines}\n\nDecision: ${best?`lowest fixed-bitrate pass is **${best.id}**; quantizer mode does not earn a deep pass yet.`:'no fixed-bitrate candidate clears every x264 ROI; quantizer/content-adaptive policy earns the next bounded pass.'}\n`;
 await fsp.writeFile(path.join(outDir,'summary.md'),md);console.log(md);
}finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
