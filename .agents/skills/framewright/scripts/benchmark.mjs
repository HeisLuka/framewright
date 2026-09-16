#!/usr/bin/env node
// End-to-end benchmark for the current Framewright pipeline.
// HTML=examples/ris-tv/index.html node benchmark.mjs [report=e01-benchmark.json] [seed=7] [width=1920] [tabs=5]
// Env: AR, START, END, CRF, FPS, MAXRATE, FRAMES_DIR, VIDEO_OUT, TRACK, KEEP_FRAMES=1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const [,, reportArg='e01-benchmark.json', seed='7', width='1920', tabs='5']=process.argv;
const reportPath=path.resolve(reportArg);
const framesDir=path.resolve(process.env.FRAMES_DIR||'frames-bench');
const videoOut=path.resolve(process.env.VIDEO_OUT||'e01-benchmark.mp4');
const renderProfile=path.resolve(process.env.RENDER_PROFILE_OUT||'e01-render-profile.json');
const track=process.env.TRACK||'__no_track__.wav';
const html=path.resolve(process.env.HTML||'index.html');

function run(command,args,env=process.env){ const t0=performance.now(); const r=spawnSync(command,args,{env,stdio:'inherit'}); return {status:r.status,signal:r.signal,wallMs:+(performance.now()-t0).toFixed(3),error:r.error?.message||null}; }
function dirBytes(dir){ if(!fs.existsSync(dir)) return 0; let total=0; for(const ent of fs.readdirSync(dir,{withFileTypes:true})){ const p=path.join(dir,ent.name); total+=ent.isDirectory()?dirBytes(p):fs.statSync(p).size; } return total; }
function capture(command,args){ const r=spawnSync(command,args,{encoding:'utf8'}); return {status:r.status,stdout:r.stdout?.trim()||'',stderr:r.stderr?.trim()||''}; }

if(!fs.existsSync(html)){ console.error(`no such HTML: ${html}`); process.exit(1); }
fs.rmSync(framesDir,{recursive:true,force:true}); fs.rmSync(videoOut,{force:true}); fs.rmSync(renderProfile,{force:true});

const startedAt=new Date().toISOString(), totalT0=performance.now();
const renderEnv={...process.env,HTML:html,PROFILE_OUT:renderProfile};
const render=run(process.execPath,[path.join(HERE,'profile-render.mjs'),framesDir,seed,width,tabs],renderEnv);
if(render.status!==0){ console.error('render failed; benchmark stopped before encode'); process.exit(render.status||1); }

const frameBytes=dirBytes(framesDir), frameCount=fs.readdirSync(framesDir).filter(n=>/^f\d{5}\.png$/.test(n)).length;
const build=run('bash',[path.join(HERE,'build.sh'),videoOut,framesDir,track],process.env);
if(build.status!==0){ console.error('build failed'); process.exit(build.status||1); }

const probe=capture('ffprobe',['-v','error','-show_entries','format=duration,size','-show_entries','stream=codec_name,width,height,nb_frames','-of','json',videoOut]);
let ffprobe=null; try{ ffprobe=probe.status===0?JSON.parse(probe.stdout):{error:probe.stderr}; }catch{ ffprobe={raw:probe.stdout,error:probe.stderr}; }
const renderData=fs.existsSync(renderProfile)?JSON.parse(fs.readFileSync(renderProfile,'utf8')):null;
const report={schema:'framewright-e01-benchmark-v1',startedAt,finishedAt:new Date().toISOString(),config:{html,seed:+seed,width:+width,tabs:+tabs,ar:process.env.AR||null,start:process.env.START==null?null:+process.env.START,end:process.env.END==null?null:+process.env.END,crf:+(process.env.CRF||22),fps:+(process.env.FPS||30),maxrate:process.env.MAXRATE||'14M',track:fs.existsSync(track)?path.resolve(track):null},wall:{renderMs:render.wallMs,buildMs:build.wallMs,totalMs:+(performance.now()-totalT0).toFixed(3)},intermediates:{framesDir,frameCount,frameBytes},output:{videoOut,videoBytes:fs.statSync(videoOut).size,ffprobe},renderProfile:renderData};
fs.mkdirSync(path.dirname(reportPath),{recursive:true}); fs.writeFileSync(reportPath,JSON.stringify(report,null,2)); console.log(`benchmark report ${reportPath}`);
if(!process.env.KEEP_FRAMES) fs.rmSync(framesDir,{recursive:true,force:true});
