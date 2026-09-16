#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const batchPath=path.resolve(process.argv[2]||'artifacts/c21/batch.json');
const manifestPath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-c21/manifest.json');
const auditPath=path.resolve(process.argv[4]||'artifacts/c21/opening-audit.json');
const outPath=path.resolve(process.argv[5]||'artifacts/c21/summary.json');
const batch=JSON.parse(fs.readFileSync(batchPath,'utf8')),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),audit=JSON.parse(fs.readFileSync(auditPath,'utf8'));
function stats(xs){const s=[...xs].sort((a,b)=>a-b),mean=s.reduce((a,b)=>a+b,0)/Math.max(1,s.length),q=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))]||0;return{mean:+mean.toFixed(4),p50:+q(.5).toFixed(4),p95:+q(.95).toFixed(4),max:+q(1).toFixed(4)};}
const byId=new Map(batch.results.map(x=>[x.id,x])),books=[...new Set(manifest.items.map(x=>x.bookId))],pairs=[];
for(const item of manifest.items)if(!byId.has(item.id))throw new Error(`missing batch result ${item.id}`);
for(const bookId of books){
  const items=manifest.items.filter(x=>x.bookId===bookId),baseItem=items.find(x=>x.grammar==='hook-led');if(!baseItem)throw new Error(`${bookId}: missing hook-led baseline`);
  const base=byId.get(baseItem.id),baseMs=base.initMs+base.totalMs;
  for(const item of items.filter(x=>x.grammar!=='hook-led')){
    const row=byId.get(item.id),ms=row.initMs+row.totalMs;
    pairs.push({bookId,style:item.style,grammar:item.grammar,baselineMs:+baseMs.toFixed(3),grammarMs:+ms.toFixed(3),costRatio:+(ms/baseMs).toFixed(4),bytesRatio:+(row.outputBytes/base.outputBytes).toFixed(4)});
  }
}
const cost=stats(pairs.map(x=>x.costRatio)),bytes=stats(pairs.map(x=>x.bytesRatio));
const byGrammar=Object.fromEntries(['cover-led','title-led','progressive-hook'].map(grammar=>{const p=pairs.filter(x=>x.grammar===grammar);return[grammar,{pairs:p.length,costRatio:stats(p.map(x=>x.costRatio)),bytesRatio:stats(p.map(x=>x.bytesRatio))}];}));
const summary={schema:'framewright-c21-summary-v1',books:books.length,renders:batch.count,layoutWarningGroups:batch.layoutWarningGroups,videosPerHour:batch.videosPerHour,peakCombinedRssBytes:batch.peakCombinedRssBytes,openingAudit:{meanOpeningAcrossBooks:audit.meanOpeningAcrossBooks,minOpeningAcrossBooks:audit.minOpeningAcrossBooks,maxConvergenceAcrossBooks:audit.maxConvergenceAcrossBooks},costRatio:cost,bytesRatio:bytes,byGrammar,pairs};
fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(summary,null,2));
if(summary.books!==10)throw new Error(`expected 10 books, got ${summary.books}`);if(summary.renders!==40)throw new Error(`expected 40 renders, got ${summary.renders}`);if(summary.layoutWarningGroups!==0)throw new Error(`layout warnings ${summary.layoutWarningGroups}`);if(summary.openingAudit.maxConvergenceAcrossBooks!==0)throw new Error(`opening leakage ${summary.openingAudit.maxConvergenceAcrossBooks}`);if(summary.costRatio.mean>1.10)throw new Error(`mean opening cost ratio ${summary.costRatio.mean} > 1.10`);if(summary.costRatio.p95>1.20)throw new Error(`p95 opening cost ratio ${summary.costRatio.p95} > 1.20`);if(summary.bytesRatio.mean>1.30)throw new Error(`mean byte ratio ${summary.bytesRatio.mean} > 1.30`);
console.log(JSON.stringify({books:summary.books,renders:summary.renders,videosPerHour:summary.videosPerHour,layoutWarnings:summary.layoutWarningGroups,opening:summary.openingAudit,costRatio:summary.costRatio,bytesRatio:summary.bytesRatio,byGrammar:summary.byGrammar},null,2));
