#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createCanvas, Image, GlobalFonts } from '@napi-rs/canvas';

const root = process.cwd();
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-e18/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/i02');
const reportPath = path.resolve(process.env.REPORT || path.join(outDir, 'report.json'));
const summaryPath = path.resolve(process.env.SUMMARY || path.join(outDir, 'summary.md'));
const trackPath = path.resolve(process.env.TRACK || path.join(outDir, 'track.wav'));
const repeats = Math.max(1, Math.min(10, Math.trunc(Number(process.env.REPEATS || 3))));
const bitrate = Math.max(250_000, Math.trunc(Number(process.env.BITRATE || 2_000_000)));
const x264Preset = process.env.X264_PRESET || 'veryfast';
const crf = Math.max(0, Math.min(51, Number(process.env.X264_CRF || 22)));
const queueLimit = Math.max(1, Math.min(64, Math.trunc(Number(process.env.WEBCODECS_QUEUE || 8))));
const selector = {
  bookId: process.env.BOOK_ID || 'river-station',
  variant: process.env.VARIANT || 'hook-first',
  profile: process.env.PROFILE || 'vertical',
};
const sampleFramesEnv = process.env.SAMPLE_FRAMES || '';

for (const [file, family] of [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'DejaVu Sans'],
]) {
  if (!GlobalFonts.registerFromPath(file, family)) throw new Error(`failed to register font ${file}`);
}

for (const file of [htmlPath, manifestPath, trackPath]) {
  if (!fs.existsSync(file)) throw new Error(`missing required input: ${file}`);
}
await fsp.mkdir(outDir, { recursive: true });

const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const entry = manifest.items.find((item) =>
  item.bookId === selector.bookId && item.variant === selector.variant && item.profile === selector.profile
);
if (!entry) {
  throw new Error(`fixture not found: ${JSON.stringify(selector)} in ${manifestPath}`);
}
const manifestDir = path.dirname(manifestPath);
const templateDir = path.dirname(htmlPath);
const payloadPath = path.resolve(manifestDir, entry.payloadFile);
const browserPayload = JSON.parse(await fsp.readFile(payloadPath, 'utf8'));
const nodePayload = structuredClone(browserPayload);
if (nodePayload.cover_url && !/^[a-z]+:/i.test(nodePayload.cover_url) && !path.isAbsolute(nodePayload.cover_url)) {
  nodePayload.cover_url = path.resolve(templateDir, nodePayload.cover_url);
}
const html = await fsp.readFile(htmlPath, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!scriptMatch) throw new Error('inline scene script not found');
const sceneSource = scriptMatch[1];

function stat(xs) {
  const values = [...xs].sort((a, b) => a - b);
  const q = (p) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] ?? 0;
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  return { mean: +mean.toFixed(3), p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), min: +q(0).toFixed(3), max: +q(1).toFixed(3) };
}

function procTreeRssBytes(rootPid = process.pid) {
  try {
    const pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).map(Number);
    const parent = new Map();
    const rss = new Map();
    for (const pid of pids) {
      try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const pp = status.match(/^PPid:\s+(\d+)/m);
        const rr = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
        if (pp) parent.set(pid, Number(pp[1]));
        if (rr) rss.set(pid, Number(rr[1]) * 1024);
      } catch {}
    }
    const wanted = new Set([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, ppid] of parent) {
        if (wanted.has(ppid) && !wanted.has(pid)) { wanted.add(pid); changed = true; }
      }
    }
    let total = 0;
    for (const pid of wanted) total += rss.get(pid) || 0;
    return total;
  } catch { return 0; }
}

function cgroupCpuUsec() {
  try {
    const text = fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8');
    const m = text.match(/^usage_usec\s+(\d+)/m);
    if (m) return Number(m[1]);
  } catch {}
  return null;
}

function startResourceSampler() {
  let peak = procTreeRssBytes();
  const cpu0 = cgroupCpuUsec();
  const timer = setInterval(() => { peak = Math.max(peak, procTreeRssBytes()); }, 20);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    peak = Math.max(peak, procTreeRssBytes());
    const cpu1 = cgroupCpuUsec();
    return { peakProcessTreeRssBytes: peak, cgroupCpuMs: cpu0 != null && cpu1 != null ? +(cpu1 - cpu0).toFixed(3) / 1000 : null };
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr, pid: child.pid });
      else reject(new Error(`${command} exited ${code ?? signal}\n${stderr.slice(-6000)}`));
    });
  });
}

async function ffprobe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-count_frames', '-show_entries',
    'format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,duration',
    '-of', 'json', file,
  ]);
  return JSON.parse(stdout);
}

async function metric(kind, a, b) {
  const filter = kind === 'ssim' ? '[0:v][1:v]ssim' : '[0:v][1:v]psnr';
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-i', a, '-i', b, '-lavfi', filter, '-f', 'null', '-']);
  if (kind === 'ssim') {
    const m = [...stderr.matchAll(/All:([0-9.]+)/g)].at(-1);
    return m ? Number(m[1]) : null;
  }
  const m = [...stderr.matchAll(/average:([0-9.]+)/g)].at(-1);
  return m ? Number(m[1]) : null;
}

async function compareVideo(a, b) {
  return { ssim: await metric('ssim', a, b), psnr: await metric('psnr', a, b) };
}

async function nodeContext(payload) {
  const canvas = createCanvas(entry.width, entry.height);
  const document = {
    createElement(name) {
      if (String(name).toLowerCase() !== 'canvas') throw new Error(`unsupported element ${name}`);
      return createCanvas(1, 1);
    },
    getElementById(id) { return id === 'c' ? canvas : null; },
  };
  const window = { FRAMEWRIGHT_PAYLOAD: payload };
  const location = { search: `?f=0&w=${entry.width}&h=${entry.height}&s=${entry.seed}&profile=${entry.profile}` };
  const sandbox = { window, document, Image, URLSearchParams, location, console, performance, setTimeout, clearTimeout, requestAnimationFrame() { return 0; } };
  sandbox.globalThis = sandbox;
  window.window = window; window.document = document; window.location = location;
  const ctx = vm.createContext(sandbox);
  const t0 = performance.now();
  vm.runInContext(sceneSource, ctx, { filename: htmlPath });
  const deadline = performance.now() + 10_000;
  while (!window.__ready && performance.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  if (!window.__ready) throw new Error('node scene boot timeout');
  if (window.__bootError) throw new Error(window.__bootError);
  vm.runInContext(`globalThis.__i02Render=(n,w,s)=>{renderFrame(n,w,s,document.getElementById('c'));return document.getElementById('c');};`, ctx);
  return { ctx, window, canvas, initMs: performance.now() - t0 };
}

async function renderNodeX264({ mode, runIndex }) {
  const stopResources = startResourceSampler();
  const wall0 = performance.now();
  const { ctx, window, canvas, initMs } = await nodeContext(nodePayload);
  const total = Number(window.RISO.total);
  const fps = Number(window.RISO.fps);
  const output = path.join(outDir, `node-${mode}-${runIndex}.mp4`);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${entry.width}x${entry.height}`, '-r', String(fps), '-i', '-',
    '-i', trackPath,
    '-c:v', 'libx264', '-preset', x264Preset,
  ];
  if (mode === 'fixed') {
    args.push('-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2));
  } else {
    args.push('-crf', String(crf));
  }
  args.push('-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output);
  const ff = spawn('ffmpeg', args, { cwd: root, stdio: ['pipe', 'ignore', 'pipe'] });
  let fferr = '';
  ff.stderr.on('data', (d) => { fferr += d; });
  const renderTimes = [], writeWaitTimes = [];
  const encode0 = performance.now();
  for (let frame = 0; frame < total; frame += 1) {
    const r0 = performance.now();
    const rendered = ctx.__i02Render(frame, entry.width, entry.seed);
    renderTimes.push(performance.now() - r0);
    const rgba = rendered.getContext('2d').getImageData(0, 0, rendered.width, rendered.height).data;
    const buf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    const w0 = performance.now();
    if (!ff.stdin.write(buf)) await new Promise((resolve) => ff.stdin.once('drain', resolve));
    writeWaitTimes.push(performance.now() - w0);
  }
  ff.stdin.end();
  await new Promise((resolve, reject) => {
    ff.once('error', reject);
    ff.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg x264 exited ${code}: ${fferr.slice(-4000)}`)));
  });
  const encodeAndMuxMs = performance.now() - encode0;
  const wallMs = performance.now() - wall0;
  const resources = stopResources();
  const probe = await ffprobe(output);
  return {
    backend: `node-canvas-x264-${mode}`, runIndex, output, wallMs: +wallMs.toFixed(3), initMs: +initMs.toFixed(3),
    encodeAndMuxMs: +encodeAndMuxMs.toFixed(3), renderFrameMs: stat(renderTimes), writeWaitMs: stat(writeWaitTimes),
    outputBytes: fs.statSync(output).size, resources, probe,
  };
}

function contentType(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': case '.mjs': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

async function withServer(fn) {
  let uploaded = null;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'POST' && u.pathname === '/__i02_h264') {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => { uploaded = Buffer.concat(chunks); res.writeHead(204); res.end(); });
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
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try { return await fn({ origin, getUploaded: () => uploaded }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function renderWebCodecs(runIndex) {
  return withServer(async ({ origin, getUploaded }) => {
    const stopResources = startResourceSampler();
    const wall0 = performance.now();
    const puppeteer = (await import('puppeteer')).default;
    const launch0 = performance.now();
    const browser = await puppeteer.launch({ headless: true, protocolTimeout: 600_000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const launchMs = performance.now() - launch0;
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument((payload) => { window.FRAMEWRIGHT_PAYLOAD = payload; }, browserPayload);
      const rel = path.relative(root, htmlPath).split(path.sep).map(encodeURIComponent).join('/');
      const url = new URL(`/${rel}`, origin);
      url.searchParams.set('f', '0'); url.searchParams.set('w', String(entry.width)); url.searchParams.set('h', String(entry.height));
      url.searchParams.set('s', String(entry.seed)); url.searchParams.set('profile', entry.profile);
      const page0 = performance.now();
      await page.goto(url.href, { waitUntil: 'load', timeout: 120_000 });
      await page.waitForFunction('window.__ready===true', { timeout: 120_000 });
      const pageLoadMs = performance.now() - page0;
      const browserResult = await page.evaluate(async ({ width, seed, bitrate, queueLimit }) => {
        const canvas = document.getElementById('c');
        const total = Math.max(1, Number(window.RISO?.total || 1));
        const fps = Math.max(1, Number(window.RISO?.fps || 30));
        if (!canvas || typeof window.renderFrame !== 'function') throw new Error('same-scene renderFrame unavailable');
        const config = { codec: 'avc1.420028', width, height: canvas.height, bitrate, framerate: fps, latencyMode: 'realtime', avc: { format: 'annexb' } };
        window.renderFrame(0, width, seed, canvas);
        config.width = canvas.width; config.height = canvas.height;
        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) throw new Error(`unsupported WebCodecs config ${JSON.stringify(config)}`);
        const chunks = [];
        let bytes = 0, maxQueue = 0;
        const encoder = new VideoEncoder({
          output(chunk) { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push(b); bytes += b.byteLength; },
          error(error) { throw error; },
        });
        encoder.configure(config);
        const drawMs = [];
        const enc0 = performance.now();
        for (let frame = 0; frame < total; frame += 1) {
          const d0 = performance.now();
          window.renderFrame(frame, width, seed, canvas);
          drawMs.push(performance.now() - d0);
          const vf = new VideoFrame(canvas, { timestamp: Math.trunc(frame * 1_000_000 / fps) });
          encoder.encode(vf, { keyFrame: frame === 0 || frame % Math.max(1, Math.round(fps * 2)) === 0 });
          vf.close();
          maxQueue = Math.max(maxQueue, encoder.encodeQueueSize);
          while (encoder.encodeQueueSize > queueLimit) await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }));
        }
        await encoder.flush();
        const encodeMs = performance.now() - enc0;
        encoder.close();
        const body = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        const up0 = performance.now();
        const response = await fetch('/__i02_h264', { method: 'POST', body });
        if (!response.ok) throw new Error(`upload ${response.status}`);
        return { total, fps, canvasWidth: canvas.width, canvasHeight: canvas.height, encodeMs, uploadMs: performance.now() - up0, encodedBytes: bytes, maxQueue, drawMs };
      }, { width: entry.width, seed: entry.seed, bitrate, queueLimit });
      const h264 = getUploaded();
      if (!h264?.length) throw new Error('browser produced no h264');
      const h264Path = path.join(outDir, `web-${runIndex}.h264`);
      const output = path.join(outDir, `web-${runIndex}.mp4`);
      await fsp.writeFile(h264Path, h264);
      const mux0 = performance.now();
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'h264', '-r', String(browserResult.fps), '-i', h264Path, '-i', trackPath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output]);
      const muxMs = performance.now() - mux0;
      const wallMs = performance.now() - wall0;
      const resources = stopResources();
      const probe = await ffprobe(output);
      return {
        backend: 'chromium-webcodecs', runIndex, output, wallMs: +wallMs.toFixed(3), launchMs: +launchMs.toFixed(3),
        pageLoadMs: +pageLoadMs.toFixed(3), encodeMs: +browserResult.encodeMs.toFixed(3), uploadMs: +browserResult.uploadMs.toFixed(3),
        muxMs: +muxMs.toFixed(3), encodedBytes: browserResult.encodedBytes, outputBytes: fs.statSync(output).size,
        maxEncodeQueue: browserResult.maxQueue, drawFrameMs: stat(browserResult.drawMs), resources, probe,
      };
    } finally {
      await browser.close();
    }
  });
}

async function captureRasterParity(total, fps) {
  const defaultFrames = [Math.round(fps), Math.round(total * 0.32), Math.round(total * 0.61), Math.min(total - 1, Math.round(total * 0.9))];
  const frames = sampleFramesEnv ? sampleFramesEnv.split(',').map(Number).filter(Number.isFinite) : defaultFrames;
  const dir = path.join(outDir, 'raster-parity');
  await fsp.mkdir(dir, { recursive: true });
  const node = await nodeContext(nodePayload);
  for (const frame of frames) {
    const canvas = node.ctx.__i02Render(frame, entry.width, entry.seed);
    await fsp.writeFile(path.join(dir, `node-${frame}.png`), canvas.toBuffer('image/png'));
  }
  await withServer(async ({ origin }) => {
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument((payload) => { window.FRAMEWRIGHT_PAYLOAD = payload; }, browserPayload);
      const rel = path.relative(root, htmlPath).split(path.sep).map(encodeURIComponent).join('/');
      const url = new URL(`/${rel}`, origin);
      url.searchParams.set('f', '0'); url.searchParams.set('w', String(entry.width)); url.searchParams.set('s', String(entry.seed)); url.searchParams.set('profile', entry.profile);
      await page.goto(url.href, { waitUntil: 'load', timeout: 120_000 });
      await page.waitForFunction('window.__ready===true', { timeout: 120_000 });
      for (const frame of frames) {
        const dataUrl = await page.evaluate(({ frame, width, seed }) => {
          const canvas = document.getElementById('c'); window.renderFrame(frame, width, seed, canvas); return canvas.toDataURL('image/png');
        }, { frame, width: entry.width, seed: entry.seed });
        await fsp.writeFile(path.join(dir, `browser-${frame}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
      }
    } finally { await browser.close(); }
  });
  const results = [];
  for (const frame of frames) {
    const browser = path.join(dir, `browser-${frame}.png`), nodeFile = path.join(dir, `node-${frame}.png`);
    results.push({ frame, ...(await compareVideo(browser, nodeFile)) });
  }
  return results;
}

console.log(`I02 scout fixture: ${entry.id} style=${entry.style} variant=${entry.variant} profile=${entry.profile} ${entry.width}x${entry.height} seed=${entry.seed}`);
const web = [], nodeFixed = [];
for (let i = 1; i <= repeats; i += 1) {
  console.log(`web ${i}/${repeats}`); web.push(await renderWebCodecs(i));
  console.log(`node-fixed ${i}/${repeats}`); nodeFixed.push(await renderNodeX264({ mode: 'fixed', runIndex: i }));
}
console.log('node-crf reference');
const nodeCrf = await renderNodeX264({ mode: 'crf', runIndex: 1 });
const qualityFixed = await compareVideo(web[0].output, nodeFixed[0].output);
const qualityCrf = await compareVideo(web[0].output, nodeCrf.output);
const videoStream = web[0].probe.streams.find((s) => s.codec_type === 'video');
const totalFrames = Number(videoStream?.nb_read_frames || 0) || Number(entry.frames || 360);
const fps = Number(window?.RISO?.fps || 30);
const rasterParity = await captureRasterParity(totalFrames, 30);

const summarize = (runs) => ({
  wallMs: stat(runs.map((x) => x.wallMs)),
  outputBytes: stat(runs.map((x) => x.outputBytes)),
  peakRssBytes: stat(runs.map((x) => x.resources.peakProcessTreeRssBytes)),
  cgroupCpuMs: stat(runs.map((x) => x.resources.cgroupCpuMs).filter((x) => x != null)),
  videosPerHourFromMeanWall: +(3_600_000 / (runs.reduce((a, x) => a + x.wallMs, 0) / runs.length)).toFixed(2),
});
const report = {
  schema: 'framewright-i02-fast-backend-scout-v1',
  warning: 'Scout only. C18 fixture is used before C19 production package; do not treat this as final backend verdict.',
  fixture: { ...selector, id: entry.id, style: entry.style, width: entry.width, height: entry.height, seed: entry.seed, payloadFile: entry.payloadFile },
  config: { repeats, bitrate, x264Preset, crf, queueLimit, audio: path.relative(root, trackPath) },
  host: { platform: process.platform, arch: process.arch, node: process.version, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model || null, totalMemoryBytes: os.totalmem() },
  summary: { web: summarize(web), nodeFixed: summarize(nodeFixed), nodeCrf: summarize([nodeCrf]) },
  quality: { webVsNodeFixed: qualityFixed, webVsNodeCrf: qualityCrf, rasterParity },
  runs: { web, nodeFixed, nodeCrf },
};
await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const mb = (n) => (n / 1048576).toFixed(2);
const s = report.summary;
const rasterMin = { ssim: Math.min(...rasterParity.map((x) => x.ssim ?? 1)), psnr: Math.min(...rasterParity.map((x) => x.psnr ?? Infinity)) };
const md = `# I02 FAST backend scout\n\n> Scout only: C18 fixture before C19 production package. This run may reject a clearly bad backend, but final selection waits for the canonical production workload.\n\nFixture: \`${entry.id}\` — ${entry.width}×${entry.height}, seed ${entry.seed}, ${entry.style}/${entry.variant}/${entry.profile}.\n\n| backend | mean wall | videos/hour | mean MP4 | mean peak RSS | mean CPU |\n|---|---:|---:|---:|---:|---:|\n| Chromium Canvas → WebCodecs → FFmpeg mux | ${(s.web.wallMs.mean/1000).toFixed(3)} s | ${s.web.videosPerHourFromMeanWall} | ${mb(s.web.outputBytes.mean)} MiB | ${mb(s.web.peakRssBytes.mean)} MiB | ${(s.web.cgroupCpuMs.mean/1000).toFixed(3)} s |\n| @napi-rs/canvas → x264 fixed target | ${(s.nodeFixed.wallMs.mean/1000).toFixed(3)} s | ${s.nodeFixed.videosPerHourFromMeanWall} | ${mb(s.nodeFixed.outputBytes.mean)} MiB | ${mb(s.nodeFixed.peakRssBytes.mean)} MiB | ${(s.nodeFixed.cgroupCpuMs.mean/1000).toFixed(3)} s |\n| @napi-rs/canvas → x264 CRF ${crf} reference | ${(s.nodeCrf.wallMs.mean/1000).toFixed(3)} s | ${s.nodeCrf.videosPerHourFromMeanWall} | ${mb(s.nodeCrf.outputBytes.mean)} MiB | ${mb(s.nodeCrf.peakRssBytes.mean)} MiB | ${(s.nodeCrf.cgroupCpuMs.mean/1000).toFixed(3)} s |\n\nDecoded comparison (not a common-reference quality score): WebCodecs vs fixed x264 SSIM=${qualityFixed.ssim}, PSNR=${qualityFixed.psnr}; WebCodecs vs CRF x264 SSIM=${qualityCrf.ssim}, PSNR=${qualityCrf.psnr}.\n\nPre-encode raster parity across ${rasterParity.length} sampled frames: worst SSIM=${rasterMin.ssim}, worst PSNR=${Number.isFinite(rasterMin.psnr) ? rasterMin.psnr : 'inf'}. This isolates Canvas implementation differences from codec differences.\n\nRaw JSON: \`${path.relative(root, reportPath)}\`.\n`;
await fsp.writeFile(summaryPath, md);
console.log(md);
