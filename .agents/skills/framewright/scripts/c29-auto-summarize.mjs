#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/c29/batch.json'),'utf8'));
const semantic=JSON.parse(fs.readFileSync(path.resolve(process.argv[3]||'artifacts/c29/semantic-audit.json'),'utf8'));
const renderAudit=JSON.parse(fs.readFileSync(path.resolve(process.argv[4]||'artifacts/c29/render-audit.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.resolve(process.argv[5]||'examples/book-ad-systems/generated-c29-auto/manifest.json'),'utf8'));
const out=path.resolve(process.argv[6]||'artifacts/c29/summary.json');
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');}
function stats(xs){const s=[...xs].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))]||0,mean=s.reduce((a,b)=>a+b,0)/Math.max(1,s.length);return{mean:+mean.toFixed(3),p50:+q(.5).toFixed(3),p95:+q(.95).toFixed(3),max:+q(1).toFixed(3)};}
function probe(file){const r=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=nb_frames,duration','-of','json',path.resolve(file)],{encoding:'utf8'});if(r.status!==0)throw new Error(`ffprobe failed ${file}: ${r.stderr}`);const s=JSON.parse(r.stdout).streams?.[0]||{};return{frames:Number(s.nb_frames),durationSeconds:Number(s.duration)};}
const itemById=new Map(manifest.items.map(x=>[x.id,x])),results=[];let layoutWarnings=0,artifactErrors=0;
for(const row of batch.results){
  const item=itemById.get(row.id);if(!item)throw new Error(`missing manifest row ${row.id}`);layoutWarnings+=row.layoutWarnings.length;
  const media=probe(row.output),expectedFrames=270;if(media.frames!==expectedFrames||Math.abs(media.durationSeconds-9)>.02)artifactErrors++;
  results.push({...item,output:row.output,outputSha256:sha(row.output),totalMs:row.totalMs,outputBytes:row.outputBytes,layoutWarnings:row.layoutWarnings.length,artifactFrames:media.frames,artifactDurationSeconds:media.durationSeconds});
}
const uniqueOutputs=new Set(results.map(x=>x.outputSha256)).size,angleTypes=[...new Set(results.map(x=>x.angleType))],concepts=[...new Set(results.map(x=>`${x.angleType}/${x.hookCandidateId}`))];
const conceptEvidence={};let conceptsWithThreeDistinct=0;
for(const concept of concepts){const xs=results.filter(x=>`${x.angleType}/${x.hookCandidateId}`===concept),timings=[...new Set(xs.map(x=>x.revealTiming))],hashes=new Set(xs.map(x=>x.outputSha256));conceptEvidence[concept]={renders:xs.length,revealTimings:timings.length,uniqueOutputs:hashes.size};if(xs.length===3&&timings.length===3&&hashes.size===3)conceptsWithThreeDistinct++;}
const summary={
  schema:'framewright-c29-auto-creative-summary-v1',renders:results.length,angleTypes,angles:angleTypes.length,concepts:concepts.length,
  uniqueOutputs,conceptsWithThreeDistinct,layoutWarnings,artifactErrors,semanticAuditOk:semantic.ok===true,semanticPlans:semantic.plans,
  semanticHookCandidates:semantic.hookCandidates,semanticRevealOrderGroups:semantic.revealOrderGroups,renderAuditErrors:renderAudit.errors?.length||0,
  renderAuditCount:renderAudit.count,totalSafeViolations:renderAudit.totalSafeViolations||0,conceptEvidence,
  perVideoMs:stats(results.map(x=>x.totalMs)),outputBytes:stats(results.map(x=>x.outputBytes)),videosPerHour:batch.videosPerHour,peakCombinedRssBytes:batch.peakCombinedRssBytes
};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({...summary,results},null,2));
if(results.length!==18||batch.count!==18)throw new Error(`expected 18 renders, got ${results.length}`);if(angleTypes.length!==3||concepts.length!==6)throw new Error(`coverage angles=${angleTypes.length} concepts=${concepts.length}`);if(uniqueOutputs!==18)throw new Error(`expected 18 distinct outputs, got ${uniqueOutputs}`);if(conceptsWithThreeDistinct!==6)throw new Error(`concept reveal diversity ${conceptsWithThreeDistinct}/6`);if(layoutWarnings!==0)throw new Error(`layout warnings ${layoutWarnings}`);if(artifactErrors!==0)throw new Error(`artifact frame/duration errors ${artifactErrors}`);if(!summary.semanticAuditOk||semantic.plans!==18||semantic.hookCandidates!==6||semantic.revealOrderGroups!==6)throw new Error('semantic audit incomplete');if(summary.renderAuditErrors!==0||summary.renderAuditCount!==18||summary.totalSafeViolations!==0)throw new Error('render/safe-zone audit incomplete');
console.log(JSON.stringify(summary,null,2));
