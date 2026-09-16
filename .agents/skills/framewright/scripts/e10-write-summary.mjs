#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const input=process.argv[2]||'artifacts/e10/concurrency/matrix.json';
const output=process.argv[3]||'artifacts/e10/summary.md';
const r=JSON.parse(fs.readFileSync(input,'utf8')),mib=n=>n/1048576;
let md='# E10 concurrency matrix\n\n';
md+=`Host: ${r.host.cpus} logical CPUs · ${r.host.cpuModel}\n\n`;
md+='| concurrency | videos/hour | speedup | efficiency | p50 s | p95 s | peak tree RSS MiB |\n|---:|---:|---:|---:|---:|---:|---:|\n';
for(const c of r.cases) md+=`| ${c.concurrency} | ${c.videosPerHour.toFixed(2)} | ${c.speedupVsC1.toFixed(3)}x | ${(c.parallelEfficiency*100).toFixed(1)}% | ${(c.perVideoMs.p50/1000).toFixed(3)} | ${(c.perVideoMs.p95/1000).toFixed(3)} | ${mib(c.peakProcessTreeRssBytes).toFixed(1)} |\n`;
md+=`\nBest measured concurrency: **${r.bestConcurrency}**, ${r.bestVideosPerHour.toFixed(2)} videos/hour (${r.bestSpeedupVsC1.toFixed(3)}x vs c1).\n`;
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,md);console.log(md);
