#!/usr/bin/env node
// Encode one PNG source sequence through an x264 preset/CRF matrix and measure quality.
// node x264-matrix.mjs <frames-dir> [out-dir=x264-matrix] [fps=30]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const [,,framesArg,outArg='x264-matrix',fpsS='30']=process.argv;
if(!framesArg){console.error('usage: x264-matrix.mjs <frames-dir> [out-dir] [fps]');process.exit(2);}
const frames=path.resolve(framesArg),outDir=path.resolve(outArg),fps=+fpsS;
const presets=(process.env.PRESETS||'veryfast,fast,medium,slow').split(',').map(x=>x.trim()).filter(Boolean);
const crfs=(process.env.CRFS||'18,22,26').split(',').map(Number);
fs.mkdirSync(outDir,{recursive:true});

function quality(video){
  const r=spawnSync('ffmpeg',['-hide_banner','-y','-framerate',String(fps),'-i',path.join(frames,'f%05d.png'),'-i',video,'-lavfi','[0:v][1:v]ssim;[0:v][1:v]psnr','-f','null','-'],{encoding:'utf8',maxBuffer:64*1024*1024});
  if(r.status!==0)throw new Error(r.stderr||`quality ffmpeg exit ${r.status}`);
  const t=r.stderr||'',sm=/SSIM[^\n]*All:([0-9.]+)/.exec(t),pm=/PSNR[^\n]*average:([0-9.]+)/.exec(t);
  return{ssimAll:sm?+sm[1]:null,psnrAverage:pm?+pm[1]:null};
}
function probe(video){const r=spawnSync('ffprobe',['-v','error','-show_entries','format=duration,size','-show_entries','stream=codec_name,profile,width,height,nb_frames,avg_frame_rate','-of','json',video],{encoding:'utf8'});return r.status===0?JSON.parse(r.stdout):{error:r.stderr};}
const rows=[];
for(const preset of presets){
  for(const crf of crfs){
    const name=`x264-${preset}-crf${crf}`,video=path.join(outDir,name+'.mp4');
    const t0=performance.now();
    const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate',String(fps),'-i',path.join(frames,'f%05d.png'),'-c:v','libx264','-preset',preset,'-crf',String(crf),'-pix_fmt','yuv420p','-movflags','+faststart',video],{encoding:'utf8'});
    const encodeMs=performance.now()-t0;if(r.status!==0)throw new Error(r.stderr||`${name} failed`);
    const q=quality(video),p=probe(video);
    const row={family:'x264',preset,crf,encodeMs:+encodeMs.toFixed(3),bytes:fs.statSync(video).size,...q,ffprobe:p};rows.push(row);console.log(JSON.stringify(row));
  }
}
fs.writeFileSync(path.join(outDir,'x264-matrix.json'),JSON.stringify(rows,null,2));
