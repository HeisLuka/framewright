#!/usr/bin/env node
import fs from 'node:fs';

const reportPath=process.env.REPORT||'artifacts/r40/report.json';
const r=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const control=r.book?.['canvas-direct'];
const synth=r.synthetic?.['canvas-direct'];
const measuredReferenceValid=Boolean(
  synth?.summary?.pass &&
  control?.mp4Probe &&
  Object.values(control?.metrics||{}).every(v=>Number.isFinite(v?.ssim))
);
if(!r.decision?.winner && measuredReferenceValid) r.decision.fallbackMeasuredReference=true;
fs.writeFileSync(reportPath,JSON.stringify(r,null,2)+'\n');
console.log(JSON.stringify(r.decision,null,2));
