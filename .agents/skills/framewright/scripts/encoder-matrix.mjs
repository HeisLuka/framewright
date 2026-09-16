#!/usr/bin/env node
// Benchmark H.264 encoder settings against one rendered PNG sequence.
// node encoder-matrix.mjs [frames=frames] [outDir=encoder-matrix] [fps=30]
// Env: PRESETS=veryfast,fast,medium,slow CRFS=18,22,26 MAXRATE=14M BUFSIZE=28M
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const [,, framesArg='frames', outArg='encoder-matrix', fpsArg='30'] = process.argv;
const framesDir = path.resolve(framesArg), outDir = path.resolve(outArg), fps = +fpsArg;
const presets = (process.env.PRESETS || 'veryfast,fast,medium,slow').split(',').map(x=>x.trim()).filter(Boolean);
const crfs = (process.env.CRFS || '18,22,26').split(',').map(Number).filter(Number.isFinite);
const maxrate = process.env.MAXRATE || '14M', bufsize = process.env.BUFSIZE || '28M';
const frameNames = fs.existsSync(framesDir) ? fs.readdirSync(framesDir).filter(n=>/^f\d{5}\.png$/.test(n)).sort() : [];
if (!frameNames.length) { console.error(`no PNG frames in ${framesDir}`); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

function run(cmd,args,{inherit=false}={}) {
  const t0=performance.now();
  const r=spawnSync(cmd,args,{encoding:'utf8',stdio:inherit?'inherit':'pipe'});
  return {status:r.status,wallMs:+(performance.now()-t0).toFixed(3),stdout:r.stdout||'',stderr:r.stderr||'',error:r.error?.message||null};
}
function parseMetric(text,name) {
  const re = name==='ssim' ? /All:([0-9.]+)/g : /average:([0-9.]+)/g;
  let m,last=null; while((m=re.exec(text))) last=+m[1]; return last;
}
function quality(video) {
  const input = path.join(framesDir,'f%05d.png');
  const common=['-hide_banner','-framerate',String(fps),'-i',input,'-i',video];
  const ssim=run('ffmpeg',[...common,'-lavfi','[0:v]setpts=PTS-STARTPTS,format=yuv420p[ref];[1:v]setpts=PTS-STARTPTS,format=yuv420p[test];[ref][test]ssim','-f','null','-']);
  const psnr=run('ffmpeg',[...common,'-lavfi','[0:v]setpts=PTS-STARTPTS,format=yuv420p[ref];[1:v]setpts=PTS-STARTPTS,format=yuv420p[test];[ref][test]psnr','-f','null','-']);
  return {ssim:parseMetric(ssim.stderr,'ssim'),psnr:parseMetric(psnr.stderr,'psnr'),ssimStatus:ssim.status,psnrStatus:psnr.status};
}
function probe(video) {
  const r=run('ffprobe',['-v','error','-show_entries','format=duration,size,bit_rate','-show_entries','stream=codec_name,width,height,nb_frames','-of','json',video]);
  if(r.status!==0) return {error:r.stderr.trim()};
  try{return JSON.parse(r.stdout);}catch{return {raw:r.stdout};}
}

const rows=[];
for(const preset of presets) for(const crf of crfs) {
  const name=`x264-${preset}-crf${crf}`, video=path.join(outDir,`${name}.mp4`);
  console.log(`=== ${name} ===`);
  const enc=run('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate',String(fps),'-i',path.join(framesDir,'f%05d.png'),'-c:v','libx264','-preset',preset,'-crf',String(crf),'-maxrate',maxrate,'-bufsize',bufsize,'-pix_fmt','yuv420p','-movflags','+faststart',video],{inherit:true});
  if(enc.status!==0){ rows.push({preset,crf,status:'encode-failed',encodeMs:enc.wallMs}); continue; }
  const q=quality(video), p=probe(video), bytes=fs.statSync(video).size;
  rows.push({preset,crf,status:'ok',encodeMs:enc.wallMs,encodeFps:+(frameNames.length*1000/enc.wallMs).toFixed(3),bytes,ssim:q.ssim,psnr:q.psnr,probe:p});
  console.log(`${enc.wallMs.toFixed(0)} ms, ${(bytes/1024).toFixed(1)} KiB, SSIM ${q.ssim}, PSNR ${q.psnr}`);
}

const baseline=rows.find(r=>r.preset==='slow'&&r.crf===22&&r.status==='ok') || null;
for(const r of rows) if(r.status==='ok'&&baseline) {
  r.speedupVsSlow22=+(baseline.encodeMs/r.encodeMs).toFixed(3);
  r.sizeRatioVsSlow22=+(r.bytes/baseline.bytes).toFixed(3);
}
const report={schema:'framewright-encoder-matrix-v1',createdAt:new Date().toISOString(),config:{framesDir,outDir,fps,frameCount:frameNames.length,presets,crfs,maxrate,bufsize},baseline:baseline?{preset:'slow',crf:22,encodeMs:baseline.encodeMs,bytes:baseline.bytes,ssim:baseline.ssim,psnr:baseline.psnr}:null,rows};
fs.writeFileSync(path.join(outDir,'matrix.json'),JSON.stringify(report,null,2));
let md='| preset | CRF | encode s | fps | size KiB | speedup vs slow/22 | size ratio | SSIM | PSNR |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n';
for(const r of rows) md+=r.status==='ok'?`| ${r.preset} | ${r.crf} | ${(r.encodeMs/1000).toFixed(3)} | ${r.encodeFps} | ${(r.bytes/1024).toFixed(1)} | ${r.speedupVsSlow22??''} | ${r.sizeRatioVsSlow22??''} | ${r.ssim??''} | ${r.psnr??''} |\n`:`| ${r.preset} | ${r.crf} | FAILED | | | | | | |\n`;
fs.writeFileSync(path.join(outDir,'matrix.md'),md); console.log('\n'+md);
if(rows.some(r=>r.status!=='ok')) process.exit(1);
