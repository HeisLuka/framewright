#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/c23/batch.json'),'utf8'));
const audit=JSON.parse(fs.readFileSync(path.resolve(process.argv[3]||'artifacts/c23/composition-audit.json'),'utf8'));
const out=path.resolve(process.argv[4]||'artifacts/c23/summary.json');
const byBook=new Map();for(const r of batch.results){if(!byBook.has(r.bookId))byBook.set(r.bookId,{});byBook.get(r.bookId)[r.id.endsWith('-adaptive')?'adaptive':'fixed']=r;}
const ratios=[],bytes=[];let warnings=0,missing=0;for(const [book,x] of byBook){if(!x.fixed||!x.adaptive){missing++;continue;}const fixedMs=(x.fixed.totalMs||0)+(x.fixed.initMs||0),adaptiveMs=(x.adaptive.totalMs||0)+(x.adaptive.initMs||0);ratios.push(adaptiveMs/fixedMs);bytes.push(x.adaptive.outputBytes/x.fixed.outputBytes);warnings+=x.fixed.layoutWarnings.length+x.adaptive.layoutWarnings.length;}
const sorted=[...ratios].sort((a,b)=>a-b),q=p=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]||0,mean=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const summary={schema:'framewright-c23-summary-v2',books:byBook.size,renders:batch.count,layoutWarnings:warnings,missingPairs:missing,costBasis:'initMs+totalMs',costRatio:{mean:+mean(ratios).toFixed(4),p95:+q(.95).toFixed(4),max:+q(1).toFixed(4)},bytesRatio:{mean:+mean(bytes).toFixed(4)},sides:audit.sides,confidence:audit.confidence,zoom:audit.zoom,videosPerHour:batch.videosPerHour,peakCombinedRssBytes:batch.peakCombinedRssBytes};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(summary,null,2));
if(batch.count!==72)throw new Error(`expected 72 renders, got ${batch.count}`);if(byBook.size!==36||missing)throw new Error(`pairing failed books=${byBook.size} missing=${missing}`);if(warnings!==0)throw new Error(`layout warnings ${warnings}`);if(!audit.zoom||audit.zoom.minRetention<.889)throw new Error(`crop retention gate failed: ${audit.zoom?.minRetention}`);if(summary.costRatio.mean>1.08)throw new Error(`mean cost regression ${summary.costRatio.mean}`);if(summary.costRatio.p95>1.15)throw new Error(`p95 cost regression ${summary.costRatio.p95}`);console.log(JSON.stringify(summary,null,2));
