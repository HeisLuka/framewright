#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'.agents/skills/framewright/scripts/r34-mixed-catalog-soak.mjs');
const output=path.resolve(process.argv[3]||'artifacts/r47/r47-worker.mjs');
let source=fs.readFileSync(input,'utf8');

function replaceOnce(needle,replacement,label){
  const first=source.indexOf(needle);
  if(first<0)throw new Error(`R47 transform marker missing: ${label}`);
  if(source.indexOf(needle,first+needle.length)>=0)throw new Error(`R47 transform marker not unique: ${label}`);
  source=source.slice(0,first)+replacement+source.slice(first+needle.length);
}

const warmupRe=/const warmupJobs = [^\n]+\n/;
const warmupMatch=source.match(warmupRe);
if(!warmupMatch)throw new Error('R47 warmup marker missing');
source=source.replace(warmupRe,warmupMatch[0]+String.raw`const batchSize = Math.max(concurrency, Math.trunc(Number(process.env.BATCH_SIZE || 6)));
const learnJobs = Math.max(batchSize, Math.trunc(Number(process.env.LEARN_JOBS || 36)));
const thresholdMultiplier = Number(process.env.RSS_THRESHOLD_MULTIPLIER || 1.25);
const streakRequired = Math.max(1, Math.trunc(Number(process.env.RSS_STREAK || 3)));
const idleSettleMs = Math.max(0, Math.trunc(Number(process.env.IDLE_SETTLE_MS || 100)));
if (jobsN < learnJobs + batchSize) throw new Error('R47 needs jobs beyond the learn window');
if (learnJobs % batchSize !== 0) throw new Error('LEARN_JOBS must be divisible by BATCH_SIZE');
if (jobsN % batchSize !== 0) throw new Error('JOBS must be divisible by BATCH_SIZE');
`);

const startMarker="  const workers = await Promise.all(Array.from({ length: concurrency }, () => browser.newPage()));";
const endMarker="  const scenarioWallMs = performance.now() - scenario0;";
const start=source.indexOf(startMarker),end=source.indexOf(endMarker);
if(start<0||end<0||end<=start)throw new Error('R47 execution block markers missing');
const replacement=String.raw`  let workers = await Promise.all(Array.from({ length: concurrency }, () => browser.newPage()));
  const rows = [], failures = [], barrierSamples = [], recycleEvents = [];
  let completionSeq = 0;
  let sampledPeakRss = processTreeRss();
  let sampledPeakCgroup = cgroupMemory();
  let recycleBaselineRss = 0;
  let highStreak = 0;
  let generation = 0;
  const scenario0 = performance.now();
  const cpu0 = cpuUsec();
  const sampler = setInterval(() => {
    sampledPeakRss = Math.max(sampledPeakRss, processTreeRss());
    sampledPeakCgroup = Math.max(sampledPeakCgroup, cgroupMemory());
  }, 250);

  async function runOne(page, worker, j) {
    const idx = j % entries.length;
    const entry = entries[idx];
    const id = 'r47-' + j + '-' + crypto.createHash('sha1').update(entry.id).digest('hex').slice(0, 8);
    const job0 = performance.now();
    try {
      const loadMs = await navigate(page, idx);
      const qa0 = performance.now();
      const fingerprint = await stateFingerprint(page, entry);
      const stateParity = sameFingerprint(fingerprint, references.get(entry.id));
      const qaMs = performance.now() - qa0;
      if (!stateParity) throw new Error('state fingerprint mismatch for ' + entry.id);
      const encoded = await encode(page, id, entry);
      const finished = await finishAndValidate(id, encoded);
      if (!finished.valid) throw new Error('artifact validation failed ' + entry.id + ': frames=' + finished.videoFrames + '/' + encoded.total + ' duration=' + finished.duration);
      completionSeq += 1;
      const wallMs = performance.now() - job0;
      rows.push({
        j, worker, generation, completionSeq, entryId: entry.id, bookId: entry.bookId, style: entry.style, variant: entry.variant, profile: entry.profile,
        width: entry.width, height: entry.height, loadMs, qaMs, encodeMs: encoded.encodeMs, drawMs: encoded.drawMs, uploadMs: encoded.uploadMs,
        muxMs: finished.muxMs, probeMs: finished.probeMs, wallMs, productionWallMs: Math.max(0, wallMs - qaMs), mp4Bytes: finished.mp4Bytes,
        stateParity, cgroupMemoryBytes: cgroupMemory(), processTreeRssBytes: processTreeRss(), elapsedScenarioMs: performance.now() - scenario0,
      });
    } catch (error) {
      completionSeq += 1;
      failures.push({ j, worker, generation, completionSeq, entryId: entry.id, bookId: entry.bookId, variant: entry.variant, profile: entry.profile, error: String(error?.stack || error), elapsedScenarioMs: performance.now() - scenario0 });
    }
  }

  try {
    for (let batchStart = 0; batchStart < jobsN; batchStart += batchSize) {
      const batchEnd = Math.min(jobsN, batchStart + batchSize);
      await Promise.all(workers.map(async (page, worker) => {
        for (let j = batchStart + worker; j < batchEnd; j += concurrency) await runOne(page, worker, j);
      }));
      if (idleSettleMs) await new Promise((resolve) => setTimeout(resolve, idleSettleMs));
      const rss = processTreeRss(), cgroup = cgroupMemory();
      const sample = { batchStart, batchEnd, jobsCompleted: batchEnd, completionSeq, generation, rssBytes: rss, cgroupBytes: cgroup, highStreakBefore: highStreak, elapsedScenarioMs: performance.now() - scenario0 };
      barrierSamples.push(sample);
      sampledPeakRss = Math.max(sampledPeakRss, rss);
      sampledPeakCgroup = Math.max(sampledPeakCgroup, cgroup);

      if (batchEnd <= learnJobs) {
        if (batchEnd === learnJobs) recycleBaselineRss = Math.round(median(barrierSamples.filter((x) => x.jobsCompleted <= learnJobs).map((x) => x.rssBytes)));
        continue;
      }
      if (!recycleBaselineRss) continue;
      highStreak = rss >= recycleBaselineRss * thresholdMultiplier ? highStreak + 1 : 0;
      sample.highStreakAfter = highStreak;
      if (highStreak < streakRequired) continue;

      const recycle0 = performance.now();
      const rssBeforeBytes = rss;
      const triggerCompletionSeq = completionSeq;
      for (const page of workers) await page.close().catch(() => {});
      await browser.close().catch(() => {});
      browser = await launch();
      workers = await Promise.all(Array.from({ length: concurrency }, () => browser.newPage()));
      generation += 1;
      const pauseMs = performance.now() - recycle0;
      if (idleSettleMs) await new Promise((resolve) => setTimeout(resolve, idleSettleMs));
      const rssAfterBytes = processTreeRss();
      recycleEvents.push({
        generation, triggerBatchEnd: batchEnd, triggerCompletionSeq, firstPostRecycleCompletionSeq: triggerCompletionSeq + 1,
        baselineRssBytes: recycleBaselineRss, thresholdRssBytes: Math.round(recycleBaselineRss * thresholdMultiplier),
        rssBeforeBytes, rssAfterBytes, pauseMs: +pauseMs.toFixed(2), elapsedScenarioMs: performance.now() - scenario0,
      });
      sample.recycleGeneration = generation;
      sample.recyclePauseMs = +pauseMs.toFixed(2);
      highStreak = 0;
    }
  } finally {
    clearInterval(sampler);
    for (const page of workers) await page.close().catch(() => {});
  }

`;
source=source.slice(0,start)+replacement+source.slice(end);

replaceOnce("resetMode: 'full-document-navigation', recycleMode: 'observe-only'","resetMode: 'full-document-navigation', recycleMode: 'state-triggered-freeze', batchSize, learnJobs, thresholdMultiplier, streakRequired, idleSettleMs",'report config');
replaceOnce("sampledPeakCgroupMemoryBytes: sampledPeakCgroup, sampledPeakProcessTreeRssBytes: sampledPeakRss,\n      windows,","sampledPeakCgroupMemoryBytes: sampledPeakCgroup, sampledPeakProcessTreeRssBytes: sampledPeakRss,\n      recycleBaselineRss, barrierSamples, recycleEvents, recycleGenerations: generation,\n      windows,",'report result');
replaceOnce("schema: 'framewright-r34-mixed-catalog-soak-v1'","schema: 'framewright-r47-freeze-soak-scenario-v1'",'report schema');
replaceOnce("# R34 mixed-catalog warm soak","# R47 state-recycle 1k+ freeze soak",'summary title');

fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,source);
console.log(JSON.stringify({input,output,contract:{batchSize:6,learnJobs:36,thresholdMultiplier:1.25,streakRequired:3,idleSettleMs:100}},null,2));
