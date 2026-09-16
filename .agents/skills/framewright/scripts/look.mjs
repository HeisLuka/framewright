#!/usr/bin/env node
// Frame viewer for a framewright project.
//   node look.mjs shot <frame[,frame...]> [width=1200] [seed=7] [out]
//   node look.mjs sheet [n=24] [cellWidth=480] [seed=7] [out]
//   node look.mjs info
// Env: HTML=path/to/index.html, PAYLOAD=path/to/payload.json,
//      AR=9:16 (aspect override), OUT_DIR=shots
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const [,, mode = 'shot', ...rest] = process.argv;
const html = path.resolve(process.env.HTML || 'index.html');
const payloadPath = process.env.PAYLOAD ? path.resolve(process.env.PAYLOAD) : null;
const outDir = process.env.OUT_DIR || 'shots';
if (!fs.existsSync(html)) { console.error(`no such file: ${html} (set HTML=path)`); process.exit(1); }
let injectedPayload = null;
if (payloadPath) {
  if (!fs.existsSync(payloadPath)) { console.error(`no such payload: ${payloadPath}`); process.exit(1); }
  try { injectedPayload = JSON.parse(fs.readFileSync(payloadPath, 'utf8')); }
  catch (e) { console.error(`bad payload JSON: ${e.message}`); process.exit(1); }
}

const browserArgs = ['--allow-file-access-from-files'];
if (process.env.CI) browserArgs.push('--no-sandbox', '--disable-setuid-sandbox');
const b = await puppeteer.launch({ headless: true, protocolTimeout: 600000, args: browserArgs });
const p = await b.newPage();
p.on('pageerror', e => console.error('PAGE ERROR', e.message));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('CONSOLE', m.text()); });
if (injectedPayload !== null) await p.evaluateOnNewDocument(v => { window.FRAMEWRIGHT_PAYLOAD = v; }, injectedPayload);

async function open(seed) {
  const url = 'file://' + html + `?f=0&w=320&s=${seed}` + (process.env.AR ? `&ar=${process.env.AR}` : '');
  await p.goto(url, { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction('window.__ready===true', { timeout: 120000 });
  const bootError = await p.evaluate(() => window.__bootError || null);
  if (bootError) throw new Error(bootError);
}
function save(dataUrl, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('saved', out);
}

try {
  if (mode === 'shot') {
    const frames = String(rest[0] ?? '0').split(',').map(Number);
    const width = +(rest[1] ?? 1200), seed = +(rest[2] ?? 7), out = rest[3];
    await open(seed);
    for (const f of frames) {
      const t0 = Date.now();
      const u = await p.evaluate((f, w, s) => window.RISO.frame(f, w, s), f, width, seed);
      save(u, out ?? path.join(outDir, `f${String(f).padStart(4, '0')}.png`));
      console.log('  ms', Date.now() - t0);
    }
  } else if (mode === 'sheet') {
    const n = +(rest[0] ?? 24), cw = +(rest[1] ?? 480), seed = +(rest[2] ?? 7);
    const out = rest[3] ?? path.join(outDir, 'sheet.png');
    await open(seed);
    const t0 = Date.now();
    const u = await p.evaluate((n, cw) => window.RISO.contact(n, cw), n, cw);
    save(u, out);
    console.log('  ms', Date.now() - t0);
  } else if (mode === 'info') {
    await open(7);
    const info = await p.evaluate(() => ({ total: window.RISO.total, fps: window.RISO.fps ?? 30, plates: window.RISO.plates, payload: window.RISO.payload ?? null }));
    info.seconds = +(info.total / info.fps).toFixed(2);
    if (payloadPath) info.payloadPath = payloadPath;
    console.log(JSON.stringify(info, null, 2));
  } else {
    console.error('usage: look.mjs shot|sheet|info ...');
  }
} finally {
  await b.close();
}
