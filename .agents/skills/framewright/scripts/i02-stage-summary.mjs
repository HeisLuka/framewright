#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/i02');
const reportPath = path.resolve(process.env.REPORT || path.join(outDir, 'report.json'));
const summaryPath = path.join(outDir, 'stage-summary.md');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pick = (runs, key) => mean(runs.map((r) => Number(r[key] || 0)));
const nestedMean = (runs, group, key='mean') => mean(runs.map((r) => Number(r[group]?.[key] || 0)));
const pct = (v, total) => total ? `${(100*v/total).toFixed(1)}%` : 'n/a';

const web = report.runs.web;
const node = report.runs.nodeFixed;
const webWall = pick(web, 'wallMs');
const nodeWall = pick(node, 'wallMs');
const webStages = {
  browserLaunch: pick(web, 'launchMs'),
  pageLoadReady: pick(web, 'pageLoadMs'),
  drawAndEncode: pick(web, 'encodeMs'),
  compressedUpload: pick(web, 'uploadMs'),
  audioMux: pick(web, 'muxMs'),
};
const webKnown = Object.values(webStages).reduce((a,b)=>a+b,0);
const nodeStages = {
  sceneInit: pick(node, 'initMs'),
  renderEncodeMux: pick(node, 'encodeAndMuxMs'),
  meanFrameDraw: nestedMean(node, 'renderFrameMs'),
  meanWriteWaitPerFrame: nestedMean(node, 'writeWaitMs'),
};

const lines = [
  '# I02 stage budget', '',
  '## Chromium Canvas → WebCodecs', '',
  `Mean full wall: **${(webWall/1000).toFixed(3)} s**.`, '',
  '| stage | mean | share of wall |', '|---|---:|---:|',
];
for (const [name, value] of Object.entries(webStages)) lines.push(`| ${name} | ${value.toFixed(1)} ms | ${pct(value, webWall)} |`);
lines.push(`| residual / measurement overlap | ${Math.max(0, webWall-webKnown).toFixed(1)} ms | ${pct(Math.max(0, webWall-webKnown), webWall)} |`);
lines.push('', '## @napi-rs/canvas → x264 fixed target', '', `Mean full wall: **${(nodeWall/1000).toFixed(3)} s**.`, '', '| stage | mean | note |', '|---|---:|---|');
lines.push(`| scene init | ${nodeStages.sceneInit.toFixed(1)} ms | one context/job |`);
lines.push(`| frame loop + x264 + AAC/mux | ${nodeStages.renderEncodeMux.toFixed(1)} ms | dominant inclusive stage |`);
lines.push(`| mean scene draw/frame | ${nodeStages.meanFrameDraw.toFixed(3)} ms | included above |`);
lines.push(`| mean FFmpeg stdin wait/frame | ${nodeStages.meanWriteWaitPerFrame.toFixed(3)} ms | included above; proxy for downstream pressure |`);
lines.push('', `Wall ratio Node fixed / WebCodecs: **${(nodeWall/webWall).toFixed(3)}×**.`);
lines.push(`CPU ratio Node fixed / WebCodecs: **${(report.summary.nodeFixed.cgroupCpuMs.mean/report.summary.web.cgroupCpuMs.mean).toFixed(3)}×**.`);
lines.push(`Peak-RSS ratio WebCodecs / Node fixed: **${(report.summary.web.peakRssBytes.mean/report.summary.nodeFixed.peakRssBytes.mean).toFixed(3)}×**.`);
lines.push('', 'Interpret stage shares carefully: browser launch/page/encode/upload/mux timers are sequential but process cleanup/probe/resource sampling can live in residual wall. Node `renderEncodeMux` is intentionally inclusive, so per-frame timings must not be added to it.');
const markdown = `${lines.join('\n')}\n`;
fs.writeFileSync(summaryPath, markdown);
console.log(markdown);
