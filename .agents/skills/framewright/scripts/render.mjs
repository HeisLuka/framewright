#!/usr/bin/env node
// Render every frame to PNG using parallel browser tabs.
//   node render.mjs [dir=frames] [seed=7] [width=1920] [tabs=5]
// Env: HTML=path/to/index.html, PAYLOAD=path/to/payload.json, AR=9:16,
//      START=0 END=120 (frame range), RESUME=1 (skip existing files)
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const [,, dir = 'frames', seedS = '7', widthS = '1920', tabsS = '5'] = process.argv;
const seed = +seedS, width = +widthS, tabs = Math.max(1, +tabsS);
const html = path.resolve(process.env.HTML || 'index.html');
const payloadPath = process.env.PAYLOAD ? path.resolve(process.env.PAYLOAD) : null;
if (!fs.existsSync(html)) { console.error(`no such file: ${html} (set HTML=path)`); process.exit(1); }
let injectedPayload = null;
if (payloadPath) {
  if (!fs.existsSync(payloadPath)) { console.error(`no such payload: ${payloadPath}`); process.exit(1); }
  try { injectedPayload = JSON.parse(fs.readFileSync(payloadPath, 'utf8')); }
  catch (e) { console.error(`bad payload JSON: ${e.message}`); process.exit(1); }
}
fs.mkdirSync(dir, { recursive: true });
const url = 'file://' + html + `?f=0&w=320&s=${seed}` + (process.env.AR ? `&ar=${process.env.AR}` : '');

const browserArgs = ['--allow-file-access-from-files'];
if (process.env.CI) browserArgs.push('--no-sandbox', '--disable-setuid-sandbox');
const b = await puppeteer.launch({ headless: true, protocolTimeout: 600000, args: browserArgs });
async function preparedPage() {
  const p = await b.newPage();
  p.on('pageerror', e => console.error('PAGE ERROR', e.message));
  if (injectedPayload !== null) await p.evaluateOnNewDocument(v => { window.FRAMEWRIGHT_PAYLOAD = v; }, injectedPayload);
  return p;
}
async function loadPage() {
  const p = await preparedPage();
  await p.goto(url, { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction('window.__ready===true', { timeout: 120000 });
  const bootError = await p.evaluate(() => window.__bootError || null);
  if (bootError) throw new Error(bootError);
  return p;
}

const p0 = await loadPage();
const meta = await p0.evaluate(() => ({ total: window.RISO.total, fps: window.RISO.fps ?? 30, plates: window.RISO.plates }));
await p0.close();
const START = +(process.env.START || 0), END = Math.min(meta.total, +(process.env.END || meta.total));
const count = END - START;
console.log(`frames ${meta.total} (${(meta.total / meta.fps).toFixed(1)} s), rendering ${START}..${END - 1}, tabs ${tabs}, width ${width}, seed ${seed}${payloadPath ? `, payload ${payloadPath}` : ''}`);
console.log(meta.plates.map(p => `${p.name}:${p.len}`).join('  '));

let next = START, done = 0, failed = 0; const t0 = Date.now();
async function worker() {
  const p = await loadPage();
  while (true) {
    const n = next++; if (n >= END) break;
    const out = path.join(dir, `f${String(n).padStart(5, '0')}.png`);
    if (process.env.RESUME && fs.existsSync(out)) { done++; continue; }
    try {
      const u = await p.evaluate((n, w, s) => window.RISO.frame(n, w, s), n, width, seed);
      fs.writeFileSync(out, Buffer.from(u.split(',')[1], 'base64'));
    } catch (e) { failed++; console.error('frame', n, 'failed:', e.message); }
    done++;
    if (done % 60 === 0) { const el = (Date.now() - t0) / 1000; console.log(`${done}/${count}  ${el.toFixed(0)} s, ~${(el / done * (count - done)).toFixed(0)} s left`); }
  }
  await p.close();
}
await Promise.all(Array.from({ length: tabs }, worker));
await b.close();
console.log(`done: ${done - failed} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
