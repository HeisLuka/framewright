#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { materializeVideoObservation } from '../../../../contracts/inverse-creative-compiler-v1.mjs';

function fail(message){throw new Error(message);}
function parseArgs(argv){
  const out={input:null,out:null,sample_fps:6,scene_threshold:0.18};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--out')out.out=argv[++i];
    else if(arg==='--sample-fps')out.sample_fps=Number(argv[++i]);
    else if(arg==='--scene-threshold')out.scene_threshold=Number(argv[++i]);
    else if(arg.startsWith('--'))fail(`unknown option ${arg}`);
    else if(!out.input)out.input=arg;
    else fail(`unexpected argument ${arg}`);
  }
  if(!out.input)fail('usage: node ic01-observe-video.mjs <video.mp4> [--out observation.json] [--sample-fps 6] [--scene-threshold 0.18]');
  if(!(Number.isFinite(out.sample_fps)&&out.sample_fps>0&&out.sample_fps<=30))fail('sample_fps must be in (0,30]');
  if(!(Number.isFinite(out.scene_threshold)&&out.scene_threshold>0&&out.scene_threshold<1))fail('scene_threshold must be in (0,1)');
  return out;
}
function run(command,args,{encoding='utf8',maxBuffer=256*1024*1024}={}){
  const result=spawnSync(command,args,{encoding,maxBuffer,windowsHide:true});
  if(result.error)fail(`${command} failed: ${result.error.message}`);
  if(result.status!==0)fail(`${command} exited ${result.status}: ${String(result.stderr||'').trim()}`);
  return result.stdout;
}
function parseRate(value){
  if(typeof value!=='string'||!value)return NaN;
  const [a,b='1']=value.split('/').map(Number);
  return b?a/b:NaN;
}
function percentile(values,p){
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  const index=Math.min(sorted.length-1,Math.max(0,Math.round((sorted.length-1)*p)));
  return sorted[index];
}
function mean(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}
function stdev(values){if(values.length<2)return 0;const m=mean(values);return Math.sqrt(mean(values.map(v=>(v-m)**2)));}
function blankGrid(){return Array.from({length:4},()=>Array(4).fill(0));}
function normalizeGrid(grid){
  const flat=grid.flat(),total=flat.reduce((a,b)=>a+b,0);
  if(total<=0)return grid.map(row=>row.map(()=>0));
  return grid.map(row=>row.map(value=>value/total));
}
function frameEdges(frame,width,height){
  const grid=blankGrid();let total=0,weightedX=0,weightedY=0;
  for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
    const i=y*width+x;
    const g=(Math.abs(frame[i]-frame[i+1])+Math.abs(frame[i]-frame[i+width]))/510;
    if(g<=0)continue;
    const gx=Math.min(3,Math.floor(x/width*4)),gy=Math.min(3,Math.floor(y/height*4));
    grid[gy][gx]+=g;total+=g;weightedX+=x*g;weightedY+=y*g;
  }
  return {grid,centroid:{x:total?weightedX/total:width/2,y:total?weightedY/total:height/2},energy:total/((width-1)*(height-1))};
}
function analyzeGrayFrames(buffer,width,height,sampleFps,sceneThreshold){
  const frameSize=width*height,frameCount=Math.floor(buffer.length/frameSize);
  if(frameCount<1)fail('ffmpeg returned no sampled frames');
  const frames=[];for(let i=0;i<frameCount;i++)frames.push(buffer.subarray(i*frameSize,(i+1)*frameSize));
  const appearanceGrid=blankGrid(),motionGrid=blankGrid(),edgeEnergies=[],centroids=[],lumas=[];
  for(const frame of frames){
    let sum=0;for(const value of frame)sum+=value;lumas.push(sum/(frame.length*255));
    const edge=frameEdges(frame,width,height);edgeEnergies.push(edge.energy);centroids.push(edge.centroid);
    for(let y=0;y<4;y++)for(let x=0;x<4;x++)appearanceGrid[y][x]+=edge.grid[y][x];
  }
  const diffs=[],cutCandidates=[],dxs=[],dys=[];
  for(let fi=1;fi<frames.length;fi++){
    const a=frames[fi-1],b=frames[fi];let sum=0;const local=blankGrid();
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,d=Math.abs(a[i]-b[i])/255;sum+=d;
      local[Math.min(3,Math.floor(y/height*4))][Math.min(3,Math.floor(x/width*4))]+=d;
    }
    const score=sum/frameSize;diffs.push(score);
    for(let y=0;y<4;y++)for(let x=0;x<4;x++)motionGrid[y][x]+=local[y][x];
    const dx=centroids[fi].x-centroids[fi-1].x,dy=centroids[fi].y-centroids[fi-1].y;dxs.push(dx);dys.push(dy);
    if(score>=sceneThreshold)cutCandidates.push({frame_index:fi,time_seconds:fi/sampleFps,score,previous_score:diffs.length<2?0:diffs[diffs.length-2]});
  }
  const filteredCuts=cutCandidates.filter((item,index,list)=>{
    const prev=list[index-1],next=list[index+1];
    if(prev&&item.frame_index-prev.frame_index===1&&prev.score>item.score)return false;
    if(next&&next.frame_index-item.frame_index===1&&next.score>item.score)return false;
    return true;
  }).map(({previous_score,...item})=>item);
  const absDx=dxs.map(Math.abs),absDy=dys.map(Math.abs),mx=mean(absDx),my=mean(absDy),directionDen=mx+my||1;
  const meanDiff=mean(diffs),sd=stdev(diffs);
  return {
    sampled_frames:frameCount,
    luma:{mean:mean(lumas),stddev:stdev(lumas)},
    appearance:{edge_grid:normalizeGrid(appearanceGrid),mean_edge_energy:mean(edgeEnergies)},
    motion:{
      mean_abs_diff:meanDiff,
      p95_abs_diff:percentile(diffs,0.95),
      burstiness:meanDiff>0?sd/meanDiff:0,
      directional_bias:{horizontal:mx/directionDen,vertical:my/directionDen},
      feature_centroid_delta:{dx:mean(dxs),dy:mean(dys),mean_abs_dx:mx,mean_abs_dy:my},
      activity_grid:normalizeGrid(motionGrid),
    },
    cut_candidates:filteredCuts,
  };
}
function rgbToHex(r,g,b){return `#${[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')}`;}
function analyzePalette(buffer,width,height){
  const frameSize=width*height*3,frames=Math.floor(buffer.length/frameSize),counts=new Map(),total=frames*width*height;
  for(let i=0;i<frames*frameSize;i+=3){
    const r=buffer[i],g=buffer[i+1],b=buffer[i+2],qr=r>>5,qg=g>>5,qb=b>>5,key=(qr<<6)|(qg<<3)|qb;
    counts.set(key,(counts.get(key)||0)+1);
  }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([key,count])=>{
    const qr=(key>>6)&7,qg=(key>>3)&7,qb=key&7;
    return {hex:rgbToHex(qr*32+16,qg*32+16,qb*32+16),fraction:total?count/total:0};
  });
}

const args=parseArgs(process.argv.slice(2));
const input=resolve(args.input);
const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',input]));
const stream=(probe.streams||[]).find(item=>item.codec_type==='video');
if(!stream)fail('no video stream found');
const fps=parseRate(stream.avg_frame_rate)||parseRate(stream.r_frame_rate);
const duration=Number(stream.duration||probe.format?.duration);
if(!(Number.isFinite(fps)&&fps>0))fail('unable to determine fps');
if(!(Number.isFinite(duration)&&duration>0))fail('unable to determine duration');
const source={width:Number(stream.width),height:Number(stream.height),fps,duration_seconds:duration,frame_count:Number(stream.nb_frames)||Math.max(1,Math.round(duration*fps)),codec_name:stream.codec_name||null,pix_fmt:stream.pix_fmt||null};
const grayWidth=64,grayHeight=64;
const gray=run('ffmpeg',['-v','error','-i',input,'-an','-sn','-vf',`fps=${args.sample_fps},scale=${grayWidth}:${grayHeight}:flags=area,format=gray`,'-f','rawvideo','-pix_fmt','gray','pipe:1'],{encoding:null});
const grayAnalysis=analyzeGrayFrames(gray,grayWidth,grayHeight,args.sample_fps,args.scene_threshold);
const paletteWidth=32,paletteHeight=32,paletteFps=Math.min(2,args.sample_fps);
const rgb=run('ffmpeg',['-v','error','-i',input,'-an','-sn','-vf',`fps=${paletteFps},scale=${paletteWidth}:${paletteHeight}:flags=area,format=rgb24`,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:null});
const observation=materializeVideoObservation({source,sampling:{sample_fps:args.sample_fps,sampled_frames:grayAnalysis.sampled_frames,analysis_width:grayWidth,analysis_height:grayHeight},cut_candidates:grayAnalysis.cut_candidates,motion:grayAnalysis.motion,appearance:{...grayAnalysis.appearance,luma:grayAnalysis.luma,dominant_colors:analyzePalette(rgb,paletteWidth,paletteHeight)}});
const output=`${JSON.stringify(observation,null,2)}\n`;
if(args.out)writeFileSync(resolve(args.out),output,'utf8');else process.stdout.write(output);
