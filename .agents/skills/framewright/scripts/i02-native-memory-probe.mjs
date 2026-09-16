#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas, Image, GlobalFonts} from '@napi-rs/canvas';
import {VideoEncoder, VideoFrame} from '@napi-rs/webcodecs';

const root = process.cwd();
const mode = process.env.MODE || 'frame-only';
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18-for-i02.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-i02/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/i02-memory');
const bitrate = Number(process.env.BITRATE || 2_000_000);
const queueLimit = Number(process.env.QUEUE || 8);
const selector = {bookId: process.env.BOOK_ID || 'river-station', variant: process.env.VARIANT || 'hook-first', profile: process.env.PROFILE || 'vertical'};
if (!['frame-only', 'encode-drop', 'encode-copy', 'encode-retain'].includes(mode)) throw new Error(`unknown MODE=${mode}`);

for (const [file, family] of [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'DejaVu Sans'],
]) GlobalFonts.registerFromPath(file, family);
await fsp.mkdir(outDir, {recursive: true});
const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const entry = manifest.items.find((x) => x.bookId === selector.bookId && x.variant === selector.variant && x.profile === selector.profile);
if (!entry) throw new Error(`fixture not found ${JSON.stringify(selector)}`);
const payload = JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath), entry.payloadFile), 'utf8'));
if (payload.cover_url && !/^[a-z]+:/i.test(payload.cover_url) && !path.isAbsolute(payload.cover_url)) payload.cover_url = path.resolve(path.dirname(htmlPath), payload.cover_url);
const html = await fsp.readFile(htmlPath, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!scriptMatch) throw new Error('inline scene script not found');

function rssBytes() {
  try {
    const m = fs.readFileSync('/proc/self/status', 'utf8').match(/^VmRSS:\s+(\d+)\s+kB/m);
    return m ? Number(m[1]) * 1024 : process.memoryUsage().rss;
  } catch { return process.memoryUsage().rss; }
}
function mb(n) { return +(n / 1048576).toFixed(2); }
async function nodeContext() {
  const canvas = createCanvas(entry.width, entry.height);
  const document = {
    createElement(name) { if (String(name).toLowerCase() !== 'canvas') throw new Error(`unsupported ${name}`); return createCanvas(1, 1); },
    getElementById(id) { return id === 'c' ? canvas : null; },
  };
  const window = {FRAMEWRIGHT_PAYLOAD: structuredClone(payload)};
  const location = {search: `?f=0&w=${entry.width}&h=${entry.height}&s=${entry.seed}&profile=${entry.profile}`};
  const sandbox = {window, document, Image, URLSearchParams, location, console, performance, setTimeout, clearTimeout, requestAnimationFrame() { return 0; }};
  sandbox.globalThis = sandbox; window.window = window; window.document = document; window.location = location;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1], ctx, {filename: htmlPath});
  const deadline = performance.now() + 10_000;
  while (!window.__ready && performance.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  if (!window.__ready || window.__bootError) throw new Error(window.__bootError || 'scene boot timeout');
  vm.runInContext(`globalThis.__render=(n,w,s)=>{renderFrame(n,w,s,document.getElementById('c'));return document.getElementById('c');};`, ctx);
  return {ctx, window, canvas};
}
async function waitQueue(encoder) {
  while (encoder.encodeQueueSize > queueLimit) await new Promise((r) => setTimeout(r, 1));
}

const start = performance.now();
const {ctx, window, canvas} = await nodeContext();
const total = Number(window.RISO.total), fps = Number(window.RISO.fps);
const checkpoints = [{frame: -1, rssMiB: mb(rssBytes())}];
let peak = rssBytes();
let encodedBytes = 0;
const retained = [];
const copied = [];
let encoder = null, encodeError = null, maxQueue = 0;
if (mode !== 'frame-only') {
  encoder = new VideoEncoder({
    output(chunk, metadata) {
      encodedBytes += chunk.byteLength;
      if (mode === 'encode-retain') retained.push({chunk, metadata});
      if (mode === 'encode-copy') {
        const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
        copied.push({bytes, type: chunk.type, timestamp: chunk.timestamp, duration: chunk.duration ?? null, descriptionBytes: metadata?.decoderConfig?.description?.byteLength || 0});
      }
    },
    error(error) { encodeError = error; },
  });
  encoder.configure({codec: 'avc1.420028', width: canvas.width, height: canvas.height, bitrate, framerate: fps, latencyMode: 'realtime', hardwareAcceleration: 'prefer-software'});
}
for (let frame = 0; frame < total; frame += 1) {
  const rendered = ctx.__render(frame, entry.width, entry.seed);
  const vf = new VideoFrame(rendered, {timestamp: Math.trunc(frame * 1_000_000 / fps), duration: Math.trunc(1_000_000 / fps)});
  if (encoder) {
    encoder.encode(vf, {keyFrame: frame === 0 || frame % Math.max(1, Math.round(fps * 2)) === 0});
    maxQueue = Math.max(maxQueue, encoder.encodeQueueSize);
  }
  vf.close();
  if (encoder) await waitQueue(encoder);
  if (encodeError) throw encodeError;
  if (frame % 30 === 29 || frame === total - 1) {
    global.gc?.();
    const rss = rssBytes(); peak = Math.max(peak, rss);
    checkpoints.push({frame, rssMiB: mb(rss)});
  } else {
    peak = Math.max(peak, rssBytes());
  }
}
if (encoder) {
  await encoder.flush();
  if (encodeError) throw encodeError;
  encoder.close();
}
global.gc?.();
const endRss = rssBytes(); peak = Math.max(peak, endRss);
const first = checkpoints[0].rssMiB, last = mb(endRss);
const result = {
  schema: 'framewright-i02-native-memory-probe-v1', mode,
  fixture: entry.id, dimensions: `${entry.width}x${entry.height}`, frames: total, fps,
  wallMs: +(performance.now() - start).toFixed(2), encodedBytes,
  retainedChunks: retained.length, copiedChunks: copied.length, maxEncodeQueue: maxQueue,
  startRssMiB: first, endRssMiB: last, peakRssMiB: mb(peak), growthMiB: +(last - first).toFixed(2), growthMiBPerFrame: +((last - first) / total).toFixed(4),
  checkpoints,
};
await fsp.writeFile(path.join(outDir, `${mode}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
