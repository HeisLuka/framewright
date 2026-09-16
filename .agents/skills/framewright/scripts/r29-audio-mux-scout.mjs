#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const root = process.cwd();
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/r29');
const h264Path = path.resolve(process.env.H264 || path.join(outDir, 'video.h264'));
const wavPath = path.resolve(process.env.WAV || path.join(outDir, 'track.wav'));
const aacPath = path.resolve(process.env.AAC || path.join(outDir, 'track.m4a'));
const reportPath = path.resolve(process.env.REPORT || path.join(outDir, 'report.json'));
const summaryPath = path.resolve(process.env.SUMMARY || path.join(outDir, 'summary.md'));
const repeats = Math.max(5, Math.min(100, Math.trunc(Number(process.env.REPEATS || 25))));
const fps = Math.max(1, Number(process.env.FPS || 30));
const baselineFullMs = Number(process.env.BASELINE_FULL_MS || 4136.563);
const baselineMuxMs = Number(process.env.BASELINE_MUX_MS || 666.9);

for (const file of [h264Path, wavPath, aacPath]) if (!fs.existsSync(file)) throw new Error(`missing input ${file}`);
await fsp.mkdir(outDir, { recursive: true });

function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function stats(values) {
  const xs = [...values].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    n: xs.length,
    mean: +mean.toFixed(3),
    p50: +quantile(xs, 0.5).toFixed(3),
    p95: +quantile(xs, 0.95).toFixed(3),
    min: +(xs[0] || 0).toFixed(3),
    max: +(xs.at(-1) || 0).toFixed(3),
  };
}
function run(command, args, { captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'] });
    const stdout = [];
    let stderr = '';
    if (captureStdout) child.stdout.on('data', (d) => stdout.push(d));
    child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve({ stdout: Buffer.concat(stdout), stderr });
      else reject(new Error(`${command} exited ${code ?? signal}\n${stderr.slice(-5000)}`));
    });
  });
}

async function timedFfmpeg(args) {
  const marker = '__R29_TIME__';
  const t0 = performance.now();
  const { stderr } = await run('/usr/bin/time', [
    '-f', `${marker} user=%U sys=%S rss_kb=%M`,
    'ffmpeg', '-hide_banner', '-loglevel', 'error', ...args,
  ]);
  const wallMs = performance.now() - t0;
  const match = stderr.match(new RegExp(`${marker} user=([0-9.]+) sys=([0-9.]+) rss_kb=(\\d+)`));
  if (!match) throw new Error(`time metrics missing: ${stderr.slice(-1000)}`);
  return {
    wallMs: +wallMs.toFixed(3),
    userMs: +(Number(match[1]) * 1000).toFixed(3),
    sysMs: +(Number(match[2]) * 1000).toFixed(3),
    cpuMs: +((Number(match[1]) + Number(match[2])) * 1000).toFixed(3),
    peakRssBytes: Number(match[3]) * 1024,
  };
}

const modes = {
  current_wav_aac_mux: {
    output: path.join(outDir, 'current-wav-aac-mux.mp4'),
    args(output) { return ['-y', '-fflags', '+genpts', '-r', String(fps), '-i', h264Path, '-i', wavPath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output]; },
  },
  cached_aac_copy_mux: {
    output: path.join(outDir, 'cached-aac-copy-mux.mp4'),
    args(output) { return ['-y', '-fflags', '+genpts', '-r', String(fps), '-i', h264Path, '-i', aacPath, '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', output]; },
  },
  video_only_mux: {
    output: path.join(outDir, 'video-only-mux.mp4'),
    args(output) { return ['-y', '-fflags', '+genpts', '-r', String(fps), '-i', h264Path, '-c:v', 'copy', '-an', '-movflags', '+faststart', output]; },
  },
};

const results = Object.fromEntries(Object.keys(modes).map((id) => [id, []]));
const ids = Object.keys(modes);

console.log(`R29 fixture: H264 ${(fs.statSync(h264Path).size / 1048576).toFixed(2)} MiB, WAV ${(fs.statSync(wavPath).size / 1048576).toFixed(2)} MiB, cached AAC ${(fs.statSync(aacPath).size / 1048576).toFixed(2)} MiB`);
console.log('warmup');
for (const id of ids) await timedFfmpeg(modes[id].args(modes[id].output));

for (let i = 0; i < repeats; i += 1) {
  const order = ids.map((_, j) => ids[(i + j) % ids.length]);
  for (const id of order) {
    const row = await timedFfmpeg(modes[id].args(modes[id].output));
    results[id].push(row);
  }
  if ((i + 1) % 5 === 0 || i + 1 === repeats) console.log(`completed ${i + 1}/${repeats}`);
}

async function ffprobe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,duration,sample_rate,channels', '-of', 'json', file], { captureStdout: true });
  return JSON.parse(stdout.toString('utf8'));
}
async function videoHash(file) {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-c:v', 'copy', '-f', 'h264', '-'], { captureStdout: true });
  return crypto.createHash('sha256').update(stdout).digest('hex');
}

const summary = {};
for (const [id, rows] of Object.entries(results)) {
  const mode = modes[id];
  const probe = await ffprobe(mode.output);
  const v = probe.streams.find((x) => x.codec_type === 'video');
  const a = probe.streams.find((x) => x.codec_type === 'audio');
  const videoDuration = Number(v?.duration || probe.format?.duration || 0);
  const audioDuration = Number(a?.duration || 0);
  summary[id] = {
    wallMs: stats(rows.map((x) => x.wallMs)),
    cpuMs: stats(rows.map((x) => x.cpuMs)),
    userMs: stats(rows.map((x) => x.userMs)),
    sysMs: stats(rows.map((x) => x.sysMs)),
    peakRssBytes: stats(rows.map((x) => x.peakRssBytes)),
    outputBytes: fs.statSync(mode.output).size,
    videoElementarySha256: await videoHash(mode.output),
    avDurationDeltaMs: a ? +(Math.abs(videoDuration - audioDuration) * 1000).toFixed(3) : null,
    probe,
  };
}

const A = summary.current_wav_aac_mux.wallMs.p50;
const B = summary.cached_aac_copy_mux.wallMs.p50;
const C = summary.video_only_mux.wallMs.p50;
const cachedAacSavedMs = A - B;
const remainingContainerAudioMs = B;
const estimatedMuxMs = baselineMuxMs * (B / A);
const estimatedFullMs = baselineFullMs - baselineMuxMs + estimatedMuxMs;
const report = {
  schema: 'framewright-r29-audio-mux-scout-v1',
  fixture: { h264Bytes: fs.statSync(h264Path).size, wavBytes: fs.statSync(wavPath).size, cachedAacBytes: fs.statSync(aacPath).size, fps, repeats },
  baselineReference: { fullWallMs: baselineFullMs, audioMuxMs: baselineMuxMs, source: 'I02 corrected same-scene scout run 35134914213' },
  summary,
  decision: {
    p50CurrentMs: A,
    p50CachedAacMs: B,
    p50VideoOnlyMs: C,
    cachedAacSavedMs: +cachedAacSavedMs.toFixed(3),
    cachedAacRelativeReduction: +(cachedAacSavedMs / A).toFixed(4),
    estimatedFullWallMsIfRatioTransfers: +estimatedFullMs.toFixed(3),
    estimatedFullWallReductionMs: +(baselineFullMs - estimatedFullMs).toFixed(3),
    inProcessMuxScoutRecommended: B >= Math.max(200, baselineFullMs * 0.05),
  },
  caveat: 'The full-job estimate transfers only the same-run A->B ratio onto I02 mux wall. It is a prioritization estimate, not a production capacity claim. Final integration must be measured end-to-end.',
};
await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const mb = (n) => (n / 1048576).toFixed(2);
const lines = [
  '# R29 audio/mux boundary scout', '',
  `Fixture: ${mb(report.fixture.h264Bytes)} MiB H.264 + 12s PCM WAV; canonical AAC artifact ${mb(report.fixture.cachedAacBytes)} MiB. ${repeats} measured repetitions after warmup, interleaved order.`, '',
  '| path | p50 wall | p95 wall | p50 CPU | p50 peak RSS | MP4 | A/V delta |',
  '|---|---:|---:|---:|---:|---:|---:|',
];
for (const id of ids) {
  const s = summary[id];
  lines.push(`| ${id} | ${s.wallMs.p50.toFixed(1)} ms | ${s.wallMs.p95.toFixed(1)} ms | ${s.cpuMs.p50.toFixed(1)} ms | ${mb(s.peakRssBytes.p50)} MiB | ${mb(s.outputBytes)} MiB | ${s.avDurationDeltaMs == null ? 'n/a' : `${s.avDurationDeltaMs.toFixed(1)} ms`} |`);
}
lines.push('', `Cached AAC removes **${cachedAacSavedMs.toFixed(1)} ms p50** from the current FFmpeg mux boundary (${(100 * cachedAacSavedMs / A).toFixed(1)}% of that boundary on this runner).`);
lines.push(`If that same relative reduction transfers to the I02 full-job mux stage (${baselineMuxMs.toFixed(1)} ms), the prioritization estimate is **${(baselineFullMs-estimatedFullMs).toFixed(1)} ms** off a ${baselineFullMs.toFixed(1)} ms full job.`);
lines.push(`Residual cached-AAC FFmpeg copy/mux p50 is **${B.toFixed(1)} ms**; video-only mux p50 is **${C.toFixed(1)} ms**.`);
lines.push('', report.decision.inProcessMuxScoutRecommended ? '**Gate:** residual is still large enough to justify a bounded in-process/browser mux scout.' : '**Gate:** residual is below the in-process mux scout threshold; do not add another mux implementation yet.');
lines.push('', 'All three outputs preserve the same elementary video SHA-256 if stream-copy semantics are correct; report.json contains ffprobe validation and hashes.');
const markdown = `${lines.join('\n')}\n`;
await fsp.writeFile(summaryPath, markdown);
console.log(markdown);
