#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batchPath=path.resolve(process.argv[2]||'artifacts/e16/source-batch.json');
const manifestPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-e16/manifest.json');
const outDir=path.resolve(process.argv[4]||'artifacts/e16/adapted');
const reportPath=path.resolve(process.argv[5]||'artifacts/e16/adaptation.json');
const batch=JSON.parse(fs.readFileSync(batchPath,'utf8'));
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});

const FORMATS=[
  {id:'square',width:1080,height:1080},
  {id:'landscape',width:1920,height:1080}
];
const STRATEGIES=['contain','cover'];
const sourceAspect=9/16;
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8'});if(r.status!==0)throw new Error(`ffmpeg failed: ${r.stderr.slice(-3000)}`);}
function probe(file){const r=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,duration','-of','json',file],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr);const s=JSON.parse(r.stdout).streams[0];return{width:+s.width,height:+s.height,duration:+s.duration};}
function ffColor(hex){return String(hex||'#111111').replace('#','0x');}

const rows=[];
for(const entry of manifest.items){
  const src=batch.results.find(x=>x.id===entry.id);if(!src)throw new Error(`missing source render ${entry.id}`);
  const payloadFile=path.resolve(path.dirname(manifestPath),entry.payloadFile),payload=JSON.parse(fs.readFileSync(payloadFile,'utf8'));
  const sourcePath=path.resolve(src.output);
  for(const fmt of FORMATS){
    const targetAspect=fmt.width/fmt.height;
    for(const strategy of STRATEGIES){
      const file=path.join(outDir,`${entry.bookId}-${entry.style}-${fmt.id}-${strategy}.mp4`);
      const filter=strategy==='contain'
        ?`scale=${fmt.width}:${fmt.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${fmt.width}:${fmt.height}:(ow-iw)/2:(oh-ih)/2:color=${ffColor(payload.background)}`
        :`scale=${fmt.width}:${fmt.height}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${fmt.width}:${fmt.height}`;
      run(['-hide_banner','-loglevel','error','-y','-i',sourcePath,'-vf',filter,'-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',file]);
      const p=probe(file),ratio=Math.min(1,sourceAspect/targetAspect);
      rows.push({bookId:entry.bookId,style:entry.style,format:fmt.id,strategy,target:{width:fmt.width,height:fmt.height,aspect:+targetAspect.toFixed(6)},sourceRetention:strategy==='contain'?1:+ratio.toFixed(6),contentAreaUtilization:strategy==='contain'?+ratio.toFixed(6):1,output:path.relative(process.cwd(),file),outputBytes:fs.statSync(file).size,probe:p});
    }
  }
}
const report={schema:'framewright-e16-raster-adaptation-v1',source:{width:1080,height:1920,aspect:sourceAspect},formats:FORMATS,strategies:STRATEGIES,results:rows};
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
