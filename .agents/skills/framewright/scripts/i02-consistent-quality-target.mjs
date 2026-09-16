#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createCanvas, Image, GlobalFonts } from '@napi-rs/canvas';
import puppeteer from 'puppeteer';

const root = process.cwd();
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18-for-i02.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-i02/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/i02');
const reportPath = path.join(outDir, 'quality-calibration.json');
const summaryPath = path.join(outDir, 'quality-calibration.md');
const selector = {
  bookId: process.env.BOOK_ID || 'river-station',
  variant: process.env.VARIANT || 'hook-first',
  profile: process.env.PROFILE || 'vertical',
};

for (const [file, family] of [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'DejaVu Sans'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'DejaVu Sans'],
]) {
  if (!GlobalFonts.registerFromPath(file, family)) throw new Error(`failed to register font ${file}`);
}
for (const file of [htmlPath, manifestPath]) if (!fs.existsSync(file)) throw new Error(`missing ${file}`);

const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const entry = manifest.items.find((x) => x.bookId === selector.bookId && x.variant === selector.variant && x.profile === selector.profile);
if (!entry) throw new Error(`fixture not found: ${JSON.stringify(selector)}`);
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
async function metric(kind, reference, encoded) {
  const filter = kind === 'ssim' ? '[0:v][1:v]ssim' : '[0:v][1:v]psnr';
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-i', reference, '-i', encoded, '-lavfi', filter, '-f', 'null', '-']);
  const re = kind === 'ssim' ? /All:([0-9.]+)/g : /average:([0-9.]+)/g;
  const m = [...stderr.matchAll(re)].at(-1);
  return m ? Number(m[1]) : null;
}
async function extractFrame(video, frame, output) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vf', `select=eq(n\\,${frame})`, '-vsync', '0', '-frames:v', '1', output]);
}
function summarize(rows) {
  const ssims = rows.map((x) => x.ssim).filter(Number.isFinite);
  const psnrs = rows.map((x) => x.psnr).filter(Number.isFinite);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    samples: rows.length,
    ssimMean: +mean(ssims).toFixed(6),
    ssimWorst: +Math.min(...ssims).toFixed(6),
    psnrMean: +mean(psnrs).toFixed(4),
    psnrWorst: +Math.min(...psnrs).toFixed(4),
  };
}
function semanticFrames(plates) {
  const frames = [];
  let start = 0;
  for (const plate of plates) {
    const len = Number(plate.len);
    for (const t of [0.15, 0.5, 0.85]) frames.push(Math.min(start + len - 1, start + Math.round((len - 1) * t)));
    start += len;
  }
  return [...new Set(frames)].sort((a, b) => a - b);
}
async function nodeContext() {
  const canvas = createCanvas(entry.width, entry.height);
  const document = {
    createElement(name) { if (String(name).toLowerCase() !== 'canvas') throw new Error(`unsupported element ${name}`); return createCanvas(1, 1); },
    getElementById(id) { return id === 'c' ? canvas : null; },
  };
  const window = { FRAMEWRIGHT_PAYLOAD: nodePayload };
  const location = { search: `?f=0&w=${entry.width}&h=${entry.height}&s=${entry.seed}&profile=${entry.profile}` };
  const sandbox = { window, document, Image, URLSearchParams, location, console, performance, setTimeout, clearTimeout, requestAnimationFrame() { return 0; } };
  sandbox.globalThis = sandbox; window.window = window; window.document = document; window.location = location;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(sceneSource, ctx, { filename: htmlPath });
  const deadline = Date.now() + 10_000;
  while (!window.__ready && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  if (!window.__ready) throw new Error('node scene boot timeout');
  if (window.__bootError) throw new Error(window.__bootError);
  vm.runInContext(`globalThis.__i02Render=(n,w,s)=>{renderFrame(n,w,s,document.getElementById('c'));return document.getElementById('c');};`, ctx);
  return { ctx, window };
}
function contentType(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': case '.mjs': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

const refDir = path.join(outDir, 'consistent-quality-reference');
const decodedDir = path.join(outDir, 'consistent-quality-decoded');
await fsp.mkdir(refDir, { recursive: true });
await fsp.mkdir(decodedDir, { recursive: true });
const node = await nodeContext();
const plates = Array.from(node.window.RISO?.plates || []).map((p) => ({ name: p.name, len: Number(p.len) }));
if (!plates.length) throw new Error('scene plates unavailable');
const frames = semanticFrames(plates);

for (const frame of frames) {
  const canvas = node.ctx.__i02Render(frame, entry.width, entry.seed);
  await fsp.writeFile(path.join(refDir, `node-${frame}.png`), canvas.toBuffer('image/png'));
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const u = new URL(req.url || '/', 'http://127.0.0.1');
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
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
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
    await fsp.writeFile(path.join(refDir, `browser-${frame}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  await new Promise((resolve) => server.close(resolve));
}

const backends = [
  { id: 'webcodecs-2mbps', video: path.join(outDir, 'web-1.mp4'), refPrefix: 'browser' },
  { id: 'x264-fixed-2mbps', video: path.join(outDir, 'node-fixed-1.mp4'), refPrefix: 'node' },
  { id: 'x264-crf22', video: path.join(outDir, 'node-crf-1.mp4'), refPrefix: 'node' },
];
const result = { schema: 'framewright-i02-consistent-quality-v1', frames, plates, fixture: { ...selector, id: entry.id }, backends: {} };
for (const backend of backends) {
  if (!fs.existsSync(backend.video)) throw new Error(`missing ${backend.video}`);
  const rows = [];
  for (const frame of frames) {
    const decoded = path.join(decodedDir, `${backend.id}-${frame}.png`);
    await extractFrame(backend.video, frame, decoded);
    const reference = path.join(refDir, `${backend.refPrefix}-${frame}.png`);
    rows.push({ frame, ssim: await metric('ssim', reference, decoded), psnr: await metric('psnr', reference, decoded) });
  }
  result.backends[backend.id] = { summary: summarize(rows), samples: rows };
}
await fsp.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
const lines = [
  '# I02 codec quality — identical semantic frames', '',
  `Frames: ${frames.join(', ')}. Each plate contributes samples at 15%, 50%, 85%.`, '',
  '| backend | samples | mean SSIM | worst SSIM | mean PSNR | worst PSNR |',
  '|---|---:|---:|---:|---:|---:|',
];
for (const [id, value] of Object.entries(result.backends)) {
  const s = value.summary;
  lines.push(`| ${id} | ${s.samples} | ${s.ssimMean} | ${s.ssimWorst} | ${s.psnrMean} dB | ${s.psnrWorst} dB |`);
}
lines.push('', 'This file intentionally replaces the earlier four-frame calibration so the subsequent WebCodecs matrix and x264 target use exactly the same semantic sample positions.');
const markdown = `${lines.join('\n')}\n`;
await fsp.writeFile(summaryPath, markdown);
console.log(markdown);
