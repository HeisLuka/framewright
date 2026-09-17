#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {canonicalizeSemanticObservation,SEMANTIC_OBSERVATION_SCHEMA} from '../../../../contracts/inverse-observation-fusion-v1.mjs';

const SAMPLE_FPS=10,SAMPLE_W=270,SAMPLE_H=480,SAFE={x:19,y:72,w:232,h:312},DIMS={w:1080,h:1920};
function fail(message){console.error(message);process.exit(1);}
function execCmd(bin,args,options={}){const r=spawnSync(bin,args,{encoding:options.binary?null:'utf8',maxBuffer:256*1024*1024});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${bin} failed (${r.status}): ${String(r.stderr||r.stdout).slice(-3000)}`);return r;}
function sha256File(file){return createHash('sha256').update(readFileSync(file)).digest('hex');}
function parseRatio(value){const m=String(value||'').match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);return m?Number(m[1])/Number(m[2]):Number(value);}
function probe(video){const r=execCmd(process.env.FFPROBE||'ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate:format=duration','-of','json',video]),j=JSON.parse(r.stdout),s=j.streams?.[0];if(!s)throw new Error('video stream missing');return{width:Number(s.width),height:Number(s.height),fps:parseRatio(s.avg_frame_rate),duration_seconds:Number(j.format?.duration)};}
function rawFrames(video){const r=execCmd(process.env.FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-i',video,'-an','-vf',`fps=${SAMPLE_FPS},scale=${SAMPLE_W}:${SAMPLE_H}:flags=area`,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{binary:true}),frameBytes=SAMPLE_W*SAMPLE_H*3;if(r.stdout.length%frameBytes!==0)throw new Error(`rawvideo byte mismatch ${r.stdout.length}`);const frames=[];for(let offset=0,index=0;offset<r.stdout.length;offset+=frameBytes,index++)frames.push({index,t:index/SAMPLE_FPS,bytes:r.stdout.subarray(offset,offset+frameBytes)});return frames;}
function luminance(bytes,index){const r=bytes[index],g=bytes[index+1],b=bytes[index+2];return .2126*r+.7152*g+.0722*b;}
function normalizeAngle(deg){while(deg>=90)deg-=180;while(deg<-90)deg+=180;return deg;}
function angleDelta(a,b){return normalizeAngle(a-b);}
function coverComponent(frame){
  const mask=new Uint8Array(SAMPLE_W*SAMPLE_H);for(let y=SAFE.y;y<SAFE.y+SAFE.h;y++)for(let x=SAFE.x;x<SAFE.x+SAFE.w;x++){const p=y*SAMPLE_W+x,i=p*3;if(luminance(frame.bytes,i)<232)mask[p]=1;}
  const seen=new Uint8Array(mask.length);let best=null;
  for(let p=0;p<mask.length;p++){
    if(!mask[p]||seen[p])continue;const stack=[p];seen[p]=1;let area=0,minX=SAMPLE_W,maxX=0,minY=SAMPLE_H,maxY=0,sumX=0,sumY=0,sumXX=0,sumYY=0,sumXY=0;
    while(stack.length){const q=stack.pop(),x=q%SAMPLE_W,y=Math.floor(q/SAMPLE_W);area++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);sumX+=x;sumY+=y;sumXX+=x*x;sumYY+=y*y;sumXY+=x*y;for(const n of [q-1,q+1,q-SAMPLE_W,q+SAMPLE_W]){if(n<0||n>=mask.length||seen[n]||!mask[n])continue;const nx=n%SAMPLE_W,ny=Math.floor(n/SAMPLE_W);if(Math.abs(nx-x)+Math.abs(ny-y)!==1)continue;seen[n]=1;stack.push(n);}}
    const w=maxX-minX+1,h=maxY-minY+1;if(area<600||w<20||h<25)continue;const cx=sumX/area,cy=sumY/area,covXX=sumXX/area-cx*cx,covYY=sumYY/area-cy*cy,covXY=sumXY/area-cx*cy,trace=covXX+covYY,angle=.5*Math.atan2(2*covXY,covXX-covYY)*180/Math.PI;const c={area,x:minX,y:minY,w,h,cx,cy,trace,angle_deg:normalizeAngle(angle)};if(!best||c.area>best.area)best=c;
  }
  return best;
}
function findRuns(observed){const runs=[];let start=null;for(let i=0;i<=observed.length;i++){const active=i<observed.length&&observed[i].component;if(active&&start===null)start=i;if(!active&&start!==null){if(i-start>=8)runs.push({start,end:i-1,length:i-start});start=null;}}return runs;}
function chooseRevealRun(observed,duration){const runs=findRuns(observed).filter(r=>observed[r.start].t>=duration*.1&&observed[r.start].t<duration*.6&&observed[r.end].t<duration*.7);if(!runs.length)throw new Error(`no cover-bearing reveal run detected: ${JSON.stringify(findRuns(observed).map(r=>({start:observed[r.start].t,end:observed[r.end].t,length:r.length})))}`);return runs[0];}
function sampleTrack(observed,revealRun){
  const ref=observed[revealRun.end].component;if(!ref)throw new Error('settled cover reference missing');const center={x:SAMPLE_W/2,y:SAMPLE_H/2},scaleToLogical=DIMS.w/SAMPLE_W,targetProgress=[0,.08,.16,.24,.32,.4,.5,.65,.8],samples=[],diagnostics=[];
  for(const progress of targetProgress){const index=Math.max(revealRun.start,Math.min(revealRun.end,Math.round(revealRun.start+progress*(revealRun.end-revealRun.start)))),c=observed[index].component;if(!c)continue;const rotation_deg=angleDelta(c.angle_deg,ref.angle_deg),theta=rotation_deg*Math.PI/180,scale=Math.sqrt(Math.max(1e-9,c.trace)/Math.max(1e-9,ref.trace)),vx=ref.cx-center.x,vy=ref.cy-center.y,predX=center.x+scale*(Math.cos(theta)*vx-Math.sin(theta)*vy),predY=center.y+scale*(Math.sin(theta)*vx+Math.cos(theta)*vy),dx=(c.cx-predX)*scaleToLogical,dy=(c.cy-predY)*scaleToLogical;const sample={progress:Number(progress.toFixed(6)),dx:Number(dx.toFixed(5)),dy:Number(dy.toFixed(5)),scale:Number(scale.toFixed(6)),rotation_deg:Number(rotation_deg.toFixed(5))};samples.push(sample);diagnostics.push({progress,t:observed[index].t,component:c,sample});}
  return{samples,reference:ref,diagnostics};
}
function parseArgs(){const args=process.argv.slice(2),out={};for(let i=0;i<args.length;i++){if(args[i]==='--video')out.video=args[++i];else if(args[i]==='--out')out.out=args[++i];else fail(`unknown arg ${args[i]}`);}if(!out.video)fail('usage: i22-observe-asset-motion.mjs --video input.mp4 [--out observation.json]');return out;}

const options=parseArgs(),video=path.resolve(options.video);if(!existsSync(video))fail(`missing video ${video}`);const media=probe(video);if(media.width!==1080||media.height!==1920)throw new Error(`I22 C40 arm admits canonical vertical only, got ${media.width}x${media.height}`);const frames=rawFrames(video),observed=frames.map(frame=>({...frame,component:coverComponent(frame)})),revealRun=chooseRevealRun(observed,media.duration_seconds),track=sampleTrack(observed,revealRun);if(track.samples.length<6)throw new Error(`insufficient cover track samples ${track.samples.length}`);
const semantic=canonicalizeSemanticObservation({schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,delivery:{aspect:'vertical'},layout_evidence:{},motion_tracks:[{target:'asset',samples:track.samples}],coverage:{layout:0,motion:1},residuals:['layout:not_observed_i22_motion_arm','opacity:not_inferred_from_encoded_pixels','visual_system:not_observed_i22_motion_arm','asset_staging:not_observed_i22_motion_arm']});
const result={schema:'i22-pixel-asset-motion-observation-v1',version:1,source_sha256:sha256File(video),media,sampling:{fps:SAMPLE_FPS,width:SAMPLE_W,height:SAMPLE_H,safe_rect:SAFE},reveal_run:{start_time:observed[revealRun.start].t,end_time:observed[revealRun.end].t,frames:revealRun.length},raw_track:{reference:track.reference,samples:track.diagnostics},semantic_observation:semantic};const json=JSON.stringify(result,null,2)+'\n';if(options.out)writeFileSync(path.resolve(options.out),json);else process.stdout.write(json);
