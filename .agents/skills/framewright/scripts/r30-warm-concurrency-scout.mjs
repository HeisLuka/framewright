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
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18-for-r30.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-r30/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/r30');
const audioPath = path.resolve(process.env.AUDIO || path.join(outDir, 'track.m4a'));
const reportPath = path.resolve(process.env.REPORT || path.join(outDir, 'report.json'));
const summaryPath = path.resolve(process.env.SUMMARY || path.join(outDir, 'summary.md'));
const bitrate = Math.max(250_000, Math.trunc(Number(process.env.BITRATE || 2_000_000)));
const queueLimit = Math.max(1, Math.min(64, Math.trunc(Number(process.env.WEBCODECS_QUEUE || 8))));
const coldJobs = Math.max(2, Math.min(8, Math.trunc(Number(process.env.COLD_JOBS || 3))));
const freshPageJobs = Math.max(3, Math.min(12, Math.trunc(Number(process.env.FRESH_PAGE_JOBS || 6))));
const matrixJobs = Math.max(4, Math.min(24, Math.trunc(Number(process.env.MATRIX_JOBS || 8))));
const soakJobs = Math.max(8, Math.min(60, Math.trunc(Number(process.env.SOAK_JOBS || 20))));
const concurrencies = String(process.env.CONCURRENCIES || '1,2,3,4').split(',').map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 6);
const selector = {
  bookId: process.env.BOOK_ID || 'river-station',
  variant: process.env.VARIANT || 'hook-first',
  profile: process.env.PROFILE || 'vertical',
};

for (const file of [htmlPath, manifestPath, audioPath]) if (!fs.existsSync(file)) throw new Error(`missing input ${file}`);
await fsp.mkdir(outDir, { recursive: true });
const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const entry = manifest.items.find((x) => x.bookId === selector.bookId && x.variant === selector.variant && x.profile === selector.profile);
if (!entry) throw new Error(`fixture not found ${JSON.stringify(selector)}`);
const payload = JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath), entry.payloadFile), 'utf8'));

const sha256File = async (file) => crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
const quantile = (sorted, p) => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const stats = (values) => {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return { n: xs.length, mean: +mean.toFixed(3), p50: +quantile(xs, .5).toFixed(3), p95: +quantile(xs, .95).toFixed(3), min: +(xs[0] || 0).toFixed(3), max: +(xs.at(-1) || 0).toFixed(3) };
};
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; }); child.stderr?.on('data', (d) => { stderr += d; });
    child.once('error', reject); child.once('close', (code, signal) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code ?? signal}\n${stderr.slice(-5000)}`)));
  });
}
function cgroupCpuUsec() {
  try { const m = fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8').match(/^usage_usec\s+(\d+)/m); return m ? Number(m[1]) : null; } catch { return null; }
}
function procTreeRssBytes(rootPid = process.pid) {
  try {
    const pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).map(Number), parent = new Map(), rss = new Map();
    for (const pid of pids) {
      try {
        const text = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const pp = text.match(/^PPid:\s+(\d+)/m), rr = text.match(/^VmRSS:\s+(\d+)\s+kB/m);
        if (pp) parent.set(pid, Number(pp[1])); if (rr) rss.set(pid, Number(rr[1]) * 1024);
      } catch {}
    }
    const wanted = new Set([rootPid]);
    let changed = true;
    while (changed) { changed = false; for (const [pid, ppid] of parent) if (wanted.has(ppid) && !wanted.has(pid)) { wanted.add(pid); changed = true; } }
    let total = 0; for (const pid of wanted) total += rss.get(pid) || 0; return total;
  } catch { return 0; }
}
function startResources() {
  const rssStart = procTreeRssBytes(); let peak = rssStart; const cpu0 = cgroupCpuUsec();
  const samples = [];
  const timer = setInterval(() => { const rss = procTreeRssBytes(); peak = Math.max(peak, rss); samples.push(rss); }, 40); timer.unref?.();
  return () => {
    clearInterval(timer); const rssEnd = procTreeRssBytes(); peak = Math.max(peak, rssEnd); const cpu1 = cgroupCpuUsec();
    return { rssStartBytes: rssStart, rssEndBytes: rssEnd, peakProcessTreeRssBytes: peak, rssSamples: samples.length, cgroupCpuMs: cpu0 != null && cpu1 != null ? +(cpu1 - cpu0).toFixed(3) / 1000 : null };
  };
}
function contentType(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'; case '.js': case '.mjs': return 'text/javascript; charset=utf-8'; case '.json': return 'application/json';
    case '.svg': return 'image/svg+xml'; case '.png': return 'image/png'; case '.jpg': case '.jpeg': return 'image/jpeg'; case '.webp': return 'image/webp'; default: return 'application/octet-stream';
  }
}
async function probe(file, expectedFrames, expectedSeconds) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,duration', '-of', 'json', file]);
  const p = JSON.parse(stdout), v = p.streams.find((x) => x.codec_type === 'video'), a = p.streams.find((x) => x.codec_type === 'audio');
  if (Number(v?.nb_read_frames || 0) !== expectedFrames) throw new Error(`frame mismatch ${v?.nb_read_frames}/${expectedFrames}`);
  if (a?.codec_name !== 'aac') throw new Error('AAC missing');
  const formatDuration = Number(p.format.duration || 0), audioDuration = Number(a.duration || formatDuration);
  if (Math.abs(formatDuration - expectedSeconds) > .10 || Math.abs(audioDuration - expectedSeconds) > .10) throw new Error(`duration drift ${formatDuration}/${audioDuration} expected ${expectedSeconds}`);
  return p;
}

const uploads = new Map();
const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname.startsWith('/__r30_h264/')) {
    const id = decodeURIComponent(u.pathname.slice('/__r30_h264/'.length)), chunks = [];
    req.on('data', (d) => chunks.push(d)); req.on('end', () => { uploads.set(id, Buffer.concat(chunks)); res.writeHead(204); res.end(); }); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, ''), filename = path.resolve(root, rel || '.');
  if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(filename, (err, st) => { if (err || !st.isFile()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': contentType(filename), 'Cache-Control': 'no-store' }); if (req.method === 'HEAD') res.end(); else fs.createReadStream(filename).pipe(res); });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const relHtml = path.relative(root, htmlPath).split(path.sep).map(encodeURIComponent).join('/');

async function launchBrowser() {
  const t0 = performance.now();
  const browser = await puppeteer.launch({ headless: true, protocolTimeout: 600_000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  return { browser, launchMs: performance.now() - t0 };
}
async function loadPage(browser) {
  const t0 = performance.now();
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((p) => { window.FRAMEWRIGHT_PAYLOAD = p; }, payload);
  const url = new URL(`/${relHtml}`, origin); url.searchParams.set('f', '0'); url.searchParams.set('w', String(entry.width)); url.searchParams.set('s', String(entry.seed)); url.searchParams.set('profile', entry.profile);
  await page.goto(url.href, { waitUntil: 'load', timeout: 120_000 }); await page.waitForFunction('window.__ready===true', { timeout: 120_000 });
  return { page, loadMs: performance.now() - t0 };
}
async function encodePage(page, jobId, seed) {
  uploads.delete(jobId);
  const result = await page.evaluate(async ({ jobId, width, seed, bitrate, queueLimit }) => {
    const canvas = document.getElementById('c'), runtime = window.RISO;
    if (!canvas || !runtime || typeof window.renderFrame !== 'function') throw new Error('scene unavailable');
    const total = Number(runtime.total), fps = Number(runtime.fps || 30); window.renderFrame(0, width, seed, canvas);
    const config = { codec: 'avc1.420028', width: canvas.width, height: canvas.height, bitrate, framerate: fps, latencyMode: 'realtime', avc: { format: 'annexb' } };
    const support = await VideoEncoder.isConfigSupported(config); if (!support.supported) throw new Error(`unsupported ${JSON.stringify(config)}`);
    const chunks = []; let bytes = 0, maxQueue = 0, drawMs = 0;
    const encoder = new VideoEncoder({ output(chunk) { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push(b); bytes += b.byteLength; }, error(e) { throw e; } }); encoder.configure(config);
    const encode0 = performance.now();
    for (let frame = 0; frame < total; frame += 1) {
      const d0 = performance.now(); window.renderFrame(frame, width, seed, canvas); drawMs += performance.now() - d0;
      const vf = new VideoFrame(canvas, { timestamp: Math.trunc(frame * 1_000_000 / fps) }); encoder.encode(vf, { keyFrame: frame === 0 || frame % Math.max(1, Math.round(fps * 2)) === 0 }); vf.close();
      maxQueue = Math.max(maxQueue, encoder.encodeQueueSize); while (encoder.encodeQueueSize > queueLimit) await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }));
    }
    await encoder.flush(); const encodeMs = performance.now() - encode0; encoder.close();
    const body = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const upload0 = performance.now(); const response = await fetch(`/__r30_h264/${encodeURIComponent(jobId)}`, { method: 'POST', body }); if (!response.ok) throw new Error(`upload ${response.status}`);
    return { total, fps, encodeMs, drawMs, uploadMs: performance.now() - upload0, h264Bytes: bytes, maxQueue };
  }, { jobId, width: entry.width, seed, bitrate, queueLimit });
  const h264 = uploads.get(jobId); if (!h264?.length) throw new Error(`${jobId}: upload missing`); uploads.delete(jobId);
  return { ...result, h264 };
}
async function finishJob(jobId, encoded, keep = false) {
  const h264Path = path.join(outDir, `${jobId}.h264`), mp4Path = path.join(outDir, `${jobId}.mp4`); await fsp.writeFile(h264Path, encoded.h264);
  const expectedSec = encoded.total / encoded.fps;
  const mux0 = performance.now();
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-fflags', '+genpts', '-r', String(encoded.fps), '-i', h264Path, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy', '-t', String(expectedSec), '-movflags', '+faststart', mp4Path]);
  const muxMs = performance.now() - mux0;
  const media = await probe(mp4Path, encoded.total, expectedSec), bytes = fs.statSync(mp4Path).size, sha = await sha256File(mp4Path);
  if (!keep) { await fsp.rm(h264Path, { force: true }); await fsp.rm(mp4Path, { force: true }); }
  return { muxMs, outputBytes: bytes, outputSha256: sha, media };
}
async function resetPage(page) {
  const t0 = performance.now();
  await page.evaluate(() => { const c = document.getElementById('c'); const g = c?.getContext('2d'); if (g) { g.setTransform(1,0,0,1,0,0); g.clearRect(0,0,c.width,c.height); } });
  return performance.now() - t0;
}
async function runOnLoadedPage(page, jobId, seed, keep = false) {
  const t0 = performance.now();
  const encoded = await encodePage(page, jobId, seed); const finished = await finishJob(jobId, encoded, keep); const resetMs = await resetPage(page);
  return { jobId, seed, wallMs: performance.now() - t0, encodeMs: encoded.encodeMs, drawMs: encoded.drawMs, uploadMs: encoded.uploadMs, muxMs: finished.muxMs, resetMs, h264Bytes: encoded.h264Bytes, outputBytes: finished.outputBytes, outputSha256: finished.outputSha256 };
}
function summarizeScenario(name, jobs, scenarioWallMs, setupMs, resources, failures) {
  const success = jobs.length, peakGiB = resources.peakProcessTreeRssBytes / (1024 ** 3), vph = success ? success * 3_600_000 / scenarioWallMs : 0;
  const steadyWall = Math.max(1, scenarioWallMs - setupMs), steadyVph = success ? success * 3_600_000 / steadyWall : 0;
  return {
    name, jobs: success, failures: failures.length, scenarioWallMs: +scenarioWallMs.toFixed(3), setupMs: +setupMs.toFixed(3),
    jobWallMs: stats(jobs.map((x) => x.wallMs)), encodeMs: stats(jobs.map((x) => x.encodeMs)), muxMs: stats(jobs.map((x) => x.muxMs)), resetMs: stats(jobs.map((x) => x.resetMs)),
    videosPerHour: +vph.toFixed(2), steadyVideosPerHour: +steadyVph.toFixed(2), peakRssBytes: resources.peakProcessTreeRssBytes,
    videosPerHourPerGiB: peakGiB ? +(vph / peakGiB).toFixed(2) : null, cpuMs: resources.cgroupCpuMs,
    cpuMsPerVideo: resources.cgroupCpuMs != null && success ? +(resources.cgroupCpuMs / success).toFixed(3) : null,
    rssStartBytes: resources.rssStartBytes, rssEndBytes: resources.rssEndBytes, rssDeltaBytes: resources.rssEndBytes - resources.rssStartBytes,
    failuresDetail: failures,
  };
}

async function coldScenario() {
  const stop = startResources(), t0 = performance.now(), jobs = [], failures = []; let setupMs = 0;
  for (let i = 0; i < coldJobs; i += 1) {
    const job0 = performance.now(); let browser;
    try {
      const launched = await launchBrowser(); browser = launched.browser; const loaded = await loadPage(browser); setupMs += launched.launchMs + loaded.loadMs;
      const row = await runOnLoadedPage(loaded.page, `cold-${i}`, entry.seed + i, i === 0); row.wallMs = performance.now() - job0; jobs.push(row); await loaded.page.close();
    } catch (e) { failures.push({ job: i, error: String(e?.stack || e) }); }
    finally { try { if (browser) await browser.close(); } catch {} }
  }
  const wall = performance.now() - t0, resources = stop(); return summarizeScenario('cold-browser-per-job', jobs, wall, setupMs, resources, failures);
}
async function freshPageScenario() {
  const stop = startResources(), t0 = performance.now(), jobs = [], failures = []; const launched = await launchBrowser(); let setupMs = launched.launchMs;
  try {
    for (let i = 0; i < freshPageJobs; i += 1) {
      let page;
      try { const job0 = performance.now(), loaded = await loadPage(launched.browser); page = loaded.page; const row = await runOnLoadedPage(page, `fresh-${i}`, entry.seed + i, i === 0); row.pageLoadMs = loaded.loadMs; row.wallMs = performance.now() - job0; jobs.push(row); }
      catch (e) { failures.push({ job: i, error: String(e?.stack || e) }); }
      finally { try { if (page) await page.close(); } catch {} }
    }
  } finally { await launched.browser.close(); }
  const wall = performance.now() - t0, resources = stop(); return summarizeScenario('persistent-browser-fresh-page', jobs, wall, setupMs, resources, failures);
}
async function reuseScenario(concurrency, jobCount, label, keepFirst = false) {
  const stop = startResources(), t0 = performance.now(), jobs = [], failures = []; const launched = await launchBrowser();
  const loaded = await Promise.all(Array.from({ length: concurrency }, () => loadPage(launched.browser))); const setupMs = launched.launchMs + Math.max(...loaded.map((x) => x.loadMs));
  const rssAfterSetup = procTreeRssBytes();
  try {
    await Promise.all(loaded.map(async ({ page }, worker) => {
      for (let i = worker; i < jobCount; i += concurrency) {
        try { jobs.push(await runOnLoadedPage(page, `${label}-${i}`, entry.seed + i, keepFirst && i === 0)); }
        catch (e) { failures.push({ worker, job: i, error: String(e?.stack || e) }); }
      }
    }));
  } finally { await Promise.all(loaded.map(({ page }) => page.close().catch(() => {}))); await launched.browser.close(); }
  const wall = performance.now() - t0, resources = stop(), summary = summarizeScenario(label, jobs, wall, setupMs, resources, failures);
  summary.concurrency = concurrency; summary.rssAfterSetupBytes = rssAfterSetup; summary.rssGrowthAfterSetupBytes = resources.rssEndBytes - rssAfterSetup; summary.rssGrowthPerJobBytes = jobCount ? Math.trunc(summary.rssGrowthAfterSetupBytes / jobCount) : null;
  return summary;
}

try {
  console.log(`R30 fixture ${entry.id} ${entry.width}x${entry.height}, cached AAC ${audioPath}`);
  const cold = await coldScenario(); console.log('cold', cold);
  const fresh = await freshPageScenario(); console.log('fresh', fresh);
  const matrix = [];
  for (const c of concurrencies) { const result = await reuseScenario(c, matrixJobs, `reuse-c${c}`, c === 1); matrix.push(result); console.log(`reuse c${c}`, result); }
  const healthy = matrix.filter((x) => x.failures === 0);
  const bestThroughput = [...healthy].sort((a, b) => b.videosPerHour - a.videosPerHour)[0] || matrix[0];
  const bestMemoryEfficiency = [...healthy].sort((a, b) => b.videosPerHourPerGiB - a.videosPerHourPerGiB)[0] || matrix[0];
  const soakConcurrency = bestThroughput?.concurrency || 1;
  const soak = await reuseScenario(soakConcurrency, soakJobs, `soak-c${soakConcurrency}`, false); console.log('soak', soak);
  const report = {
    schema: 'framewright-r30-warm-concurrency-scout-v1',
    fixture: { ...selector, id: entry.id, style: entry.style, width: entry.width, height: entry.height, seed: entry.seed, bitrate, audioSha256: await sha256File(audioPath) },
    config: { coldJobs, freshPageJobs, matrixJobs, soakJobs, concurrencies, queueLimit },
    results: { cold, fresh, matrix, soak },
    decision: {
      bestThroughputConcurrency: bestThroughput?.concurrency || null,
      bestThroughputVideosPerHour: bestThroughput?.videosPerHour || null,
      bestMemoryEfficiencyConcurrency: bestMemoryEfficiency?.concurrency || null,
      bestMemoryEfficiencyVideosPerHourPerGiB: bestMemoryEfficiency?.videosPerHourPerGiB || null,
      reuseC1GainVsCold: cold.videosPerHour ? +((matrix.find((x) => x.concurrency === 1)?.videosPerHour || 0) / cold.videosPerHour - 1).toFixed(4) : null,
      concurrencyGainVsReuseC1: matrix.find((x) => x.concurrency === 1)?.videosPerHour ? +(bestThroughput.videosPerHour / matrix.find((x) => x.concurrency === 1).videosPerHour - 1).toFixed(4) : null,
      soakPass: soak.failures === 0 && Math.abs(soak.rssGrowthPerJobBytes || 0) < 25 * 1024 * 1024,
    },
    caveat: 'Reused-page scenarios keep one immutable payload/cover loaded and vary deterministic seed. They measure the upper-bound lifecycle/cache/concurrency economics of a warm worker; production payload swapping/reset still needs a contract if reuse clears the gate.',
  };
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const gib = (n) => (n / (1024 ** 3)).toFixed(2), secs = (n) => (n / 1000).toFixed(3);
  const lines = ['# R30 warm pool & concurrency economics', '', `Fixture: \`${entry.id}\`, ${entry.width}x${entry.height}, cached AAC stream-copy mux, ${bitrate/1e6} Mbps H.264.`, '', '| scenario | jobs | p50 job | p95 job | videos/hour | peak RSS | videos/hour/GiB | CPU/video | failures |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
  const all = [cold, fresh, ...matrix, soak];
  for (const x of all) lines.push(`| ${x.name} | ${x.jobs} | ${secs(x.jobWallMs.p50)}s | ${secs(x.jobWallMs.p95)}s | ${x.videosPerHour} | ${gib(x.peakRssBytes)} GiB | ${x.videosPerHourPerGiB} | ${x.cpuMsPerVideo == null ? 'n/a' : secs(x.cpuMsPerVideo)+'s'} | ${x.failures} |`);
  lines.push('', `Best raw throughput: **c${report.decision.bestThroughputConcurrency}** at **${report.decision.bestThroughputVideosPerHour} videos/hour**.`);
  lines.push(`Best memory efficiency: **c${report.decision.bestMemoryEfficiencyConcurrency}** at **${report.decision.bestMemoryEfficiencyVideosPerHourPerGiB} videos/hour/GiB**.`);
  lines.push(`Reuse c1 gain vs cold: **${(100*(report.decision.reuseC1GainVsCold || 0)).toFixed(1)}%**. Best concurrency gain vs reuse c1: **${(100*(report.decision.concurrencyGainVsReuseC1 || 0)).toFixed(1)}%**.`);
  lines.push(`Short soak at c${soakConcurrency}: failures=${soak.failures}, RSS growth/job=${(soak.rssGrowthPerJobBytes / 1048576).toFixed(2)} MiB, gate=${report.decision.soakPass ? 'PASS' : 'FAIL/REVIEW'}.`);
  lines.push('', 'Important: reused-page jobs keep the same immutable payload/cover and vary seed. If reuse is valuable, a later production pass must prove safe payload/asset reset rather than assuming `clearRect` is sufficient.');
  const markdown = `${lines.join('\n')}\n`; await fsp.writeFile(summaryPath, markdown); console.log(markdown);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
