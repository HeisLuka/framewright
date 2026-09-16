#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/i02');
const parityDir = path.join(outDir, 'raster-parity');
const reportPath = path.join(outDir, 'quality-calibration.json');
const summaryPath = path.join(outDir, 'quality-calibration.md');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code ?? signal}\n${stderr.slice(-5000)}`));
    });
  });
}

async function extractFrame(video, frame, output) {
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', video,
    '-vf', `select=eq(n\\,${frame})`, '-vsync', '0', '-frames:v', '1', output,
  ]);
}

async function metric(kind, reference, encoded) {
  const filter = kind === 'ssim' ? '[0:v][1:v]ssim' : '[0:v][1:v]psnr';
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'info', '-i', reference, '-i', encoded,
    '-lavfi', filter, '-f', 'null', '-',
  ]);
  if (kind === 'ssim') {
    const m = [...stderr.matchAll(/All:([0-9.]+)/g)].at(-1);
    return m ? Number(m[1]) : null;
  }
  const m = [...stderr.matchAll(/average:([0-9.]+)/g)].at(-1);
  return m ? Number(m[1]) : null;
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

if (!fs.existsSync(parityDir)) throw new Error(`missing parity dir: ${parityDir}`);
const frames = fs.readdirSync(parityDir)
  .map((name) => name.match(/^browser-(\d+)\.png$/)?.[1])
  .filter(Boolean).map(Number).sort((a, b) => a - b);
if (!frames.length) throw new Error('no browser raster parity PNGs found');

const backends = [
  { id: 'webcodecs-2mbps', video: path.join(outDir, 'web-1.mp4'), refPrefix: 'browser' },
  { id: 'x264-fixed-2mbps', video: path.join(outDir, 'node-fixed-1.mp4'), refPrefix: 'node' },
  { id: 'x264-crf22', video: path.join(outDir, 'node-crf-1.mp4'), refPrefix: 'node' },
];
for (const b of backends) if (!fs.existsSync(b.video)) throw new Error(`missing video: ${b.video}`);

const decodedDir = path.join(outDir, 'decoded-samples');
await fsp.mkdir(decodedDir, { recursive: true });
const result = { schema: 'framewright-i02-own-raster-quality-v1', frames, backends: {} };

for (const backend of backends) {
  const rows = [];
  for (const frame of frames) {
    const reference = path.join(parityDir, `${backend.refPrefix}-${frame}.png`);
    const decoded = path.join(decodedDir, `${backend.id}-${frame}.png`);
    await extractFrame(backend.video, frame, decoded);
    rows.push({
      frame,
      ssim: await metric('ssim', reference, decoded),
      psnr: await metric('psnr', reference, decoded),
    });
  }
  result.backends[backend.id] = { summary: summarize(rows), samples: rows };
}

await fsp.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
const lines = [
  '# I02 codec quality vs own pre-encode raster',
  '',
  '> Each encoder is compared against the lossless sampled raster produced by its own Canvas implementation. This separates codec loss from browser-vs-node raster differences.',
  '',
  '| backend | samples | mean SSIM | worst SSIM | mean PSNR | worst PSNR |',
  '|---|---:|---:|---:|---:|---:|',
];
for (const [id, value] of Object.entries(result.backends)) {
  const s = value.summary;
  lines.push(`| ${id} | ${s.samples} | ${s.ssimMean} | ${s.ssimWorst} | ${s.psnrMean} dB | ${s.psnrWorst} dB |`);
}
lines.push('', `Raw JSON: \`${path.relative(root, reportPath)}\`.`);
const markdown = `${lines.join('\n')}\n`;
await fsp.writeFile(summaryPath, markdown);
console.log(markdown);
