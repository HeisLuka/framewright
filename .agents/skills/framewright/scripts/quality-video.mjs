#!/usr/bin/env node
// Compare an encoded video against the original PNG frame sequence.
// node quality-video.mjs <frames-dir> <video.mp4> [out.json] [fps=30]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [,,framesArg,videoArg,outArg='quality.json',fpsS='30']=process.argv;
if(!framesArg||!videoArg){console.error('usage: quality-video.mjs <frames-dir> <video.mp4> [out.json] [fps=30]');process.exit(2);}
const frames=path.resolve(framesArg),video=path.resolve(videoArg),out=path.resolve(outArg),fps=+fpsS;
const ff=spawnSync('ffmpeg',['-hide_banner','-y','-framerate',String(fps),'-i',path.join(frames,'f%05d.png'),'-i',video,'-lavfi','[0:v][1:v]ssim;[0:v][1:v]psnr','-f','null','-'],{encoding:'utf8',maxBuffer:64*1024*1024});
if(ff.status!==0){console.error(ff.stderr);process.exit(ff.status||1);}
const text=ff.stderr||'';
const ssim=/SSIM[^\n]*All:([0-9.]+)/.exec(text);
const psnr=/PSNR[^\n]*average:([0-9.]+)/.exec(text);
const probe=spawnSync('ffprobe',['-v','error','-show_entries','format=duration,size','-show_entries','stream=codec_name,profile,width,height,nb_frames,avg_frame_rate','-of','json',video],{encoding:'utf8'});
const report={video,ssimAll:ssim?+ssim[1]:null,psnrAverage:psnr?+psnr[1]:null,ffprobe:probe.status===0?JSON.parse(probe.stdout):{error:probe.stderr},ffmpegSummary:text.split('\n').filter(x=>x.includes('SSIM')||x.includes('PSNR')).slice(-4)};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
