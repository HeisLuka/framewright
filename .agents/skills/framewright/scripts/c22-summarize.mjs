#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const batchPath=path.resolve(process.argv[2]||'artifacts/c22/batch.json');
const manifestPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-c22/manifest.json');
const auditPath=path.resolve(process.argv[4]||'artifacts/c22/motion-audit.json');
const outPath=path.resolve(process.argv[5]||'artifacts/c22/summary.json');
const batch=JSON.parse(fs.readFileSync(batchPath,'utf8')),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),audit=JSON.parse(fs.readFileSync(auditPath,'utf8'));
function stats(xs){const s=[...xs].sort((a,b)=>a-b),mean=s.reduce((a,b)=>a+b,0)/Math.max(1,s.length),q=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))]||0;return{mean:+mean.toFixed(4),p50:+q(.5).toFixed(4),p95:+q(.95).toFixed(4),max:+q(1).toFixed(4)};}
const byId=new Map(batch.results.map(x=>[x.id,x])),books=[...new Set(manifest.items.map(x=>x.bookId))],pairs=[];
for(const item of manifest.items)if(!byId.has(item.id))throw new Error(`missing batch result ${item.id}`);
for(const bookId of books){
  const items=manifest.items.filter(x=>x.bookId===bookId),baseItem=items.find(x=>x.mode==='e12-active'),v2Item=items.find(x=>x.mode==='c22-v2');
  if(!baseItem||!v2Item)throw new Error(`${bookId}: missing motion pair`);const base=byId.get(baseItem.id),v2=byId.get(v2Item.id),baseMs=base.initMs+base.totalMs,v2Ms=v2.initMs+v2.totalMs;
  pairs.push({bookId,style:baseItem.style,baselineMs:+baseMs.toFixed(3),c22Ms:+v2Ms.toFixed(3),costRatio:+(v2Ms/baseMs).toFixed(4),bytesRatio:+(v2.outputBytes/base.outputBytes).toFixed(4)});
}
const cost=stats(pairs.map(x=>x.costRatio)),bytes=stats(pairs.map(x=>x.bytesRatio));
const summary={schema:'framewright-c22-summary-v1',books:books.length,renders:batch.count,layoutWarningGroups:batch.layoutWarningGroups,videosPerHour:batch.videosPerHour,peakCombinedRssBytes:batch.peakCombinedRssBytes,motionAudit:audit.aggregate,costRatio:cost,bytesRatio:bytes,pairs};
fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(summary,null,2));
if(summary.books!==10)throw new Error(`expected 10 books, got ${summary.books}`);if(summary.renders!==20)throw new Error(`expected 20 renders, got ${summary.renders}`);if(summary.layoutWarningGroups!==0)throw new Error(`layout warnings ${summary.layoutWarningGroups}`);if(summary.costRatio.mean>1.08)throw new Error(`mean C22 wall ratio ${summary.costRatio.mean} > 1.08`);if(summary.costRatio.p95>1.15)throw new Error(`p95 C22 wall ratio ${summary.costRatio.p95} > 1.15`);if(summary.bytesRatio.mean>1.20)throw new Error(`mean C22 MP4 byte ratio ${summary.bytesRatio.mean} > 1.20`);
console.log(JSON.stringify({books:summary.books,renders:summary.renders,videosPerHour:summary.videosPerHour,layoutWarnings:summary.layoutWarningGroups,motionAudit:summary.motionAudit,costRatio:summary.costRatio,bytesRatio:summary.bytesRatio},null,2));
