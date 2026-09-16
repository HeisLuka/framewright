#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createCanvas, Image } from '@napi-rs/canvas';

const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-v0/index.html');
const payloadPath = path.resolve(process.env.PAYLOAD || 'examples/book-ad-v0/payload.example.json');
const outPath = path.resolve(process.argv[2] || 'artifacts/e06/node-canvas.mp4');
const seed = +(process.argv[3] || 7);
const width = +(process.argv[4] || 1080);
const preset = process.env.PRESET || 'veryfast';
const crf = process.env.CRF || '22';
const reportPath = process.env.REPORT ? path.resolve(process.env.REPORT) : null;

const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!match) throw new Error(`No inline <script> found in ${htmlPath}`);
const source = match[1];
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const templateDir = path.dirname(htmlPath);
if (payload.cover_url && !/^[a-z]+:/i.test(payload.cover_url) && !path.isAbsolute(payload.cover_url)) {
  payload.cover_url = path.resolve(templateDir, payload.cover_url);
}

const mainCanvas = createCanvas(width, Math.round(width * 16 / 9));
const document = {
  createElement(name) {
    if (String(name).toLowerCase() !== 'canvas') throw new Error(`Unsupported element ${name}`);
    return createCanvas(1, 1);
  },
  getElementById(id) {
    if (id !== 'c') return null;
    return mainCanvas;
  }
};
const window = { FRAMEWRIGHT_PAYLOAD: payload };
const sandbox = {
  window,
  document,
  Image,
  URLSearchParams,
  location: { search: `?f=0&w=${width}&s=${seed}` },
  console,
  performance,
  setTimeout,
  clearTimeout,
  requestAnimationFrame() { return 0; }
};
sandbox.globalThis = sandbox;
window.window = window;
window.document = document;
window.location = sandbox.location;

const context = vm.createContext(sandbox);
vm.runInContext(source, context, { filename: htmlPath });

const bootDeadline = performance.now() + 10000;
while (!window.__ready && performance.now() < bootDeadline) {
  await new Promise(r => setTimeout(r, 10));
}
if (!window.__ready) throw new Error('Template boot timeout');
if (window.__bootError) throw new Error(window.__bootError);

vm.runInContext(`globalThis.__renderRaw = (n,w,s) => {
  renderFrame(n,w,s,MAIN);
  return MAIN.getContext('2d').getImageData(0,0,MAIN.width,MAIN.height).data;
};`, context);

const total = window.RISO.total;
const fps = window.RISO.fps;
const height = mainCanvas.height;
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const ff = spawn('ffmpeg', [
  '-hide_banner','-loglevel','error','-y',
  '-f','rawvideo','-pix_fmt','rgba','-s',`${width}x${height}`,'-r',String(fps),'-i','-',
  '-c:v','libx264','-preset',preset,'-crf',String(crf),'-maxrate','14M','-bufsize','28M',
  '-pix_fmt','yuv420p','-movflags','+faststart',outPath
], { stdio: ['pipe','ignore','pipe'] });
let ffErr = '';
ff.stderr.on('data', d => { ffErr += d.toString(); });

const stage = { renderMs: [], writeWaitMs: [] };
const t0 = performance.now();
for (let i = 0; i < total; i++) {
  const a = performance.now();
  const rgba = context.__renderRaw(i, width, seed);
  const b = performance.now();
  stage.renderMs.push(b - a);
  const buf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const w0 = performance.now();
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  stage.writeWaitMs.push(performance.now() - w0);
  if ((i + 1) % 60 === 0) console.log(`${i + 1}/${total}`);
}
ff.stdin.end();
await new Promise((resolve, reject) => {
  ff.on('error', reject);
  ff.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${ffErr}`)));
});
const totalMs = performance.now() - t0;

function stats(xs) {
  const ys = [...xs].sort((a,b) => a-b);
  const q = p => ys[Math.min(ys.length - 1, Math.floor((ys.length - 1) * p))] || 0;
  return {
    mean: +(ys.reduce((a,b)=>a+b,0) / Math.max(1, ys.length)).toFixed(3),
    p50: +q(.50).toFixed(3),
    p95: +q(.95).toFixed(3),
    max: +(ys.at(-1) || 0).toFixed(3)
  };
}
const report = {
  renderer: '@napi-rs/canvas',
  width,
  height,
  fps,
  totalFrames: total,
  preset,
  crf: +crf,
  totalMs: +totalMs.toFixed(3),
  outputBytes: fs.statSync(outPath).size,
  throughputFps: +(total / (totalMs / 1000)).toFixed(3),
  stages: { renderMs: stats(stage.renderMs), writeWaitMs: stats(stage.writeWaitMs) }
};
if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
