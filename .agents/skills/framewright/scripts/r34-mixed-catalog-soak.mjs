#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';

const root = process.cwd();
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18-for-r34.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-r34/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/r34');
const audioPath = path.resolve(process.env.AUDIO || path.join(outDir, 'track.m4a'));
const reportPath = path.resolve(process.env.REPORT || path.join(outDir, 'report.json'));
const jobsN = Math.max(36, Math.min(720, Math.trunc(Number(process.env.JOBS || 180))));
const concurrency = 2;
const bitrate = Number(process.env.BITRATE || 3_000_000);
const queueLimit = Math.max(1, Math.min(32, Math.trunc(Number(process.env.WEBCODECS_QUEUE || 8))));
const windowSize = Math.max(12, Math.min(60, Math.trunc(Number(process.env.WINDOW_SIZE || 30))));
const warmupJobs = Math.max(0, Math.min(60, Math.trunc(Number(process.env.WARMUP_JOBS || 20))));

await fsp.mkdir(outDir, { recursive: true });
for (const file of [htmlPath, manifestPath, audioPath]) if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const entries = manifest.items || [];
if (entries.length !== 36) throw new Error(`expected 36 C18 fixtures, got ${entries.length}`);
for (const entry of entries) entry.payload = JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath), entry.payloadFile), 'utf8'));
const html = await fsp.readFile(htmlPath, 'utf8');
const uploads = new Map();

function contentType(filename) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

const uploadPrefix = '/__r34_h264/';
const scenePath = '/examples/book-ad-systems/__r34_scene.html';
const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname.startsWith(uploadPrefix)) {
    const id = decodeURIComponent(u.pathname.slice(uploadPrefix.length));
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => { uploads.set(id, Buffer.concat(chunks)); res.writeHead(204); res.end(); });
    return;
  }
  if (u.pathname === scenePath) {
    const idx = Number(u.searchParams.get('fixture'));
    const entry = entries[idx];
    if (!entry) { res.writeHead(404); res.end(); return; }
    const injected = html.replace('<script>', `<script>window.FRAMEWRIGHT_PAYLOAD=${JSON.stringify(entry.payload)};<\/script>\n<script>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(injected);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const filename = path.resolve(root, rel || '.');
  if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(filename, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': contentType(filename), 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(filename).pipe(res);
  });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code ?? signal}\n${stderr.slice(-4000)}`)));
  });
}

function cpuUsec() {
  try { return Number(fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8').match(/^usage_usec\s+(\d+)/m)?.[1] || 0); } catch { return 0; }
}
function cgroupMemory() {
  try { return Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim() || 0); } catch { return 0; }
}
function processTreeRss() {
  try {
    const nodes = new Map();
    for (const name of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const status = fs.readFileSync(`/proc/${name}/status`, 'utf8');
        const ppid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] || -1);
        const rss = Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1] || 0) * 1024;
        nodes.set(Number(name), { ppid, rss });
      } catch {}
    }
    const wanted = new Set([process.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, node] of nodes) if (!wanted.has(pid) && wanted.has(node.ppid)) { wanted.add(pid); changed = true; }
    }
    let total = 0;
    for (const pid of wanted) total += nodes.get(pid)?.rss || 0;
    return total;
  } catch { return 0; }
}

async function launch() {
  return puppeteer.launch({ headless: true, protocolTimeout: 600_000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
}
function urlFor(idx) {
  const entry = entries[idx];
  const u = new URL(scenePath, origin);
  u.searchParams.set('fixture', idx);
  u.searchParams.set('f', '0');
  u.searchParams.set('w', String(entry.width));
  u.searchParams.set('h', String(entry.height));
  u.searchParams.set('s', String(entry.seed));
  u.searchParams.set('profile', entry.profile);
  return u.href;
}
async function navigate(page, idx) {
  const t0 = performance.now();
  await page.goto(urlFor(idx), { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction('window.__ready===true', { timeout: 120_000 });
  return performance.now() - t0;
}

async function stateFingerprint(page, entry) {
  return page.evaluate(({ width, seed }) => {
    const canvas = document.getElementById('c');
    const total = Number(window.RISO?.total || 360);
    const frames = [...new Set([0, Math.floor(total * 0.25), Math.floor(total * 0.62), total - 1])];
    const scratch = document.createElement('canvas');
    scratch.width = 96; scratch.height = 96;
    const sx = scratch.getContext('2d', { willReadFrequently: true });
    const out = [];
    for (const frame of frames) {
      window.renderFrame(frame, width, seed, canvas);
      sx.clearRect(0, 0, 96, 96);
      sx.drawImage(canvas, 0, 0, 96, 96);
      const data = sx.getImageData(0, 0, 96, 96).data;
      let hash = 2166136261 >>> 0;
      for (let i = 0; i < data.length; i += 1) hash = Math.imul(hash ^ data[i], 16777619) >>> 0;
      out.push({ frame, hash: hash.toString(16).padStart(8, '0') });
    }
    return out;
  }, { width: entry.width, seed: entry.seed });
}
function sameFingerprint(a, b) { return a?.length === b?.length && a.every((x, i) => x.frame === b[i].frame && x.hash === b[i].hash); }

async function encode(page, id, entry) {
  uploads.delete(id);
  const encoded = await page.evaluate(async ({ id, width, seed, bitrate, queueLimit, uploadPrefix }) => {
    const canvas = document.getElementById('c');
    const runtime = window.RISO;
    const total = Number(runtime.total);
    const fps = Number(runtime.fps || 30);
    window.renderFrame(0, width, seed, canvas);
    const config = { codec: 'avc1.420028', width: canvas.width, height: canvas.height, bitrate, framerate: fps, latencyMode: 'realtime', avc: { format: 'annexb' } };
    const support = await VideoEncoder.isConfigSupported(config);
    if (!support.supported) throw new Error(`unsupported WebCodecs config ${JSON.stringify(config)}`);
    const chunks = [];
    let bytes = 0, drawMs = 0, maxQueue = 0;
    const encoder = new VideoEncoder({
      output(chunk) { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push(b); bytes += b.byteLength; },
      error(error) { throw error; },
    });
    encoder.configure(config);
    const encode0 = performance.now();
    for (let frame = 0; frame < total; frame += 1) {
      const draw0 = performance.now();
      window.renderFrame(frame, width, seed, canvas);
      drawMs += performance.now() - draw0;
      const vf = new VideoFrame(canvas, { timestamp: Math.trunc(frame * 1_000_000 / fps) });
      encoder.encode(vf, { keyFrame: frame === 0 || frame % Math.max(1, Math.round(fps * 2)) === 0 });
      vf.close();
      maxQueue = Math.max(maxQueue, encoder.encodeQueueSize);
      while (encoder.encodeQueueSize > queueLimit) await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }));
    }
    await encoder.flush();
    const encodeMs = performance.now() - encode0;
    encoder.close();
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const upload0 = performance.now();
    const response = await fetch(`${uploadPrefix}${encodeURIComponent(id)}`, { method: 'POST', body });
    if (!response.ok) throw new Error(`upload ${response.status}`);
    return { total, fps, encodeMs, drawMs, uploadMs: performance.now() - upload0, bytes, maxQueue };
  }, { id, width: entry.width, seed: entry.seed, bitrate, queueLimit, uploadPrefix });
  const h264 = uploads.get(id);
  uploads.delete(id);
  if (!h264?.length) throw new Error(`missing H264 upload for ${id}`);
  return { ...encoded, h264 };
}

async function finishAndValidate(id, encoded) {
  const h264Path = path.join(outDir, `${id}.h264`);
  const mp4Path = path.join(outDir, `${id}.mp4`);
  const expectedDuration = encoded.total / encoded.fps;
  let muxMs = 0, probeMs = 0;
  try {
    await fsp.writeFile(h264Path, encoded.h264);
    const mux0 = performance.now();
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-fflags', '+genpts', '-r', String(encoded.fps), '-i', h264Path, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy', '-t', String(expectedDuration), '-movflags', '+faststart', mp4Path]);
    muxMs = performance.now() - mux0;
    const probe0 = performance.now();
    const { stdout } = await run('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,nb_read_frames', '-show_entries', 'format=duration', '-of', 'json', mp4Path]);
    probeMs = performance.now() - probe0;
    const probe = JSON.parse(stdout);
    const video = probe.streams?.find((x) => x.codec_type === 'video');
    const audio = probe.streams?.find((x) => x.codec_type === 'audio');
    const videoFrames = Number(video?.nb_read_frames || 0);
    const duration = Number(probe.format?.duration || 0);
    const valid = videoFrames === encoded.total && Boolean(audio) && Math.abs(duration - expectedDuration) <= 0.15;
    const mp4Bytes = fs.statSync(mp4Path).size;
    return { muxMs, probeMs, valid, videoFrames, duration, mp4Bytes };
  } finally {
    await fsp.rm(h264Path, { force: true }).catch(() => {});
    await fsp.rm(mp4Path, { force: true }).catch(() => {});
  }
}

function quantile(values, p) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return 0;
  return xs[Math.min(xs.length - 1, Math.floor((xs.length - 1) * p))];
}
function mean(values) { const xs = values.filter(Number.isFinite); return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length); }
function median(values) { return quantile(values, 0.5); }
function slopePerJob(rows, field) {
  const points = rows.map((row) => [row.completionSeq, Number(row[field])]).filter(([, y]) => Number.isFinite(y) && y > 0);
  if (points.length < 2) return 0;
  const mx = mean(points.map((p) => p[0])), my = mean(points.map((p) => p[1]));
  let num = 0, den = 0;
  for (const [x, y] of points) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den ? num / den : 0;
}
function summarizeWindow(rows, index) {
  return {
    index,
    firstCompletionSeq: Math.min(...rows.map((x) => x.completionSeq)),
    lastCompletionSeq: Math.max(...rows.map((x) => x.completionSeq)),
    jobs: rows.length,
    p50ProductionWallMs: +median(rows.map((x) => x.productionWallMs)).toFixed(2),
    p95ProductionWallMs: +quantile(rows.map((x) => x.productionWallMs), 0.95).toFixed(2),
    p50LoadMs: +median(rows.map((x) => x.loadMs)).toFixed(2),
    cgroupMemoryMedianBytes: Math.round(median(rows.map((x) => x.cgroupMemoryBytes))),
    processTreeRssMedianBytes: Math.round(median(rows.map((x) => x.processTreeRssBytes))),
  };
}

let browser;
try {
  browser = await launch();
  const reference0 = performance.now();
  const references = new Map();
  for (let idx = 0; idx < entries.length; idx += 1) {
    const page = await browser.newPage();
    await navigate(page, idx);
    references.set(entries[idx].id, await stateFingerprint(page, entries[idx]));
    await page.close();
  }
  const referenceSetupMs = performance.now() - reference0;

  const workers = await Promise.all(Array.from({ length: concurrency }, () => browser.newPage()));
  const rows = [], failures = [];
  let completionSeq = 0;
  let sampledPeakRss = processTreeRss();
  let sampledPeakCgroup = cgroupMemory();
  const scenario0 = performance.now();
  const cpu0 = cpuUsec();
  const sampler = setInterval(() => {
    sampledPeakRss = Math.max(sampledPeakRss, processTreeRss());
    sampledPeakCgroup = Math.max(sampledPeakCgroup, cgroupMemory());
  }, 250);

  try {
    await Promise.all(workers.map(async (page, worker) => {
      for (let j = worker; j < jobsN; j += concurrency) {
        const idx = j % entries.length;
        const entry = entries[idx];
        const id = `r34-${j}-${crypto.createHash('sha1').update(entry.id).digest('hex').slice(0, 8)}`;
        const job0 = performance.now();
        try {
          const loadMs = await navigate(page, idx);
          const qa0 = performance.now();
          const fingerprint = await stateFingerprint(page, entry);
          const stateParity = sameFingerprint(fingerprint, references.get(entry.id));
          const qaMs = performance.now() - qa0;
          if (!stateParity) throw new Error(`state fingerprint mismatch for ${entry.id}`);
          const encoded = await encode(page, id, entry);
          const finished = await finishAndValidate(id, encoded);
          if (!finished.valid) throw new Error(`artifact validation failed ${entry.id}: frames=${finished.videoFrames}/${encoded.total} duration=${finished.duration}`);
          completionSeq += 1;
          const wallMs = performance.now() - job0;
          rows.push({
            j, completionSeq, entryId: entry.id, bookId: entry.bookId, style: entry.style, variant: entry.variant, profile: entry.profile,
            width: entry.width, height: entry.height, loadMs, qaMs, encodeMs: encoded.encodeMs, drawMs: encoded.drawMs, uploadMs: encoded.uploadMs,
            muxMs: finished.muxMs, probeMs: finished.probeMs, wallMs, productionWallMs: Math.max(0, wallMs - qaMs), mp4Bytes: finished.mp4Bytes,
            stateParity, cgroupMemoryBytes: cgroupMemory(), processTreeRssBytes: processTreeRss(), elapsedScenarioMs: performance.now() - scenario0,
          });
        } catch (error) {
          completionSeq += 1;
          failures.push({ j, completionSeq, entryId: entry.id, bookId: entry.bookId, variant: entry.variant, profile: entry.profile, error: String(error?.stack || error), elapsedScenarioMs: performance.now() - scenario0 });
        }
      }
    }));
  } finally {
    clearInterval(sampler);
    for (const page of workers) await page.close().catch(() => {});
  }

  const scenarioWallMs = performance.now() - scenario0;
  const cpuMs = (cpuUsec() - cpu0) / 1000;
  const ordered = [...rows].sort((a, b) => a.completionSeq - b.completionSeq);
  const stable = ordered.filter((x) => x.completionSeq > warmupJobs);
  const windows = [];
  for (let start = 0; start < stable.length; start += windowSize) {
    const chunk = stable.slice(start, start + windowSize);
    if (chunk.length >= Math.min(12, windowSize)) windows.push(summarizeWindow(chunk, windows.length));
  }
  const firstWindow = windows[0] || null;
  const lastWindow = windows.at(-1) || null;
  const productionWalls = rows.map((x) => x.productionWallMs);
  const loads = rows.map((x) => x.loadMs);
  const successRate = rows.length / jobsN;
  const failureRate = failures.length / jobsN;
  const p50ProductionWallMs = median(productionWalls);
  const p95ProductionWallMs = quantile(productionWalls, 0.95);
  const p50LoadMs = median(loads);
  const latencyP50Growth = firstWindow && lastWindow && firstWindow !== lastWindow ? lastWindow.p50ProductionWallMs / firstWindow.p50ProductionWallMs - 1 : 0;
  const latencyP95Growth = firstWindow && lastWindow && firstWindow !== lastWindow ? lastWindow.p95ProductionWallMs / firstWindow.p95ProductionWallMs - 1 : 0;
  const cgroupMemoryGrowth = firstWindow && lastWindow && firstWindow.cgroupMemoryMedianBytes ? lastWindow.cgroupMemoryMedianBytes / firstWindow.cgroupMemoryMedianBytes - 1 : 0;
  const rssGrowth = firstWindow && lastWindow && firstWindow.processTreeRssMedianBytes ? lastWindow.processTreeRssMedianBytes / firstWindow.processTreeRssMedianBytes - 1 : 0;
  const cgroupSlopeMiBPerJob = slopePerJob(stable, 'cgroupMemoryBytes') / 1048576;
  const rssSlopeMiBPerJob = slopePerJob(stable, 'processTreeRssBytes') / 1048576;
  const runtimeFailureCount = failures.filter((x) => /Target closed|Protocol error|Session closed|browser|VideoEncoder|EncodingError|AbortError/i.test(x.error)).length;
  const corruptOutputCount = failures.filter((x) => /artifact validation|state fingerprint/i.test(x.error)).length;

  const triggers = {
    failure: failureRate > 0.01 || runtimeFailureCount > 0 || corruptOutputCount > 0,
    latencyDrift: latencyP95Growth >= 0.25 && latencyP50Growth >= 0.10,
    memoryDrift: (cgroupMemoryGrowth >= 0.25 && cgroupSlopeMiBPerJob >= 0.5) || (rssGrowth >= 0.25 && rssSlopeMiBPerJob >= 0.5),
    resetReopen: p50ProductionWallMs > 0 && p50LoadMs / p50ProductionWallMs >= 0.10,
  };
  const recycleEarned = triggers.failure || triggers.latencyDrift || triggers.memoryDrift;
  const decision = {
    successRate: +successRate.toFixed(4), failureRate: +failureRate.toFixed(4), runtimeFailureCount, corruptOutputCount,
    latencyP50Growth: +latencyP50Growth.toFixed(4), latencyP95Growth: +latencyP95Growth.toFixed(4),
    cgroupMemoryGrowth: +cgroupMemoryGrowth.toFixed(4), rssGrowth: +rssGrowth.toFixed(4),
    cgroupSlopeMiBPerJob: +cgroupSlopeMiBPerJob.toFixed(4), rssSlopeMiBPerJob: +rssSlopeMiBPerJob.toFixed(4),
    navigationShareOfP50: +(p50ProductionWallMs ? p50LoadMs / p50ProductionWallMs : 0).toFixed(4),
    triggers, recycleEarned,
    policy: recycleEarned ? 'state-based recycle earns a deep pass before final freeze soak' : 'do not add recycle yet; keep the simpler warm c2/full-navigation pool and reserve 1k+ soak for final freeze',
  };

  const report = {
    schema: 'framewright-r34-mixed-catalog-soak-v1',
    fixtureSet: { schema: manifest.schema, entries: entries.map((e) => ({ id: e.id, bookId: e.bookId, style: e.style, variant: e.variant, profile: e.profile, width: e.width, height: e.height, seed: e.seed })) },
    config: { jobsRequested: jobsN, concurrency, bitrate, queueLimit, windowSize, warmupJobs, audioMode: 'canonical-preencoded-aac-copy', resetMode: 'full-document-navigation', recycleMode: 'observe-only' },
    setup: { referenceSetupMs: +referenceSetupMs.toFixed(2) },
    result: {
      successfulJobs: rows.length, failedJobs: failures.length, scenarioWallMs: +scenarioWallMs.toFixed(2),
      observedVideosPerHour: +(rows.length * 3600000 / scenarioWallMs).toFixed(2),
      p50ProductionWallMs: +p50ProductionWallMs.toFixed(2), p95ProductionWallMs: +p95ProductionWallMs.toFixed(2),
      p50LoadMs: +p50LoadMs.toFixed(2), p95LoadMs: +quantile(loads, 0.95).toFixed(2),
      meanQaMs: +mean(rows.map((x) => x.qaMs)).toFixed(2), meanMp4Bytes: Math.round(mean(rows.map((x) => x.mp4Bytes))),
      cpuMs: +cpuMs.toFixed(2), cpuMsPerSuccessfulVideo: +(cpuMs / Math.max(1, rows.length)).toFixed(2),
      sampledPeakCgroupMemoryBytes: sampledPeakCgroup, sampledPeakProcessTreeRssBytes: sampledPeakRss,
      windows,
    },
    decision,
    failures,
    rows,
  };
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  const first = firstWindow, last = lastWindow;
  const md = `# R34 mixed-catalog warm soak\n\n` +
    `Workload: **${jobsN} jobs** cycling all **${entries.length} C18 fixtures** at c2, full document navigation, cached AAC, WebCodecs **${(bitrate / 1e6).toFixed(1)} Mbps**.\n\n` +
    `Successful: **${rows.length}/${jobsN}**; observed throughput: **${report.result.observedVideosPerHour} videos/h**; p50/p95 production-equivalent job wall: **${report.result.p50ProductionWallMs}/${report.result.p95ProductionWallMs} ms**.\n\n` +
    `First stable window p50/p95: **${first?.p50ProductionWallMs ?? 0}/${first?.p95ProductionWallMs ?? 0} ms**; last: **${last?.p50ProductionWallMs ?? 0}/${last?.p95ProductionWallMs ?? 0} ms**. Latency growth: **${(decision.latencyP50Growth * 100).toFixed(1)}% p50 / ${(decision.latencyP95Growth * 100).toFixed(1)}% p95**.\n\n` +
    `Memory trend after warmup: cgroup **${decision.cgroupSlopeMiBPerJob.toFixed(3)} MiB/job**, process-tree RSS **${decision.rssSlopeMiBPerJob.toFixed(3)} MiB/job**; first→last medians **${(decision.cgroupMemoryGrowth * 100).toFixed(1)}% cgroup / ${(decision.rssGrowth * 100).toFixed(1)}% RSS**.\n\n` +
    `Navigation p50 share: **${(decision.navigationShareOfP50 * 100).toFixed(1)}%**. State/artifact failures: **${decision.corruptOutputCount}**; runtime failures: **${decision.runtimeFailureCount}**.\n\n` +
    `Recycle decision: **${decision.recycleEarned ? 'EARNED DEEP PASS' : 'NOT EARNED'}** — ${decision.policy}.\n`;
  await fsp.writeFile(path.join(outDir, 'summary.md'), md);
  console.log(md);
} finally {
  if (browser) await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
