#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/c26/batch.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.resolve(process.argv[3]||'examples/book-ad-systems/generated-c26/manifest.json'),'utf8'));
const audit=JSON.parse(fs.readFileSync(path.resolve(process.argv[4]||'artifacts/c26/safe-zone-audit.json'),'utf8'));
const out=path.resolve(process.argv[5]||'artifacts/c26/summary.json');
const itemById=new Map(manifest.items.map(x=>[x.id,x])),rowById=new Map(batch.results.map(x=>[x.id,x]));
const groups=new Map();for(const item of manifest.items){if(!groups.has(item.bookId))groups.set(item.bookId,{});groups.get(item.bookId)[item.platform]=rowById.get(item.id);}
function stats(xs){const s=[...xs].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))]||0,mean=s.reduce((a,b)=>a+b,0)/Math.max(1,s.length);return{mean:+mean.toFixed(4),p50:+q(.5).toFixed(4),p95:+q(.95).toFixed(4),max:+q(1).toFixed(4)};}
const ratios={youtube_shorts:[],instagram_reels:[],tiktok:[]},byteRatios={youtube_shorts:[],instagram_reels:[],tiktok:[]};let warnings=0,missing=0;
for(const [bookId,g] of groups){const base=g.generic;if(!base){missing++;continue;}for(const p of Object.keys(ratios)){if(!g[p]){missing++;continue;}ratios[p].push((g[p].initMs+g[p].totalMs)/(base.initMs+base.totalMs));byteRatios[p].push(g[p].outputBytes/base.outputBytes);}for(const r of Object.values(g))if(r)warnings+=r.layoutWarnings.length;}
const platformWallRatios=Object.fromEntries(Object.entries(ratios).map(([k,v])=>[k,stats(v)])),platformByteRatios=Object.fromEntries(Object.entries(byteRatios).map(([k,v])=>[k,stats(v)]));
const summary={schema:'framewright-c26-platform-safe-summary-v1',policyVersion:audit.policyVersion,renders:batch.count,groups:groups.size,layoutWarnings:warnings,missingRows:missing,auditErrors:audit.errors?.length||0,totalSafeZoneViolations:audit.totalViolations,platformCounts:audit.platformCounts,safeAreaRatios:audit.safeAreaRatios,platformWallRatios,platformByteRatios,videosPerHour:batch.videosPerHour,peakCombinedRssBytes:batch.peakCombinedRssBytes};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(summary,null,2));if(batch.count!==24)throw new Error(`expected 24 renders, got ${batch.count}`);if(groups.size!==6||missing)throw new Error(`pairing failed groups=${groups.size} missing=${missing}`);if(warnings!==0)throw new Error(`layout warnings ${warnings}`);if(summary.auditErrors!==0||summary.totalSafeZoneViolations!==0)throw new Error(`safe-zone audit errors=${summary.auditErrors} violations=${summary.totalSafeZoneViolations}`);for(const p of Object.keys(platformWallRatios))if(platformWallRatios[p].p95>1.20)throw new Error(`${p} p95 wall regression ${platformWallRatios[p].p95}`);console.log(JSON.stringify(summary,null,2));
