#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'artifacts/r47/scenario/report.json');
const out=path.resolve(process.argv[3]||'artifacts/r47/report.json');
const summary=path.resolve(process.argv[4]||'artifacts/r47/summary.md');
const r=JSON.parse(fs.readFileSync(input,'utf8'));
if(r.schema!=='framewright-r47-freeze-soak-scenario-v1')throw new Error(`wrong R47 scenario schema ${r.schema}`);

const jobs=Number(r.config?.jobsRequested||0);
const batchSize=Number(r.config?.batchSize||0);
const learnJobs=Number(r.config?.learnJobs||0);
const threshold=Number(r.config?.thresholdMultiplier||0);
const streakRequired=Number(r.config?.streakRequired||0);
if(jobs!==1080)throw new Error(`expected 1080 jobs, got ${jobs}`);
if(batchSize!==6||learnJobs!==36||threshold!==1.25||streakRequired!==3)throw new Error('freeze trigger contract drift');

function q(values,p){const xs=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!xs.length)return 0;const i=Math.min(xs.length-1,Math.max(0,Math.ceil(p*xs.length)-1));return xs[i];}
function median(values){return q(values,0.5);}
function pct(a,b){return b? a/b-1 : 0;}
function throughput(rows){const xs=[...rows].sort((a,b)=>a.elapsedScenarioMs-b.elapsedScenarioMs);if(xs.length<2)return 0;const span=xs.at(-1).elapsedScenarioMs-xs[0].elapsedScenarioMs;return span>0?(xs.length-1)*3600000/span:0;}
function mib(v){return v/1048576;}

const rows=[...(r.rows||[])].sort((a,b)=>a.completionSeq-b.completionSeq);
const failures=r.failures||[];
const barriers=r.result?.barrierSamples||[];
const events=r.result?.recycleEvents||[];
const baseline=Number(r.result?.recycleBaselineRss||0);
const post=barriers.filter(x=>x.jobsCompleted>learnJobs);
const expectedBarriers=jobs/batchSize;

const accountingPass=rows.length+failures.length===jobs&&Number(r.result?.successfulJobs||0)===rows.length&&Number(r.result?.failedJobs||0)===failures.length;
const correctnessPass=failures.length===0&&Number(r.decision?.corruptOutputCount||0)===0&&rows.every(x=>x.stateParity===true);
const barrierPass=barriers.length===expectedBarriers&&post.length===expectedBarriers-(learnJobs/batchSize)&&baseline>0;

const idleRatios=post.map(x=>x.rssBytes/baseline);
const p95IdleRatio=q(idleRatios,0.95);
const maxIdleRatio=Math.max(0,...idleRatios);
const lateIdleRatio=median(post.slice(-12).map(x=>x.rssBytes))/baseline;
const idleRssGate=p95IdleRatio<=1.35&&maxIdleRatio<=1.50&&lateIdleRatio<=1.30;

let run=0,maxRun=0;
for(const b of post){run=(b.rssBytes>=baseline*threshold)?run+1:0;maxRun=Math.max(maxRun,run);if(b.recycleGeneration)run=0;}
const eventTriggerPass=events.every(e=>{
  const b=barriers.find(x=>x.jobsCompleted===e.triggerBatchEnd);
  return Boolean(b)&&Number(b.highStreakAfter)>=streakRequired&&Number(b.recycleGeneration)===Number(e.generation);
});
const triggerConsistencyGate=eventTriggerPass&&(events.length>0||maxRun<streakRequired);

const steady=rows.filter(x=>x.completionSeq>learnJobs);
const early=steady.slice(0,180);
const late=steady.slice(-180);
const earlyP95=q(early.map(x=>x.productionWallMs),0.95);
const lateP95=q(late.map(x=>x.productionWallMs),0.95);
const p95Regression=pct(lateP95,earlyP95);
const latencyDriftGate=p95Regression<=0.10;
const earlyVph=throughput(early),lateVph=throughput(late);
const throughputLoss=earlyVph?1-lateVph/earlyVph:1;
const throughputDriftGate=throughputLoss<=0.10;

const scenarioWallMs=Math.max(0,...barriers.map(x=>x.elapsedScenarioMs),...rows.map(x=>x.elapsedScenarioMs),...failures.map(x=>x.elapsedScenarioMs));
const recyclePauseMs=events.reduce((a,b)=>a+Number(b.pauseMs||0),0);
const recyclePauseShare=scenarioWallMs?recyclePauseMs/scenarioWallMs:1;
const recycleOverheadGate=recyclePauseShare<=0.02;

const recovery=[];
for(const e of events){const row=rows.find(x=>x.completionSeq>=e.firstPostRecycleCompletionSeq);if(row)recovery.push(row.productionWallMs);}
const overallP95=q(steady.map(x=>x.productionWallMs),0.95);
const recoveryP95=q(recovery,0.95);
const recoveryTailGate=events.length===0||recovery.length===events.length&&recoveryP95<=overallP95*1.25;

const gates={accountingPass,correctnessPass,barrierPass,idleRssGate,triggerConsistencyGate,latencyDriftGate,throughputDriftGate,recycleOverheadGate,recoveryTailGate};
const pass=Object.values(gates).every(Boolean);
const report={
  schema:'framewright-r47-freeze-soak-v1',
  workload:{jobs,batchSize,learnJobs,catalogCycles:jobs/36,thresholdMultiplier:threshold,streakRequired},
  gates:{...gates,pass},
  metrics:{
    successfulJobs:rows.length,failedJobs:failures.length,recycleCount:events.length,generations:Number(r.result?.recycleGenerations||0),
    baselineRssBytes:baseline,p95IdleRssBytes:q(post.map(x=>x.rssBytes),0.95),maxIdleRssBytes:Math.max(0,...post.map(x=>x.rssBytes)),lateIdleRssBytes:median(post.slice(-12).map(x=>x.rssBytes)),
    p95IdleRatio,maxIdleRatio,lateIdleRatio,
    earlyP95Ms:earlyP95,lateP95Ms:lateP95,p95Regression,
    earlyVideosPerHour:earlyVph,lateVideosPerHour:lateVph,throughputLoss,
    scenarioWallMs,recyclePauseMs,recyclePauseShare,p50RecyclePauseMs:median(events.map(x=>x.pauseMs)),p95RecyclePauseMs:q(events.map(x=>x.pauseMs),0.95),
    overallP95Ms:overallP95,p95FirstPostRecycleJobMs:recoveryP95,
    sampledPeakProcessTreeRssBytes:Number(r.result?.sampledPeakProcessTreeRssBytes||0),sampledPeakCgroupMemoryBytes:Number(r.result?.sampledPeakCgroupMemoryBytes||0)
  },
  recycleEvents:events,
  decision:pass?'FREEZE state-based recycle lifecycle candidate':'DO NOT FREEZE state-based recycle lifecycle candidate',
  reason:pass?'all 1k+ correctness, memory, drift and recycle-overhead gates passed':Object.entries(gates).filter(([,v])=>!v).map(([k])=>k).join(', ')
};
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
const md=`# R47 — 1k+ state-recycle freeze soak\n\n`+
`Workload: **${jobs} jobs / ${jobs/36} full catalog cycles**, c2, full navigation, 3 Mbps WebCodecs, cached AAC, current artifact validation.\n\n`+
`Correctness: **${rows.length}/${jobs} successful**, ${failures.length} failures. Recycles: **${events.length}**.\n\n`+
`Idle RSS vs learned baseline: p95 **${(p95IdleRatio*100).toFixed(1)}%**, max **${(maxIdleRatio*100).toFixed(1)}%**, late median **${(lateIdleRatio*100).toFixed(1)}%** (baseline ${mib(baseline).toFixed(1)} MiB).\n\n`+
`Early -> late: p95 **${earlyP95.toFixed(1)} -> ${lateP95.toFixed(1)} ms (${(p95Regression*100).toFixed(1)}%)**; throughput **${earlyVph.toFixed(1)} -> ${lateVph.toFixed(1)} v/h (${(throughputLoss*100).toFixed(1)}% loss)**.\n\n`+
`Recycle pause share: **${(recyclePauseShare*100).toFixed(2)}%** of scenario wall; p50/p95 pause **${median(events.map(x=>x.pauseMs)).toFixed(1)}/${q(events.map(x=>x.pauseMs),0.95).toFixed(1)} ms**; p95 first post-recycle job **${recoveryP95.toFixed(1)} ms** vs overall **${overallP95.toFixed(1)} ms**.\n\n`+
`Decision: **${report.decision}** — ${report.reason}.\n`;
fs.writeFileSync(summary,md);
console.log(md);
if(!pass)process.exitCode=2;
