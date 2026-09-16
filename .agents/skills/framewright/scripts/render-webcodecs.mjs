#!/usr/bin/env node
// Render a Framewright template entirely inside Chromium and encode with WebCodecs.
// No per-frame PNG/dataURL/CDP/disk path: RISO.frame() still draws the same canvas,
// while canvas.toDataURL() is temporarily replaced with a no-op during the loop.
//
// HTML=examples/book-ad-v0/index.html PAYLOAD=examples/book-ad-v0/payload.example.json \
//   node render-webcodecs.mjs [out.mp4] [seed=7] [width=1080] [bitrate=2500000]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const [,,outArg='webcodecs.mp4',seedS='7',widthS='1080',bitrateS='2500000']=process.argv;
const out=path.resolve(outArg),seed=+seedS,width=+widthS,bitrate=+bitrateS;
const html=path.resolve(process.env.HTML||'index.html');
const payloadPath=process.env.PAYLOAD?path.resolve(process.env.PAYLOAD):null;
const reportPath=path.resolve(process.env.REPORT_OUT||out.replace(/\.mp4$/i,'')+'-report.json');
if(!fs.existsSync(html)){console.error(`no such HTML: ${html}`);process.exit(1);}
let payload=null;
if(payloadPath){try{payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'));}catch(e){console.error(`bad payload: ${e.message}`);process.exit(1);}}

const root=path.dirname(html),htmlName=path.basename(html);
const mime={'.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=http.createServer((req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost'),rel=u.pathname==='/'?htmlName:decodeURIComponent(u.pathname.replace(/^\//,''));
    const file=path.resolve(root,rel);
    if(!(file===root||file.startsWith(root+path.sep))||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('not found');return;}
    res.writeHead(200,{'content-type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res);
  }catch(e){res.writeHead(500);res.end(String(e));}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port;
const pageUrl=`http://127.0.0.1:${port}/${htmlName}?f=0&w=320&s=${seed}`;

const browserArgs=['--allow-file-access-from-files'];
if(process.env.CI)browserArgs.push('--no-sandbox','--disable-setuid-sandbox');
const runT0=performance.now(),launchT0=performance.now();
const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:browserArgs});
const chromeLaunchMs=performance.now()-launchT0;
const page=await browser.newPage();
page.on('pageerror',e=>console.error('PAGE ERROR',e.message));
if(payload!==null)await page.evaluateOnNewDocument(v=>{window.FRAMEWRIGHT_PAYLOAD=v;},payload);
const loadT0=performance.now();
await page.goto(pageUrl,{waitUntil:'load',timeout:120000});
await page.waitForFunction('window.__ready===true',{timeout:120000});
const pageLoadMs=performance.now()-loadT0;
const bootError=await page.evaluate(()=>window.__bootError||null);if(bootError)throw new Error(bootError);

const codecCandidates=['avc1.4d002a','avc1.42002a','avc1.4d0028','avc1.420028'];
const resultT0=performance.now();
const result=await page.evaluate(async({seed,width,bitrate,codecCandidates})=>{
  if(typeof VideoEncoder==='undefined'||typeof VideoFrame==='undefined')throw new Error('WebCodecs VideoEncoder/VideoFrame unavailable');
  const canvas=document.getElementById('c');if(!canvas)throw new Error('main canvas #c not found');
  const total=window.RISO.total,fps=window.RISO.fps||30,height=Math.round(width*16/9/2)*2;
  let selected=null;
  for(const codec of codecCandidates){
    const config={codec,width,height,bitrate,framerate:fps,bitrateMode:'variable',latencyMode:'quality',avc:{format:'annexb'}};
    try{const s=await VideoEncoder.isConfigSupported(config);if(s.supported){selected=s.config||config;break;}}catch{}
  }
  if(!selected)throw new Error(`no supported H.264 WebCodecs config at ${width}x${height}`);
  const chunks=[];let totalBytes=0,encoderError=null,decoderConfig=null;
  const encoder=new VideoEncoder({
    output(chunk,meta){
      const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);chunks.push(bytes);totalBytes+=bytes.byteLength;
      if(meta?.decoderConfig&&!decoderConfig)decoderConfig={codec:meta.decoderConfig.codec,descriptionBytes:meta.decoderConfig.description?.byteLength||0};
    },
    error(e){encoderError=String(e);}
  });
  encoder.configure(selected);
  const originalToDataURL=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL=function(){return 'data:,';};
  let renderMs=0,videoFrameMs=0,enqueueMs=0,maxQueue=0;
  const encodeT0=performance.now();
  try{
    for(let n=0;n<total;n++){
      let t=performance.now();window.RISO.frame(n,width,seed);renderMs+=performance.now()-t;
      t=performance.now();const frame=new VideoFrame(canvas,{timestamp:Math.round(n*1_000_000/fps),duration:Math.round(1_000_000/fps)});videoFrameMs+=performance.now()-t;
      t=performance.now();encoder.encode(frame,{keyFrame:n===0||n%(fps*4)===0});enqueueMs+=performance.now()-t;frame.close();
      maxQueue=Math.max(maxQueue,encoder.encodeQueueSize);
      while(encoder.encodeQueueSize>8)await new Promise(resolve=>setTimeout(resolve,0));
    }
    await encoder.flush();
  }finally{
    HTMLCanvasElement.prototype.toDataURL=originalToDataURL;
    encoder.close();
  }
  const browserWallMs=performance.now()-encodeT0;
  if(encoderError)throw new Error(encoderError);
  const all=new Uint8Array(totalBytes);let off=0;for(const c of chunks){all.set(c,off);off+=c.byteLength;}
  const b64T0=performance.now();let binary='';const STEP=0x8000;for(let i=0;i<all.length;i+=STEP)binary+=String.fromCharCode(...all.subarray(i,i+STEP));const base64=btoa(binary);const base64Ms=performance.now()-b64T0;
  return{base64,meta:{total,fps,width,height,codec:selected,encodedBytes:totalBytes,chunks:chunks.length,browserWallMs,renderMs,videoFrameMs,enqueueMs,base64Ms,maxQueue,decoderConfig,isSecureContext:self.isSecureContext}};
},{seed,width,bitrate,codecCandidates});
const evaluateWallMs=performance.now()-resultT0;
await page.close();await browser.close();await new Promise(resolve=>server.close(resolve));

const decodeT0=performance.now(),h264=Buffer.from(result.base64,'base64'),base64DecodeMs=performance.now()-decodeT0;
const h264Path=out.replace(/\.mp4$/i,'')+'.h264';fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(h264Path,h264);
const muxT0=performance.now();
const mux=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-r',String(result.meta.fps),'-i',h264Path,'-c:v','copy','-movflags','+faststart',out],{encoding:'utf8'});
const muxMs=performance.now()-muxT0;
if(mux.status!==0){console.error(mux.stderr||`ffmpeg exit ${mux.status}`);process.exit(mux.status||1);}
const probe=spawnSync('ffprobe',['-v','error','-show_entries','format=duration,size','-show_entries','stream=codec_name,profile,width,height,nb_frames,avg_frame_rate','-of','json',out],{encoding:'utf8'});
let ffprobe=null;try{ffprobe=JSON.parse(probe.stdout);}catch{ffprobe={raw:probe.stdout,stderr:probe.stderr};}
const report={
  schema:'framewright-webcodecs-render-v1',createdAt:new Date().toISOString(),
  config:{html,payloadPath,seed,width,bitrate},
  startup:{chromeLaunchMs:+chromeLaunchMs.toFixed(3),pageLoadMs:+pageLoadMs.toFixed(3)},
  browser:result.meta,
  node:{evaluateWallMs:+evaluateWallMs.toFixed(3),finalCdpTransferApproxMs:+Math.max(0,evaluateWallMs-result.meta.browserWallMs-result.meta.base64Ms).toFixed(3),base64DecodeMs:+base64DecodeMs.toFixed(3),muxMs:+muxMs.toFixed(3)},
  output:{h264Bytes:h264.byteLength,mp4Bytes:fs.statSync(out).size,ffprobe},
  totalRunMs:+(performance.now()-runT0).toFixed(3)
};
fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
if(!process.env.KEEP_H264)fs.rmSync(h264Path,{force:true});
console.log(JSON.stringify(report,null,2));
console.log(`webcodecs output ${out}`);
