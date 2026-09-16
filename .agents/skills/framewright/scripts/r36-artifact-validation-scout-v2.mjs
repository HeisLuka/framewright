#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';

const root = process.cwd();
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18-for-r36.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-r36/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/r36');
const audioPath = path.resolve(process.env.AUDIO || path.join(outDir, 'track.m4a'));
const reportPath = path.resolve(process.env.REPORT || path.join(outDir, 'report.json'));
const bitrate = Number(process.env.BITRATE || 3_000_000);
const queueLimit = Math.max(1, Math.min(32, Math.trunc(Number(process.env.WEBCODECS_QUEUE || 8))));
const concurrency = 2;
const jobsPerScenario = 36;

await fsp.mkdir(outDir, { recursive: true });
for (const file of [htmlPath, manifestPath, audioPath]) if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const entries = manifest.items || [];
if (entries.length !== 36) throw new Error(`expected 36 C18 fixtures, got ${entries.length}`);
for (const entry of entries) entry.payload = JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath), entry.payloadFile), 'utf8'));
const html = await fsp.readFile(htmlPath, 'utf8');
const uploads = new Map();

function sha256Buffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function contentType(filename) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

function annexBNals(buffer) {
  const starts = [];
  for (let i = 0; i + 3 < buffer.length; i += 1) {
    if (buffer[i] !== 0 || buffer[i + 1] !== 0) continue;
    if (buffer[i + 2] === 1) { starts.push({ at: i, len: 3 }); i += 2; continue; }
    if (buffer[i + 2] === 0 && buffer[i + 3] === 1) { starts.push({ at: i, len: 4 }); i += 3; }
  }
  const out = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i].at + starts[i].len;
    const end = i + 1 < starts.length ? starts[i + 1].at : buffer.length;
    if (end <= start) continue;
    let nal = buffer.subarray(start, end);
    while (nal.length && nal[nal.length - 1] === 0) nal = nal.subarray(0, nal.length - 1);
    if (!nal.length) continue;
    out.push({ type: nal[0] & 0x1f, data: nal });
  }
  return out;
}
function normalizedH264Digest(buffer) {
  const nals = annexBNals(buffer);
  const excludedTypes = new Set([7, 8, 9]); // SPS/PPS/AUD may be moved between samples and avcC by MP4 muxing.
  const kept = nals.filter((n) => !excludedTypes.has(n.type));
  const hash = crypto.createHash('sha256');
  const types = {};
  for (const n of nals) types[n.type] = (types[n.type] || 0) + 1;
  for (const n of kept) {
    const len = Buffer.allocUnsafe(4); len.writeUInt32BE(n.data.length);
    hash.update(Buffer.from([n.type])); hash.update(len); hash.update(n.data);
  }
  return { sha256: hash.digest('hex'), totalNals: nals.length, keptNals: kept.length, types };
}

const uploadPrefix = '/__r36_h264/';
const scenePath = '/examples/book-ad-systems/__r36_scene.html';
const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname.startsWith(uploadPrefix)) {
    const id = decodeURIComponent(u.pathname.slice(uploadPrefix.length));
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => { uploads.set(id, Buffer.concat(chunks)); res.writeHead(204); res.end(); });
    return;
  }
  if (u.pathname === scenePath) {
    const idx = Number(u.searchParams.get('fixture'));
    const entry = entries[idx];
    if (!entry) { res.writeHead(404); res.end(); return; }
    const injected = html.replace('<script>', `<script>window.FRAMEWRIGHT_PAYLOAD=${JSON.stringify(entry.payload)};<\/script>\n<script>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(injected); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const filename = path.resolve(root, rel || '.');
  if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(filename, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': contentType(filename), 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(filename).pipe(res);
  });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve({ stdout, stderr, code: 0 }) : reject(Object.assign(new Error(`${command} exited ${code ?? signal}\n${stderr.slice(-4000)}`), { stdout, stderr, code })));
  });
}
function runObserved(command, args) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', (error) => resolve({ code: null, stdout, stderr: `${stderr}\n${error}`, ms: performance.now() - t0 }));
    child.once('close', (code) => resolve({ code, stdout, stderr, ms: performance.now() - t0 }));
  });
}
function runHash(command, args) {
  return new Promise((resolve) => {
    const t0 = performance.now(); const hash = crypto.createHash('sha256');
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0, stderr = '';
    child.stdout.on('data', (d) => { hash.update(d); bytes += d.length; }); child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', (error) => resolve({ code: null, sha256: null, bytes, stderr: `${stderr}\n${error}`, ms: performance.now() - t0 }));
    child.once('close', (code) => resolve({ code, sha256: hash.digest('hex'), bytes, stderr, ms: performance.now() - t0 }));
  });
}
function runBuffer(command, args) {
  return new Promise((resolve) => {
    const t0 = performance.now(); const chunks = [];
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', (d) => chunks.push(d)); child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', (error) => resolve({ code: null, buffer: Buffer.concat(chunks), stderr: `${stderr}\n${error}`, ms: performance.now() - t0 }));
    child.once('close', (code) => resolve({ code, buffer: Buffer.concat(chunks), stderr, ms: performance.now() - t0 }));
  });
}
function hashFile(filename) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now(); const hash = crypto.createHash('sha256'); const stream = fs.createReadStream(filename);
    stream.on('data', (d) => hash.update(d)); stream.once('error', reject);
    stream.once('end', () => resolve({ sha256: hash.digest('hex'), ms: performance.now() - t0 }));
  });
}
function cpuUsec() { try { return Number(fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8').match(/^usage_usec\s+(\d+)/m)?.[1] || 0); } catch { return 0; } }

async function launch() { return puppeteer.launch({ headless: true, protocolTimeout: 600_000, args: ['--no-sandbox', '--disable-setuid-sandbox'] }); }
function urlFor(idx) {
  const entry = entries[idx]; const u = new URL(scenePath, origin);
  u.searchParams.set('fixture', idx); u.searchParams.set('f', '0'); u.searchParams.set('w', String(entry.width)); u.searchParams.set('h', String(entry.height)); u.searchParams.set('s', String(entry.seed)); u.searchParams.set('profile', entry.profile);
  return u.href;
}
async function navigate(page, idx) {
  const t0 = performance.now(); await page.goto(urlFor(idx), { waitUntil: 'load', timeout: 120_000 }); await page.waitForFunction('window.__ready===true', { timeout: 120_000 }); return performance.now() - t0;
}

async function encode(page, id, entry) {
  uploads.delete(id);
  const encoded = await page.evaluate(async ({ id, width, seed, bitrate, queueLimit, uploadPrefix }) => {
    const canvas = document.getElementById('c'), runtime = window.RISO;
    const total = Number(runtime.total), fps = Number(runtime.fps || 30);
    window.renderFrame(0, width, seed, canvas);
    const config = { codec: 'avc1.420028', width: canvas.width, height: canvas.height, bitrate, framerate: fps, latencyMode: 'realtime', avc: { format: 'annexb' } };
    const support = await VideoEncoder.isConfigSupported(config); if (!support.supported) throw new Error(`unsupported ${JSON.stringify(config)}`);
    const chunks = []; let bytes = 0, drawMs = 0, maxQueue = 0, outputChunks = 0, firstTimestamp = null, lastTimestamp = null;
    const encoder = new VideoEncoder({ output(chunk) { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push(b); bytes += b.byteLength; outputChunks += 1; if (firstTimestamp === null) firstTimestamp = Number(chunk.timestamp); lastTimestamp = Number(chunk.timestamp); }, error(error) { throw error; } });
    encoder.configure(config); const encode0 = performance.now();
    for (let frame = 0; frame < total; frame += 1) {
      const d0 = performance.now(); window.renderFrame(frame, width, seed, canvas); drawMs += performance.now() - d0;
      const vf = new VideoFrame(canvas, { timestamp: Math.trunc(frame * 1_000_000 / fps) }); encoder.encode(vf, { keyFrame: frame === 0 || frame % Math.max(1, Math.round(fps * 2)) === 0 }); vf.close();
      maxQueue = Math.max(maxQueue, encoder.encodeQueueSize); while (encoder.encodeQueueSize > queueLimit) await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }));
    }
    await encoder.flush(); const encodeMs = performance.now() - encode0; encoder.close();
    const body = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const h0 = performance.now(); const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body)); const browserSha256 = Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join(''); const browserHashMs = performance.now() - h0;
    const u0 = performance.now(); const response = await fetch(`${uploadPrefix}${encodeURIComponent(id)}`, { method: 'POST', body }); if (!response.ok) throw new Error(`upload ${response.status}`);
    return { total, fps, encodeMs, drawMs, uploadMs: performance.now() - u0, browserHashMs, bytes, maxQueue, outputChunks, firstTimestamp, lastTimestamp, browserSha256 };
  }, { id, width: entry.width, seed: entry.seed, bitrate, queueLimit, uploadPrefix });
  const h264 = uploads.get(id); uploads.delete(id); if (!h264?.length) throw new Error(`missing H264 ${id}`);
  const nodeSha256 = sha256Buffer(h264); if (nodeSha256 !== encoded.browserSha256) throw new Error(`browser->node H264 hash mismatch ${id}`);
  if (encoded.outputChunks !== encoded.total) throw new Error(`unexpected WebCodecs chunks ${encoded.outputChunks}/${encoded.total}`);
  return { ...encoded, h264, h264Sha256: nodeSha256, h264Normalized: normalizedH264Digest(h264) };
}

async function normalizedAudioHash(filename) { return runHash('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', filename, '-map', '0:a:0', '-c:a', 'copy', '-f', 'adts', 'pipe:1']); }
async function muxArtifact(id, encoded) {
  const h264Path = path.join(outDir, `${id}.h264`), mp4Path = path.join(outDir, `${id}.mp4`), expectedDuration = encoded.total / encoded.fps;
  await fsp.writeFile(h264Path, encoded.h264); const m0 = performance.now();
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-fflags', '+genpts', '-r', String(encoded.fps), '-i', h264Path, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy', '-t', String(expectedDuration), '-movflags', '+faststart', mp4Path]);
  const muxMs = performance.now() - m0; await fsp.rm(h264Path, { force: true }); return { mp4Path, muxMs, expectedDuration };
}
function parseJson(stdout) { try { return JSON.parse(stdout || '{}'); } catch { return {}; } }
function metadataValid(meta, encoded, expectedDuration, entry) {
  const streams = meta.streams || [], video = streams.find((x) => x.codec_type === 'video'), audio = streams.find((x) => x.codec_type === 'audio'), duration = Number(meta.format?.duration || 0), nbFrames = Number(video?.nb_frames || 0);
  return Boolean(video && audio) && video.codec_name === 'h264' && audio.codec_name === 'aac' && Number(video.width) === Number(entry.width) && Number(video.height) === Number(entry.height) && nbFrames === encoded.total && Math.abs(duration - expectedDuration) <= 0.15;
}

async function legacyValidator(mp4Path, encoded, expectedDuration) {
  const t0 = performance.now();
  const probe = await runObserved('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,duration,nb_frames,nb_read_frames', '-show_entries', 'format=duration,size', '-of', 'json', mp4Path]);
  const meta = parseJson(probe.stdout), video = (meta.streams || []).find((x) => x.codec_type === 'video'), audio = (meta.streams || []).find((x) => x.codec_type === 'audio'), duration = Number(meta.format?.duration || 0), videoFrames = Number(video?.nb_read_frames || 0);
  const valid = probe.code === 0 && videoFrames === encoded.total && Boolean(audio) && Math.abs(duration - expectedDuration) <= 0.15;
  const artifact = await hashFile(mp4Path);
  return { mode: 'legacy-count-frames', valid, ms: performance.now() - t0, probeMs: probe.ms, artifactHashMs: artifact.ms, artifactSha256: artifact.sha256, stderr: probe.stderr, videoFrames, duration };
}
async function strictDecodeValidator(mp4Path) { const r = await runObserved('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', mp4Path, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']); return { valid: r.code === 0 && !r.stderr.trim(), ms: r.ms, stderr: r.stderr, code: r.code }; }
async function packetCountProbe(mp4Path) { const r = await runObserved('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,nb_frames,nb_read_packets', '-of', 'json', mp4Path]); return { validProcess: r.code === 0 && !r.stderr.trim(), ms: r.ms, stderr: r.stderr, meta: parseJson(r.stdout) }; }

async function fastHashValidator(mp4Path, encoded, expectedDuration, entry, expectedAudioHash) {
  const t0 = performance.now();
  const [metaProbe, videoExtract, audioHash, artifact] = await Promise.all([
    runObserved('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,duration,nb_frames', '-show_entries', 'format=duration,size', '-of', 'json', mp4Path]),
    runBuffer('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', mp4Path, '-map', '0:v:0', '-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', 'pipe:1']),
    runHash('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', mp4Path, '-map', '0:a:0', '-c:a', 'copy', '-f', 'adts', 'pipe:1']),
    hashFile(mp4Path),
  ]);
  const meta = parseJson(metaProbe.stdout), finalNorm = normalizedH264Digest(videoExtract.buffer);
  const metaOk = metaProbe.code === 0 && !metaProbe.stderr.trim() && metadataValid(meta, encoded, expectedDuration, entry);
  const videoOk = videoExtract.code === 0 && !videoExtract.stderr.trim() && finalNorm.sha256 === encoded.h264Normalized.sha256;
  const audioOk = audioHash.code === 0 && !audioHash.stderr.trim() && audioHash.sha256 === expectedAudioHash;
  return { mode: 'fast-compressed-hash-v2', valid: metaOk && videoOk && audioOk, ms: performance.now() - t0, metaMs: metaProbe.ms, videoHashMs: videoExtract.ms, audioHashMs: audioHash.ms, artifactHashMs: artifact.ms, artifactSha256: artifact.sha256, metaOk, videoOk, audioOk, sourceH264Normalized: encoded.h264Normalized, finalH264Normalized: finalNorm, metaStderr: metaProbe.stderr, videoStderr: videoExtract.stderr, audioStderr: audioHash.stderr, audioSha256: audioHash.sha256 };
}

async function packetPositions(mp4Path, selector) { const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', selector, '-show_packets', '-show_entries', 'packet=pos,size,flags', '-of', 'json', mp4Path]); return parseJson(stdout).packets || []; }
async function flipPacketPayload(src, out, selector) {
  const packets = (await packetPositions(src, selector)).filter((x) => Number(x.size) >= 96 && Number.isFinite(Number(x.pos))); if (!packets.length) throw new Error(`no packet ${selector}`);
  const packet = packets[Math.floor(packets.length * 0.55)], pos = Number(packet.pos), size = Number(packet.size), bytes = Buffer.from(await fsp.readFile(src)), within = Math.min(size - 16, Math.max(24, Math.floor(size / 2))), offset = pos + within;
  for (let i = 0; i < 8; i += 1) bytes[offset + i] ^= (0x55 + i) & 0xff; await fsp.writeFile(out, bytes); return { packet: { pos, size, flags: packet.flags }, offset };
}
async function buildCorruptionMatrix(good, encoded, expectedDuration, entry, expectedAudioHash) {
  const dir = path.join(outDir, 'corruption'); await fsp.mkdir(dir, { recursive: true }); const cases = [{ id: 'good', path: good.mp4Path, expectedGood: true }]; const source = await fsp.readFile(good.mp4Path);
  const trunc = path.join(dir, 'truncated-tail.mp4'); await fsp.writeFile(trunc, source.subarray(0, Math.max(0, source.length - 4096))); cases.push({ id: 'truncated-tail', path: trunc, expectedGood: false });
  const videoFlip = path.join(dir, 'video-payload-flip.mp4'); cases.push({ id: 'video-payload-flip', path: videoFlip, expectedGood: false, mutation: await flipPacketPayload(good.mp4Path, videoFlip, 'v:0') });
  const audioFlip = path.join(dir, 'audio-payload-flip.mp4'); cases.push({ id: 'audio-payload-flip', path: audioFlip, expectedGood: false, mutation: await flipPacketPayload(good.mp4Path, audioFlip, 'a:0') });
  const noAudio = path.join(dir, 'missing-audio.mp4'); await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', good.mp4Path, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', noAudio]); cases.push({ id: 'missing-audio', path: noAudio, expectedGood: false });
  const rows = [];
  for (const c of cases) {
    const [legacy, fast, deep, packets] = await Promise.all([legacyValidator(c.path, encoded, expectedDuration), fastHashValidator(c.path, encoded, expectedDuration, entry, expectedAudioHash), strictDecodeValidator(c.path), packetCountProbe(c.path)]);
    rows.push({ id: c.id, expectedGood: c.expectedGood, mutation: c.mutation || null, legacy, fast, deep, packets });
  }
  return rows;
}

function quantile(values, p) { const xs = values.filter(Number.isFinite).sort((a, b) => a - b); return xs.length ? xs[Math.min(xs.length - 1, Math.floor((xs.length - 1) * p))] : 0; }
function mean(values) { const xs = values.filter(Number.isFinite); return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length); }
function summarizeScenario(name, runs) {
  const rows = runs.flatMap((x) => x.rows), totalWallMs = runs.reduce((a, x) => a + x.wallMs, 0), jobs = rows.length, failures = runs.flatMap((x) => x.failures);
  return { name, runs: runs.length, jobs, failures, totalWallMs: +totalWallMs.toFixed(2), videosPerHour: +(jobs * 3_600_000 / totalWallMs).toFixed(2), p50JobMs: +quantile(rows.map((x) => x.wallMs), .5).toFixed(2), p95JobMs: +quantile(rows.map((x) => x.wallMs), .95).toFixed(2), p50ValidationMs: +quantile(rows.map((x) => x.validationMs), .5).toFixed(2), p95ValidationMs: +quantile(rows.map((x) => x.validationMs), .95).toFixed(2), cpuMsPerVideo: +(runs.reduce((a, x) => a + x.cpuMs, 0) / Math.max(1, jobs)).toFixed(2), meanMuxMs: +mean(rows.map((x) => x.muxMs)).toFixed(2), meanEncodeMs: +mean(rows.map((x) => x.encodeMs)).toFixed(2), meanUploadMs: +mean(rows.map((x) => x.uploadMs)).toFixed(2) };
}
async function scenario(mode, expectedAudioHash, runLabel) {
  const browser = await launch(), workers = await Promise.all(Array.from({ length: concurrency }, () => browser.newPage())), rows = [], failures = [], cpu0 = cpuUsec(), t0 = performance.now();
  try {
    await Promise.all(workers.map(async (page, worker) => {
      for (let j = worker; j < jobsPerScenario; j += concurrency) {
        const idx = j % entries.length, entry = entries[idx], id = `${runLabel}-${mode}-${j}`, job0 = performance.now(); let mp4Path = null;
        try {
          const loadMs = await navigate(page, idx), encoded = await encode(page, id, entry), muxed = await muxArtifact(id, encoded); mp4Path = muxed.mp4Path;
          const validation = mode === 'legacy' ? await legacyValidator(mp4Path, encoded, muxed.expectedDuration) : await fastHashValidator(mp4Path, encoded, muxed.expectedDuration, entry, expectedAudioHash);
          if (!validation.valid) throw new Error(`${mode} rejected ${entry.id}: ${JSON.stringify(validation)}`);
          rows.push({ j, entryId: entry.id, bookId: entry.bookId, style: entry.style, variant: entry.variant, profile: entry.profile, width: entry.width, height: entry.height, loadMs, encodeMs: encoded.encodeMs, uploadMs: encoded.uploadMs, browserHashMs: encoded.browserHashMs, muxMs: muxed.muxMs, validationMs: validation.ms, wallMs: performance.now() - job0, outputChunks: encoded.outputChunks, mp4Bytes: fs.statSync(mp4Path).size });
        } catch (error) { failures.push({ j, entryId: entry.id, error: String(error?.stack || error) }); }
        finally { if (mp4Path) await fsp.rm(mp4Path, { force: true }).catch(() => {}); }
      }
    }));
  } finally { for (const p of workers) await p.close().catch(() => {}); await browser.close().catch(() => {}); }
  return { mode, runLabel, rows, failures, wallMs: performance.now() - t0, cpuMs: (cpuUsec() - cpu0) / 1000 };
}

let referenceBrowser;
try {
  const audioHash = await normalizedAudioHash(audioPath); if (audioHash.code !== 0 || audioHash.stderr.trim() || !audioHash.sha256) throw new Error(`AAC normalization failed: ${audioHash.stderr}`);
  referenceBrowser = await launch(); const page = await referenceBrowser.newPage(); const referenceEntry = entries.find((x) => x.bookId === 'river-station' && x.variant === 'hook-first' && x.profile === 'vertical') || entries[0], referenceIndex = entries.indexOf(referenceEntry);
  await navigate(page, referenceIndex); const referenceEncoded = await encode(page, 'r36-reference', referenceEntry); await fsp.writeFile(path.join(outDir, 'reference-source.h264'), referenceEncoded.h264);
  const referenceMuxed = await muxArtifact('r36-reference', referenceEncoded), goodFast = await fastHashValidator(referenceMuxed.mp4Path, referenceEncoded, referenceMuxed.expectedDuration, referenceEntry, audioHash.sha256), goodLegacy = await legacyValidator(referenceMuxed.mp4Path, referenceEncoded, referenceMuxed.expectedDuration);
  const preflight = { browserRawSha256: referenceEncoded.browserSha256, nodeRawSha256: referenceEncoded.h264Sha256, sourceNormalized: referenceEncoded.h264Normalized, canonicalAudioAdtsSha256: audioHash.sha256, goodFast, goodLegacy };
  await fsp.writeFile(path.join(outDir, 'preflight.json'), JSON.stringify(preflight, null, 2) + '\n'); console.log('R36 preflight', JSON.stringify(preflight, null, 2));
  if (!goodFast.valid || !goodLegacy.valid) throw new Error('reference artifact failed a validator');
  const corruption = await buildCorruptionMatrix(referenceMuxed, referenceEncoded, referenceMuxed.expectedDuration, referenceEntry, audioHash.sha256); await page.close(); await referenceBrowser.close(); referenceBrowser = null;

  const legacyA = await scenario('legacy', audioHash.sha256, 'A'), fastA = await scenario('fast', audioHash.sha256, 'A'), fastB = await scenario('fast', audioHash.sha256, 'B'), legacyB = await scenario('legacy', audioHash.sha256, 'B');
  const legacy = summarizeScenario('legacy-count-frames', [legacyA, legacyB]), fast = summarizeScenario('fast-compressed-hash-v2', [fastA, fastB]), throughputGain = legacy.videosPerHour ? fast.videosPerHour / legacy.videosPerHour - 1 : 0, validationReduction = legacy.p50ValidationMs ? 1 - fast.p50ValidationMs / legacy.p50ValidationMs : 0;
  const fastCorruptionPass = corruption.every((x) => x.fast.valid === x.expectedGood), legacyMisses = corruption.filter((x) => x.legacy.valid !== x.expectedGood).map((x) => x.id);
  const report = { schema: 'framewright-r36-artifact-validation-v2', fixture: { id: referenceEntry.id, bookId: referenceEntry.bookId, style: referenceEntry.style, variant: referenceEntry.variant, profile: referenceEntry.profile, width: referenceEntry.width, height: referenceEntry.height }, config: { bitrate, concurrency, jobsPerScenario, scenarioOrder: ['legacy-A', 'fast-A', 'fast-B', 'legacy-B'], h264Normalization: 'Annex-B NAL payload sequence excluding SPS(7), PPS(8), AUD(9), which MP4/avcC may relocate; all VCL/SEI payload bytes remain in the digest', validatorTrustBoundary: 'raw browser H264 SHA is verified after upload; post-mux gate verifies normalized compressed H264 payload identity, exact AAC ADTS identity, metadata, and final Artifact SHA. Periodic/deferred decoder QA remains separate.' }, reference: { ...preflight }, corruption, throughput: { legacy, fast, throughputGain: +throughputGain.toFixed(4), validationReduction: +validationReduction.toFixed(4) }, decision: { fastCorruptionPass, legacyMisses, throughputGatePass: throughputGain >= .10, adoptFastSyncGate: fastCorruptionPass && throughputGain >= .10 && !fast.failures.length, policy: fastCorruptionPass && throughputGain >= .10 && !fast.failures.length ? 'use normalized compressed-byte identity + metadata as synchronous post-mux gate; move full decode/count to periodic/deferred QA' : 'do not change synchronous validation policy yet' } };
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  const rows = corruption.map((x) => `| ${x.id} | ${x.expectedGood ? 'good' : 'corrupt'} | ${x.legacy.valid ? 'PASS' : 'FAIL'} | ${x.fast.valid ? 'PASS' : 'FAIL'} | ${x.deep.valid ? 'PASS' : 'FAIL'} | ${x.packets.validProcess ? 'clean' : 'error'} |`).join('\n');
  const md = `# R36 artifact validation critical-path scout v2\n\nReference normalized H264 identity: **${goodFast.videoOk ? 'PASS' : 'FAIL'}**; canonical AAC identity: **${goodFast.audioOk ? 'PASS' : 'FAIL'}**.\n\n| corruption case | expected | current count_frames gate | normalized compressed-hash gate | strict decode | count_packets process |\n|---|---|---|---|---|---|\n${rows}\n\nLegacy validator: **${legacy.videosPerHour} videos/h**, p50 validation **${legacy.p50ValidationMs} ms**, CPU **${legacy.cpuMsPerVideo} ms/video**.\n\nNormalized compressed-hash validator: **${fast.videosPerHour} videos/h**, p50 validation **${fast.p50ValidationMs} ms**, CPU **${fast.cpuMsPerVideo} ms/video**.\n\nRealized throughput gain: **${(throughputGain * 100).toFixed(1)}%**; validation reduction: **${(validationReduction * 100).toFixed(1)}%**. Fast corruption matrix: **${fastCorruptionPass ? 'PASS' : 'FAIL'}**. Current legacy misses: **${legacyMisses.length ? legacyMisses.join(', ') : 'none'}**.\n\nDecision: **${report.decision.adoptFastSyncGate ? 'ADOPT FAST SYNC GATE' : 'KEEP CURRENT GATE'}** — ${report.decision.policy}.\n`;
  await fsp.writeFile(path.join(outDir, 'summary.md'), md); console.log(md);
} finally { if (referenceBrowser) await referenceBrowser.close().catch(() => {}); await new Promise((resolve) => server.close(resolve)); }
