#!/usr/bin/env node
import fs from 'node:fs';

const input=process.argv[2]||'artifacts/e09/soak.json';
const output=process.argv[3]||'artifacts/e09/summary.md';
if(!fs.existsSync(input)){console.log(`skip summary: ${input} missing`);process.exit(0);}
const r=JSON.parse(fs.readFileSync(input,'utf8'));
const mib=n=>n/1048576;
let md='# E09 soak summary\n\n';
md+=`- canvas: ${r.canvasVersion}\n`;
md+=`- host: ${r.host.cpus} vCPU · ${r.host.cpuModel}\n`;
md+=`- videos: ${r.count}\n`;
md+=`- total: ${(r.totalMs/60000).toFixed(2)} min\n`;
md+=`- throughput: ${r.videosPerHour} videos/hour\n`;
md+=`- p50: ${(r.perVideoMs.p50/1000).toFixed(3)} s\n`;
md+=`- p95: ${(r.perVideoMs.p95/1000).toFixed(3)} s\n`;
md+=`- peak Node+FFmpeg RSS: ${mib(r.peakCombinedRssBytes).toFixed(1)} MiB\n`;
md+=`- Node RSS first-quartile median: ${mib(r.memory.firstQuartileMedianBytes).toFixed(1)} MiB\n`;
md+=`- Node RSS last-quartile median: ${mib(r.memory.lastQuartileMedianBytes).toFixed(1)} MiB\n`;
md+=`- quartile delta: ${mib(r.memory.quartileDeltaBytes).toFixed(1)} MiB\n`;
md+=`- linear RSS slope: ${(r.memory.linearSlopeBytesPerVideo/1024).toFixed(1)} KiB/video\n`;
md+=`- layout warning groups: ${r.layoutWarningGroups}\n`;
fs.writeFileSync(output,md);
console.log(md);
