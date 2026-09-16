#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const root = process.cwd();
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/r40');
const reportPath = path.resolve(process.env.REPORT || path.join(outDir, 'report.json'));
const W = 1080, H = 1920, FPS = 30, TOTAL = 60, BITRATE = 3_000_000;
await fsp.mkdir(outDir, { recursive: true });

const PATCHES = [
  ['black',[0,0,0]],['nearblack',[16,16,16]],['gray64',[64,64,64]],['gray128',[128,128,128]],
  ['gray192',[192,192,192]],['studio_white',[235,235,235]],['white',[255,255,255]],['red',[180,32,32]],
  ['green',[32,180,32]],['blue',[32,32,180]],['cyan',[32,180,180]],['magenta',[180,32,180]],
  ['yellow',[180,180,32]],['skin',[198,134,101]],['cover_blue',[48,92,170]],['warm',[210,150,60]],
  ['deep_red',[118,42,52]],['teal',[48,132,130]],['paper',[226,218,199]],['purple',[105,68,145]],
].map(([name,rgb],i)=>({name,rgb,x:70+(i%4)*250,y:100+Math.floor(i/4)*330,w:210,h:270}));

const uploads = new Map();
const server = http.createServer((req,res)=>{
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname.startsWith('/__r40_h264/')) {
    const id = decodeURIComponent(u.pathname.slice('/__r40_h264/'.length));
    const chunks=[]; req.on('data',d=>chunks.push(d)); req.on('end',()=>{uploads.set(id,Buffer.concat(chunks));res.writeHead(204);res.end();}); return;
  }
  if (u.pathname === '/__r40.html') {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end(`<!doctype html><html><body><canvas id="c" width="${W}" height="${H}"></canvas></body></html>`); return;
  }
  res.writeHead(404); res.end();
});
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
const origin = `http://127.0.0.1:${server.address().port}`;

function runText(cmd,args){return new Promise((ok,no)=>{const p=spawn(cmd,args,{cwd:root,stdio:['ignore','pipe','pipe']});let o='',e='';p.stdout.on('data',d=>o+=d);p.stderr.on('data',d=>e+=d);p.once('error',no);p.once('close',c=>c===0?ok({stdout:o,stderr:e}):no(new Error(`${cmd} exited ${c}\n${e.slice(-4000)}`)));});}
function runBuffer(cmd,args){return new Promise((ok,no)=>{const p=spawn(cmd,args,{cwd:root,stdio:['ignore','pipe','pipe']});const a=[];let e='';p.stdout.on('data',d=>a.push(d));p.stderr.on('data',d=>e+=d);p.once('error',no);p.once('close',c=>c===0?ok(Buffer.concat(a)):no(new Error(`${cmd} exited ${c}\n${e.slice(-4000)}`)));});}
async function probe(file){const {stdout}=await runText('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,profile,pix_fmt,width,height,color_range,color_space,color_transfer,color_primaries,chroma_location','-of','json',file]);return JSON.parse(stdout).streams?.[0]||{};}
async function mux(h264,id){const hp=path.join(outDir,`${id}.h264`),mp=path.join(outDir,`${id}.mp4`);await fsp.writeFile(hp,h264);await runText('ffmpeg',['-hide_banner','-loglevel','error','-y','-fflags','+genpts','-r',String(FPS),'-i',hp,'-c:v','copy','-an','-movflags','+faststart',mp]);return{path:mp,rawProbe:await probe(hp),probe:await probe(mp),bytes:fs.statSync(mp).size};}
async function decodeRaw(video){const b=await runBuffer('ffmpeg',['-hide_banner','-loglevel','error','-i',video,'-vf','select=eq(n\\,30)','-vsync','0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);if(b.length!==W*H*3)throw new Error(`decoded RGB size ${b.length}`);return b;}
function patchStats(rgb){return PATCHES.map(p=>{const inset=45;let s=[0,0,0],n=0;for(let y=p.y+inset;y<p.y+p.h-inset;y++)for(let x=p.x+inset;x<p.x+p.w-inset;x++){const o=(y*W+x)*3;s[0]+=rgb[o];s[1]+=rgb[o+1];s[2]+=rgb[o+2];n++;}const mean=s.map(v=>v/n),err=mean.map((v,i)=>Math.abs(v-p.rgb[i]));return{name:p.name,expected:p.rgb,mean:mean.map(v=>+v.toFixed(3)),absError:err.map(v=>+v.toFixed(3)),meanAbs:+(err.reduce((a,b)=>a+b,0)/3).toFixed(3),maxAbs:+Math.max(...err).toFixed(3)};});}
function summarize(rows){const all=rows.flatMap(r=>r.absError),neutrals=rows.filter(r=>r.expected[0]===r.expected[1]&&r.expected[1]===r.expected[2]);const by=Object.fromEntries(rows.map(r=>[r.name,r]));const order=['black','nearblack','gray64','gray128','gray192','studio_white','white'].map(n=>by[n].mean.reduce((a,b)=>a+b,0)/3);const out={meanAbsChannelError:+(all.reduce((a,b)=>a+b,0)/all.length).toFixed(3),maxAbsChannelError:+Math.max(...all).toFixed(3),neutralMaxCast:+Math.max(...neutrals.map(r=>Math.max(...r.mean)-Math.min(...r.mean))).toFixed(3),blackMean:+(by.black.mean.reduce((a,b)=>a+b,0)/3).toFixed(3),whiteMean:+(by.white.mean.reduce((a,b)=>a+b,0)/3).toFixed(3),grayscaleMonotonic:order.every((v,i)=>i===0||v>order[i-1])};out.pass=out.meanAbsChannelError<=6&&out.maxAbsChannelError<=18&&out.neutralMaxCast<=4&&out.blackMean<=6&&out.whiteMean>=249&&out.grayscaleMonotonic;return out;}

let browser;
try {
  browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:['--no-sandbox','--disable-setuid-sandbox']});
  const page=await browser.newPage(); await page.goto(`${origin}/__r40.html`,{waitUntil:'load',timeout:120000});
  const capability=await page.evaluate(()=>({VideoEncoder:typeof VideoEncoder,VideoFrame:typeof VideoFrame,VideoColorSpace:typeof VideoColorSpace}));
  if(capability.VideoEncoder!=='function'||capability.VideoFrame!=='function')throw new Error(`WebCodecs unavailable ${JSON.stringify(capability)}`);
  await page.evaluate(({patches,W,H})=>{window.R40_PATCHES=patches;window.renderR40=()=>{const c=document.getElementById('c'),x=c.getContext('2d',{willReadFrequently:true});x.fillStyle='rgb(127,127,127)';x.fillRect(0,0,W,H);for(const p of patches){x.fillStyle=`rgb(${p.rgb.join(',')})`;x.fillRect(p.x,p.y,p.w,p.h);}const g=x.createLinearGradient(70,1780,1010,1780);g.addColorStop(0,'rgb(0,0,0)');g.addColorStop(1,'rgb(255,255,255)');x.fillStyle=g;x.fillRect(70,1760,940,80);};window.renderR40();},{patches:PATCHES,W,H});

  const frameProbe=await page.evaluate(()=>{
    const c=document.getElementById('c'),out={};
    for(const [id,colorSpace] of [['default',null],['bt709-tv',{primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false}],['rgb-srgb',{primaries:'bt709',transfer:'iec61966-2-1',matrix:'rgb',fullRange:true}]]){
      try{const init={timestamp:0};if(colorSpace)init.colorSpace=colorSpace;const f=new VideoFrame(c,init);out[id]={ok:true,format:f.format,colorSpace:f.colorSpace?.toJSON?.()||null};f.close();}catch(e){out[id]={ok:false,error:String(e?.name||'Error')+': '+String(e?.message||e)};}
    }
    return out;
  });

  async function encodeCanvas(id,colorSpace){uploads.delete(id);const result=await page.evaluate(async({id,colorSpace,W,H,FPS,TOTAL,BITRATE})=>{const c=document.getElementById('c');const cfg={codec:'avc1.420028',width:W,height:H,bitrate:BITRATE,framerate:FPS,latencyMode:'realtime',avc:{format:'annexb'}};const sup=await VideoEncoder.isConfigSupported(cfg);if(!sup.supported)throw new Error('unsupported encoder');const chunks=[];let bytes=0;const enc=new VideoEncoder({output(ch){const b=new Uint8Array(ch.byteLength);ch.copyTo(b);chunks.push(b);bytes+=b.length;},error(e){throw e;}});enc.configure(cfg);const t0=performance.now();let observed=null;for(let i=0;i<TOTAL;i++){window.renderR40();const init={timestamp:Math.trunc(i*1e6/FPS)};if(colorSpace)init.colorSpace=colorSpace;const vf=new VideoFrame(c,init);if(i===0)observed={format:vf.format,colorSpace:vf.colorSpace?.toJSON?.()||null};enc.encode(vf,{keyFrame:i===0});vf.close();}await enc.flush();const encodeMs=performance.now()-t0;enc.close();const body=new Uint8Array(bytes);let off=0;for(const b of chunks){body.set(b,off);off+=b.length;}const resp=await fetch(`/__r40_h264/${id}`,{method:'POST',body});if(!resp.ok)throw new Error(`upload ${resp.status}`);return{encodeMs,observed,bytes};},{id,colorSpace,W,H,FPS,TOTAL,BITRATE});const h264=uploads.get(id);uploads.delete(id);return{...result,h264};}

  async function encodeRaw709(id){uploads.delete(id);const result=await page.evaluate(async({id,W,H,FPS,TOTAL,BITRATE})=>{window.renderR40();const c=document.getElementById('c'),ctx=c.getContext('2d',{willReadFrequently:true}),rgba=ctx.getImageData(0,0,W,H).data;const ySize=W*H,uvW=W>>1,uvH=H>>1,uvSize=uvW*uvH,buf=new Uint8Array(ySize+uvSize*2);const Y=buf.subarray(0,ySize),U=buf.subarray(ySize,ySize+uvSize),V=buf.subarray(ySize+uvSize);const clamp=v=>Math.max(0,Math.min(255,Math.round(v)));const pix=(x,y)=>{const o=(y*W+x)*4;return[rgba[o],rgba[o+1],rgba[o+2]]};for(let y=0;y<H;y++)for(let x=0;x<W;x++){const [r,g,b]=pix(x,y);Y[y*W+x]=clamp(16+(65.481*r+128.553*g+24.966*b)/255);}for(let y=0;y<H;y+=2)for(let x=0;x<W;x+=2){let su=0,sv=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const [r,g,b]=pix(x+dx,y+dy);su+=128+(-37.797*r-74.203*g+112*b)/255;sv+=128+(112*r-93.786*g-18.214*b)/255;}const o=(y>>1)*uvW+(x>>1);U[o]=clamp(su/4);V[o]=clamp(sv/4);}const cs={primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false};let base;try{base=new VideoFrame(buf,{format:'I420',codedWidth:W,codedHeight:H,timestamp:0,colorSpace:cs});}catch(e){return{supported:false,error:String(e?.name||'Error')+': '+String(e?.message||e)};}const observed={format:base.format,colorSpace:base.colorSpace?.toJSON?.()||null};const cfg={codec:'avc1.420028',width:W,height:H,bitrate:BITRATE,framerate:FPS,latencyMode:'realtime',avc:{format:'annexb'}};const sup=await VideoEncoder.isConfigSupported(cfg);if(!sup.supported){base.close();return{supported:false,error:'encoder unsupported'};}const chunks=[];let bytes=0;const enc=new VideoEncoder({output(ch){const b=new Uint8Array(ch.byteLength);ch.copyTo(b);chunks.push(b);bytes+=b.length;},error(e){throw e;}});enc.configure(cfg);const t0=performance.now();for(let i=0;i<TOTAL;i++){const vf=new VideoFrame(base,{timestamp:Math.trunc(i*1e6/FPS)});enc.encode(vf,{keyFrame:i===0});vf.close();}await enc.flush();const encodeMs=performance.now()-t0;enc.close();base.close();const body=new Uint8Array(bytes);let off=0;for(const b of chunks){body.set(b,off);off+=b.length;}const resp=await fetch(`/__r40_h264/${id}`,{method:'POST',body});if(!resp.ok)throw new Error(`upload ${resp.status}`);return{supported:true,encodeMs,observed,bytes};},{id,W,H,FPS,TOTAL,BITRATE});const h264=uploads.get(id);uploads.delete(id);return{...result,h264};}

  const configs=[
    ['canvas-default',null],
    ['canvas-bt709-tv',{primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false}],
  ];
  const rows={};
  for(const [id,cs] of configs){try{const enc=await encodeCanvas(id,cs);const m=await mux(enc.h264,id),rgb=await decodeRaw(m.path),patches=patchStats(rgb);rows[id]={supported:true,frame:enc.observed,encodeMs:+enc.encodeMs.toFixed(3),h264Bytes:enc.bytes,mp4Bytes:m.bytes,rawProbe:m.rawProbe,probe:m.probe,patches,summary:summarize(patches)};}catch(e){rows[id]={supported:false,error:String(e?.stack||e)};}}
  const raw=await encodeRaw709('raw-i420-bt709-tv');
  if(raw.supported){const m=await mux(raw.h264,'raw-i420-bt709-tv'),rgb=await decodeRaw(m.path),patches=patchStats(rgb);rows['raw-i420-bt709-tv']={supported:true,frame:raw.observed,encodeMs:+raw.encodeMs.toFixed(3),h264Bytes:raw.bytes,mp4Bytes:m.bytes,rawProbe:m.rawProbe,probe:m.probe,patches,summary:summarize(patches)};}else rows['raw-i420-bt709-tv']=raw;

  const direct=rows['canvas-bt709-tv']; const baseline=rows['canvas-default']; const manual=rows['raw-i420-bt709-tv'];
  const probe709=x=>x?.probe?.color_range==='tv'&&x?.probe?.color_space==='bt709'&&x?.probe?.color_transfer==='bt709'&&x?.probe?.color_primaries==='bt709';
  const directOverhead=(direct?.supported&&baseline?.supported)?direct.encodeMs/baseline.encodeMs-1:null;
  const decision={
    canvasOverrideSupported:!!direct?.supported,
    canvasOverrideObserved709:direct?.frame?.colorSpace?.matrix==='bt709'&&direct?.frame?.colorSpace?.fullRange===false,
    canvasOverrideEmits709:probe709(direct),
    canvasOverrideSyntheticPass:!!direct?.summary?.pass,
    canvasOverrideEncodeOverhead:directOverhead==null?null:+directOverhead.toFixed(4),
    rawI420Supported:!!manual?.supported,
    rawI420Emits709:probe709(manual),
    rawI420SyntheticPass:!!manual?.summary?.pass,
  };
  decision.direct709Candidate=decision.canvasOverrideObserved709&&decision.canvasOverrideEmits709&&decision.canvasOverrideSyntheticPass&&(decision.canvasOverrideEncodeOverhead??1)<=0.05;
  decision.manual709Proof=decision.rawI420Emits709&&decision.rawI420SyntheticPass;
  decision.next=decision.direct709Candidate?'promote canvas colorSpace override to representative-book deep pass':decision.manual709Proof?'browser accepts correct explicit BT.709 YUV; direct Canvas conversion is not controlled, so benchmark a bounded efficient preconversion path before provider comparison':'explicit BT.709 conversion not established; preserve measured current Chromium color reference for hardware matching';
  const report={schema:'nightwill-r40-explicit-color-conversion-v1',capability,frameProbe,config:{width:W,height:H,fps:FPS,total:TOTAL,bitrate:BITRATE},rows,decision};
  await fsp.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  const lines=['# R40 explicit color conversion scout','',`Canvas default: ${baseline?.supported?`${baseline.probe.color_range}/${baseline.probe.color_space}, err ${baseline.summary.meanAbsChannelError}/${baseline.summary.maxAbsChannelError}`:'unsupported'}.`,`Canvas explicit BT.709: ${direct?.supported?`${direct.probe.color_range}/${direct.probe.color_space}, err ${direct.summary.meanAbsChannelError}/${direct.summary.maxAbsChannelError}, overhead ${((directOverhead||0)*100).toFixed(1)}%`:'unsupported/rejected'}.`,`Raw I420 explicit BT.709: ${manual?.supported?`${manual.probe.color_range}/${manual.probe.color_space}, err ${manual.summary.meanAbsChannelError}/${manual.summary.maxAbsChannelError}`:'unsupported/rejected'}.`,'',`Decision: **${decision.next}**.`,''];await fsp.writeFile(path.join(outDir,'summary.md'),lines.join('\n'));console.log(lines.join('\n'));
} finally { if(browser) await browser.close().catch(()=>{}); await new Promise(ok=>server.close(ok)); }
