#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalizeObservationIR } from '../../../../contracts/inverse-creative-compiler-v1.mjs';

function fail(message){console.error(message);process.exit(1);}
function run(bin,args){
  const result=spawnSync(bin,args,{encoding:'utf8',maxBuffer:64*1024*1024});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${bin} failed (${result.status}): ${result.stderr||result.stdout}`);
  return{stdout:result.stdout||'',stderr:result.stderr||''};
}
function sha256File(path){return createHash('sha256').update(readFileSync(path)).digest('hex');}
function parseRatio(value){
  const match=String(value||'').match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if(match)return Number(match[1])/Number(match[2]);
  return Number(value);
}
function args(){
  const items=process.argv.slice(2);const out={sceneThreshold:0.24,sampleFps:10};
  for(let i=0;i<items.length;i++){
    if(items[i]==='--video')out.video=items[++i];
    else if(items[i]==='--out')out.out=items[++i];
    else if(items[i]==='--scene-threshold')out.sceneThreshold=Number(items[++i]);
    else if(items[i]==='--sample-fps')out.sampleFps=Number(items[++i]);
    else fail(`unknown argument ${items[i]}`);
  }
  if(!out.video)fail('usage: c44-observe-video.mjs --video input.mp4 [--out observation.json] [--scene-threshold 0.24] [--sample-fps 10]');
  if(!(out.sceneThreshold>0&&out.sceneThreshold<1))fail('--scene-threshold must be within 0..1');
  if(!(out.sampleFps>0&&out.sampleFps<=60))fail('--sample-fps must be within 0..60');
  return out;
}

function probe(video){
  const {stdout}=run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate:format=duration','-of','json',video]);
  const parsed=JSON.parse(stdout);const stream=parsed.streams?.[0];
  if(!stream)throw new Error('video stream missing');
  const duration=Number(parsed.format?.duration);
  const fps=parseRatio(stream.avg_frame_rate);
  if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(fps)||fps<=0)throw new Error('invalid video timing metadata');
  return{width:Number(stream.width),height:Number(stream.height),fps,duration_seconds:duration};
}

function observeCuts(video,threshold){
  const filter=`select='gt(scene,${threshold})',showinfo`;
  const {stderr}=run('ffmpeg',['-hide_banner','-nostats','-i',video,'-an','-vf',filter,'-f','null','-']);
  const times=[];
  for(const line of stderr.split(/\r?\n/)){
    const match=line.match(/pts_time:([0-9.]+)/);
    if(match){const t=Number(match[1]);if(Number.isFinite(t)&&t>0)times.push(t);}
  }
  return [...new Set(times.map(v=>Math.round(v*10000)/10000))].sort((a,b)=>a-b);
}

function observeMotionEnergy(video,sampleFps){
  const filter=`fps=${sampleFps},tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG`;
  const {stderr}=run('ffmpeg',['-hide_banner','-nostats','-i',video,'-an','-vf',filter,'-f','null','-']);
  const samples=[];let t=null;
  for(const line of stderr.split(/\r?\n/)){
    const frame=line.match(/frame:\d+\s+pts:\d+\s+pts_time:([0-9.]+)/);
    if(frame)t=Number(frame[1]);
    const value=line.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/);
    if(value&&Number.isFinite(t)){samples.push({t,value:Number(value[1])/255});t=null;}
  }
  return samples;
}

const options=args();
const video=resolve(options.video);
const media=probe(video);
const cut_times_seconds=observeCuts(video,options.sceneThreshold);
const motion_energy=observeMotionEnergy(video,options.sampleFps);
const observation=canonicalizeObservationIR({
  source_sha256:sha256File(video),
  media,
  cut_times_seconds,
  motion_energy,
  coverage:{temporal:1,motion:motion_energy.length>=3?1:0,layout:0,typography:0,appearance:0,assets:0},
  residuals:[
    'layout:not_observed_v1','typography:not_observed_v1','appearance:not_observed_v1','assets:not_observed_v1',
  ],
});
const json=`${JSON.stringify(observation,null,2)}\n`;
if(options.out)writeFileSync(resolve(options.out),json);
else process.stdout.write(json);
