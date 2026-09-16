#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';

const root = process.cwd();
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18-for-r30.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-r30/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/r30');
const reportPath = path.resolve(process.env.RSS_REPORT || path.join(outDir, 'live-rss-soak.json'));
const summaryPath = path.resolve(process.env.RSS_SUMMARY || path.join(outDir, 'live-rss-soak.md'));
const jobs = Math.max(12, Math.min(80, Math.trunc(Number(process.env.RSS_SOAK_JOBS || 24))));
const bitrate = Math.max(250_000, Math.trunc(Number(process.env.BITRATE || 2_000_000)));
const queueLimit = Math.max(1, Math.min(64, Math.trunc(Number(process.env.WEBCODECS_QUEUE || 8))));
const selector = {
  bookId: process.env.BOOK_ID || 'river-station',
  variant: process.env.VARIANT || 'hook-first',
  profile: process.env.PROFILE || 'vertical',
};

for (const file of [htmlPath, manifestPath]) if (!fs.existsSync(file)) throw new Error(`missing input ${file}`);
await fsp.mkdir(outDir, { recursive: true });
const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const entry = manifest.items.find((x) => x.bookId === selector.bookId && x.variant === selector.variant && x.profile === selector.profile);
if (!entry) throw new Error(`fixture not found ${JSON.stringify(selector)}`);
const payload = JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath), entry.payloadFile), 'utf8'));

function procTreeRssBytes(rootPid = process.pid) {
  try {
    const pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).map(Number);
    const parent = new Map(), rss = new Map();
    for (const pid of pids) {
      try {
        const text = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const pp = text.match(/^PPid:\s+(\d+)/m), rr = text.match(/^VmRSS:\s+(\d+)\s+kB/m);
        if (pp) parent.set(pid, Number(pp[1]));
        if (rr) rss.set(pid, Number(rr[1]) * 1024);
      } catch {}
    }
    const wanted = new Set([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, ppid] of parent) if (wanted.has(ppid) && !wanted.has(pid)) { wanted.add(pid); changed = true; }
    }
    let total = 0;
    for (const pid of wanted) total += rss.get(pid) || 0;
    return total;
  } catch { return 0; }
}

function stats(values) {
  const xs = [...values].sort((a, b) => a - b);
  const q = (p) => xs[Math.min(xs.length - 1, Math.floor((xs.length - 1) * p))] ?? 0;
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return { mean: +mean.toFixed(3), p50: +q(.5).toFixed(3), p95: +q(.95).toFixed(3), min: +(xs[0] || 0).toFixed(3), max: +(xs.at(-1) || 0).toFixed(3) };
}
function linearSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i += 1) { sx += i; sy += values[i]; sxx += i * i; sxy += i * values[i]; }
  const den = n * sxx - sx * sx;
  return den ? (n * sxy - sx * sy) / den : 0;
}
function contentType(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': case '.mjs': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname === '/__r30_sink') {
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(204); res.end(); });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const filename = path.resolve(root, rel || '.');
  if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(filename, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': contentType(filename), 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(filename).pipe(res);
  });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const relHtml = path.relative(root, htmlPath).split(path.sep).map(encodeURIComponent).join('/');

async function openPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((p) => { window.FRAMEWRIGHT_PAYLOAD = p; }, payload);
  const url = new URL(`/${relHtml}`, origin);
  url.searchParams.set('f', '0');
  url.searchParams.set('w', String(entry.width));
  url.searchParams.set('s', String(entry.seed));
  url.searchParams.set('profile', entry.profile);
  await page.goto(url.href, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction('window.__ready===true', { timeout: 120_000 });
  return page;
}
async function encode(page, seed) {
  return page.evaluate(async ({ width, seed, bitrate, queueLimit }) => {
    const canvas = document.getElementById('c'), runtime = window.RISO;
    if (!canvas || !runtime || typeof window.renderFrame !== 'function') throw new Error('scene unavailable');
    const total = Number(runtime.total), fps = Number(runtime.fps || 30);
    window.renderFrame(0, width, seed, canvas);
    const config = { codec: 'avc1.420028', width: canvas.width, height: canvas.height, bitrate, framerate: fps, latencyMode: 'realtime', avc: { format: 'annexb' } };
    const chunks = [];
    let bytes = 0;
    const encoder = new VideoEncoder({
      output(chunk) { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push(b); bytes += b.byteLength; },
      error(error) { throw error; },
    });
    encoder.configure(config);
    const t0 = performance.now();
    for (let frame = 0; frame < total; frame += 1) {
      window.renderFrame(frame, width, seed, canvas);
      const vf = new VideoFrame(canvas, { timestamp: Math.trunc(frame * 1_000_000 / fps) });
      encoder.encode(vf, { keyFrame: frame === 0 || frame % Math.max(1, Math.round(fps * 2)) === 0 });
      vf.close();
      while (encoder.encodeQueueSize > queueLimit) await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }));
    }
    await encoder.flush();
    const encodeMs = performance.now() - t0;
    encoder.close();
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const response = await fetch('/__r30_sink', { method: 'POST', body });
    if (!response.ok) throw new Error(`sink ${response.status}`);
    return { total, fps, bytes, encodeMs };
  }, { width: entry.width, seed, bitrate, queueLimit });
}

async function runMode(mode) {
  const browser = await puppeteer.launch({ headless: true, protocolTimeout: 600_000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const rows = [], failures = [], rssAfterJob = [];
  let reusablePage = null;
  try {
    if (mode === 'reuse-c1') reusablePage = await openPage(browser);
    const rssBeforeJobs = procTreeRssBytes();
    for (let i = 0; i < jobs; i += 1) {
      let page = reusablePage;
      const t0 = performance.now();
      try {
        if (mode === 'fresh-page') page = await openPage(browser);
        const encoded = await encode(page, entry.seed + i);
        rows.push({ job: i, wallMs: performance.now() - t0, encodeMs: encoded.encodeMs, bytes: encoded.bytes });
      } catch (error) {
        failures.push({ job: i, error: String(error?.stack || error) });
      } finally {
        if (mode === 'fresh-page' && page) await page.close().catch(() => {});
      }
      // Measure while Chromium remains alive. This is the quantity the first R30 harness missed.
      await new Promise((resolve) => setTimeout(resolve, 25));
      rssAfterJob.push(procTreeRssBytes());
    }
    const rssBeforeClose = procTreeRssBytes();
    const tail = rssAfterJob.slice(Math.floor(rssAfterJob.length / 2));
    return {
      mode, jobs: rows.length, failures: failures.length, failuresDetail: failures,
      jobWallMs: stats(rows.map((x) => x.wallMs)), encodeMs: stats(rows.map((x) => x.encodeMs)),
      rssBeforeJobsBytes: rssBeforeJobs,
      rssBeforeCloseBytes: rssBeforeClose,
      rssAfterJobBytes: rssAfterJob,
      rssSlopeBytesPerJob: +linearSlope(rssAfterJob).toFixed(3),
      rssTailSlopeBytesPerJob: +linearSlope(tail).toFixed(3),
      rssDeltaLiveBytes: rssBeforeClose - rssBeforeJobs,
      peakObservedLiveRssBytes: Math.max(rssBeforeJobs, rssBeforeClose, ...rssAfterJob),
    };
  } finally {
    if (reusablePage) await reusablePage.close().catch(() => {});
    await browser.close();
  }
}

try {
  const fresh = await runMode('fresh-page');
  console.log('fresh-page', fresh);
  const reuse = await runMode('reuse-c1');
  console.log('reuse-c1', reuse);
  const maxTailSlope = 8 * 1024 * 1024;
  const result = {
    schema: 'framewright-r30-live-rss-soak-v1',
    fixture: { ...selector, id: entry.id, width: entry.width, height: entry.height, seed: entry.seed, bitrate },
    jobsPerMode: jobs,
    fresh,
    reuse,
    gate: {
      maxTailSlopeBytesPerJob: maxTailSlope,
      freshPass: fresh.failures === 0 && fresh.rssTailSlopeBytesPerJob < maxTailSlope,
      reusePass: reuse.failures === 0 && reuse.rssTailSlopeBytesPerJob < maxTailSlope,
    },
    note: 'RSS is sampled after every job while Chromium is still alive. Tail slope is reported separately because initial font/image/codec caches can legitimately warm during the first half.',
  };
  await fsp.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  const mib = (n) => (n / 1048576).toFixed(2);
  const lines = [
    '# R30 live-browser RSS soak', '',
    `${jobs} sequential encode/upload jobs per mode; RSS sampled **before browser close** after every job.`, '',
    '| mode | p50 job | p95 job | live RSS start | live RSS end | live delta | full slope/job | tail slope/job | failures | gate |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|',
  ];
  for (const [name, row, pass] of [['fresh page', fresh, result.gate.freshPass], ['reuse c1', reuse, result.gate.reusePass]]) {
    lines.push(`| ${name} | ${(row.jobWallMs.p50/1000).toFixed(3)} s | ${(row.jobWallMs.p95/1000).toFixed(3)} s | ${mib(row.rssBeforeJobsBytes)} MiB | ${mib(row.rssBeforeCloseBytes)} MiB | ${mib(row.rssDeltaLiveBytes)} MiB | ${mib(row.rssSlopeBytesPerJob)} MiB | ${mib(row.rssTailSlopeBytesPerJob)} MiB | ${row.failures} | ${pass ? 'PASS' : 'REVIEW'} |`);
  }
  lines.push('', 'Tail slope is the stability signal; first-half growth may be normal cache/font/image/codec warmup. A pass here is still a short scout, not the final 1k-job production soak.');
  const markdown = `${lines.join('\n')}\n`;
  await fsp.writeFile(summaryPath, markdown);
  console.log(markdown);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
