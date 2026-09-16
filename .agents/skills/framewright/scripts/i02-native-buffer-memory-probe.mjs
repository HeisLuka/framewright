#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createCanvas, Image, GlobalFonts} from '@napi-rs/canvas';
import {VideoFrame} from '@napi-rs/webcodecs';

const mode = process.env.MODE || 'image-data-frame';
const allowed = new Set(['render-only','canvas-data-only','image-data-only','canvas-data-frame','image-data-frame']);
if (!allowed.has(mode)) throw new Error(`unknown MODE=${mode}`);
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18-for-i02.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-i02/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/i02-buffer-memory');
const selector = {bookId: process.env.BOOK_ID || 'river-station', variant: process.env.VARIANT || 'hook-first', profile: process.env.PROFILE || 'vertical'};
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
  const m = fs.readFileSync('/proc/self/status', 'utf8').match(/^VmRSS:\s+(\d+)\s+kB/m);
  return m ? Number(m[1]) * 1024 : process.memoryUsage().rss;
}
const mb = (n) => +(n / 1048576).toFixed(2);
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
  return {ctx, window};
}

const t0 = performance.now();
const {ctx, window} = await nodeContext();
const total = Number(window.RISO.total), fps = Number(window.RISO.fps);
let peak = rssBytes();
const checkpoints = [{frame:-1, rssMiB:mb(peak)}];
let touchedBytes = 0;
for (let frame = 0; frame < total; frame += 1) {
  const canvas = ctx.__render(frame, entry.width, entry.seed);
  if (mode === 'canvas-data-only') {
    const raw = canvas.data();
    touchedBytes += raw.byteLength;
  } else if (mode === 'image-data-only') {
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    touchedBytes += rgba.byteLength;
  } else if (mode === 'canvas-data-frame') {
    const raw = canvas.data();
    touchedBytes += raw.byteLength;
    const vf = new VideoFrame(raw, {format:'RGBA', codedWidth:canvas.width, codedHeight:canvas.height, timestamp:Math.trunc(frame * 1_000_000 / fps), duration:Math.trunc(1_000_000 / fps)});
    vf.close();
  } else if (mode === 'image-data-frame') {
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    touchedBytes += rgba.byteLength;
    const vf = new VideoFrame(rgba, {format:'RGBA', codedWidth:canvas.width, codedHeight:canvas.height, timestamp:Math.trunc(frame * 1_000_000 / fps), duration:Math.trunc(1_000_000 / fps)});
    vf.close();
  }
  if (frame % 30 === 29 || frame === total - 1) {
    global.gc?.();
    const rss = rssBytes(); peak = Math.max(peak, rss);
    checkpoints.push({frame, rssMiB:mb(rss)});
  } else peak = Math.max(peak, rssBytes());
}
global.gc?.();
const end = rssBytes(); peak = Math.max(peak, end);
const startMiB = checkpoints[0].rssMiB, endMiB = mb(end), growth = +(endMiB - startMiB).toFixed(2);
const result = {
  schema:'framewright-i02-native-buffer-memory-probe-v1', mode, fixture:entry.id, dimensions:`${entry.width}x${entry.height}`, frames:total, fps,
  wallMs:+(performance.now()-t0).toFixed(2), touchedBytes, startRssMiB:startMiB, endRssMiB:endMiB, peakRssMiB:mb(peak),
  growthMiB:growth, growthMiBPerFrame:+(growth/total).toFixed(4), checkpoints,
};
await fsp.writeFile(path.join(outDir, `${mode}.json`), `${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify(result));
