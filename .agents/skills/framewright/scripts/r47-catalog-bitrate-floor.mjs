#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';

const root=process.cwd();
const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-e18-for-r47.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-r47/manifest.json');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/r47');
const reportPath=path.resolve(process.env.REPORT||path.join(outDir,'report.json'));
const bitrates=String(process.env.BITRATES||'3000000,3250000,3500000,3750000,4000000').split(',').map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
const wanted=['river-station','letters','city-seven','observatory','long-title','night-archive'];
const queueLimit=8;
await fsp.mkdir(outDir,{recursive:true});
for(const f of [htmlPath,manifestPath]) if(!fs.existsSync(f)) throw new Error(`missing ${f}`);
const manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'));
const entries=wanted.map(bookId=>manifest.items.find(x=>x.bookId===bookId&&x.variant==='hook-first'&&x.profile==='vertical'));
if(entries.some(x=>!x)) throw new Error('missing representative hook-first vertical fixture');
const styleCounts=Object.fromEntries([...new Set(entries.map(x=>x.style))].map(style=>[style,entries.filter(x=>x.style===style).length]));
for(const style of ['paper','swiss','newspaper']) if((styleCounts[style]||0)<2) throw new Error(`need >=2 ${style} fixtures; got ${styleCounts[style]||0}`);

function run(cmd,args,{stdin}={}){return new Promise((ok,no)=>{const p=spawn(cmd,args,{cwd:root,stdio:['pipe','pipe','pipe']});let o='',e='';p.stdout.on('data',d=>o+=d);p.stderr.on('data',d=>e+=d);p.once('error',no);p.once('close',c=>c===0?ok({stdout:o,stderr:e}):no(new Error(`${cmd} exited ${c}\n${e.slice(-5000)}`)));if(stdin){(async()=>{try{for await(const b of stdin){if(!p.stdin.write(b))await new Promise(r=>p.stdin.once('drain',r));}p.stdin.end();}catch(err){p.stdin.destroy(err);}})();}else p.stdin.end();});}
function ctype(f){return ({'.html':'text/html; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[path.extname(f).toLowerCase()]||'application/octet-stream';}
const uploads=new Map();
const server=http.createServer((req,res)=>{const u=new URL(req.url||'/','http://127.0.0.1');if(req.method==='POST'&&u.pathname.startsWith('/__r47_h264/')){const id=decodeURIComponent(u.pathname.slice('/__r47_h264/'.length)),a=[];req.on('data',d=>a.push(d));req.on('end',()=>{uploads.set(id,Buffer.concat(a));res.writeHead(204);res.end();});return;}const rel=decodeURIComponent(u.pathname).replace(/^\/+/,''),f=path.resolve(root,rel||'.');if(f!==root&&!f.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.stat(f,(err,st)=>{if(err||!st.isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':ctype(f),'Cache-Control':'no-store'});fs.createReadStream(f).pipe(res);});});
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});const origin=`http://127.0.0.1:${server.address().port}`;

const ROI={hook:{frame:45,rect:{x:76,y:620,w:928,h:700}},book_cover:{frame:165,rect:{x:120,y:450,w:430,h:650}},book_title:{frame:165,rect:{x:570,y:540,w:434,h:470}},book_hook:{frame:195,rect:{x:490,y:1120,w:514,h:320}},cta_cover:{frame:285,rect:{x:350,y:500,w:380,h:560}},cta_title:{frame:300,rect:{x:60,y:1080,w:960,h:300}},cta_button:{frame:330,rect:{x:160,y:1340,w:760,h:220}}};
function clampRoi(r,w,h){const x=Math.max(0,Math.min(w-2,Math.round(r.x))),y=Math.max(0,Math.min(h-2,Math.round(r.y)));return{...r,x,y,w:Math.max(2,Math.min(w-x,Math.round(r.w))),h:Math.max(2,Math.min(h-y,Math.round(r.h)))};}
async function metric(kind,ref,cand,roi){const crop=`crop=${roi.w}:${roi.h}:${roi.x}:${roi.y}`;const filt=kind==='ssim'?`[0:v]${crop}[a];[1:v]${crop}[b];[a][b]ssim`:`[0:v]${crop}[a];[1:v]${crop}[b];[a][b]psnr`;const {stderr}=await run('ffmpeg',['-hide_banner','-loglevel','info','-i',ref,'-i',cand,'-lavfi',filt,'-f','null','-']);const re=kind==='ssim'?/All:([0-9.]+)/g:/average:([0-9.]+)/g;const m=[...stderr.matchAll(re)].at(-1);return m?Number(m[1]):null;}
async function decodeFrame(video,frame,out){await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',video,'-vf',`select=eq(n\\,${frame})`,'-vsync','0','-frames:v','1',out]);}

let browser;
try{
  browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:['--no-sandbox','--disable-setuid-sandbox']});
  const page=await browser.newPage();
  const fixtureReports=[];
  for(const entry of entries){
    const payload=JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath),entry.payloadFile),'utf8'));
    await page.evaluateOnNewDocument(p=>{window.FRAMEWRIGHT_PAYLOAD=p;},payload);
    const rel=path.relative(root,htmlPath).split(path.sep).map(encodeURIComponent).join('/');const url=new URL(`/${rel}`,origin);url.searchParams.set('f','0');url.searchParams.set('w',String(entry.width));url.searchParams.set('s',String(entry.seed));url.searchParams.set('profile',entry.profile);url.searchParams.set('book',entry.bookId);
    await page.goto(url.href,{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});
    const scene=await page.evaluate(()=>({total:Number(window.RISO.total),fps:Number(window.RISO.fps),width:document.getElementById('c').width,height:document.getElementById('c').height}));
    const rois=Object.fromEntries(Object.entries(ROI).map(([k,v])=>[k,{frame:v.frame,rect:clampRoi(v.rect,scene.width,scene.height)}]));
    const dir=path.join(outDir,entry.bookId),refs=path.join(dir,'refs'),decoded=path.join(dir,'decoded');await fsp.mkdir(refs,{recursive:true});await fsp.mkdir(decoded,{recursive:true});
    for(const [name,r] of Object.entries(rois)){const data=await page.evaluate(({f,w,s})=>{const c=document.getElementById('c');window.renderFrame(f,w,s,c);return c.toDataURL('image/png');},{f:r.frame,w:entry.width,s:entry.seed});await fsp.writeFile(path.join(refs,`${name}.png`),Buffer.from(data.split(',')[1],'base64'));}
    async function* pngFrames(){for(let f=0;f<scene.total;f++){const data=await page.evaluate(({f,w,s})=>{const c=document.getElementById('c');window.renderFrame(f,w,s,c);return c.toDataURL('image/png');},{f,w:entry.width,s:entry.seed});yield Buffer.from(data.split(',')[1],'base64');}}
    const x264=path.join(dir,'x264-crf22.mp4'),x0=performance.now();await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','png','-framerate',String(scene.fps),'-i','-','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-an','-movflags','+faststart',x264],{stdin:pngFrames()});const x264WallMs=performance.now()-x0;
    const candidates=[{id:'x264-crf22',path:x264,bytes:fs.statSync(x264).size,encodeMs:x264WallMs,kind:'x264'}];
    for(const bitrate of bitrates){
      const uploadId=`${entry.bookId}-${bitrate}`;uploads.delete(uploadId);
      const enc=await page.evaluate(async({uploadId,width,seed,bitrate,queueLimit})=>{const c=document.getElementById('c'),total=Number(window.RISO.total),fps=Number(window.RISO.fps);window.renderFrame(0,width,seed,c);const cfg={codec:'avc1.420028',width:c.width,height:c.height,bitrate,framerate:fps,latencyMode:'realtime',avc:{format:'annexb'}};const support=await VideoEncoder.isConfigSupported(cfg);if(!support.supported)throw new Error('unsupported');const chunks=[];let bytes=0;const encoder=new VideoEncoder({output(ch){const b=new Uint8Array(ch.byteLength);ch.copyTo(b);chunks.push(b);bytes+=b.length;},error(e){throw e;}});encoder.configure(cfg);const t0=performance.now();for(let f=0;f<total;f++){window.renderFrame(f,width,seed,c);const vf=new VideoFrame(c,{timestamp:Math.trunc(f*1e6/fps)});encoder.encode(vf,{keyFrame:f===0||f%(fps*2)===0});vf.close();while(encoder.encodeQueueSize>queueLimit)await new Promise(ok=>encoder.addEventListener('dequeue',ok,{once:true}));}await encoder.flush();const encodeMs=performance.now()-t0;encoder.close();const body=new Uint8Array(bytes);let off=0;for(const b of chunks){body.set(b,off);off+=b.length;}const resp=await fetch(`/__r47_h264/${encodeURIComponent(uploadId)}`,{method:'POST',body});if(!resp.ok)throw new Error(`upload ${resp.status}`);return{encodeMs,bytes};},{uploadId,width:entry.width,seed:entry.seed,bitrate,queueLimit});
      const h=uploads.get(uploadId);if(!h)throw new Error(`missing ${uploadId}`);const hp=path.join(dir,`${bitrate}.h264`),mp=path.join(dir,`${bitrate}.mp4`);await fsp.writeFile(hp,h);await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-fflags','+genpts','-r',String(scene.fps),'-i',hp,'-c:v','copy','-an','-movflags','+faststart',mp]);await fsp.rm(hp,{force:true});candidates.push({id:`wc-${(bitrate/1e6).toFixed(2)}m`,path:mp,bytes:fs.statSync(mp).size,encodeMs:enc.encodeMs,kind:'webcodecs',bitrate});
    }
    const rows=[];
    for(const c of candidates){const metrics={};for(const [name,r] of Object.entries(rois)){const dec=path.join(decoded,`${c.id.replaceAll('/','-')}-${name}.png`);await decodeFrame(c.path,r.frame,dec);const ref=path.join(refs,`${name}.png`);metrics[name]={ssim:await metric('ssim',ref,dec,r.rect),psnr:await metric('psnr',ref,dec,r.rect)};}rows.push({...c,path:undefined,metrics});}
    const x=rows.find(r=>r.kind==='x264');
    for(const r of rows){const vals=Object.values(r.metrics);r.summary={ssimMean:+(vals.reduce((a,b)=>a+b.ssim,0)/vals.length).toFixed(6),ssimWorst:+Math.min(...vals.map(v=>v.ssim)).toFixed(6)};r.failures=Object.entries(r.metrics).filter(([k,m])=>m.ssim<x.metrics[k].ssim).map(([roi,m])=>({roi,ssim:m.ssim,reference:x.metrics[roi].ssim,delta:+(m.ssim-x.metrics[roi].ssim).toFixed(6)}));r.passVsX264=r.failures.length===0;}
    const wc=rows.filter(r=>r.kind==='webcodecs').sort((a,b)=>a.bitrate-b.bitrate);
    for(let i=0;i<wc.length;i++) wc[i].stablePass=wc.slice(i).every(r=>r.passVsX264);
    const stable=wc.find(r=>r.stablePass)||null,fixed3=wc.find(r=>r.bitrate===3000000);
    fixtureReports.push({bookId:entry.bookId,style:entry.style,seed:entry.seed,scene,rows,lowestStablePass:stable?{bitrate:stable.bitrate,bytes:stable.bytes,id:stable.id}:null,fixed3Bytes:fixed3?.bytes||null});
  }

  const styles=['paper','swiss','newspaper'];
  const styleReports={};
  for(const style of styles){
    const fixtures=fixtureReports.filter(f=>f.style===style),valid=fixtures.every(f=>f.lowestStablePass),styleFloor=valid?Math.max(...fixtures.map(f=>f.lowestStablePass.bitrate)):null;
    styleReports[style]={fixtures:fixtures.map(f=>f.bookId),valid,styleFloor};
  }
  const valid=fixtureReports.every(f=>f.lowestStablePass),globalFloor=valid?Math.max(...fixtureReports.map(f=>f.lowestStablePass.bitrate)):null;
  const bitrateBytes=(f,b)=>f.rows.find(r=>r.kind==='webcodecs'&&r.bitrate===b)?.bytes??null;
  const fixed3Total=fixtureReports.reduce((s,f)=>s+(bitrateBytes(f,3000000)||0),0);
  const globalTotal=globalFloor==null?null:fixtureReports.reduce((s,f)=>s+(bitrateBytes(f,globalFloor)||0),0);
  const globalByteIncreaseVs3M=globalTotal==null||!fixed3Total?null:globalTotal/fixed3Total-1;
  let styleTotal=null,styleSavingsVsGlobal=null,styleSpecificEarned=false;
  if(valid&&globalFloor!=null&&styles.every(s=>styleReports[s].styleFloor!=null)){
    styleTotal=fixtureReports.reduce((sum,f)=>sum+(bitrateBytes(f,styleReports[f.style].styleFloor)||0),0);
    styleSavingsVsGlobal=globalTotal?1-styleTotal/globalTotal:null;
    const distinctStyleFloors=new Set(styles.map(s=>styleReports[s].styleFloor)).size;
    styleSpecificEarned=distinctStyleFloors>=2&&styleSavingsVsGlobal!=null&&styleSavingsVsGlobal>=0.20;
  }
  const report={schema:'nightwill-r47-catalog-bitrate-floor-v1',bitrates,fixtures:fixtureReports,styles:styleReports,decision:{valid,globalFloor,fixed3TotalBytes:fixed3Total,globalFloorTotalBytes:globalTotal,globalByteIncreaseVs3M,styleSpecificTotalBytes:styleTotal,styleSpecificSavingsVsGlobal:styleSavingsVsGlobal,styleSpecificEarned,rule:'per-fixture lowest stable PASS requires chosen bitrate and every higher ladder point to pass every R31 semantic ROI vs same-raster x264 CRF22'}};
  await fsp.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  const lines=fixtureReports.map(f=>`| ${f.bookId} | ${f.style} | ${f.lowestStablePass?`${(f.lowestStablePass.bitrate/1e6).toFixed(2)} Mbps`:'none <='+(bitrates.at(-1)/1e6).toFixed(2)+'M'} |`).join('\n');
  const styleLines=styles.map(s=>`| ${s} | ${styleReports[s].styleFloor?`${(styleReports[s].styleFloor/1e6).toFixed(2)} Mbps`:'none'} |`).join('\n');
  const md=`# R47 catalog-wide semantic ROI bitrate floor\n\n| fixture | style | lowest stable PASS |\n|---|---|---:|\n${lines}\n\n| style | robust floor across sampled books |\n|---|---:|\n${styleLines}\n\nGlobal robust floor: **${globalFloor?`${(globalFloor/1e6).toFixed(2)} Mbps`:'not found in ladder'}**.\n\nGlobal-floor bytes vs fixed 3M: **${globalByteIncreaseVs3M==null?'n/a':(globalByteIncreaseVs3M*100).toFixed(1)+'%'}**. Style-specific savings vs global floor: **${styleSavingsVsGlobal==null?'n/a':(styleSavingsVsGlobal*100).toFixed(1)+'%'}**. Style-specific policy earned: **${styleSpecificEarned?'yes':'no'}**.\n`;
  await fsp.writeFile(path.join(outDir,'summary.md'),md);console.log(md);
}finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
