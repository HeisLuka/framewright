#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/c27/batch.json'),'utf8'));
const semantic=JSON.parse(fs.readFileSync(path.resolve(process.argv[3]||'artifacts/c27/semantic-audit.json'),'utf8'));
const renderAudit=JSON.parse(fs.readFileSync(path.resolve(process.argv[4]||'artifacts/c27/render-audit.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.resolve(process.argv[5]||'examples/book-ad-systems/generated-c27-render/manifest.json'),'utf8'));
const out=path.resolve(process.argv[6]||'artifacts/c27/summary.json');
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');}
function stats(xs){const s=[...xs].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))]||0,mean=s.reduce((a,b)=>a+b,0)/Math.max(1,s.length);return{mean:+mean.toFixed(3),p50:+q(.5).toFixed(3),p95:+q(.95).toFixed(3),max:+q(1).toFixed(3)};}
function probe(file){const r=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=nb_frames,duration','-of','json',path.resolve(file)],{encoding:'utf8'});if(r.status!==0)throw new Error(`ffprobe failed ${file}: ${r.stderr}`);const s=JSON.parse(r.stdout).streams?.[0]||{};return{frames:Number(s.nb_frames),durationSeconds:Number(s.duration)};}
const itemById=new Map(manifest.items.map(x=>[x.id,x])),results=[];let warnings=0,artifactFrameErrors=0;
for(const row of batch.results){
  const item=itemById.get(row.id);if(!item)throw new Error(`batch row missing manifest item ${row.id}`);warnings+=row.layoutWarnings.length;
  const media=probe(row.output),expectedFrames=Math.round(item.durationSeconds*30);if(media.frames!==expectedFrames||Math.abs(media.durationSeconds-item.durationSeconds)>.02)artifactFrameErrors++;
  results.push({...item,output:row.output,outputSha256:sha(row.output),totalMs:row.totalMs,outputBytes:row.outputBytes,layoutWarnings:row.layoutWarnings.length,artifactFrames:media.frames,artifactDurationSeconds:media.durationSeconds,expectedFrames});
}
const books=[...new Set(results.map(x=>x.bookId))],bookEvidence={};let uniqueGroups=0;
for(const bookId of books){const xs=results.filter(x=>x.bookId===bookId),hashes=new Set(xs.map(x=>x.outputSha256)),angles=[...new Set(xs.map(x=>x.angleId))],timings=[...new Set(xs.map(x=>x.revealTiming))];bookEvidence[bookId]={renders:xs.length,uniqueOutputs:hashes.size,angles:angles.length,revealTimings:timings.length};if(xs.length===6&&hashes.size===6&&angles.length===2&&timings.length===3)uniqueGroups++;}
const revealGroups={};for(const row of renderAudit.rows){const key=`${row.bookId}/${row.angleId}`;(revealGroups[key]??=[]).push(row);}let orderedRevealGroups=0;for(const [key,xs] of Object.entries(revealGroups)){const by=Object.fromEntries(xs.map(x=>[x.revealTiming,x.revealFrame]));if(Number.isFinite(by.early)&&Number.isFinite(by.mid)&&Number.isFinite(by.late)&&by.early<by.mid&&by.mid<by.late)orderedRevealGroups++;else throw new Error(`reveal order drift ${key}: ${JSON.stringify(by)}`);}
const summary={schema:'framewright-c27-narrative-render-summary-v1',renders:batch.count,books:books.length,layoutWarnings:warnings,artifactFrameErrors,semanticAuditOk:semantic.ok===true,semanticPlans:semantic.plans,deterministicReplays:semantic.deterministic_replays,copyAtomsVerified:semantic.copy_atoms_verified,renderAuditErrors:renderAudit.errors?.length||0,renderAuditCount:renderAudit.count,totalSafeViolations:renderAudit.totalSafeViolations||0,bookGroupsWithSixDistinctOutputs:uniqueGroups,revealOrderGroups:orderedRevealGroups,bookEvidence,perVideoMs:stats(results.map(x=>x.totalMs)),outputBytes:stats(results.map(x=>x.outputBytes)),videosPerHour:batch.videosPerHour,peakCombinedRssBytes:batch.peakCombinedRssBytes};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({...summary,results},null,2));
if(batch.count!==36||results.length!==36)throw new Error(`expected 36 renders, got ${results.length}`);if(books.length!==6)throw new Error(`expected 6 books, got ${books.length}`);if(warnings!==0)throw new Error(`layout warnings ${warnings}`);if(artifactFrameErrors!==0)throw new Error(`artifact frame/duration errors ${artifactFrameErrors}`);if(!summary.semanticAuditOk||semantic.plans!==36||semantic.deterministic_replays!==36)throw new Error('semantic audit incomplete');if(summary.renderAuditErrors!==0||summary.renderAuditCount!==36||summary.totalSafeViolations!==0)throw new Error('render/safe-zone audit incomplete');if(uniqueGroups!==6)throw new Error(`distinct-output coverage ${uniqueGroups}/6`);if(orderedRevealGroups!==12)throw new Error(`reveal ordering ${orderedRevealGroups}/12`);console.log(JSON.stringify(summary,null,2));
