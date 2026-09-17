#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {canonicalizeSemanticObservation,SEMANTIC_OBSERVATION_SCHEMA} from '../../../../contracts/inverse-observation-fusion-v1.mjs';

function fail(message){console.error(message);process.exit(1);}
function run(bin,args,options={}){const r=spawnSync(bin,args,{encoding:options.binary?null:'utf8',maxBuffer:128*1024*1024});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${bin} failed (${r.status}): ${String(r.stderr||r.stdout).slice(-3000)}`);return r;}
function sha256File(file){return createHash('sha256').update(readFileSync(file)).digest('hex');}
function parseRatio(value){const m=String(value||'').match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);return m?Number(m[1])/Number(m[2]):Number(value);}
function probe(video){const r=run(process.env.FFPROBE||'ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate:format=duration','-of','json',video]),j=JSON.parse(r.stdout),s=j.streams?.[0];if(!s)throw new Error('video stream missing');return{width:Number(s.width),height:Number(s.height),fps:parseRatio(s.avg_frame_rate),duration_seconds:Number(j.format?.duration)};}
function frame(video,time,w,h){const r=run(process.env.FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-ss',String(time),'-i',video,'-frames:v','1','-vf',`scale=${w}:${h}:flags=area`,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{binary:true});if(r.stdout.length!==w*h*3)throw new Error(`raw frame size mismatch ${r.stdout.length} != ${w*h*3}`);return r.stdout;}
function pixel(buf,w,x,y){const i=(y*w+x)*3;return[buf[i],buf[i+1],buf[i+2]];}
const PROFILE={
  vertical:{width:1080,height:1920,safe:{x:76,y:288,w:928,h:1248},sample:{w:270,h:480}},
  square:{width:1080,height:1080,safe:{x:64,y:62,w:952,h:956},sample:{w:360,h:360}},
  landscape:{width:1920,height:1080,safe:{x:110,y:70,w:1700,h:940},sample:{w:480,h:270}},
};
function profileFor(media){for(const [aspect,p] of Object.entries(PROFILE))if(media.width===p.width&&media.height===p.height)return{aspect,...p};throw new Error(`unsupported I22 delivery geometry ${media.width}x${media.height}`);}
function scaledSafe(profile,sample){return{x:Math.round(profile.safe.x/profile.width*sample.w),y:Math.round(profile.safe.y/profile.height*sample.h),w:Math.round(profile.safe.w/profile.width*sample.w),h:Math.round(profile.safe.h/profile.height*sample.h)};}
function toSafePoint(x,y,safe){return{x:(x-safe.x)/safe.w*1000,y:(y-safe.y)/safe.h*1000};}
function toSafeBox(box,safe){return{x:(box.x-safe.x)/safe.w*1000,y:(box.y-safe.y)/safe.h*1000,w:box.w/safe.w*1000,h:box.h/safe.h*1000};}
function findPrimaryTextAnchor(buf,w,h,safe){
  let minX=Infinity,minY=Infinity,count=0;
  for(let y=safe.y;y<safe.y+safe.h;y++)for(let x=safe.x;x<safe.x+safe.w;x++){
    const [r,g,b]=pixel(buf,w,x,y),max=Math.max(r,g,b),min=Math.min(r,g,b),lum=.2126*r+.7152*g+.0722*b;
    if(lum<105&&max-min<70){minX=Math.min(minX,x);minY=Math.min(minY,y);count++;}
  }
  if(!Number.isFinite(minX)||count<20)throw new Error(`primary text dark-pixel evidence too weak (${count})`);
  return{anchor:toSafePoint(minX,minY,safe),dark_pixel_count:count};
}
function accentMask(buf,w,h,safe){
  const mask=new Uint8Array(w*h),minY=Math.round(safe.y+safe.h*.54),maxY=Math.min(h,safe.y+safe.h);
  for(let y=minY;y<maxY;y++)for(let x=safe.x;x<Math.min(w,safe.x+safe.w);x++){
    const [r,g,b]=pixel(buf,w,x,y);
    if(r>145&&r>g*1.55&&r>b*1.45&&g<135&&b<135)mask[y*w+x]=1;
  }
  return mask;
}
function components(mask,w,h){
  const seen=new Uint8Array(mask.length),out=[];
  for(let i=0;i<mask.length;i++){
    if(!mask[i]||seen[i])continue;
    const stack=[i];seen[i]=1;let minX=w,minY=h,maxX=0,maxY=0,n=0;
    while(stack.length){const p=stack.pop(),x=p%w,y=Math.floor(p/w);n++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);for(const q of [p-1,p+1,p-w,p+w]){if(q<0||q>=mask.length||seen[q]||!mask[q])continue;const qx=q%w,qy=Math.floor(q/w);if(Math.abs(qx-x)+Math.abs(qy-y)!==1)continue;seen[q]=1;stack.push(q);}}
    out.push({x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1,pixels:n,fill:n/Math.max(1,(maxX-minX+1)*(maxY-minY+1))});
  }
  return out.sort((a,b)=>b.pixels-a.pixels||b.w*b.h-a.w*a.h);
}
function findCta(buf,w,h,safe){const minPixels=Math.max(25,Math.round(w*h*.00025)),minW=Math.max(18,Math.round(w*.05)),minH=Math.max(6,Math.round(h*.02));const list=components(accentMask(buf,w,h,safe),w,h).filter(c=>c.pixels>=minPixels&&c.w>=minW&&c.h>=minH);if(!list.length)throw new Error('CTA accent component missing');const best=list[0];return{box:toSafeBox(best,safe),component:best,candidate_count:list.length};}
function parseArgs(){const args=process.argv.slice(2),out={};for(let i=0;i<args.length;i+=1){if(args[i]==='--video')out.video=args[++i];else if(args[i]==='--out')out.out=args[++i];else fail(`unknown arg ${args[i]}`);}if(!out.video)fail('usage: i22-observe-layout.mjs --video input.mp4 [--out result.json]');return out;}

const options=parseArgs(),video=path.resolve(options.video);if(!existsSync(video))fail(`missing video ${video}`);
const media=probe(video),profile=profileFor(media),sample=profile.sample,safe=scaledSafe(profile,sample),hookTime=media.duration_seconds*.18,ctaTime=media.duration_seconds*.94;
const hookFrame=frame(video,hookTime,sample.w,sample.h),ctaFrame=frame(video,ctaTime,sample.w,sample.h),primary=findPrimaryTextAnchor(hookFrame,sample.w,sample.h,safe),cta=findCta(ctaFrame,sample.w,sample.h,safe);
const semantic=canonicalizeSemanticObservation({schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,delivery:{aspect:profile.aspect},layout_evidence:{primary_text_anchor:primary.anchor,cta_box:cta.box},motion_tracks:[],coverage:{layout:1,motion:0},residuals:['motion:not_observed_i22_layout_arm','visual_system:not_observed_i22_layout_arm','asset_staging:not_observed_i22_layout_arm']});
const result={schema:'i22-pixel-layout-observation-v2',version:2,source_sha256:sha256File(video),media,delivery_aspect:profile.aspect,sampling:{width:sample.w,height:sample.h,hook_time_seconds:hookTime,cta_time_seconds:ctaTime,safe_rect:safe},raw_measurements:{primary_text:primary,cta},semantic_observation:semantic};
const json=JSON.stringify(result,null,2)+'\n';if(options.out)writeFileSync(path.resolve(options.out),json);else process.stdout.write(json);
