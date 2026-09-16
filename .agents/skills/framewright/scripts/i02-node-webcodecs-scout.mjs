#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createCanvas, Image, GlobalFonts} from '@napi-rs/canvas';
import {
  VideoEncoder,
  VideoFrame,
  AudioEncoder,
  AudioData,
  Mp4Muxer,
} from '@napi-rs/webcodecs';

const root = process.cwd();
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-e18/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/i02');
const reportPath = path.resolve(process.env.NATIVE_REPORT || path.join(outDir, 'node-webcodecs-report.json'));
const summaryPath = path.resolve(process.env.NATIVE_SUMMARY || path.join(outDir, 'node-webcodecs-summary.md'));
const trackPath = path.resolve(process.env.TRACK || path.join(outDir, 'track.wav'));
const repeats = Math.max(1, Math.min(10, Math.trunc(Number(process.env.NATIVE_REPEATS || 3))));
const bitrate = Math.max(250_000, Math.trunc(Number(process.env.NATIVE_BITRATE || process.env.BITRATE || 2_000_000)));
const audioBitrate = Math.max(32_000, Math.trunc(Number(process.env.NATIVE_AUDIO_BITRATE || 192_000)));
const queueLimit = Math.max(1, Math.min(64, Math.trunc(Number(process.env.NATIVE_QUEUE || process.env.WEBCODECS_QUEUE || 8))));
const codec = process.env.NATIVE_CODEC || 'avc1.420028';
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
for (const file of [htmlPath, manifestPath, trackPath]) {
  if (!fs.existsSync(file)) throw new Error(`missing required input: ${file}`);
}
await fsp.mkdir(outDir, {recursive: true});

const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const entry = manifest.items.find((item) =>
  item.bookId === selector.bookId && item.variant === selector.variant && item.profile === selector.profile
);
if (!entry) throw new Error(`fixture not found: ${JSON.stringify(selector)}`);
const manifestDir = path.dirname(manifestPath);
const templateDir = path.dirname(htmlPath);
const payloadPath = path.resolve(manifestDir, entry.payloadFile);
const payload = JSON.parse(await fsp.readFile(payloadPath, 'utf8'));
if (payload.cover_url && !/^[a-z]+:/i.test(payload.cover_url) && !path.isAbsolute(payload.cover_url)) {
  payload.cover_url = path.resolve(templateDir, payload.cover_url);
}
const html = await fsp.readFile(htmlPath, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!scriptMatch) throw new Error('inline scene script not found');
const sceneSource = scriptMatch[1];

function stat(xs) {
  const values = [...xs].filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return {mean: 0, p50: 0, p95: 0, min: 0, max: 0};
  const q = (p) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {mean: +mean.toFixed(3), p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), min: +q(0).toFixed(3), max: +q(1).toFixed(3)};
}

function procTreeRssBytes(rootPid = process.pid) {
  try {
    const pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).map(Number);
    const parent = new Map();
    const rss = new Map();
    for (const pid of pids) {
      try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const pp = status.match(/^PPid:\s+(\d+)/m);
        const rr = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
        if (pp) parent.set(pid, Number(pp[1]));
        if (rr) rss.set(pid, Number(rr[1]) * 1024);
      } catch {}
    }
    const wanted = new Set([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, ppid] of parent) {
        if (wanted.has(ppid) && !wanted.has(pid)) { wanted.add(pid); changed = true; }
      }
    }
    let total = 0;
    for (const pid of wanted) total += rss.get(pid) || 0;
    return total;
  } catch { return 0; }
}

function cgroupCpuUsec() {
  try {
    const text = fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8');
    const m = text.match(/^usage_usec\s+(\d+)/m);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

function startResourceSampler() {
  let peak = procTreeRssBytes();
  const cpu0 = cgroupCpuUsec();
  const timer = setInterval(() => { peak = Math.max(peak, procTreeRssBytes()); }, 20);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    peak = Math.max(peak, procTreeRssBytes());
    const cpu1 = cgroupCpuUsec();
    return {
      peakProcessTreeRssBytes: peak,
      cgroupCpuMs: cpu0 != null && cpu1 != null ? +((cpu1 - cpu0) / 1000).toFixed(3) : null,
    };
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve({stdout, stderr});
      else reject(new Error(`${command} exited ${code ?? signal}\n${stderr.slice(-6000)}`));
    });
  });
}

async function ffprobe(file) {
  const {stdout} = await run('ffprobe', [
    '-v', 'error', '-count_frames', '-show_entries',
    'format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,duration,sample_rate,channels',
    '-of', 'json', file,
  ]);
  return JSON.parse(stdout);
}

async function metric(kind, a, b) {
  const filter = kind === 'ssim' ? '[0:v][1:v]ssim' : '[0:v][1:v]psnr';
  const {stderr} = await run('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-i', a, '-i', b, '-lavfi', filter, '-f', 'null', '-']);
  if (kind === 'ssim') {
    const m = [...stderr.matchAll(/All:([0-9.]+)/g)].at(-1);
    return m ? Number(m[1]) : null;
  }
  const m = [...stderr.matchAll(/average:([0-9.]+)/g)].at(-1);
  return m ? Number(m[1]) : null;
}

async function compareVideo(a, b) {
  return {ssim: await metric('ssim', a, b), psnr: await metric('psnr', a, b)};
}

async function nodeContext() {
  const canvas = createCanvas(entry.width, entry.height);
  const document = {
    createElement(name) {
      if (String(name).toLowerCase() !== 'canvas') throw new Error(`unsupported element ${name}`);
      return createCanvas(1, 1);
    },
    getElementById(id) { return id === 'c' ? canvas : null; },
  };
  const window = {FRAMEWRIGHT_PAYLOAD: structuredClone(payload)};
  const location = {search: `?f=0&w=${entry.width}&h=${entry.height}&s=${entry.seed}&profile=${entry.profile}`};
  const sandbox = {window, document, Image, URLSearchParams, location, console, performance, setTimeout, clearTimeout, requestAnimationFrame() { return 0; }};
  sandbox.globalThis = sandbox;
  window.window = window; window.document = document; window.location = location;
  const ctx = vm.createContext(sandbox);
  const t0 = performance.now();
  vm.runInContext(sceneSource, ctx, {filename: htmlPath});
  const deadline = performance.now() + 10_000;
  while (!window.__ready && performance.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  if (!window.__ready) throw new Error('node scene boot timeout');
  if (window.__bootError) throw new Error(window.__bootError);
  vm.runInContext(`globalThis.__i02Render=(n,w,s)=>{renderFrame(n,w,s,document.getElementById('c'));return document.getElementById('c');};`, ctx);
  return {ctx, window, canvas, initMs: performance.now() - t0};
}

function parsePcmWav16(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('audio fixture is not RIFF/WAVE');
  let offset = 12, fmt = null, data = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(start),
        channels: buf.readUInt16LE(start + 2),
        sampleRate: buf.readUInt32LE(start + 4),
        blockAlign: buf.readUInt16LE(start + 12),
        bitsPerSample: buf.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(start, Math.min(buf.length, start + size));
    }
    offset = start + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV missing fmt/data chunks');
  if (fmt.format !== 1 || fmt.bitsPerSample !== 16) throw new Error(`expected PCM16 WAV, got format=${fmt.format} bits=${fmt.bitsPerSample}`);
  const frames = Math.floor(data.length / fmt.blockAlign);
  return {...fmt, frames, data};
}

async function waitForQueue(encoder) {
  while (encoder.encodeQueueSize > queueLimit) await new Promise((resolve) => setTimeout(resolve, 1));
}

async function renderNativeWebCodecs(runIndex) {
  const stopResources = startResourceSampler();
  const wall0 = performance.now();
  const {ctx, window, canvas, initMs} = await nodeContext();
  const total = Number(window.RISO.total);
  const fps = Number(window.RISO.fps);
  const frameDurationUs = Math.trunc(1_000_000 / fps);
  const wav = parsePcmWav16(trackPath);
  const output = path.join(outDir, `node-webcodecs-${runIndex}.mp4`);
  const muxer = new Mp4Muxer({fastStart: true});
  muxer.addVideoTrack({codec, width: canvas.width, height: canvas.height, framerate: fps});
  muxer.addAudioTrack({codec: 'mp4a.40.2', sampleRate: wav.sampleRate, numberOfChannels: wav.channels});

  let videoError = null, audioError = null, videoChunks = 0, audioChunks = 0, videoBytes = 0, audioBytes = 0;
  const videoEncoder = new VideoEncoder({
    output(chunk, metadata) {
      videoChunks += 1; videoBytes += chunk.byteLength; muxer.addVideoChunk(chunk, metadata);
    },
    error(error) { videoError = error; },
  });
  const videoConfig = {
    codec,
    width: canvas.width,
    height: canvas.height,
    bitrate,
    framerate: fps,
    latencyMode: 'realtime',
    hardwareAcceleration: 'prefer-software',
  };
  const support = await VideoEncoder.isConfigSupported(videoConfig);
  if (!support.supported) throw new Error(`native VideoEncoder config unsupported: ${JSON.stringify(videoConfig)}`);
  videoEncoder.configure(videoConfig);

  const audioEncoder = new AudioEncoder({
    output(chunk, metadata) {
      audioChunks += 1; audioBytes += chunk.byteLength; muxer.addAudioChunk(chunk, metadata);
    },
    error(error) { audioError = error; },
  });
  audioEncoder.configure({codec: 'mp4a.40.2', sampleRate: wav.sampleRate, numberOfChannels: wav.channels, bitrate: audioBitrate});

  const renderMs = [], frameCopyEncodeMs = [], queueWaitMs = [];
  let maxQueue = 0;
  const video0 = performance.now();
  for (let frame = 0; frame < total; frame += 1) {
    const r0 = performance.now();
    const rendered = ctx.__i02Render(frame, entry.width, entry.seed);
    renderMs.push(performance.now() - r0);
    const e0 = performance.now();
    const vf = new VideoFrame(rendered, {timestamp: Math.trunc(frame * 1_000_000 / fps), duration: frameDurationUs});
    videoEncoder.encode(vf, {keyFrame: frame === 0 || frame % Math.max(1, Math.round(fps * 2)) === 0});
    vf.close();
    frameCopyEncodeMs.push(performance.now() - e0);
    maxQueue = Math.max(maxQueue, videoEncoder.encodeQueueSize);
    const q0 = performance.now();
    await waitForQueue(videoEncoder);
    queueWaitMs.push(performance.now() - q0);
    if (videoError) throw videoError;
  }
  await videoEncoder.flush();
  if (videoError) throw videoError;
  const videoMs = performance.now() - video0;
  videoEncoder.close();

  const audio0 = performance.now();
  const chunkFrames = 1024;
  for (let startFrame = 0; startFrame < wav.frames; startFrame += chunkFrames) {
    const frames = Math.min(chunkFrames, wav.frames - startFrame);
    const byteStart = startFrame * wav.blockAlign;
    const byteEnd = byteStart + frames * wav.blockAlign;
    const bytes = new Uint8Array(wav.data.subarray(byteStart, byteEnd));
    const ad = new AudioData({
      format: 's16',
      sampleRate: wav.sampleRate,
      numberOfFrames: frames,
      numberOfChannels: wav.channels,
      timestamp: Math.trunc(startFrame * 1_000_000 / wav.sampleRate),
      data: bytes,
    });
    audioEncoder.encode(ad);
    ad.close();
    if (audioError) throw audioError;
  }
  await audioEncoder.flush();
  if (audioError) throw audioError;
  const audioMs = performance.now() - audio0;
  audioEncoder.close();

  const mux0 = performance.now();
  muxer.flush();
  const mp4 = muxer.finalize();
  muxer.close();
  const muxFinalizeMs = performance.now() - mux0;
  const write0 = performance.now();
  await fsp.writeFile(output, mp4);
  const writeMs = performance.now() - write0;
  const wallMs = performance.now() - wall0;
  const resources = stopResources();
  const probe = await ffprobe(output);
  return {
    backend: 'node-canvas-napi-webcodecs', runIndex, output,
    wallMs: +wallMs.toFixed(3), initMs: +initMs.toFixed(3), videoMs: +videoMs.toFixed(3), audioMs: +audioMs.toFixed(3),
    muxFinalizeMs: +muxFinalizeMs.toFixed(3), writeMs: +writeMs.toFixed(3), renderFrameMs: stat(renderMs),
    frameCopyEncodeMs: stat(frameCopyEncodeMs), queueWaitMs: stat(queueWaitMs), maxEncodeQueue: maxQueue,
    videoChunks, audioChunks, encodedVideoBytes: videoBytes, encodedAudioBytes: audioBytes, outputBytes: mp4.byteLength,
    resources, probe,
  };
}

async function sampledOwnRasterQuality(output, total, fps) {
  const frames = [Math.round(fps), Math.round(total * 0.32), Math.round(total * 0.61), Math.min(total - 1, Math.round(total * 0.9))];
  const dir = path.join(outDir, 'node-webcodecs-quality');
  await fsp.mkdir(dir, {recursive: true});
  const node = await nodeContext();
  const rows = [];
  for (const frame of frames) {
    const canvas = node.ctx.__i02Render(frame, entry.width, entry.seed);
    const ref = path.join(dir, `ref-${frame}.png`);
    const dec = path.join(dir, `decoded-${frame}.png`);
    await fsp.writeFile(ref, canvas.toBuffer('image/png'));
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', output, '-vf', `select=eq(n\\,${frame})`, '-vsync', 'vfr', '-frames:v', '1', dec]);
    rows.push({frame, ...(await compareVideo(ref, dec))});
  }
  return rows;
}

console.log(`I02 native Node WebCodecs scout: ${entry.id} ${entry.width}x${entry.height} bitrate=${bitrate}`);
const runs = [];
for (let i = 1; i <= repeats; i += 1) {
  console.log(`native ${i}/${repeats}`);
  runs.push(await renderNativeWebCodecs(i));
}
const videoStream = runs[0].probe.streams.find((s) => s.codec_type === 'video');
const totalFrames = Number(videoStream?.nb_read_frames || entry.frames || 360);
const fps = Number(String(videoStream?.avg_frame_rate || '30/1').split('/')[0]) || 30;
const ownRasterQuality = await sampledOwnRasterQuality(runs[0].output, totalFrames, fps);
const x264Ref = path.join(outDir, 'node-crf-1.mp4');
const nativeVsX264Crf = fs.existsSync(x264Ref) ? await compareVideo(runs[0].output, x264Ref) : null;
const summarize = (xs) => ({
  wallMs: stat(xs.map((x) => x.wallMs)),
  outputBytes: stat(xs.map((x) => x.outputBytes)),
  peakRssBytes: stat(xs.map((x) => x.resources.peakProcessTreeRssBytes)),
  cgroupCpuMs: stat(xs.map((x) => x.resources.cgroupCpuMs).filter((x) => x != null)),
  videoMs: stat(xs.map((x) => x.videoMs)),
  audioMs: stat(xs.map((x) => x.audioMs)),
  muxFinalizeMs: stat(xs.map((x) => x.muxFinalizeMs)),
  videosPerHourFromMeanWall: +(3_600_000 / (xs.reduce((a, x) => a + x.wallMs, 0) / xs.length)).toFixed(2),
});
const q = {
  samples: ownRasterQuality,
  meanSsim: +(ownRasterQuality.reduce((a, x) => a + (x.ssim ?? 0), 0) / ownRasterQuality.length).toFixed(6),
  worstSsim: +Math.min(...ownRasterQuality.map((x) => x.ssim ?? 1)).toFixed(6),
  meanPsnr: +(ownRasterQuality.reduce((a, x) => a + (x.psnr ?? 0), 0) / ownRasterQuality.length).toFixed(4),
  worstPsnr: +Math.min(...ownRasterQuality.map((x) => x.psnr ?? Infinity)).toFixed(4),
};
const report = {
  schema: 'framewright-i02-node-webcodecs-scout-v1',
  warning: 'Scout only. Third FAST candidate on the same pre-C19 C18 workload; final freeze still requires canonical production workload.',
  fixture: {...selector, id: entry.id, style: entry.style, width: entry.width, height: entry.height, seed: entry.seed, payloadFile: entry.payloadFile},
  config: {repeats, codec, bitrate, audioBitrate, queueLimit, package: '@napi-rs/webcodecs@1.3.0', audio: path.relative(root, trackPath)},
  host: {platform: process.platform, arch: process.arch, node: process.version, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model || null, totalMemoryBytes: os.totalmem()},
  summary: summarize(runs),
  quality: {ownRaster: q, nativeVsX264Crf},
  runs,
};
await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const mb = (n) => (n / 1048576).toFixed(2);
const s = report.summary;
const md = `# I02 native Node WebCodecs scout\n\n> Third FAST candidate only; same C18 semantic scene as PR #32. Final backend selection still waits for the canonical production workload.\n\nFixture: \`${entry.id}\` — ${entry.width}×${entry.height}, seed ${entry.seed}, ${entry.style}/${entry.variant}/${entry.profile}.\n\n| metric | native Node WebCodecs |\n|---|---:|\n| mean wall | ${(s.wallMs.mean / 1000).toFixed(3)} s |\n| videos/hour | ${s.videosPerHourFromMeanWall} |\n| mean cgroup CPU | ${(s.cgroupCpuMs.mean / 1000).toFixed(3)} s |\n| peak process-tree RSS | ${mb(s.peakRssBytes.max)} MiB |\n| mean MP4 | ${mb(s.outputBytes.mean)} MiB |\n| mean video stage | ${(s.videoMs.mean / 1000).toFixed(3)} s |\n| mean AAC stage | ${(s.audioMs.mean / 1000).toFixed(3)} s |\n| mean mux finalize | ${s.muxFinalizeMs.mean.toFixed(1)} ms |\n| own-raster mean/worst SSIM | ${q.meanSsim} / ${q.worstSsim} |\n| own-raster mean/worst PSNR | ${q.meanPsnr} / ${q.worstPsnr} dB |\n\nNative vs x264 CRF22 decoded-output difference: ${nativeVsX264Crf ? `SSIM ${nativeVsX264Crf.ssim}, PSNR ${nativeVsX264Crf.psnr} dB` : 'x264 reference not present'}.\n\nImportant implementation fact: \`VideoFrame(canvas)\` copies RGBA in @napi-rs/webcodecs v1.3.0, so \`frameCopyEncodeMs\` and total CPU/RSS must decide whether this path is useful; the absence of Chromium/FFmpeg CLI alone is not a win.\n`;
await fsp.writeFile(summaryPath, md);
console.log(md);
