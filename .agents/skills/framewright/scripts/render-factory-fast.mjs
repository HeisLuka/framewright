#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileRuntimeExecutionPlan, assertRuntimeObservedTimeline } from '../../../../contracts/runtime-consumer-v1.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const INNER_RENDERER = path.join(ROOT, '.agents/skills/framewright/scripts/render-webcodecs.mjs');
const INVOCATION_CWD = process.cwd();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

function flag(v) { return v === true || ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase()); }
function int(v, fallback, label) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative integer`);
  return n;
}
async function sha256File(filename) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('end', resolve);
    stream.once('error', reject);
  });
  return hash.digest('hex');
}
function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}
function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited with ${code ?? signal}: ${stderr.slice(-2000)}`)));
  });
}
async function atomicJson(filename, value) {
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  const tmp = `${filename}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, filename);
}

const options = parseArgs(process.argv.slice(2));
const bundlePath = path.resolve(INVOCATION_CWD, String(options.bundle || process.env.FACTORY_BUNDLE || ''));
if (!bundlePath || !fs.existsSync(bundlePath)) throw new Error('--bundle or FACTORY_BUNDLE must point to a factory bundle JSON');
const bundle = JSON.parse(await fsp.readFile(bundlePath, 'utf8'));
const plan = compileRuntimeExecutionPlan(bundle);
if (flag(options['plan-only'])) { process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`); process.exit(0); }

const ratio = plan.delivery.width / plan.delivery.height;
if (Math.abs(ratio - 9 / 16) > 1e-6) throw new Error(`current Chromium FAST executor supports vertical 9:16 only; got ${plan.delivery.width}x${plan.delivery.height}`);

const out = path.resolve(INVOCATION_CWD, String(options.out || 'factory-fast.mp4'));
const receiptPath = path.resolve(INVOCATION_CWD, String(options['receipt-out'] || `${out}.factory.json`));
const artifactDir = options['artifact-dir'] ? path.resolve(INVOCATION_CWD, String(options['artifact-dir'])) : (process.env.FW_ARTIFACT_DIR ? path.resolve(process.env.FW_ARTIFACT_DIR) : null);
const force = flag(options.force || process.env.FORCE);
const retries = int(options.retries ?? process.env.WEBCODECS_RETRIES, 1, '--retries');
const artifactMp4 = artifactDir ? path.join(artifactDir, `${plan.canonical_artifact_key}.mp4`) : null;
const artifactReceipt = artifactDir ? path.join(artifactDir, `${plan.canonical_artifact_key}.json`) : null;
await fsp.mkdir(path.dirname(out), { recursive: true });
if (artifactDir) await fsp.mkdir(artifactDir, { recursive: true });

if (!force && artifactMp4 && artifactReceipt && fs.existsSync(artifactMp4) && fs.existsSync(artifactReceipt)) {
  const cached = JSON.parse(await fsp.readFile(artifactReceipt, 'utf8'));
  if (cached.render_spec_id === plan.render_spec_id && cached.output?.sha256 === await sha256File(artifactMp4)) {
    if (path.resolve(artifactMp4) !== out) await fsp.copyFile(artifactMp4, out);
    const receipt = { ...cached, invocation: { ...cached.invocation, cache_hit: true, output: out, at: new Date().toISOString() } };
    await atomicJson(receiptPath, receipt);
    console.log(`factory FAST cache hit ${plan.render_spec_id}`);
    process.exit(0);
  }
}

let canonicalAudioPath = null;
if (plan.audio) {
  canonicalAudioPath = path.resolve(INVOCATION_CWD, String(options.audio || process.env.CANONICAL_AUDIO_PATH || ''));
  if (!canonicalAudioPath || !fs.existsSync(canonicalAudioPath)) throw new Error('RenderSpec declares canonical audio; --audio or CANONICAL_AUDIO_PATH is required');
  if (!plan.audio.expected_sha256) throw new Error('RenderSpec canonical audio artifact must declare sha256 before runtime consumption');
  const actualAudioSha = await sha256File(canonicalAudioPath);
  if (actualAudioSha !== plan.audio.expected_sha256) throw new Error(`canonical audio sha256 mismatch: expected ${plan.audio.expected_sha256}, got ${actualAudioSha}`);
}

const rawVideo = plan.audio ? `${out}.video-only.mp4` : out;
const innerReport = `${rawVideo}.report.json`;
const innerEnv = {
  REPORT_OUT: innerReport,
  WEBCODECS_CODEC: plan.video.codec,
  WEBCODECS_LATENCY_MODE: 'realtime',
};
if (process.env.HTML) innerEnv.HTML = process.env.HTML;
if (process.env.PAYLOAD) innerEnv.PAYLOAD = process.env.PAYLOAD;
if (process.env.CI) innerEnv.CI = process.env.CI;

let lastError = null, attemptsUsed = 0;
for (let attempt = 0; attempt <= retries; attempt += 1) {
  attemptsUsed = attempt + 1;
  try {
    await run(process.execPath, [INNER_RENDERER, rawVideo, String(bundle.creative.seed), String(plan.delivery.width), String(plan.video.bitrate_bps)], innerEnv);
    lastError = null;
    break;
  } catch (error) {
    lastError = error;
    if (attempt >= retries) break;
    console.error(`factory FAST render attempt ${attempt + 1} failed: ${error.message}`);
  }
}
if (lastError) throw lastError;

const inner = JSON.parse(await fsp.readFile(innerReport, 'utf8'));
assertRuntimeObservedTimeline(plan, { frame_count: Number(inner.browser?.total), fps: Number(inner.browser?.fps) });
if (Number(inner.browser?.height) !== plan.delivery.height) throw new Error(`runtime height mismatch: expected ${plan.delivery.height}, got ${inner.browser?.height}`);
if (String(inner.browser?.codec?.codec || '').toLowerCase() !== String(plan.video.codec).toLowerCase()) {
  throw new Error(`runtime codec mismatch: expected ${plan.video.codec}, got ${inner.browser?.codec?.codec}`);
}

if (plan.audio) {
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  await run(ffmpeg, ['-hide_banner','-loglevel',process.env.FFMPEG_LOGLEVEL||'error','-y','-i',rawVideo,'-i',canonicalAudioPath,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','copy','-t',(plan.delivery.duration_ms/1000).toFixed(3),'-movflags','+faststart',out]);
  await fsp.rm(rawVideo, { force: true });
}

const probe = await runCapture(process.env.FFPROBE || 'ffprobe', ['-v','error','-count_frames','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames','-of','json',out]);
const media = JSON.parse(probe.stdout);
const video = (media.streams || []).find(s => s.codec_type === 'video');
const audio = (media.streams || []).find(s => s.codec_type === 'audio') || null;
if (Number(video?.nb_read_frames) !== plan.delivery.frame_count) throw new Error(`final MP4 frame count mismatch: expected ${plan.delivery.frame_count}, got ${video?.nb_read_frames}`);
if (plan.audio && !audio) throw new Error('RenderSpec declares audio but final MP4 has no audio stream');
if (!plan.audio && audio) throw new Error('silent RenderSpec unexpectedly produced an audio stream');

const receipt = {
  schema: 'newboo-render-artifact-v1',
  render_spec_id: plan.render_spec_id,
  output: { sha256: await sha256File(out), bytes: (await fsp.stat(out)).size, mime_type: 'video/mp4', duration_ms: Number(media.format?.duration || 0) * 1000, frame_count: Number(video.nb_read_frames), storage_uri: artifactMp4 || out },
  qa: { status: 'pass', checks: [
    { id: 'factory-identity', status: 'pass', details: { render_spec_id: plan.render_spec_id } },
    { id: 'runtime-codec', status: 'pass', details: { expected: plan.video.codec, actual: inner.browser.codec.codec } },
    { id: 'frame-count', status: 'pass', details: { expected: plan.delivery.frame_count, actual: Number(video.nb_read_frames) } },
    { id: 'audio-stream', status: 'pass', details: { expected: Boolean(plan.audio), present: Boolean(audio), audio_spec_id: plan.audio?.audio_spec_id || null } },
  ]},
  metrics: { inner_total_run_ms: inner.totalRunMs || null },
  invocation: { cache_hit: false, attempts: attemptsUsed, runtime_plan_schema: plan.schema },
};
if (artifactMp4 && artifactReceipt) {
  if (path.resolve(out) !== path.resolve(artifactMp4)) await fsp.copyFile(out, artifactMp4);
  await atomicJson(artifactReceipt, { ...receipt, output: { ...receipt.output, storage_uri: artifactMp4 } });
}
await atomicJson(receiptPath, receipt);
await fsp.rm(innerReport, { force: true });
console.log(JSON.stringify(receipt, null, 2));
