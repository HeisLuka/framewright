#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const FACTORY = path.join(SCRIPT_DIR, 'run-video-factory.mjs');
const POOL = path.join(SCRIPT_DIR, 'render-webcodecs-pool.mjs');
const campaignPath = path.resolve(process.env.CAMPAIGN || '.bench/i10/input/campaign.json');
const executionMapPath = path.resolve(process.env.EXECUTION_MAP || '.bench/i10/input/execution-map.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/i10');
const reportPath = path.resolve(process.env.REPORT || path.join(outDir, 'report.json'));
const visualFrames = [0, 67, 134, 202, 269];
const visualGate = { ssim: 0.97, psnrDb: 30 };

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function run(command, args, { env = {}, inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    if (!inherit) {
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited with ${code ?? signal}\n${stderr.slice(-4000)}`)));
  });
}

async function waitForPool(portFile, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`pool exited before ready: ${child.exitCode}`);
    try {
      const state = JSON.parse(await fsp.readFile(portFile, 'utf8'));
      const response = await fetch(`${state.url}/health`);
      if (state.schema === 'framewright-webcodecs-pool-v1' && state.concurrency === 2 && response.ok) return state;
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await sleep(100);
  }
  throw new Error('pool readiness timeout');
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(5000).then(() => { if (child.exitCode == null) child.kill('SIGKILL'); }),
  ]);
}

async function runFactory(requestPath, runDir, artifactDir, env = {}) {
  const t0 = performance.now();
  await run(process.execPath, [FACTORY, '--request', requestPath, '--out-dir', runDir, '--artifact-dir', artifactDir], { env, inherit: true });
  return {
    wallMs: +(performance.now() - t0).toFixed(3),
    run: JSON.parse(await fsp.readFile(path.join(runDir, 'run.json'), 'utf8')),
    manifest: JSON.parse(await fsp.readFile(path.join(runDir, 'canonical-artifacts.json'), 'utf8')),
  };
}

async function decodeFrame(video, frame, out) {
  await run(process.env.FFMPEG || 'ffmpeg', [
    '-hide_banner','-loglevel','error','-y','-i',video,
    '-vf',`select=eq(n\\,${frame})`,'-vsync','0','-frames:v','1',out,
  ]);
}

async function imageMetric(kind, ref, cand) {
  const filter = kind === 'ssim' ? 'ssim' : 'psnr';
  const { stderr } = await run(process.env.FFMPEG || 'ffmpeg', [
    '-hide_banner','-loglevel','info','-i',ref,'-i',cand,'-lavfi',filter,'-f','null','-',
  ]);
  const re = kind === 'ssim' ? /All:([0-9.]+)/g : /average:([0-9.]+)/g;
  const match = [...stderr.matchAll(re)].at(-1);
  if (!match) throw new Error(`unable to parse ${kind} metric`);
  return Number(match[1]);
}

async function compareVideos(label, ref, cand, dir) {
  await fsp.mkdir(dir, { recursive: true });
  const samples = [];
  for (const frame of visualFrames) {
    const refPng = path.join(dir, `${label}-${frame}-one.png`);
    const candPng = path.join(dir, `${label}-${frame}-warm.png`);
    await decodeFrame(ref, frame, refPng);
    await decodeFrame(cand, frame, candPng);
    const ssim = await imageMetric('ssim', refPng, candPng);
    const psnrDb = await imageMetric('psnr', refPng, candPng);
    samples.push({ frame, ssim, psnrDb, pass: ssim >= visualGate.ssim && psnrDb >= visualGate.psnrDb });
  }
  return { label, samples, pass: samples.every(x => x.pass) };
}

function artifactIds(manifest) {
  return manifest.artifacts.map(x => x.render_spec_id).sort();
}

async function receipts(runDir, ids) {
  const rows = [];
  for (const id of ids) rows.push(JSON.parse(await fsp.readFile(path.join(runDir, 'receipts', `${id}.json`), 'utf8')));
  return rows;
}

await fsp.rm(outDir, { recursive: true, force: true });
await fsp.mkdir(outDir, { recursive: true });
for (const filename of [campaignPath, executionMapPath]) if (!fs.existsSync(filename)) throw new Error(`missing I10 input ${filename}`);

const campaign = JSON.parse(await fsp.readFile(campaignPath, 'utf8'));
const executionMap = JSON.parse(await fsp.readFile(executionMapPath, 'utf8'));
const productionRequest = {
  ...campaign,
  selected: campaign.selected.map(row => {
    const execution = executionMap.selections?.[row.selection_id];
    if (!execution) throw new Error(`${row.selection_id}: missing execution-map row`);
    return {
      ...row,
      execution: {
        html: path.resolve(execution.html),
        payload: path.resolve(execution.payload),
        audio: execution.audio ? path.resolve(execution.audio) : null,
        template_id: row.creative.template.id,
        template_version: row.creative.template.version,
      },
    };
  }),
};
const productionRequestPath = path.join(outDir, 'production-request.json');
await fsp.writeFile(productionRequestPath, `${JSON.stringify(productionRequest, null, 2)}\n`);

const oneShotDir = path.join(outDir, 'one-shot');
const oneShotArtifacts = path.join(outDir, 'one-shot-artifacts');
const oneShot = await runFactory(productionRequestPath, oneShotDir, oneShotArtifacts, { CI: '1', WEBCODECS_POOL_URL: '', WEBCODECS_POOL_FINGERPRINT: '' });
assert.equal(oneShot.run.render_concurrency, 1);
assert.deepEqual(oneShot.run.runtime_pool_pids, []);
assert.equal(oneShot.run.cache_hits, 0);
assert.ok(oneShot.manifest.artifacts.every(x => x.qa.status === 'pass'));

const portFile = path.join(outDir, 'pool.json');
const pool = spawn(process.execPath, [POOL, '--port-file', portFile, '--concurrency', '2'], {
  cwd: ROOT,
  env: { ...process.env, CI: '1' },
  stdio: 'inherit',
});
let poolState;
try {
  poolState = await waitForPool(portFile, pool);
  const warmEnv = { CI: '1', WEBCODECS_POOL_URL: poolState.url, WEBCODECS_POOL_FINGERPRINT: '1' };
  const warmADir = path.join(outDir, 'warm-a');
  const warmAArtifacts = path.join(outDir, 'warm-a-artifacts');
  const warmA = await runFactory(productionRequestPath, warmADir, warmAArtifacts, warmEnv);
  const healthAfterA = await (await fetch(`${poolState.url}/health`)).json();

  const replayDir = path.join(outDir, 'warm-replay');
  const replay = await runFactory(productionRequestPath, replayDir, warmAArtifacts, warmEnv);
  const healthAfterReplay = await (await fetch(`${poolState.url}/health`)).json();

  const warmBDir = path.join(outDir, 'warm-b');
  const warmBArtifacts = path.join(outDir, 'warm-b-artifacts');
  const warmB = await runFactory(productionRequestPath, warmBDir, warmBArtifacts, warmEnv);
  const healthAfterB = await (await fetch(`${poolState.url}/health`)).json();

  const ids = artifactIds(oneShot.manifest);
  assert.deepEqual(ids, artifactIds(warmA.manifest));
  assert.deepEqual(ids, artifactIds(replay.manifest));
  assert.deepEqual(ids, artifactIds(warmB.manifest));
  assert.equal(warmA.run.render_concurrency, 2);
  assert.equal(warmB.run.render_concurrency, 2);
  assert.deepEqual(warmA.run.runtime_pool_pids, [poolState.pid]);
  assert.deepEqual(warmB.run.runtime_pool_pids, [poolState.pid]);
  assert.equal(warmA.run.cache_hits, 0);
  assert.equal(replay.run.cache_hits, ids.length);
  assert.equal(warmB.run.cache_hits, 0);
  assert.equal(healthAfterA.renderSequence, ids.length);
  assert.equal(healthAfterReplay.renderSequence, healthAfterA.renderSequence, 'cache replay unexpectedly rendered through warm pool');
  assert.equal(healthAfterB.renderSequence, ids.length * 2);

  const warmAReceipts = await receipts(warmADir, ids);
  const warmBReceipts = await receipts(warmBDir, ids);
  const oneShotReceipts = await receipts(oneShotDir, ids);
  const slotsA = [...new Set(warmAReceipts.map(x => x.metrics?.runtime_pool?.pageSlot))].sort();
  assert.deepEqual(slotsA, [0, 1], 'c2 run did not exercise both reusable page slots');
  assert.ok(warmAReceipts.every(x => x.metrics.runtime_pool?.pid === poolState.pid && x.metrics.runtime_pool?.fullDocumentNavigation === true));
  assert.ok(warmBReceipts.every(x => x.metrics.runtime_pool?.pid === poolState.pid && x.metrics.runtime_pool?.fullDocumentNavigation === true));
  assert.ok(oneShotReceipts.every(x => x.metrics?.runtime_pool == null));

  const fingerprints = [];
  for (const id of ids) {
    const a = warmAReceipts.find(x => x.render_spec_id === id);
    const b = warmBReceipts.find(x => x.render_spec_id === id);
    assert.ok(Array.isArray(a.metrics.state_fingerprint) && a.metrics.state_fingerprint.length >= 4, `${id}: missing warm fingerprint A`);
    assert.deepEqual(a.metrics.state_fingerprint, b.metrics.state_fingerprint, `${id}: reusable page state fingerprint drift`);
    fingerprints.push({ renderSpecId: id, fingerprint: a.metrics.state_fingerprint, firstPageSlot: a.metrics.runtime_pool.pageSlot, secondPageSlot: b.metrics.runtime_pool.pageSlot });
  }

  const visual = [];
  for (const id of ids) {
    visual.push(await compareVideos(
      id,
      path.join(oneShotDir, 'video', `${id}.mp4`),
      path.join(warmADir, 'video', `${id}.mp4`),
      path.join(outDir, 'visual'),
    ));
  }
  assert.ok(visual.every(x => x.pass), 'one-shot vs warm decoded visual parity gate failed');

  for (const manifest of [oneShot.manifest, warmA.manifest, replay.manifest, warmB.manifest]) {
    assert.equal(manifest.schema, 'newboo-campaign-artifact-manifest-v1');
    assert.ok(manifest.artifacts.every(x => x.qa.status === 'pass'));
    assert.deepEqual(artifactIds(manifest), ids);
  }
  assert.equal(oneShot.manifest.delivery_package_sha256, warmA.manifest.delivery_package_sha256);
  assert.equal(warmA.manifest.delivery_package_sha256, warmB.manifest.delivery_package_sha256);

  const report = {
    schema: 'nightwill-i10-canonical-warm-executor-v1',
    decision: 'PASS_CANONICAL_WARM_C2_WIRING',
    predeclared: {
      runtime: 'one Chromium + c2 reusable pages + full document navigation/job; no recycle',
      visualParity: `five decoded checkpoints/render: SSIM>=${visualGate.ssim} AND PSNR>=${visualGate.psnrDb}dB`,
      stateParity: 'exact 96x96 Canvas fingerprints across two physical canonical warm runs',
      cache: 'replay must not increment pool render sequence',
    },
    pool: { pid: poolState.pid, concurrency: poolState.concurrency, chromeLaunchMs: poolState.chromeLaunchMs, healthAfterA, healthAfterReplay, healthAfterB },
    factory: {
      renderSpecIds: ids,
      deliveryPackageSha256: warmA.manifest.delivery_package_sha256,
      oneShotWallMs: oneShot.wallMs,
      warmAWallMs: warmA.wallMs,
      replayWallMs: replay.wallMs,
      warmBWallMs: warmB.wallMs,
      oneShotConcurrency: oneShot.run.render_concurrency,
      warmConcurrency: warmA.run.render_concurrency,
    },
    fingerprints,
    visual,
  };
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ decision: report.decision, pool: report.pool, factory: report.factory, visualPass: visual.every(x => x.pass), fingerprintsStable: true }, null, 2));
} finally {
  await stopChild(pool);
}
