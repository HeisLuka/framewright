#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const controlPath=path.resolve(process.argv[2]||'artifacts/r37/control/report.json');
const recyclePath=path.resolve(process.argv[3]||'artifacts/r37/recycle/report.json');
const outPath=path.resolve(process.argv[4]||'artifacts/r37/report.json');
const summaryPath=path.resolve(process.argv[5]||'artifacts/r37/summary.md');
const control=JSON.parse(fs.readFileSync(controlPath,'utf8'));
const recycle=JSON.parse(fs.readFileSync(recyclePath,'utf8'));
for(const [name,r] of [['control',control],['recycle',recycle]]){
  if(r.schema!=='framewright-r37-state-recycle-scenario-v1')throw new Error(`${name}: wrong schema ${r.schema}`);
  if(r.config?.jobsRequested!==180)throw new Error(`${name}: expected 180 jobs, got ${r.config?.jobsRequested}`);
  if(r.config?.batchSize!==6||r.config?.learnJobs!==36||r.config?.thresholdMultiplier!==1.25||r.config?.streakRequired!==3)throw new Error(`${name}: predeclared trigger contract drift`);
  if((r.result?.successfulJobs||0)+(r.result?.failedJobs||0)!==180)throw new Error(`${name}: incomplete job accounting`);
  if(!Array.isArray(r.result?.barrierSamples)||r.result.barrierSamples.length!==30)throw new Error(`${name}: expected 30 idle barriers`);
}
if(control.config.recycleMode!=='control'||recycle.config.recycleMode!=='recycle')throw new Error('scenario labels drifted');

function median(values){const xs=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!xs.length)return 0;return xs[Math.floor((xs.length-1)/2)];}
function pct(a,b){return b? a/b-1 : 0;}
function postLearn(r){return r.result.barrierSamples.filter(x=>x.jobsCompleted>r.config.learnJobs);}
function lateMedian(r,n=6){const xs=postLearn(r).slice(-n).map(x=>x.rssBytes);return median(xs);}
function postPeak(r){return Math.max(0,...postLearn(r).map(x=>x.rssBytes));}
function mib(v){return v/1048576;}
function recoveryWalls(r){
  const rows=[...(r.rows||[])].sort((a,b)=>a.completionSeq-b.completionSeq), out=[];
  for(const event of r.result.recycleEvents||[]){const row=rows.find(x=>x.completionSeq>=event.firstPostRecycleCompletionSeq);if(row)out.push(row.productionWallMs);}
  return out;
}

const controlBaseline=control.result.recycleBaselineRss;
const recycleBaseline=recycle.result.recycleBaselineRss;
const controlLate=lateMedian(control), recycleLate=lateMedian(recycle);
const controlPeak=postPeak(control), recyclePeak=postPeak(recycle);
const controlDrift=pct(controlLate,controlBaseline);
const lateReduction=controlLate?1-recycleLate/controlLate:0;
const peakReduction=controlPeak?1-recyclePeak/controlPeak:0;
const peakAbsoluteReduction=controlPeak-recyclePeak;
const throughputLoss=1-(recycle.result.observedVideosPerHour/control.result.observedVideosPerHour);
const p95Regression=pct(recycle.result.p95ProductionWallMs,control.result.p95ProductionWallMs);
const correctnessPass=control.result.failedJobs===0&&recycle.result.failedJobs===0&&control.decision?.corruptOutputCount===0&&recycle.decision?.corruptOutputCount===0;
const controlReproducedDrift=controlDrift>=0.25;
const recycleCount=(recycle.result.recycleEvents||[]).length;
const triggerFired=recycleCount>0;
const materialMemoryWin=lateReduction>=0.15||peakReduction>=0.15||peakAbsoluteReduction>=384*1048576;
const throughputGate=throughputLoss<=0.05;
const p95Gate=p95Regression<=0.10;
const promote=Boolean(controlReproducedDrift&&triggerFired&&materialMemoryWin&&correctnessPass&&throughputGate&&p95Gate);
const recovery=recoveryWalls(recycle);

const report={
  schema:'framewright-r37-state-recycle-v1',
  gates:{controlReproducedDrift,triggerFired,materialMemoryWin,correctnessPass,throughputGate,p95Gate,promote},
  config:{jobsPerScenario:180,batchSize:6,learnJobs:36,thresholdMultiplier:1.25,streakRequired:3,memoryWinRelativeGate:0.15,memoryWinAbsoluteMiBGate:384,throughputLossGate:0.05,p95RegressionGate:0.10},
  metrics:{
    control:{videosPerHour:control.result.observedVideosPerHour,p50Ms:control.result.p50ProductionWallMs,p95Ms:control.result.p95ProductionWallMs,baselineRssBytes:controlBaseline,lateRssBytes:controlLate,postLearnPeakRssBytes:controlPeak,failures:control.result.failedJobs},
    recycle:{videosPerHour:recycle.result.observedVideosPerHour,p50Ms:recycle.result.p50ProductionWallMs,p95Ms:recycle.result.p95ProductionWallMs,baselineRssBytes:recycleBaseline,lateRssBytes:recycleLate,postLearnPeakRssBytes:recyclePeak,failures:recycle.result.failedJobs,recycleCount,p50RecyclePauseMs:median((recycle.result.recycleEvents||[]).map(x=>x.pauseMs)),p50FirstPostRecycleJobMs:median(recovery)},
    comparison:{controlDrift,lateRssReduction:lateReduction,peakRssReduction:peakReduction,peakAbsoluteReductionBytes:peakAbsoluteReduction,throughputLoss,p95Regression}
  },
  recycleEvents:recycle.result.recycleEvents||[],
  decision:promote?'PROMOTE state-based recycle':'DO NOT PROMOTE state-based recycle',
  reason:!controlReproducedDrift?'control did not reproduce material memory drift':!triggerFired?'predeclared RSS trigger never fired':!materialMemoryWin?'recycle did not buy enough memory headroom':!correctnessPass?'correctness regression observed':!throughputGate?'throughput loss exceeded 5%':!p95Gate?'p95 wall regression exceeded 10%':'all predeclared gates passed'
};
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n');
const md=`# R37 state-based warm-pool recycle deep pass\n\n`+
`Control: **${report.metrics.control.videosPerHour} videos/h**, p50/p95 **${report.metrics.control.p50Ms}/${report.metrics.control.p95Ms} ms**. Recycle: **${report.metrics.recycle.videosPerHour} videos/h**, p50/p95 **${report.metrics.recycle.p50Ms}/${report.metrics.recycle.p95Ms} ms**.\n\n`+
`Control RSS drift from learned baseline to late idle barriers: **${(controlDrift*100).toFixed(1)}%**. Late RSS reduction with recycle: **${(lateReduction*100).toFixed(1)}%**; post-learn peak reduction: **${(peakReduction*100).toFixed(1)}% / ${mib(peakAbsoluteReduction).toFixed(1)} MiB**.\n\n`+
`Recycle events: **${recycleCount}**; p50 recycle pause **${report.metrics.recycle.p50RecyclePauseMs.toFixed(1)} ms**; p50 first post-recycle job **${report.metrics.recycle.p50FirstPostRecycleJobMs.toFixed(1)} ms**. Throughput loss: **${(throughputLoss*100).toFixed(1)}%**; p95 regression: **${(p95Regression*100).toFixed(1)}%**; correctness: **${correctnessPass?'PASS':'FAIL'}**.\n\n`+
`Decision: **${report.decision}** — ${report.reason}.\n`;
fs.writeFileSync(summaryPath,md);
console.log(md);
