#!/usr/bin/env node
// Render every frame to PNG using parallel browser tabs.
//   node render.mjs [dir=frames] [seed=7] [width=1920] [tabs=5]
// Env: HTML=path/to/index.html, AR=9:16, START=0 END=120, RESUME=1,
//      FW_QUERY='key=value&...', METRICS_OUT=path/to/metrics.json
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const [,, dir = 'frames', seedS = '7', widthS = '1920', tabsS = '5'] = process.argv;
const seed = +seedS, width = +widthS, tabs = Math.max(1, +tabsS);
const html = path.resolve(process.env.HTML || 'index.html');
const metricsOut = process.env.METRICS_OUT ? path.resolve(process.env.METRICS_OUT) : null;
if (!fs.existsSync(html)) { console.error(`no such file: ${html} (set HTML=path)`); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });

function buildUrl() {
  const url = new URL('file://' + html);
  url.searchParams.set('f', '0');
  url.searchParams.set('w', '320');
  url.searchParams.set('s', String(seed));
  if (process.env.AR) url.searchParams.set('ar', process.env.AR);
  for (const [key, value] of new URLSearchParams(process.env.FW_QUERY || '')) {
    url.searchParams.set(key, value);
  }
  return url.href;
}
const url = buildUrl();

const b = await puppeteer.launch({ headless: true, protocolTimeout: 600000, args: ['--allow-file-access-from-files'] });
const p0 = await b.newPage();
await p0.goto(url, { waitUntil: 'load', timeout: 120000 });
await p0.waitForFunction('window.__ready===true', { timeout: 120000 });
const info = await p0.evaluate(() => ({
  total: window.RISO.total,
  fps: window.RISO.fps ?? 30,
  plates: window.RISO.plates,
}));
await p0.close();
const total = info.total;
const fps = Number(info.fps) || 30;
const plates = info.plates;
const START = +(process.env.START || 0), END = Math.min(total, +(process.env.END || total));
const count = END - START;
console.log(`frames ${total} (${(total / fps).toFixed(1)} s), rendering ${START}..${END - 1}, tabs ${tabs}, width ${width}, seed ${seed}`);
console.log(plates.map(p => `${p.name}:${p.len}`).join('  '));

let next = START, done = 0, failed = 0, frameFileBytes = 0; const t0 = Date.now();
async function worker() {
  const p = await b.newPage();
  p.on('pageerror', e => console.error('PAGE ERROR', e.message));
  await p.goto(url, { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction('window.__ready===true', { timeout: 120000 });
  while (true) {
    const n = next++; if (n >= END) break;
    const out = path.join(dir, `f${String(n).padStart(5, '0')}.png`);
    if (process.env.RESUME && fs.existsSync(out)) {
      done++;
      frameFileBytes += fs.statSync(out).size;
      continue;
    }
    try {
      const u = await p.evaluate((n, w, s) => window.RISO.frame(n, w, s), n, width, seed);
      const bytes = Buffer.from(u.split(',')[1], 'base64');
      fs.writeFileSync(out, bytes);
      frameFileBytes += bytes.length;
    } catch (e) { failed++; console.error('frame', n, 'failed:', e.message); }
    done++;
    if (done % 60 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`${done}/${count}  ${el.toFixed(1)} s  ${(done / Math.max(el, 1e-9)).toFixed(1)} fps  ~${(el / done * (count - done)).toFixed(0)} s left`);
    }
  }
  await p.close();
}
await Promise.all(Array.from({ length: tabs }, worker));
await b.close();
const elapsedSeconds = (Date.now() - t0) / 1000;
const metrics = {
  renderer: 'png-dataurl-v0',
  html,
  outputDirectory: path.resolve(dir),
  seed,
  width,
  fps,
  tabs,
  start: START,
  end: END,
  frames: count,
  successfulFrames: done - failed,
  failedFrames: failed,
  seconds: elapsedSeconds,
  framesPerSecond: (done - failed) / Math.max(elapsedSeconds, 1e-9),
  frameFileBytes,
};
console.log(JSON.stringify(metrics, null, 2));
if (metricsOut) {
  fs.mkdirSync(path.dirname(metricsOut), { recursive: true });
  fs.writeFileSync(metricsOut, `${JSON.stringify(metrics, null, 2)}\n`);
}
if (failed) process.exit(1);
