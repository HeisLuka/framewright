#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';

const root=process.cwd();
const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-e18-for-r35.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-r35/manifest.json');
const outDir=path.resolve(process.env.OUT_DIR||'artifacts/r35');
const reportPath=path.resolve(process.env.REPORT||path.join(outDir,'report.json'));
const queueLimit=8;
const anchorBitrate=3_000_000;
const fineBitrates=[2_000_000,2_250_000,2_500_000,2_750_000,3_000_000];
const traceFrames=60;
await fsp.mkdir(outDir,{recursive:true});
for(const f of [htmlPath,manifestPath]) if(!fs.existsSync(f)) throw new Error(`missing ${f}`);
const manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'));
const entry=manifest.items.find(x=>x.bookId==='river-station'&&x.variant==='hook-first'&&x.profile==='vertical');
if(!entry) throw new Error('river-station hook-first vertical fixture missing');
if(entry.style!=='paper') throw new Error(`expected paper style, got ${entry.style}`);
const payload=JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath),entry.payloadFile),'utf8'));

function run(cmd,args,{stdin}={}){return new Promise((ok,no)=>{const p=spawn(cmd,args,{cwd:root,stdio:['pipe','pipe','pipe']});let o='',e='';p.stdout.on('data',d=>o+=d);p.stderr.on('data',d=>e+=d);p.once('error',no);p.once('close',c=>c===0?ok({stdout:o,stderr:e}):no(new Error(`${cmd} exited ${c}\n${e.slice(-6000)}`)));if(stdin){(async()=>{try{for await(const b of stdin){if(!p.stdin.write(b))await new Promise(r=>p.stdin.once('drain',r));}p.stdin.end();}catch(err){p.stdin.destroy(err);}})();}else p.stdin.end();});}
function ctype(f){return ({'.html':'text/html; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[path.extname(f).toLowerCase()]||'application/octet-stream';}
const uploads=new Map();
const server=http.createServer((req,res)=>{const u=new URL(req.url||'/','http://127.0.0.1');if(req.method==='POST'&&u.pathname.startsWith('/__r35_h264/')){const id=decodeURIComponent(u.pathname.slice('/__r35_h264/'.length)),a=[];req.on('data',d=>a.push(d));req.on('end',()=>{uploads.set(id,Buffer.concat(a));res.writeHead(204);res.end();});return;}const rel=decodeURIComponent(u.pathname).replace(/^\/+/,''),f=path.resolve(root,rel||'.');if(f!==root&&!f.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.stat(f,(err,st)=>{if(err||!st.isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':ctype(f),'Cache-Control':'no-store'});fs.createReadStream(f).pipe(res);});});
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
const PROFILES={baseline:'avc1.420028',main:'avc1.4D0028',high:'avc1.640028'};
const supportSpecs=[];
for(const [profile,codec] of Object.entries(PROFILES)){
 for(const hint of ['', 'text']) for(const latencyMode of ['realtime','quality']) supportSpecs.push({profile,codec,hint,latencyMode});
}
function policyId({profile,hint,latencyMode,bitrate}){return `${profile}-${hint||'default'}-${latencyMode}-${Math.round(bitrate/250000)/4}m`.replace('.0m','m');}
function encoderConfig(spec,w,h,fps){const cfg={codec:spec.codec,width:w,height:h,bitrate:spec.bitrate,framerate:fps,latencyMode:spec.latencyMode,avc:{format:'annexb'}};if(spec.hint)cfg.contentHint=spec.hint;return cfg;}
async function metric(kind,ref,cand,roi){const crop=`crop=${roi.w}:${roi.h}:${roi.x}:${roi.y}`;const filt=kind==='ssim'?`[0:v]${crop}[a];[1:v]${crop}[b];[a][b]ssim`:`[0:v]${crop}[a];[1:v]${crop}[b];[a][b]psnr`;const {stderr}=await run('ffmpeg',['-hide_banner','-loglevel','info','-i',ref,'-i',cand,'-lavfi',filt,'-f','null','-']);const re=kind==='ssim'?/All:([0-9.]+)/g:/average:([0-9.]+)/g;const m=[...stderr.matchAll(re)].at(-1);return m?Number(m[1]):null;}
async function decodeFrame(video,frame,out){await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',video,'-vf',`select=eq(n\\,${frame})`,'-vsync','0','-frames:v','1',out]);}
async function ffprobeVideo(file){const {stdout}=await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,profile,level,pix_fmt,width,height,avg_frame_rate,bit_rate','-of','json',file]);return JSON.parse(stdout).streams?.[0]||{};}
async function readTraceStream(client,stream){let text='';for(;;){const r=await client.send('IO.read',{handle:stream});text+=r.data||'';if(r.eof)break;}await client.send('IO.close',{handle:stream}).catch(()=>{});return text;}
function summarizeTrace(raw){let obj;try{obj=JSON.parse(raw)}catch{return{parseError:true,bytes:Buffer.byteLength(raw)}}const events=obj.traceEvents||[];const re=/(video.*encod|encod.*video|openh264|readback|copy.*video|video.*copy|canvas|gpumemory|sharedimage|texture|convert.*yuv|rgb.*yuv|media)/i;const hit=events.filter(e=>re.test(String(e.name||''))||re.test(String(e.cat||'')));const grouped=new Map();for(const e of hit){const key=`${e.cat||''} :: ${e.name||''}`;const g=grouped.get(key)||{name:e.name||'',cat:e.cat||'',count:0,totalDurMs:0,maxDurMs:0};g.count++;const d=Number(e.dur||0)/1000;if(Number.isFinite(d)){g.totalDurMs+=d;g.maxDurMs=Math.max(g.maxDurMs,d);}grouped.set(key,g);}const groups=[...grouped.values()].sort((a,b)=>b.totalDurMs-a.totalDurMs||b.count-a.count).slice(0,80).map(g=>({...g,totalDurMs:+g.totalDurMs.toFixed(3),maxDurMs:+g.maxDurMs.toFixed(3)}));return{bytes:Buffer.byteLength(raw),totalEvents:events.length,matchedEvents:hit.length,groups};}

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

 const support=await page.evaluate(async({supportSpecs,width,height,fps})=>{const rows=[];for(const s of supportSpecs){const cfg={codec:s.codec,width,height,bitrate:3000000,framerate:fps,latencyMode:s.latencyMode,avc:{format:'annexb'}};if(s.hint)cfg.contentHint=s.hint;try{const r=await VideoEncoder.isConfigSupported(cfg);rows.push({...s,supported:!!r.supported,returnedCodec:r.config?.codec||null,returnedContentHint:r.config?.contentHint??null,returnedLatencyMode:r.config?.latencyMode??null});}catch(e){rows.push({...s,supported:false,error:String(e)});}}return rows;},{supportSpecs,width:scene.width,height:scene.height,fps:scene.fps});

 // Same lossless Chromium Canvas timeline -> explicit x264 High CRF22 reference.
 const x264=path.join(outDir,'x264-high-crf22.mp4');
 async function* pngFrames(){for(let f=0;f<scene.total;f++){const data=await page.evaluate(({f,w,s})=>{const c=document.getElementById('c');window.renderFrame(f,w,s,c);return c.toDataURL('image/png');},{f,w:entry.width,s:entry.seed});yield Buffer.from(data.split(',')[1],'base64');}}
 const x0=performance.now();await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','png','-framerate',String(scene.fps),'-i','-','-c:v','libx264','-preset','veryfast','-profile:v','high','-level:v','4.0','-crf','22','-pix_fmt','yuv420p','-an','-movflags','+faststart',x264],{stdin:pngFrames()});const x264WallMs=performance.now()-x0;

 async function encodePolicy(spec){const id=policyId(spec);uploads.delete(id);const cfg=encoderConfig(spec,scene.width,scene.height,scene.fps);const enc=await page.evaluate(async({id,width,seed,cfg,queueLimit})=>{const c=document.getElementById('c'),total=Number(window.RISO.total),fps=Number(window.RISO.fps);const support=await VideoEncoder.isConfigSupported(cfg);if(!support.supported)return{supported:false,config:support.config||cfg};const chunks=[];let bytes=0;const encoder=new VideoEncoder({output(ch){const b=new Uint8Array(ch.byteLength);ch.copyTo(b);chunks.push(b);bytes+=b.length;},error(e){throw e;}});encoder.configure(cfg);const t0=performance.now();for(let f=0;f<total;f++){window.renderFrame(f,width,seed,c);const vf=new VideoFrame(c,{timestamp:Math.trunc(f*1e6/fps)});encoder.encode(vf,{keyFrame:f===0||f%(fps*2)===0});vf.close();while(encoder.encodeQueueSize>queueLimit)await new Promise(ok=>encoder.addEventListener('dequeue',ok,{once:true}));}await encoder.flush();const encodeMs=performance.now()-t0;encoder.close();const body=new Uint8Array(bytes);let off=0;for(const b of chunks){body.set(b,off);off+=b.length;}const resp=await fetch(`/__r35_h264/${encodeURIComponent(id)}`,{method:'POST',body});if(!resp.ok)throw new Error(`upload ${resp.status}`);return{supported:true,encodeMs,bytes,total,fps,config:support.config||cfg};},{id,width:entry.width,seed:entry.seed,cfg,queueLimit});if(!enc.supported)return{id,spec,supported:false,config:enc.config};const h=uploads.get(id);if(!h)throw new Error(`missing ${id}`);uploads.delete(id);const hp=path.join(outDir,`${id}.h264`),mp=path.join(outDir,`${id}.mp4`);await fsp.writeFile(hp,h);await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-fflags','+genpts','-r',String(scene.fps),'-i',hp,'-c:v','copy','-an','-movflags','+faststart',mp]);await fsp.rm(hp,{force:true});return{id,spec,supported:true,path:mp,bytes:fs.statSync(mp).size,encodeMs:enc.encodeMs,config:enc.config,probe:await ffprobeVideo(mp)};}

 const matrixSpecs=[
  {profile:'baseline',codec:PROFILES.baseline,hint:'',latencyMode:'realtime',bitrate:anchorBitrate},
  {profile:'baseline',codec:PROFILES.baseline,hint:'',latencyMode:'quality',bitrate:anchorBitrate},
  {profile:'high',codec:PROFILES.high,hint:'',latencyMode:'realtime',bitrate:anchorBitrate},
  {profile:'high',codec:PROFILES.high,hint:'',latencyMode:'quality',bitrate:anchorBitrate},
  {profile:'high',codec:PROFILES.high,hint:'text',latencyMode:'realtime',bitrate:anchorBitrate},
  {profile:'high',codec:PROFILES.high,hint:'text',latencyMode:'quality',bitrate:anchorBitrate},
  {profile:'main',codec:PROFILES.main,hint:'text',latencyMode:'quality',bitrate:anchorBitrate},
 ];
 const matrix=[];for(const spec of matrixSpecs)matrix.push(await encodePolicy(spec));
 const supportedMatrix=matrix.filter(x=>x.supported);
 // Fine-search the current production winner, not a merely supported but unvalidated policy.
 const pref=supportedMatrix.find(x=>x.spec.profile==='baseline'&&!x.spec.hint&&x.spec.latencyMode==='realtime')||supportedMatrix[0];
 if(!pref)throw new Error('no WebCodecs H264 candidate supported');
 const fine=[];for(const bitrate of fineBitrates){if(bitrate===anchorBitrate&&pref.spec.bitrate===anchorBitrate){fine.push({...pref,aliasOfMatrix:true});continue;}fine.push(await encodePolicy({...pref.spec,bitrate}));}

 const unique=[];const seen=new Set();for(const c of [{id:'x264-high-crf22',supported:true,path:x264,bytes:fs.statSync(x264).size,encodeMs:x264WallMs,spec:{kind:'x264',profile:'high',bitrateMode:'crf22'},probe:await ffprobeVideo(x264)},...matrix,...fine]){if(!c.supported||seen.has(c.id))continue;seen.add(c.id);unique.push(c);}
 const rows=[];for(const c of unique){const metrics={};for(const [name,r] of Object.entries(rois)){const dec=path.join(decoded,`${c.id}-${name}.png`);await decodeFrame(c.path,r.frame,dec);const ref=path.join(refs,`${name}.png`);metrics[name]={ssim:await metric('ssim',ref,dec,r.rect),psnr:await metric('psnr',ref,dec,r.rect)};}const vals=Object.values(metrics);rows.push({...c,path:undefined,metrics,summary:{ssimMean:+(vals.reduce((a,b)=>a+b.ssim,0)/vals.length).toFixed(6),ssimWorst:+Math.min(...vals.map(v=>v.ssim)).toFixed(6),psnrMean:+(vals.reduce((a,b)=>a+b.psnr,0)/vals.length).toFixed(3),psnrWorst:+Math.min(...vals.map(v=>v.psnr)).toFixed(3)}});}
 const x=rows.find(r=>r.id==='x264-high-crf22');if(!x)throw new Error('missing x264 row');for(const r of rows)r.passVsX264=Object.keys(rois).every(k=>r.metrics[k].ssim>=x.metrics[k].ssim);
 const webPasses=rows.filter(r=>r.spec?.kind!=='x264'&&r.passVsX264).sort((a,b)=>a.bytes-b.bytes||a.encodeMs-b.encodeMs);const best=webPasses[0]||null;

 // Observational trace only. Trace the actual production anchor; traced wall is excluded from timing comparisons.
 const traceClient=await browser.target().createCDPSession();
 const systemInfo=await traceClient.send('SystemInfo.getInfo').catch(e=>({error:String(e)}));
 const browserVersion=await traceClient.send('Browser.getVersion').catch(e=>({error:String(e)}));
 const traceSpec={...pref.spec,bitrate:anchorBitrate};const traceCfg=encoderConfig(traceSpec,scene.width,scene.height,scene.fps);
 let traceSummary={error:'trace not run'};
 try{
  const completed=new Promise(resolve=>traceClient.once('Tracing.tracingComplete',resolve));
  await traceClient.send('Tracing.start',{categories:'toplevel,media,gpu,cc,blink,disabled-by-default-media',options:'record-until-full',transferMode:'ReturnAsStream'});
  await page.evaluate(async({width,seed,cfg,queueLimit,traceFrames})=>{const c=document.getElementById('c'),fps=Number(window.RISO.fps);const encoder=new VideoEncoder({output(){},error(e){throw e;}});encoder.configure(cfg);for(let f=0;f<traceFrames;f++){window.renderFrame(f,width,seed,c);const vf=new VideoFrame(c,{timestamp:Math.trunc(f*1e6/fps)});encoder.encode(vf,{keyFrame:f===0});vf.close();while(encoder.encodeQueueSize>queueLimit)await new Promise(ok=>encoder.addEventListener('dequeue',ok,{once:true}));}await encoder.flush();encoder.close();},{width:entry.width,seed:entry.seed,cfg:traceCfg,queueLimit,traceFrames});
  await traceClient.send('Tracing.end');const done=await completed;const raw=await readTraceStream(traceClient,done.stream);traceSummary=summarizeTrace(raw);await fsp.writeFile(path.join(outDir,'trace-summary.json'),JSON.stringify(traceSummary,null,2)+'\n');
 }catch(e){traceSummary={error:String(e?.stack||e)};await fsp.writeFile(path.join(outDir,'trace-summary.json'),JSON.stringify(traceSummary,null,2)+'\n');}
 await traceClient.detach().catch(()=>{});

 const report={schema:'framewright-r35-webcodecs-profile-trace-v1',fixture:{id:entry.id,bookId:entry.bookId,style:entry.style,variant:entry.variant,profile:entry.profile,width:entry.width,height:entry.height,seed:entry.seed},scene,rois,support,preferredFinePolicy:pref.spec,rows,decision:{bestPassingWebCodecs:best?{id:best.id,spec:best.spec,bytes:best.bytes,bytesVsX264:+(best.bytes/x.bytes-1).toFixed(4),encodeMs:best.encodeMs,profile:best.probe?.profile||null}:null,baseline3m:rows.find(r=>r.id.startsWith('baseline-default-realtime-3m'))?.id||null,highTextQuality3m:rows.find(r=>r.id.startsWith('high-text-quality-3m'))?.id||null},trace:{traceFrames,spec:traceSpec,systemInfo,browserVersion,summary:traceSummary}};
 await fsp.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
 const lines=rows.map(r=>`| ${r.id} | ${r.probe?.profile||'?'} | ${(r.bytes/1048576).toFixed(2)} MiB | ${(r.encodeMs/1000).toFixed(2)} s | ${r.summary.ssimMean} | ${r.summary.ssimWorst} | ${r.passVsX264?'PASS':'FAIL'} |`).join('\n');
 const supportLines=support.map(s=>`| ${s.profile} | ${s.hint||'default'} | ${s.latencyMode} | ${s.supported?'yes':'no'} | ${s.returnedCodec||''} |`).join('\n');
 const traceTop=(traceSummary.groups||[]).slice(0,12).map(g=>`- ${g.cat} :: ${g.name} — count ${g.count}, total ${g.totalDurMs} ms`).join('\n')||`- ${traceSummary.error||'no matching trace events'}`;
 const md=`# R35 WebCodecs profile/content-hint + trace scout\n\nSame Chromium Canvas raster and the same R31 semantic ROIs are used for every codec candidate. x264 is explicitly High Profile CRF22. Tracing is a separate observational 60-frame encode of the production anchor and is excluded from timing comparisons.\n\n## Support probe\n\n| profile | contentHint | latency | supported | returned codec |\n|---|---|---|---|---|\n${supportLines}\n\n## Rate/quality matrix\n\n| policy | emitted profile | bytes | encode wall | ROI SSIM mean | ROI SSIM worst | every ROI >= x264 |\n|---|---|---:|---:|---:|---:|---|\n${lines}\n\nDecision: ${best?`smallest passing WebCodecs output is **${best.id}** at ${(best.bytes/1048576).toFixed(2)} MiB (${((best.bytes/x.bytes-1)*100).toFixed(1)}% bytes vs x264 High CRF22).`:'no tested WebCodecs policy clears every x264 semantic ROI.'}\n\n## Trace observations\n\n${traceTop}\n`;
 await fsp.writeFile(path.join(outDir,'summary.md'),md);console.log(md);
}finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok));}