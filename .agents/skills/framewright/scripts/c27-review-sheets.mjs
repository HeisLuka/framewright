#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/c27/batch.json'),'utf8'));
const manifestPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-c27-render/manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),manifestDir=path.dirname(manifestPath);
const outDir=path.resolve(process.argv[4]||'artifacts/c27/review');fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const rowById=new Map(batch.results.map(x=>[x.id,x]));
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr.slice(-5000));}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function role(plan,name){return plan.roles.find(r=>r.role===name);}
function middle(r){return r.start_frame+Math.min(r.frames-1,Math.max(0,Math.floor(r.frames*.5)));}
function revealFrame(plan){const r=role(plan,'book_reveal');return r? r.start_frame+Math.min(r.frames-1,Math.max(2,Math.floor(r.frames*.35))):plan.checkpoints.reveal;}
function ctaFrame(plan){const r=role(plan,'cta');return r? r.start_frame+Math.min(r.frames-1,Math.max(2,Math.floor(r.frames*.45))):plan.total_frames-3;}
function extract(video,frame,file,label,plain=false){const t=Math.max(.001,frame/30),vf=plain?'scale=180:320':`scale=180:320,drawbox=x=0:y=0:w=iw:h=38:color=black@0.58:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${label}':x=7:y=7:fontsize=16:fontcolor=white`;run(['-hide_banner','-loglevel','error','-y','-ss',t.toFixed(3),'-i',path.resolve(video),'-frames:v','1','-vf',vf,file]);}
const books=[...new Set(manifest.items.map(x=>x.bookId))],map={schema:'framewright-c27-narrative-review-v1',columns:['hook','pre_reveal','reveal','cta','end'],books:{}},probe={};
for(const bookId of books){
  const items=manifest.items.filter(x=>x.bookId===bookId).sort((a,b)=>a.angleId.localeCompare(b.angleId)||['early','mid','late'].indexOf(a.revealTiming)-['early','mid','late'].indexOf(b.revealTiming));const rowFiles=[];map.books[bookId]={rows:[]};
  for(const item of items){
    const out=rowById.get(item.id);if(!out)throw new Error(`missing rendered output ${item.id}`);const plan=JSON.parse(fs.readFileSync(path.join(manifestDir,item.planFile),'utf8')),hook=role(plan,'hook'),tension=role(plan,'tension');if(!hook||!tension)throw new Error(`${item.id}: hook/tension role missing`);
    const frames=[middle(hook),Math.max(0,plan.checkpoints.pre_reveal),revealFrame(plan),ctaFrame(plan),plan.total_frames-3],labels=['HOOK','PRE','REVEAL','CTA','END'],cells=[];
    for(let i=0;i<frames.length;i++){const f=path.join(outDir,`${item.id}-${labels[i].toLowerCase()}.png`);extract(out.output,frames[i],f,`${item.angleId} ${item.revealTiming} ${labels[i]}`);cells.push(f);}
    const strip=path.join(outDir,`${item.id}-row.png`),inputs=cells.flatMap(f=>['-i',f]);run(['-hide_banner','-loglevel','error','-y',...inputs,'-filter_complex',cells.map((_,i)=>`[${i}:v]`).join('')+`hstack=inputs=${cells.length}[v]`,'-map','[v]','-frames:v','1',strip]);rowFiles.push(strip);
    const probeFile=path.join(outDir,`${item.id}-tension-probe.png`);extract(out.output,middle(tension),probeFile,'',true);probe[`${bookId}/${item.revealTiming}/${item.angleId}`]=hash(probeFile);
    map.books[bookId].rows.push({id:item.id,angleId:item.angleId,revealTiming:item.revealTiming,narrativePlanId:item.narrativePlanId,frames:Object.fromEntries(labels.map((x,i)=>[x.toLowerCase(),frames[i]])),tensionProbeFrame:middle(tension),row:path.relative(process.cwd(),strip)});
  }
  const sheet=path.join(outDir,`${bookId}-narrative-matrix.png`),inputs=rowFiles.flatMap(f=>['-i',f]);run(['-hide_banner','-loglevel','error','-y',...inputs,'-filter_complex',rowFiles.map((_,i)=>`[${i}:v]`).join('')+`vstack=inputs=${rowFiles.length}[v]`,'-map','[v]','-frames:v','1',sheet]);map.books[bookId].sheet=path.relative(process.cwd(),sheet);
}
let divergentPairs=0;const divergence=[];
for(const bookId of books){const angles=[...new Set(manifest.items.filter(x=>x.bookId===bookId).map(x=>x.angleId))];if(angles.length!==2)throw new Error(`${bookId}: expected exactly 2 angles`);for(const timing of ['early','mid','late']){const a=probe[`${bookId}/${timing}/${angles[0]}`],b=probe[`${bookId}/${timing}/${angles[1]}`],different=a&&b&&a!==b;divergence.push({bookId,revealTiming:timing,angleA:angles[0],angleB:angles[1],different});if(different)divergentPairs++;}}
map.postHookTensionProbe={pairs:divergence.length,divergentPairs,results:divergence};fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));if(divergence.length!==18||divergentPairs!==18)throw new Error(`post-hook visual divergence ${divergentPairs}/${divergence.length}`);console.log(`built ${books.length} C27 narrative matrices; post-hook tension probes differ for ${divergentPairs}/18 angle pairs`);
