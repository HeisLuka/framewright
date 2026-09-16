#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const root=process.cwd();
const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-e18-for-r48.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-r48/manifest.json');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/r48');
const reportPath=path.resolve(process.env.REPORT||path.join(outDir,'report.json'));
const repeats=Math.max(3,Number(process.env.REPEATS||3));
const bitrates=[3000000,4000000];
const wanted=['river-station','letters','long-title','night-archive'];
const queueLimit=8;
const ROI={hook:{frame:45,rect:{x:76,y:620,w:928,h:700}},book_cover:{frame:165,rect:{x:120,y:450,w:430,h:650}},book_title:{frame:165,rect:{x:570,y:540,w:434,h:470}},book_hook:{frame:195,rect:{x:490,y:1120,w:514,h:320}},cta_cover:{frame:285,rect:{x:350,y:500,w:380,h:560}},cta_title:{frame:300,rect:{x:60,y:1080,w:960,h:300}},cta_button:{frame:330,rect:{x:160,y:1340,w:760,h:220}}};
await fsp.mkdir(outDir,{recursive:true});
for(const f of [htmlPath,manifestPath]) if(!fs.existsSync(f)) throw new Error(`missing ${f}`);
const manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'));
const entries=wanted.map(bookId=>manifest.items.find(x=>x.bookId===bookId&&x.variant==='hook-first'&&x.profile==='vertical'));
if(entries.some(x=>!x)) throw new Error('missing R48 fixture');
function run(cmd,args,{stdin}={}){return new Promise((ok,no)=>{const p=spawn(cmd,args,{cwd:root,stdio:['pipe','pipe','pipe']});let o='',e='';p.stdout.on('data',d=>o+=d);p.stderr.on('data',d=>e+=d);p.once('error',no);p.once('close',c=>c===0?ok({stdout:o,stderr:e}):no(new Error(`${cmd} exited ${c}\n${e.slice(-4000)}`)));if(stdin){(async()=>{try{for await(const b of stdin){if(!p.stdin.write(b))await new Promise(r=>p.stdin.once('drain',r));}p.stdin.end();}catch(err){p.stdin.destroy(err);}})();}else p.stdin.end();});}
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const ctype=f=>({'.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[path.extname(f).toLowerCase()]||'application/octet-stream';
const uploads=new Map();
const server=http.createServer((req,res)=>{const u=new URL(req.url||'/','http://127.0.0.1');if(req.method==='POST'&&u.pathname.startsWith('/__r48_h264/')){const id=decodeURIComponent(u.pathname.slice('/__r48_h264/'.length)),a=[];req.on('data',d=>a.push(d));req.on('end',()=>{uploads.set(id,Buffer.concat(a));res.writeHead(204);res.end();});return;}const rel=decodeURIComponent(u.pathname).replace(/^\/+/,''),f=path.resolve(root,rel||'.');if(f!==root&&!f.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.stat(f,(err,st)=>{if(err||!st.isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':ctype(f),'Cache-Control':'no-store'});fs.createReadStream(f).pipe(res);});});
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});const origin=`http://127.0.0.1:${server.address().port}`;
function clampRoi(r,w,h){const x=Math.max(0,Math.min(w-2,Math.round(r.x))),y=Math.max(0,Math.min(h-2,Math.round(r.y)));return{...r,x,y,w:Math.max(2,Math.min(w-x,Math.round(r.w))),h:Math.max(2,Math.min(h-y,Math.round(r.h)))};}
async function metric(kind,ref,cand,roi){const crop=`crop=${roi.w}:${roi.h}:${roi.x}:${roi.y}`;const filt=kind==='ssim'?`[0:v]${crop}[a];[1:v]${crop}[b];[a][b]ssim`:`[0:v]${crop}[a];[1:v]${crop}[b];[a][b]psnr`;const {stderr}=await run('ffmpeg',['-hide_banner','-loglevel','info','-i',ref,'-i',cand,'-lavfi',filt,'-f','null','-']);const re=kind==='ssim'?/All:([0-9.]+)/g:/average:([0-9.]+)/g;const m=[...stderr.matchAll(re)].at(-1);return m?Number(m[1]):null;}
async function decodeFrame(video,frame,out){await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',video,'-vf',`select=eq(n\\,${frame})`,'-vsync','0','-frames:v','1',out]);}

let browser;
try{
 browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:['--no-sandbox','--disable-setuid-sandbox']});
 const page=await browser.newPage(),fixtures=[];
 for(const entry of entries){
  const payload=JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath),entry.payloadFile),'utf8'));
  await page.evaluateOnNewDocument(p=>{window.FRAMEWRIGHT_PAYLOAD=p;},payload);
  const rel=path.relative(root,htmlPath).split(path.sep).map(encodeURIComponent).join('/');const url=new URL(`/${rel}`,origin);url.searchParams.set('f','0');url.searchParams.set('w',String(entry.width));url.searchParams.set('s',String(entry.seed));url.searchParams.set('profile',entry.profile);url.searchParams.set('book',entry.bookId);
  await page.goto(url.href,{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});
  const scene=await page.evaluate(()=>({total:Number(window.RISO.total),fps:Number(window.RISO.fps),width:document.getElementById('c').width,height:document.getElementById('c').height}));
  const rois=Object.fromEntries(Object.entries(ROI).map(([k,v])=>[k,{frame:v.frame,rect:clampRoi(v.rect,scene.width,scene.height)}]));
  const dir=path.join(outDir,entry.bookId);await fsp.mkdir(dir,{recursive:true});
  async function* pngFrames(){for(let f=0;f<scene.total;f++){const data=await page.evaluate(({f,w,s})=>{const c=document.getElementById('c');window.renderFrame(f,w,s,c);return c.toDataURL('image/png');},{f,w:entry.width,s:entry.seed});yield Buffer.from(data.split(',')[1],'base64');}}
  const refs=[];
  for(let rep=0;rep<2;rep++){const p=path.join(dir,`x264-${rep}.mp4`);await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','png','-framerate',String(scene.fps),'-i','-','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-an','-movflags','+faststart',p],{stdin:pngFrames()});refs.push({rep,path:p,bytes:fs.statSync(p).size,sha256:sha(p)});}
  const ref=refs[0].path,refMetrics={};for(const [name,r] of Object.entries(rois)){const png=path.join(dir,`ref-${name}.png`);const data=await page.evaluate(({f,w,s})=>{const c=document.getElementById('c');window.renderFrame(f,w,s,c);return c.toDataURL('image/png');},{f:r.frame,w:entry.width,s:entry.seed});await fsp.writeFile(png,Buffer.from(data.split(',')[1],'base64'));const dec=path.join(dir,`x264-${name}.png`);await decodeFrame(ref,r.frame,dec);refMetrics[name]={ssim:await metric('ssim',png,dec,r.rect),psnr:await metric('psnr',png,dec,r.rect),png};}
  const runs=[];
  for(const bitrate of bitrates) for(let rep=0;rep<repeats;rep++){
    const id=`${entry.bookId}-${bitrate}-${rep}`;uploads.delete(id);
    await page.evaluate(async({id,width,seed,bitrate,queueLimit})=>{const c=document.getElementById('c'),total=Number(window.RISO.total),fps=Number(window.RISO.fps);const cfg={codec:'avc1.420028',width:c.width,height:c.height,bitrate,framerate:fps,latencyMode:'realtime',avc:{format:'annexb'}};const enc=new VideoEncoder({output(ch){const b=new Uint8Array(ch.byteLength);ch.copyTo(b);chunks.push(b);},error(e){throw e;}}),chunks=[];enc.configure(cfg);for(let f=0;f<total;f++){window.renderFrame(f,width,seed,c);const vf=new VideoFrame(c,{timestamp:Math.trunc(f*1e6/fps)});enc.encode(vf,{keyFrame:f===0||f%(fps*2)===0});vf.close();while(enc.encodeQueueSize>queueLimit)await new Promise(ok=>enc.addEventListener('dequeue',ok,{once:true}));}await enc.flush();enc.close();let n=0;for(const b of chunks)n+=b.length;const body=new Uint8Array(n);let o=0;for(const b of chunks){body.set(b,o);o+=b.length;}const resp=await fetch(`/__r48_h264/${encodeURIComponent(id)}`,{method:'POST',body});if(!resp.ok)throw new Error(`upload ${resp.status}`);},{id,width:entry.width,seed:entry.seed,bitrate,queueLimit});
    const raw=uploads.get(id);if(!raw)throw new Error(`missing ${id}`);const hp=path.join(dir,`${bitrate}-${rep}.h264`),mp=path.join(dir,`${bitrate}-${rep}.mp4`);await fsp.writeFile(hp,raw);const rawSha=sha(hp);await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-fflags','+genpts','-r',String(scene.fps),'-i',hp,'-c:v','copy','-an','-movflags','+faststart',mp]);const metrics={};for(const [name,r] of Object.entries(rois)){const dec=path.join(dir,`${bitrate}-${rep}-${name}.png`);await decodeFrame(mp,r.frame,dec);metrics[name]={ssim:await metric('ssim',refMetrics[name].png,dec,r.rect),psnr:await metric('psnr',refMetrics[name].png,dec,r.rect)};}const failures=Object.entries(metrics).filter(([k,m])=>m.ssim<refMetrics[k].ssim).map(([roi,m])=>({roi,delta:+(m.ssim-refMetrics[roi].ssim).toFixed(6)}));runs.push({bitrate,rep,bytes:fs.statSync(mp).size,rawSha256:rawSha,mp4Sha256:sha(mp),metrics,failures,passVsX264:failures.length===0});await fsp.rm(hp,{force:true});
  }
  const groups={};for(const bitrate of bitrates){const rs=runs.filter(x=>x.bitrate===bitrate),spread={};for(const roi of Object.keys(rois)){const ss=rs.map(x=>x.metrics[roi].ssim),ps=rs.map(x=>x.metrics[roi].psnr);spread[roi]={ssim:+(Math.max(...ss)-Math.min(...ss)).toFixed(9),psnr:+(Math.max(...ps)-Math.min(...ps)).toFixed(6)};}groups[bitrate]={rawUnique:new Set(rs.map(x=>x.rawSha256)).size,mp4Unique:new Set(rs.map(x=>x.mp4Sha256)).size,passPattern:rs.map(x=>x.passVsX264),maxSsimSpread:Math.max(...Object.values(spread).map(x=>x.ssim)),maxPsnrSpread:Math.max(...Object.values(spread).map(x=>x.psnr)),spread};}
  fixtures.push({bookId:entry.bookId,style:entry.style,x264:{runs:refs.map(({path,...x})=>x),uniqueSha256:new Set(refs.map(x=>x.sha256)).size},referenceMetrics:Object.fromEntries(Object.entries(refMetrics).map(([k,{png,...v}])=>[k,v])),groups,runs});
 }
 const deterministic=fixtures.every(f=>f.x264.uniqueSha256===1&&Object.values(f.groups).every(g=>g.rawUnique===1&&g.mp4Unique===1&&g.maxSsimSpread===0&&g.maxPsnrSpread===0));
 const report={schema:'nightwill-r48-roi-comparator-repeatability-v1',repeats,bitrates,fixtures,decision:{deterministic,interpretation:deterministic?'Repeated identical x264 and WebCodecs encodes are byte/metric deterministic here; persistent tiny x264-relative ROI deficits are not stochastic run noise.':'Observed run-to-run variance; quantify before changing comparator.'}};await fsp.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.decision,null,2));for(const f of fixtures)console.log(f.bookId,JSON.stringify(Object.fromEntries(Object.entries(f.groups).map(([b,g])=>[b,{rawUnique:g.rawUnique,mp4Unique:g.mp4Unique,passPattern:g.passPattern,maxSsimSpread:g.maxSsimSpread}]))));
}finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
