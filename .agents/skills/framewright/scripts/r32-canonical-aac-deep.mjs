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
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18-for-r32.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-r32/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/r32');
const audioSource = path.resolve(process.env.TRACK || path.join(outDir, 'track.wav'));
const audioCacheDir = path.resolve(process.env.AUDIO_CACHE_DIR || path.join(outDir, 'audio-cache'));
const reportPath = path.resolve(process.env.REPORT || path.join(outDir, 'report.json'));
const summaryPath = path.resolve(process.env.SUMMARY || path.join(outDir, 'summary.md'));
const repeats = Math.max(2, Math.min(8, Math.trunc(Number(process.env.REPEATS || 3))));
const bitrate = Math.max(250_000, Math.trunc(Number(process.env.BITRATE || 2_000_000)));
const audioBitrate = process.env.AUDIO_BITRATE || '192k';
const renderDurationSeconds = Math.max(.1, Number(process.env.RENDER_DURATION_SECONDS || 12));
const queueLimit = Math.max(1, Math.min(64, Math.trunc(Number(process.env.WEBCODECS_QUEUE || 8))));
const selector = {
  bookId: process.env.BOOK_ID || 'river-station',
  variant: process.env.VARIANT || 'hook-first',
  profile: process.env.PROFILE || 'vertical',
};

for (const file of [htmlPath, manifestPath, audioSource]) if (!fs.existsSync(file)) throw new Error(`missing input: ${file}`);
await fsp.mkdir(outDir, { recursive: true });
await fsp.mkdir(audioCacheDir, { recursive: true });

const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const entry = manifest.items.find((x) => x.bookId === selector.bookId && x.variant === selector.variant && x.profile === selector.profile);
if (!entry) throw new Error(`fixture not found ${JSON.stringify(selector)}`);
const payload = JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath), entry.payloadFile), 'utf8'));

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256File = async (file) => sha256(await fsp.readFile(file));
const sourceAudioSha256 = await sha256File(audioSource);
const AUDIO_POLICY_VERSION = 'aac-lc-ffmpeg-192k-v2-explicit-duration';
const audioSpec = {
  version: 1,
  sourceSha256: sourceAudioSha256,
  timing: { trimStartSeconds: 0, durationSeconds: renderDurationSeconds, finalMuxDurationSeconds: renderDurationSeconds },
  mix: { gainDb: 0, fades: null },
  codec: { name: 'aac', bitrate: audioBitrate, container: 'm4a', policy: AUDIO_POLICY_VERSION },
};
const audioSpecId = `fwa1_${sha256(Buffer.from(canonicalJson(audioSpec)))}`;
const canonicalAudio = path.join(audioCacheDir, `${audioSpecId}.m4a`);
const canonicalAudioManifest = path.join(audioCacheDir, `${audioSpecId}.json`);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code ?? signal}\n${stderr.slice(-6000)}`)));
  });
}
function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function stats(values) {
  const xs = [...values].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return { n: xs.length, mean: +mean.toFixed(3), p50: +quantile(xs, .5).toFixed(3), p95: +quantile(xs, .95).toFixed(3), min: +(xs[0] || 0).toFixed(3), max: +(xs.at(-1) || 0).toFixed(3) };
}
function cgroupCpuUsec() {
  try { const m = fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8').match(/^usage_usec\s+(\d+)/m); return m ? Number(m[1]) : null; } catch { return null; }
}
function procTreeRssBytes(rootPid = process.pid) {
  try {
    const pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).map(Number), parent = new Map(), rss = new Map();
    for (const pid of pids) {
      try {
        const text = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const pp = text.match(/^PPid:\s+(\d+)/m), rr = text.match(/^VmRSS:\s+(\d+)\s+kB/m);
        if (pp) parent.set(pid, Number(pp[1])); if (rr) rss.set(pid, Number(rr[1]) * 1024);
      } catch {}
    }
    const wanted = new Set([rootPid]);
    let changed = true;
    while (changed) { changed = false; for (const [pid, ppid] of parent) if (wanted.has(ppid) && !wanted.has(pid)) { wanted.add(pid); changed = true; } }
    let total = 0; for (const pid of wanted) total += rss.get(pid) || 0; return total;
  } catch { return 0; }
}
function startResources() {
  let peak = procTreeRssBytes(); const cpu0 = cgroupCpuUsec();
  const timer = setInterval(() => { peak = Math.max(peak, procTreeRssBytes()); }, 20); timer.unref?.();
  return () => { clearInterval(timer); peak = Math.max(peak, procTreeRssBytes()); const cpu1 = cgroupCpuUsec(); return { peakProcessTreeRssBytes: peak, cgroupCpuMs: cpu0 != null && cpu1 != null ? +(cpu1 - cpu0).toFixed(3) / 1000 : null }; };
}
function contentType(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'; case '.js': case '.mjs': return 'text/javascript; charset=utf-8'; case '.json': return 'application/json';
    case '.svg': return 'image/svg+xml'; case '.png': return 'image/png'; case '.jpg': case '.jpeg': return 'image/jpeg'; case '.webp': return 'image/webp'; default: return 'application/octet-stream';
  }
}
async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,duration,sample_rate,channels', '-of', 'json', file]);
  return JSON.parse(stdout);
}

async function ensureCanonicalAudio({ forceMiss = false } = {}) {
  if (forceMiss) { await fsp.rm(canonicalAudio, { force: true }); await fsp.rm(canonicalAudioManifest, { force: true }); }
  const started = performance.now();
  if (fs.existsSync(canonicalAudio) && fs.existsSync(canonicalAudioManifest)) {
    const meta = JSON.parse(await fsp.readFile(canonicalAudioManifest, 'utf8'));
    const actual = await sha256File(canonicalAudio);
    if (meta.audioSpecId === audioSpecId && meta.artifactSha256 === actual) return { cacheHit: true, prepareMs: performance.now() - started, artifact: canonicalAudio, artifactSha256: actual, bytes: fs.statSync(canonicalAudio).size };
  }
  const tmp = `${canonicalAudio}.tmp-${process.pid}`;
  const encodeStarted = performance.now();
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', audioSource, '-t', String(renderDurationSeconds), '-vn', '-c:a', 'aac', '-b:a', audioBitrate, '-movflags', '+faststart', tmp]);
  const encodeMs = performance.now() - encodeStarted;
  await fsp.rename(tmp, canonicalAudio);
  const artifactSha256 = await sha256File(canonicalAudio);
  const meta = { kind: 'framewright-canonical-audio', version: 1, audioSpecId, audioSpec, artifactSha256, bytes: fs.statSync(canonicalAudio).size };
  await fsp.writeFile(canonicalAudioManifest, `${JSON.stringify(meta, null, 2)}\n`);
  return { cacheHit: false, prepareMs: performance.now() - started, encodeMs, artifact: canonicalAudio, artifactSha256, bytes: meta.bytes };
}

async function withServer(fn) {
  const uploads = new Map();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'POST' && u.pathname.startsWith('/__r32_h264/')) {
      const id = decodeURIComponent(u.pathname.slice('/__r32_h264/'.length)), chunks = [];
      req.on('data', (d) => chunks.push(d)); req.on('end', () => { uploads.set(id, Buffer.concat(chunks)); res.writeHead(204); res.end(); }); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, ''), filename = path.resolve(root, rel || '.');
    if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.stat(filename, (err, st) => { if (err || !st.isFile()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': contentType(filename), 'Cache-Control': 'no-store' }); if (req.method === 'HEAD') res.end(); else fs.createReadStream(filename).pipe(res); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { return await fn({ origin: `http://127.0.0.1:${server.address().port}`, uploads }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function renderJob({ id, audioMode, forceAudioMiss = false }) {
  return withServer(async ({ origin, uploads }) => {
    const stopResources = startResources();
    const wallStarted = performance.now();
    let audio = null;
    if (audioMode === 'cached') audio = await ensureCanonicalAudio({ forceMiss: forceAudioMiss });
    const launchStarted = performance.now();
    const browser = await puppeteer.launch({ headless: true, protocolTimeout: 600_000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const launchMs = performance.now() - launchStarted;
    let pageLoadMs, browserMetrics;
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument((p) => { window.FRAMEWRIGHT_PAYLOAD = p; }, payload);
      const rel = path.relative(root, htmlPath).split(path.sep).map(encodeURIComponent).join('/');
      const url = new URL(`/${rel}`, origin); url.searchParams.set('f', '0'); url.searchParams.set('w', String(entry.width)); url.searchParams.set('s', String(entry.seed)); url.searchParams.set('profile', entry.profile);
      const p0 = performance.now(); await page.goto(url.href, { waitUntil: 'load', timeout: 120_000 }); await page.waitForFunction('window.__ready===true', { timeout: 120_000 }); pageLoadMs = performance.now() - p0;
      browserMetrics = await page.evaluate(async ({ id, width, seed, bitrate, queueLimit }) => {
        const canvas = document.getElementById('c'), runtime = window.RISO;
        if (!canvas || !runtime || typeof window.renderFrame !== 'function') throw new Error('same-scene renderFrame unavailable');
        const total = Number(runtime.total), fps = Number(runtime.fps || 30); window.renderFrame(0, width, seed, canvas);
        const config = { codec: 'avc1.420028', width: canvas.width, height: canvas.height, bitrate, framerate: fps, latencyMode: 'realtime', avc: { format: 'annexb' } };
        const support = await VideoEncoder.isConfigSupported(config); if (!support.supported) throw new Error(`unsupported ${JSON.stringify(config)}`);
        const chunks = []; let bytes = 0, maxQueue = 0;
        const encoder = new VideoEncoder({ output(chunk) { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push(b); bytes += b.byteLength; }, error(e) { throw e; } }); encoder.configure(config);
        const encode0 = performance.now();
        for (let frame = 0; frame < total; frame += 1) {
          window.renderFrame(frame, width, seed, canvas); const vf = new VideoFrame(canvas, { timestamp: Math.trunc(frame * 1_000_000 / fps) });
          encoder.encode(vf, { keyFrame: frame === 0 || frame % Math.max(1, Math.round(fps * 2)) === 0 }); vf.close(); maxQueue = Math.max(maxQueue, encoder.encodeQueueSize);
          while (encoder.encodeQueueSize > queueLimit) await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }));
        }
        await encoder.flush(); const encodeMs = performance.now() - encode0; encoder.close();
        const body = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        const upload0 = performance.now(); const response = await fetch(`/__r32_h264/${encodeURIComponent(id)}`, { method: 'POST', body }); if (!response.ok) throw new Error(`upload ${response.status}`);
        return { total, fps, width: canvas.width, height: canvas.height, encodeMs, uploadMs: performance.now() - upload0, h264Bytes: bytes, maxQueue };
      }, { id, width: entry.width, seed: entry.seed, bitrate, queueLimit });
    } finally { await browser.close(); }
    const h264 = uploads.get(id); if (!h264?.length) throw new Error(`${id}: no H264 upload`);
    const h264Path = path.join(outDir, `${id}.h264`), mp4Path = path.join(outDir, `${id}.mp4`); await fsp.writeFile(h264Path, h264);
    const expectedSec = browserMetrics.total / browserMetrics.fps;
    if (Math.abs(expectedSec - renderDurationSeconds) > .001) throw new Error(`${id}: RenderSpec duration ${renderDurationSeconds}s does not match ${browserMetrics.total}/${browserMetrics.fps}=${expectedSec}s`);
    const muxStarted = performance.now();
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-fflags', '+genpts', '-r', String(browserMetrics.fps), '-i', h264Path];
    if (audioMode === 'cached') args.push('-i', audio.artifact); else args.push('-i', audioSource);
    args.push('-map', '0:v:0', '-map', '1:a:0?', '-c:v', 'copy');
    if (audioMode === 'cached') args.push('-c:a', 'copy'); else args.push('-c:a', 'aac', '-b:a', audioBitrate);
    args.push('-t', String(expectedSec), '-movflags', '+faststart', mp4Path);
    await run('ffmpeg', args); const muxMs = performance.now() - muxStarted;
    const media = await probe(mp4Path), video = media.streams.find((x) => x.codec_type === 'video'), audioStream = media.streams.find((x) => x.codec_type === 'audio');
    if (Number(video?.nb_read_frames || 0) !== browserMetrics.total) throw new Error(`${id}: frame mismatch ${video?.nb_read_frames}/${browserMetrics.total}`);
    if (!audioStream || audioStream.codec_name !== 'aac') throw new Error(`${id}: AAC stream missing`);
    const audioDuration = Number(audioStream.duration || media.format.duration || 0), formatDuration = Number(media.format.duration || 0);
    if (Math.abs(formatDuration - expectedSec) > .10 || Math.abs(audioDuration - expectedSec) > .10) throw new Error(`${id}: duration drift expected=${expectedSec} format=${formatDuration} audio=${audioDuration}`);
    const outputSha256 = await sha256File(mp4Path), outputBytes = fs.statSync(mp4Path).size;
    const audioArtifactSha256 = audioMode === 'cached' ? audio.artifactSha256 : null;
    const renderSpecId = `fwr32_${sha256(Buffer.from(canonicalJson({ fixture: entry.id, seed: entry.seed, width: entry.width, bitrate, durationSeconds: expectedSec, audio: audioMode === 'cached' ? { audioSpecId, artifactSha256: audioArtifactSha256, mux: 'copy' } : { sourceSha256: sourceAudioSha256, codec: 'aac', bitrate: audioBitrate, mux: 'encode' } })) )}`;
    const resources = stopResources(), wallMs = performance.now() - wallStarted;
    const row = {
      id, audioMode, renderSpecId, wallMs: +wallMs.toFixed(3), launchMs: +launchMs.toFixed(3), pageLoadMs: +pageLoadMs.toFixed(3), encodeMs: +browserMetrics.encodeMs.toFixed(3), uploadMs: +browserMetrics.uploadMs.toFixed(3), muxMs: +muxMs.toFixed(3),
      outputBytes, outputSha256, resources, media,
      audio: { sourceSha256: sourceAudioSha256, audioSpecId: audioMode === 'cached' ? audioSpecId : null, artifactSha256: audioArtifactSha256, cacheHit: audioMode === 'cached' ? audio.cacheHit : null, prepareMs: audioMode === 'cached' ? +audio.prepareMs.toFixed(3) : null, encodeMs: audioMode === 'cached' && audio.encodeMs != null ? +audio.encodeMs.toFixed(3) : null },
    };
    await fsp.writeFile(path.join(outDir, `${id}.json`), `${JSON.stringify(row, null, 2)}\n`); return row;
  });
}

const rows = { baseline: [], cachedHit: [], cachedMiss: [] };
console.log(`R32 fixture ${entry.id} ${entry.width}x${entry.height} seed=${entry.seed}; duration=${renderDurationSeconds}s; audio_spec_id=${audioSpecId}`);
for (let i = 1; i <= repeats; i += 1) { console.log(`baseline ${i}/${repeats}`); rows.baseline.push(await renderJob({ id: `baseline-${i}`, audioMode: 'baseline' })); }
console.log('cached miss'); rows.cachedMiss.push(await renderJob({ id: 'cached-miss-1', audioMode: 'cached', forceAudioMiss: true }));
for (let i = 1; i <= repeats; i += 1) { console.log(`cached hit ${i}/${repeats}`); rows.cachedHit.push(await renderJob({ id: `cached-hit-${i}`, audioMode: 'cached' })); }

const summarize = (xs) => ({ wallMs: stats(xs.map((x) => x.wallMs)), muxMs: stats(xs.map((x) => x.muxMs)), cpuMs: stats(xs.map((x) => x.resources.cgroupCpuMs).filter((x) => x != null)), peakRssBytes: stats(xs.map((x) => x.resources.peakProcessTreeRssBytes)), outputBytes: stats(xs.map((x) => x.outputBytes)), audioPrepareMs: stats(xs.map((x) => x.audio.prepareMs).filter((x) => x != null)) });
const summary = { baseline: summarize(rows.baseline), cachedMiss: summarize(rows.cachedMiss), cachedHit: summarize(rows.cachedHit) };
const savedWall = summary.baseline.wallMs.p50 - summary.cachedHit.wallMs.p50, savedMux = summary.baseline.muxMs.p50 - summary.cachedHit.muxMs.p50;
const report = { schema: 'framewright-r32-canonical-aac-deep-v2', fixture: { ...selector, id: entry.id, style: entry.style, width: entry.width, height: entry.height, seed: entry.seed, bitrate, durationSeconds: renderDurationSeconds }, audioIdentity: { audioSpecId, audioSpec, sourceAudioSha256, canonicalArtifact: canonicalAudio, canonicalArtifactSha256: await sha256File(canonicalAudio) }, summary, decision: { p50FullWallSavedMs: +savedWall.toFixed(3), p50FullWallReduction: +(savedWall / summary.baseline.wallMs.p50).toFixed(4), p50MuxSavedMs: +savedMux.toFixed(3), promoteCanonicalAudio: savedWall >= Math.max(250, summary.baseline.wallMs.p50 * .05) }, rows, caveat: 'This deep pass proves runtime value and identity shape on a production-shaped C18 scene. Factory-wide contract promotion remains an Integration decision.' };
await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const mb = (n) => (n / 1048576).toFixed(2);
const lines = ['# R32 canonical AAC deep integration', '', `Fixture: \`${entry.id}\` ${entry.width}x${entry.height}, seed ${entry.seed}, ${bitrate/1e6} Mbps H.264, explicit ${renderDurationSeconds}s RenderSpec duration. Audio spec: \`${audioSpecId}\`.`, '', '| mode | p50 full wall | p95 full wall | p50 mux | p50 CPU | p50 peak RSS | mean MP4 |', '|---|---:|---:|---:|---:|---:|---:|'];
for (const [name, s] of Object.entries(summary)) lines.push(`| ${name} | ${(s.wallMs.p50/1000).toFixed(3)} s | ${(s.wallMs.p95/1000).toFixed(3)} s | ${s.muxMs.p50.toFixed(1)} ms | ${(s.cpuMs.p50/1000).toFixed(3)} s | ${mb(s.peakRssBytes.p50)} MiB | ${mb(s.outputBytes.mean)} MiB |`);
lines.push('', `Canonical AAC cache hit saves **${savedWall.toFixed(1)} ms p50 full-job wall** (${(100*savedWall/summary.baseline.wallMs.p50).toFixed(1)}%) and **${savedMux.toFixed(1)} ms p50 mux wall**.`);
lines.push(`Cache-miss audio preparation is measured explicitly: ${summary.cachedMiss.audioPrepareMs.p50.toFixed(1)} ms within the miss job.`);
lines.push('', report.decision.promoteCanonicalAudio ? '**Gate: PASS.** Runtime evidence is strong enough to propose canonical encoded audio as a factory contract extension.' : '**Gate: FAIL.** Keep this as a local optimization; do not change the factory contract.');
lines.push('', 'Every MP4 is ffprobe-validated for exact video frame count, AAC presence and <=100ms duration drift. Manifest rows carry source hash, audio_spec_id, canonical artifact hash, cache-hit state and render_spec_id-like runtime identity.');
const markdown = `${lines.join('\n')}\n`; await fsp.writeFile(summaryPath, markdown); console.log(markdown);
