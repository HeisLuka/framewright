#!/usr/bin/env node
import fs from 'node:fs';

const reportFile=process.argv[2]||process.env.REPORT;
const hourly=+(process.argv[3]||process.env.HOURLY_USD||0);
const label=process.argv[4]||process.env.PROVIDER||'provider';
if(!reportFile||!fs.existsSync(reportFile)){console.error('usage: node e09-cost-model.mjs <soak.json> <hourly_usd> [label]');process.exit(2);}
if(!(hourly>0)){console.error('hourly_usd must be > 0');process.exit(2);}
const r=JSON.parse(fs.readFileSync(reportFile,'utf8'));
const throughput=+r.videosPerHour;
if(!(throughput>0))throw new Error('report has no positive videosPerHour');
const perVideo=hourly/throughput;
const out={label,hourlyUsd:hourly,measuredVideosPerHour:throughput,costUsd:{perVideo,per1000:perVideo*1000,per10000:perVideo*10000,per100000:perVideo*100000},vmHours:{per1000:1000/throughput,per100000:100000/throughput},sourceReport:reportFile,host:r.host||null,renderer:r.renderer||null,canvasVersion:r.canvasVersion||null};
console.log(JSON.stringify(out,null,2));
