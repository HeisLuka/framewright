#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/c29/batch.json'),'utf8'));
const manifestPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-c29-auto/manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),manifestDir=path.dirname(manifestPath);
const outDir=path.resolve(process.argv[4]||'artifacts/c29/review');fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const rowById=new Map(batch.results.map(x=>[x.id,x]));
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr.slice(-5000));}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function role(plan,name){return plan.roles.find(r=>r.role===name);}
function middle(r){return r.start_frame+Math.min(r.frames-1,Math.max(0,Math.floor(r.frames*.5)));}
function revealFrame(plan){const r=role(plan,'book_reveal');return r?r.start_frame+Math.min(r.frames-1,Math.max(2,Math.floor(r.frames*.35))):plan.checkpoints.reveal;}
function extract(video,frame,file,label,plain=false){const t=Math.max(.001,frame/30),vf=plain?'scale=180:320':`scale=180:320,drawbox=x=0:y=0:w=iw:h=38:color=black@0.58:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${label}':x=7:y=7:fontsize=15:fontcolor=white`;run(['-hide_banner','-loglevel','error','-y','-ss',t.toFixed(3),'-i',path.resolve(video),'-frames:v','1','-vf',vf,file]);}
const angleTypes=manifest.angleTypes,map={schema:'framewright-c29-auto-review-v1',columns:['hook','tension','pre_reveal','reveal','end'],angles:{}},hookProbe={};
for(const angleType of angleTypes){
  const items=manifest.items.filter(x=>x.angleType===angleType).sort((a,b)=>a.hookCandidateId.localeCompare(b.hookCandidateId)||a.revealOrder-b.revealOrder);
  if(items.length!==6)throw new Error(`${angleType}: expected 6 matrix rows`);
  const rowFiles=[];map.angles[angleType]={rows:[]};
  for(const item of items){
    const out=rowById.get(item.id);if(!out)throw new Error(`missing rendered output ${item.id}`);
    const plan=JSON.parse(fs.readFileSync(path.join(manifestDir,item.planFile),'utf8')),hook=role(plan,'hook'),tension=role(plan,'tension');if(!hook||!tension)throw new Error(`${item.id}: hook/tension role missing`);
    const frames=[middle(hook),middle(tension),Math.max(0,plan.checkpoints.pre_reveal),revealFrame(plan),plan.total_frames-3],labels=['HOOK','TENSION','PRE','REVEAL','END'],cells=[];
    const shortHook=item.hookCandidateId.replace(`${angleType}-`,'').slice(0,15);
    for(let i=0;i<frames.length;i++){const f=path.join(outDir,`${item.id}-${labels[i].toLowerCase()}.png`);extract(out.output,frames[i],f,`${angleType} ${shortHook} ${item.revealTiming} ${labels[i]}`);cells.push(f);}
    const strip=path.join(outDir,`${item.id}-row.png`),inputs=cells.flatMap(f=>['-i',f]);run(['-hide_banner','-loglevel','error','-y',...inputs,'-filter_complex',cells.map((_,i)=>`[${i}:v]`).join('')+`hstack=inputs=${cells.length}[v]`,'-map','[v]','-frames:v','1',strip]);rowFiles.push(strip);
    const probeFile=path.join(outDir,`${item.id}-hook-probe.png`);extract(out.output,middle(hook),probeFile,'',true);hookProbe[`${angleType}/${item.revealTiming}/${item.hookCandidateId}`]=hash(probeFile);
    map.angles[angleType].rows.push({id:item.id,hookCandidateId:item.hookCandidateId,revealTiming:item.revealTiming,narrativePlanId:item.narrativePlanId,frames:Object.fromEntries(labels.map((x,i)=>[x.toLowerCase(),frames[i]])),row:path.relative(process.cwd(),strip)});
  }
  const sheet=path.join(outDir,`${angleType}-matrix.png`),inputs=rowFiles.flatMap(f=>['-i',f]);run(['-hide_banner','-loglevel','error','-y',...inputs,'-filter_complex',rowFiles.map((_,i)=>`[${i}:v]`).join('')+`vstack=inputs=${rowFiles.length}[v]`,'-map','[v]','-frames:v','1',sheet]);map.angles[angleType].sheet=path.relative(process.cwd(),sheet);
}
let divergentHookPairs=0;const comparisons=[];
for(const angleType of angleTypes){
  const hooks=[...new Set(manifest.items.filter(x=>x.angleType===angleType).map(x=>x.hookCandidateId))];if(hooks.length!==2)throw new Error(`${angleType}: expected 2 hooks`);
  for(const timing of ['early','mid','late']){
    const a=hookProbe[`${angleType}/${timing}/${hooks[0]}`],b=hookProbe[`${angleType}/${timing}/${hooks[1]}`],different=a&&b&&a!==b;comparisons.push({angleType,revealTiming:timing,hookA:hooks[0],hookB:hooks[1],different});if(different)divergentHookPairs++;
  }
}
map.hookProbe={pairs:comparisons.length,divergentHookPairs,results:comparisons};fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));if(comparisons.length!==9||divergentHookPairs!==9)throw new Error(`hook visual divergence ${divergentHookPairs}/${comparisons.length}`);console.log(`built ${angleTypes.length} C29 matrices; hook probes differ for ${divergentHookPairs}/9 controlled hook pairs`);
