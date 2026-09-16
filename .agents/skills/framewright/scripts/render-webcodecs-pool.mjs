#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { performance } from 'node:perf_hooks';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

function contentType(filename) {
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  })[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited with ${code ?? signal}: ${stderr.slice(-4000)}`)));
  });
}

async function atomicJson(filename, value) {
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  const tmp = `${filename}.tmp-${process.pid}-${randomUUID()}`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fsp.rename(tmp, filename);
}

async function readBody(req, limit = 4 * 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const options = parseArgs(process.argv.slice(2));
const concurrency = Math.max(1, Math.min(2, Number(options.concurrency || process.env.WEBCODECS_POOL_CONCURRENCY || 2)));
const portFile = path.resolve(String(options['port-file'] || process.env.WEBCODECS_POOL_PORT_FILE || '.webcodecs-pool.json'));
const queueLimit = 8;
const token = randomBytes(24).toString('hex');
const activeScenes = new Map();
const uploads = new Map();
const availablePages = [];
const pageWaiters = [];
let browser = null;
let stopping = false;
let origin = null;
let apiPrefix = null;
let chromeLaunchMs = null;

function acquirePage() {
  if (availablePages.length) return Promise.resolve(availablePages.shift());
  return new Promise(resolve => pageWaiters.push(resolve));
}
function releasePage(page) {
  const waiter = pageWaiters.shift();
  if (waiter) waiter(page);
  else availablePages.push(page);
}

function injectPayload(html, payload) {
  const script = `<script>window.FRAMEWRIGHT_PAYLOAD=${JSON.stringify(payload)};<\/script>\n`;
  if (html.includes('<script>')) return html.replace('<script>', `${script}<script>`);
  if (html.includes('</head>')) return html.replace('</head>', `${script}</head>`);
  return `${script}${html}`;
}

async function renderJob(job) {
  const t0 = performance.now();
  const htmlPath = path.resolve(String(job.html || ''));
  const payloadPath = path.resolve(String(job.payload || ''));
  const out = path.resolve(String(job.out || ''));
  const reportPath = path.resolve(String(job.report || `${out}.report.json`));
  const seed = Number(job.seed);
  const width = Number(job.width);
  const bitrate = Number(job.bitrate);
  const requestedCodec = String(job.codec || '').trim();
  const latencyMode = String(job.latencyMode || 'realtime').trim();
  const expectedHeight = job.expectedHeight == null ? null : Number(job.expectedHeight);
  if (!fs.existsSync(htmlPath)) throw new Error(`pool missing HTML ${htmlPath}`);
  if (!fs.existsSync(payloadPath)) throw new Error(`pool missing payload ${payloadPath}`);
  if (!Number.isFinite(seed) || !Number.isFinite(width) || !Number.isFinite(bitrate)) throw new Error('pool seed/width/bitrate invalid');
  const payload = JSON.parse(await fsp.readFile(payloadPath, 'utf8'));
  const sceneId = randomUUID();
  const htmlRoot = path.dirname(htmlPath);
  const htmlName = path.basename(htmlPath);
  activeScenes.set(sceneId, { root: htmlRoot, htmlName, payload });
  const page = await acquirePage();
  const uploadId = randomUUID();
  uploads.delete(uploadId);
  try {
    page.removeAllListeners('pageerror');
    page.on('pageerror', error => console.error(`[webcodecs-pool pageerror] ${error.message}`));
    const sceneUrl = new URL(`${apiPrefix}/scene/${sceneId}/${encodeURIComponent(htmlName)}`, origin);
    sceneUrl.searchParams.set('f', '0');
    sceneUrl.searchParams.set('w', String(width));
    sceneUrl.searchParams.set('s', String(seed));
    const load0 = performance.now();
    await page.goto(sceneUrl.href, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForFunction('window.__ready===true', { timeout: 120_000 });
    const pageLoadMs = performance.now() - load0;
    const bootError = await page.evaluate(() => window.__bootError || null);
    if (bootError) throw new Error(bootError);
    const uploadUrl = `${origin}${apiPrefix}/h264/${uploadId}`;
    const evaluate0 = performance.now();
    const meta = await page.evaluate(async ({ seed, width, bitrate, requestedCodec, latencyMode, queueLimit, uploadUrl, expectedHeight }) => {
      if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('WebCodecs unavailable');
      const canvas = document.getElementById('c');
      if (!canvas) throw new Error('main canvas #c not found');
      const total = Number(window.RISO?.total);
      const fps = Number(window.RISO?.fps || 30);
      window.RISO.frame(0, width, seed);
      const actualWidth = Number(canvas.width), actualHeight = Number(canvas.height);
      if (expectedHeight != null && actualHeight !== expectedHeight) throw new Error(`runtime height mismatch: expected ${expectedHeight}, got ${actualHeight}`);
      const codecCandidates = requestedCodec ? [requestedCodec] : ['avc1.4d002a','avc1.42002a','avc1.4d0028','avc1.420028'];
      let selected = null;
      for (const codec of codecCandidates) {
        const config = { codec, width: actualWidth, height: actualHeight, bitrate, framerate: fps, latencyMode, avc: { format: 'annexb' } };
        try {
          const support = await VideoEncoder.isConfigSupported(config);
          if (support.supported) { selected = support.config || config; break; }
        } catch {}
      }
      if (!selected) throw new Error(`no supported H.264 config ${actualWidth}x${actualHeight}`);
      const chunks = [];
      let totalBytes = 0, encoderError = null, decoderConfig = null;
      const encoder = new VideoEncoder({
        output(chunk, details) {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          chunks.push(bytes);
          totalBytes += bytes.byteLength;
          if (details?.decoderConfig && !decoderConfig) decoderConfig = { codec: details.decoderConfig.codec, descriptionBytes: details.decoderConfig.description?.byteLength || 0 };
        },
        error(error) { encoderError = String(error); },
      });
      encoder.configure(selected);
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function () { return 'data:,'; };
      let renderMs = 0, videoFrameMs = 0, enqueueMs = 0, maxQueue = 0;
      const encode0 = performance.now();
      try {
        for (let n = 0; n < total; n += 1) {
          let x = performance.now();
          window.RISO.frame(n, width, seed);
          renderMs += performance.now() - x;
          x = performance.now();
          const frame = new VideoFrame(canvas, { timestamp: Math.round(n * 1_000_000 / fps), duration: Math.round(1_000_000 / fps) });
          videoFrameMs += performance.now() - x;
          x = performance.now();
          encoder.encode(frame, { keyFrame: n === 0 || n % (fps * 4) === 0 });
          enqueueMs += performance.now() - x;
          frame.close();
          maxQueue = Math.max(maxQueue, encoder.encodeQueueSize);
          while (encoder.encodeQueueSize > queueLimit) await new Promise(resolve => setTimeout(resolve, 0));
        }
        await encoder.flush();
      } finally {
        HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
        encoder.close();
      }
      const browserWallMs = performance.now() - encode0;
      if (encoderError) throw new Error(encoderError);
      const body = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      const upload0 = performance.now();
      const response = await fetch(uploadUrl, { method: 'POST', body });
      if (!response.ok) throw new Error(`H264 upload failed ${response.status}`);
      return {
        total, fps, width: actualWidth, height: actualHeight, codec: selected, encodedBytes: totalBytes, chunks: chunks.length,
        browserWallMs, renderMs, videoFrameMs, enqueueMs, uploadMs: performance.now() - upload0, maxQueue, decoderConfig,
        isSecureContext: self.isSecureContext,
      };
    }, { seed, width, bitrate, requestedCodec, latencyMode, queueLimit, uploadUrl, expectedHeight });
    const evaluateWallMs = performance.now() - evaluate0;
    const h264 = uploads.get(uploadId);
    if (!h264?.length) throw new Error(`pool missing H264 upload ${uploadId}`);
    uploads.delete(uploadId);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    const h264Path = `${out}.pool.h264`;
    await fsp.writeFile(h264Path, h264);
    const mux0 = performance.now();
    const setts = `setts=time_base=1/${meta.fps}:pts=N:dts=N:duration=1`;
    await run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner','-loglevel',process.env.FFMPEG_LOGLEVEL || 'error','-y','-r',String(meta.fps),'-i',h264Path,'-c:v','copy','-bsf:v',setts,'-video_track_timescale',String(Math.round(meta.fps)),'-movflags','+faststart',out]);
    const muxMs = performance.now() - mux0;
    const probe = await run(process.env.FFPROBE || 'ffprobe', ['-v','error','-show_entries','format=duration,size','-show_entries','stream=codec_name,profile,width,height,nb_frames,avg_frame_rate,r_frame_rate,time_base','-of','json',out]);
    let ffprobe;
    try { ffprobe = JSON.parse(probe.stdout); } catch { ffprobe = { raw: probe.stdout, stderr: probe.stderr }; }
    await fsp.rm(h264Path, { force: true });
    const report = {
      schema: 'framewright-webcodecs-render-v5-warm-pool', createdAt: new Date().toISOString(),
      config: { html: htmlPath, payloadPath, seed, width, bitrate, requestedCodec: requestedCodec || null, latencyMode },
      startup: { chromeLaunchMs: 0, pageLoadMs: +pageLoadMs.toFixed(3) },
      browser: meta,
      node: { evaluateWallMs: +evaluateWallMs.toFixed(3), base64DecodeMs: 0, muxMs: +muxMs.toFixed(3), timestampNormalization: `setts time_base=1/${meta.fps}, pts=dts=N, duration=1; MP4 track timescale=${meta.fps}` },
      pool: { schema: 'framewright-webcodecs-pool-v1', pid: process.pid, concurrency, chromeLaunchMs: +chromeLaunchMs.toFixed(3), fullDocumentNavigation: true },
      output: { h264Bytes: h264.byteLength, mp4Bytes: fs.statSync(out).size, ffprobe },
      totalRunMs: +(performance.now() - t0).toFixed(3),
    };
    await atomicJson(reportPath, report);
    return { ok: true, report: reportPath, out, pool: report.pool };
  } finally {
    activeScenes.delete(sceneId);
    uploads.delete(uploadId);
    releasePage(page);
  }
}

const server = http.createServer((req, res) => {
  (async () => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (!apiPrefix || !url.pathname.startsWith(apiPrefix)) { res.writeHead(404); res.end(); return; }
    const localPath = url.pathname.slice(apiPrefix.length) || '/';
    if (req.method === 'GET' && localPath === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, concurrency, pages: concurrency }));
      return;
    }
    if (req.method === 'POST' && localPath === '/render') {
      const job = JSON.parse((await readBody(req)).toString('utf8'));
      try {
        const result = await renderJob(job);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(error?.stack || error) }));
      }
      return;
    }
    if (req.method === 'POST' && localPath.startsWith('/h264/')) {
      const id = decodeURIComponent(localPath.slice('/h264/'.length));
      uploads.set(id, await readBody(req, 64 * 1024 * 1024));
      res.writeHead(204); res.end();
      return;
    }
    const sceneMatch = localPath.match(/^\/scene\/([^/]+)\/(.+)$/);
    if ((req.method === 'GET' || req.method === 'HEAD') && sceneMatch) {
      const sceneId = decodeURIComponent(sceneMatch[1]);
      const rel = decodeURIComponent(sceneMatch[2]);
      const scene = activeScenes.get(sceneId);
      if (!scene) { res.writeHead(404); res.end(); return; }
      const filename = path.resolve(scene.root, rel);
      if (filename !== scene.root && !filename.startsWith(`${scene.root}${path.sep}`)) { res.writeHead(403); res.end(); return; }
      const stat = await fsp.stat(filename).catch(() => null);
      if (!stat?.isFile()) { res.writeHead(404); res.end(); return; }
      if (path.resolve(filename) === path.resolve(scene.root, scene.htmlName)) {
        const source = await fsp.readFile(filename, 'utf8');
        const body = injectPayload(source, scene.payload);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        if (req.method === 'HEAD') res.end(); else res.end(body);
        return;
      }
      res.writeHead(200, { 'content-type': contentType(filename), 'cache-control': 'public, max-age=31536000, immutable' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(filename).pipe(res);
      return;
    }
    res.writeHead(404); res.end();
  })().catch(error => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(error?.stack || error));
  });
});

async function shutdown() {
  if (stopping) return;
  stopping = true;
  await fsp.rm(portFile, { force: true }).catch(() => {});
  await new Promise(resolve => server.close(resolve));
  if (browser) await browser.close().catch(() => {});
}

async function main() {
  await fsp.rm(portFile, { force: true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  apiPrefix = `/${token}`;
  const args = ['--allow-file-access-from-files'];
  if (process.env.CI) args.push('--no-sandbox', '--disable-setuid-sandbox');
  const launch0 = performance.now();
  browser = await puppeteer.launch({ headless: true, protocolTimeout: 600_000, args });
  chromeLaunchMs = performance.now() - launch0;
  for (let i = 0; i < concurrency; i += 1) availablePages.push(await browser.newPage());
  await atomicJson(portFile, { schema: 'framewright-webcodecs-pool-v1', url: `${origin}${apiPrefix}`, pid: process.pid, concurrency, chromeLaunchMs: +chromeLaunchMs.toFixed(3) });
  console.log(JSON.stringify({ ready: true, url: `${origin}${apiPrefix}`, pid: process.pid, concurrency, chromeLaunchMs: +chromeLaunchMs.toFixed(3) }));
  await new Promise(resolve => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
  await shutdown();
}

main().catch(async error => {
  console.error(error?.stack || error);
  await shutdown().catch(() => {});
  process.exitCode = 1;
});
