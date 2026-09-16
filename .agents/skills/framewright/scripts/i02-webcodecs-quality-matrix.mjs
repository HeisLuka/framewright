#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';

const root = process.cwd();
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18-for-i02.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-i02/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/i02');
const reportPath = path.join(outDir, 'webcodecs-quality-matrix.json');
const summaryPath = path.join(outDir, 'webcodecs-quality-matrix.md');
const baselineQualityPath = path.join(outDir, 'quality-calibration.json');
const selector = {
  bookId: process.env.BOOK_ID || 'river-station',
  variant: process.env.VARIANT || 'hook-first',
  profile: process.env.PROFILE || 'vertical',
};
const bitrates = String(process.env.MATRIX_BITRATES || '1500000,2000000,2500000,3000000,4000000')
  .split(',').map(Number).filter((v) => Number.isFinite(v) && v >= 250_000);
const policies = String(process.env.MATRIX_KEYFRAMES || 'fixed2s,scene+2s')
  .split(',').map((x) => x.trim()).filter((x) => ['fixed2s', 'scene+2s'].includes(x));
const queueLimit = Math.max(1, Math.min(64, Math.trunc(Number(process.env.WEBCODECS_QUEUE || 8))));
if (!bitrates.length || !policies.length) throw new Error('empty WebCodecs matrix');
for (const file of [htmlPath, manifestPath, baselineQualityPath]) if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
await fsp.mkdir(outDir, { recursive: true });

const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const entry = manifest.items.find((x) => x.bookId === selector.bookId && x.variant === selector.variant && x.profile === selector.profile);
if (!entry) throw new Error(`fixture not found: ${JSON.stringify(selector)}`);
const manifestDir = path.dirname(manifestPath);
const payload = JSON.parse(await fsp.readFile(path.resolve(manifestDir, entry.payloadFile), 'utf8'));
const baselineQuality = JSON.parse(await fsp.readFile(baselineQualityPath, 'utf8'));
const x264Target = baselineQuality.backends?.['x264-crf22']?.summary;
if (!x264Target) throw new Error('x264-crf22 quality target missing');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code ?? signal}\n${stderr.slice(-5000)}`)));
  });
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

async function metric(kind, reference, encoded) {
  const filter = kind === 'ssim' ? '[0:v][1:v]ssim' : '[0:v][1:v]psnr';
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-i', reference, '-i', encoded, '-lavfi', filter, '-f', 'null', '-']);
  const re = kind === 'ssim' ? /All:([0-9.]+)/g : /average:([0-9.]+)/g;
  const m = [...stderr.matchAll(re)].at(-1);
  return m ? Number(m[1]) : null;
}

function summarize(samples) {
  const ssim = samples.map((x) => x.ssim).filter(Number.isFinite);
  const psnr = samples.map((x) => x.psnr).filter(Number.isFinite);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    samples: samples.length,
    ssimMean: +mean(ssim).toFixed(6),
    ssimWorst: +Math.min(...ssim).toFixed(6),
    psnrMean: +mean(psnr).toFixed(4),
    psnrWorst: +Math.min(...psnr).toFixed(4),
  };
}

const uploads = new Map();
const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname.startsWith('/__i02_matrix/')) {
    const id = decodeURIComponent(u.pathname.slice('/__i02_matrix/'.length));
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => { uploads.set(id, Buffer.concat(chunks)); res.writeHead(204); res.end(); });
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

let browser;
try {
  browser = await puppeteer.launch({ headless: true, protocolTimeout: 600_000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((p) => { window.FRAMEWRIGHT_PAYLOAD = p; }, payload);
  const rel = path.relative(root, htmlPath).split(path.sep).map(encodeURIComponent).join('/');
  const url = new URL(`/${rel}`, origin);
  url.searchParams.set('f', '0');
  url.searchParams.set('w', String(entry.width));
  url.searchParams.set('h', String(entry.height));
  url.searchParams.set('s', String(entry.seed));
  url.searchParams.set('profile', entry.profile);
  await page.goto(url.href, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction('window.__ready===true', { timeout: 120_000 });

  const scene = await page.evaluate(({ width, seed }) => {
    const canvas = document.getElementById('c');
    window.renderFrame(0, width, seed, canvas);
    const plates = Array.from(window.RISO?.plates || []).map((p) => ({ name: p.name, len: Number(p.len) }));
    const total = Number(window.RISO?.total || plates.reduce((a, p) => a + p.len, 0));
    const fps = Number(window.RISO?.fps || 30);
    let start = 0;
    const starts = [0];
    const sampleFrames = [];
    for (const plate of plates) {
      for (const t of [0.15, 0.5, 0.85]) sampleFrames.push(Math.min(total - 1, start + Math.round((plate.len - 1) * t)));
      start += plate.len;
      if (start < total) starts.push(start);
    }
    return { total, fps, width: canvas.width, height: canvas.height, plates, sceneStarts: starts, sampleFrames: [...new Set(sampleFrames)].sort((a,b)=>a-b) };
  }, { width: entry.width, seed: entry.seed });

  const refsDir = path.join(outDir, 'web-matrix-reference');
  const decodedDir = path.join(outDir, 'web-matrix-decoded');
  await fsp.mkdir(refsDir, { recursive: true });
  await fsp.mkdir(decodedDir, { recursive: true });
  for (const frame of scene.sampleFrames) {
    const dataUrl = await page.evaluate(({ frame, width, seed }) => {
      const canvas = document.getElementById('c');
      window.renderFrame(frame, width, seed, canvas);
      return canvas.toDataURL('image/png');
    }, { frame, width: entry.width, seed: entry.seed });
    await fsp.writeFile(path.join(refsDir, `frame-${frame}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }

  const rows = [];
  for (const bitrate of bitrates) {
    for (const keyframePolicy of policies) {
      const id = `${Math.round(bitrate / 1000)}k-${keyframePolicy.replace(/[^a-z0-9]+/gi, '-')}`;
      uploads.delete(id);
      const t0 = performance.now();
      const encoded = await page.evaluate(async ({ id, width, seed, bitrate, queueLimit, keyframePolicy, sceneStarts }) => {
        const canvas = document.getElementById('c');
        const total = Number(window.RISO.total);
        const fps = Number(window.RISO.fps || 30);
        window.renderFrame(0, width, seed, canvas);
        const config = { codec: 'avc1.420028', width: canvas.width, height: canvas.height, bitrate, framerate: fps, latencyMode: 'realtime', avc: { format: 'annexb' } };
        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) throw new Error(`unsupported ${JSON.stringify(config)}`);
        const chunks = []; let bytes = 0, maxQueue = 0, drawTotal = 0;
        const sceneSet = new Set(sceneStarts);
        const encoder = new VideoEncoder({
          output(chunk) { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push(b); bytes += b.byteLength; },
          error(error) { throw error; },
        });
        encoder.configure(config);
        const encode0 = performance.now();
        for (let frame = 0; frame < total; frame += 1) {
          const d0 = performance.now();
          window.renderFrame(frame, width, seed, canvas);
          drawTotal += performance.now() - d0;
          const vf = new VideoFrame(canvas, { timestamp: Math.trunc(frame * 1_000_000 / fps) });
          const fixed = frame === 0 || frame % Math.max(1, Math.round(fps * 2)) === 0;
          const sceneBoundary = keyframePolicy === 'scene+2s' && sceneSet.has(frame);
          encoder.encode(vf, { keyFrame: fixed || sceneBoundary });
          vf.close();
          maxQueue = Math.max(maxQueue, encoder.encodeQueueSize);
          while (encoder.encodeQueueSize > queueLimit) await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }));
        }
        await encoder.flush();
        const encodeMs = performance.now() - encode0;
        encoder.close();
        const body = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        const upload0 = performance.now();
        const response = await fetch(`/__i02_matrix/${encodeURIComponent(id)}`, { method: 'POST', body });
        if (!response.ok) throw new Error(`upload ${response.status}`);
        return { total, fps, encodeMs, drawTotalMs: drawTotal, uploadMs: performance.now() - upload0, bytes, maxQueue };
      }, { id, width: entry.width, seed: entry.seed, bitrate, queueLimit, keyframePolicy, sceneStarts: scene.sceneStarts });
      const h264 = uploads.get(id);
      if (!h264?.length) throw new Error(`missing upload for ${id}`);
      const h264Path = path.join(outDir, `matrix-${id}.h264`);
      const mp4Path = path.join(outDir, `matrix-${id}.mp4`);
      await fsp.writeFile(h264Path, h264);
      const mux0 = performance.now();
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-fflags', '+genpts', '-r', String(scene.fps), '-i', h264Path, '-c:v', 'copy', '-an', '-movflags', '+faststart', mp4Path]);
      const muxMs = performance.now() - mux0;
      const samples = [];
      for (const frame of scene.sampleFrames) {
        const decoded = path.join(decodedDir, `${id}-${frame}.png`);
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4Path, '-vf', `select=eq(n\\,${frame})`, '-vsync', '0', '-frames:v', '1', decoded]);
        const reference = path.join(refsDir, `frame-${frame}.png`);
        samples.push({ frame, ssim: await metric('ssim', reference, decoded), psnr: await metric('psnr', reference, decoded) });
      }
      const quality = summarize(samples);
      rows.push({
        id, bitrate, keyframePolicy, h264Bytes: h264.length, mp4Bytes: fs.statSync(mp4Path).size,
        encodeMs: +encoded.encodeMs.toFixed(3), drawTotalMs: +encoded.drawTotalMs.toFixed(3), uploadMs: +encoded.uploadMs.toFixed(3), muxMs: +(performance.now() - t0 - encoded.encodeMs).toFixed(3),
        streamCopyMuxMs: +muxMs.toFixed(3), maxQueue: encoded.maxQueue, quality, samples,
      });
      console.log(`${id}: ${(h264.length/1048576).toFixed(2)} MiB, encode ${(encoded.encodeMs/1000).toFixed(3)}s, SSIM mean/worst ${quality.ssimMean}/${quality.ssimWorst}`);
    }
  }

  const passes = rows.filter((r) => r.quality.ssimMean >= x264Target.ssimMean && r.quality.ssimWorst >= x264Target.ssimWorst);
  const bestPass = [...passes].sort((a,b) => a.h264Bytes - b.h264Bytes || a.encodeMs - b.encodeMs)[0] || null;
  const closest = [...rows].sort((a,b) => {
    const da = Math.max(0, x264Target.ssimMean-a.quality.ssimMean) + 2*Math.max(0, x264Target.ssimWorst-a.quality.ssimWorst);
    const db = Math.max(0, x264Target.ssimMean-b.quality.ssimMean) + 2*Math.max(0, x264Target.ssimWorst-b.quality.ssimWorst);
    return da-db || a.h264Bytes-b.h264Bytes;
  })[0];
  const result = {
    schema: 'framewright-i02-webcodecs-quality-matrix-v1',
    fixture: { ...selector, id: entry.id, style: entry.style, width: entry.width, height: entry.height, seed: entry.seed },
    scene,
    target: { source: 'x264-crf22 own-raster sampled quality from quality-calibration.json', ...x264Target },
    rows,
    decision: { passCount: passes.length, bestPass: bestPass?.id || null, closest: closest?.id || null },
    caveat: 'Sampled full-frame SSIM/PSNR is a scout gate, not final typography/CTA ROI quality. Final policy requires ROI and platform compatibility checks.',
  };
  await fsp.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);

  const lines = [
    '# I02 WebCodecs quality-match matrix', '',
    `Target from x264 CRF22 own-raster scout: mean SSIM **${x264Target.ssimMean}**, worst SSIM **${x264Target.ssimWorst}**, mean PSNR **${x264Target.psnrMean} dB**, worst PSNR **${x264Target.psnrWorst} dB**.`, '',
    '| bitrate | keyframes | H264 | encode | mean SSIM | worst SSIM | mean PSNR | worst PSNR | meets x264 SSIM target |',
    '|---:|---|---:|---:|---:|---:|---:|---:|:---:|',
  ];
  for (const r of rows) {
    const pass = r.quality.ssimMean >= x264Target.ssimMean && r.quality.ssimWorst >= x264Target.ssimWorst;
    lines.push(`| ${(r.bitrate/1e6).toFixed(1)} Mbps | ${r.keyframePolicy} | ${(r.h264Bytes/1048576).toFixed(2)} MiB | ${(r.encodeMs/1000).toFixed(3)} s | ${r.quality.ssimMean} | ${r.quality.ssimWorst} | ${r.quality.psnrMean} | ${r.quality.psnrWorst} | ${pass ? 'yes' : 'no'} |`);
  }
  lines.push('', bestPass ? `Smallest sampled-quality pass: **${bestPass.id}**.` : `No tested WebCodecs point met both x264 CRF22 sampled SSIM gates; closest tested point: **${closest.id}**.`);
  lines.push('', 'This is still a scout: final quality policy must use semantic ROI gates for hook/title/CTA/cover, not only full-frame SSIM/PSNR.');
  await fsp.writeFile(summaryPath, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
} finally {
  try { if (browser) await browser.close(); } catch {}
  await new Promise((resolve) => server.close(resolve));
}
