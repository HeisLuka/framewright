#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/r41');
const reportPath = path.resolve(process.env.PREFLIGHT_REPORT || path.join(outDir, 'preflight.json'));
const renderNode = process.env.DRI_RENDER_NODE || '/dev/dri/renderD128';
await fsp.mkdir(outDir, { recursive: true });

function run(command, args = []) {
  const r = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return {
    command: [command, ...args].join(' '),
    status: r.status,
    signal: r.signal,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || ''),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function firstAvailable(candidates) {
  for (const [command, args] of candidates) {
    const r = run(command, args);
    if (!r.error && r.status === 0) return r;
  }
  return run(candidates[0][0], candidates[0][1]);
}

const cpuinfo = fs.existsSync('/proc/cpuinfo') ? fs.readFileSync('/proc/cpuinfo', 'utf8') : '';
const cpuModel = cpuinfo.match(/^model name\s*:\s*(.+)$/m)?.[1]?.trim() || null;
const driExists = fs.existsSync('/dev/dri');
const driEntries = driExists ? fs.readdirSync('/dev/dri').sort() : [];
const renderNodeExists = fs.existsSync(renderNode);
const i915Loaded = fs.existsSync('/sys/module/i915');

const uname = run('uname', ['-a']);
const lspci = run('lspci', ['-nnk']);
const vainfo = run('vainfo', ['--display', 'drm', '--device', renderNode]);
const ffmpegEncoders = run('ffmpeg', ['-hide_banner', '-encoders']);
const ffmpegHwaccels = run('ffmpeg', ['-hide_banner', '-hwaccels']);
const intelGpuTop = run('intel_gpu_top', ['-L']);
const chrome = firstAvailable([
  ['google-chrome', ['--version']],
  ['google-chrome-stable', ['--version']],
  ['chromium', ['--version']],
  ['chromium-browser', ['--version']],
]);

const vaText = `${vainfo.stdout}\n${vainfo.stderr}`;
const encoderText = `${ffmpegEncoders.stdout}\n${ffmpegEncoders.stderr}`;
const hwaccelText = `${ffmpegHwaccels.stdout}\n${ffmpegHwaccels.stderr}`;
const pciText = `${lspci.stdout}\n${lspci.stderr}`;
const gpuTopText = `${intelGpuTop.stdout}\n${intelGpuTop.stderr}`;

const h264Vaapi = /\bh264_vaapi\b/.test(encoderText);
const h264Qsv = /\bh264_qsv\b/.test(encoderText);
const vaapiHwaccel = /(?:^|\s)vaapi(?:\s|$)/m.test(hwaccelText);
const h264VaEncode = /H264[^\n]*(?:EncSlice|EncSliceLP)|VAProfileH264[^\n]*(?:EncSlice|EncSliceLP)/i.test(vaText);
const intelDisplay = /VGA compatible controller|Display controller/i.test(pciText) && /Intel/i.test(pciText);
const gpuTopUsable = intelGpuTop.status === 0 && /render|card|drm|i915|xe/i.test(gpuTopText);

const checks = {
  intelCpu: /Intel/i.test(cpuModel || ''),
  intelDisplay,
  i915Loaded,
  driDirectory: driExists,
  renderNodeExists,
  vainfoOk: vainfo.status === 0,
  h264VaEncode,
  h264Vaapi,
  h264Qsv,
  vaapiHwaccel,
  intelGpuTopUsable: gpuTopUsable,
  chromePresent: chrome.status === 0,
};

const hardRequirements = [
  checks.intelCpu,
  checks.intelDisplay,
  checks.renderNodeExists,
  checks.vainfoOk,
  checks.h264VaEncode,
  checks.intelGpuTopUsable,
  checks.chromePresent,
  checks.h264Vaapi || checks.h264Qsv,
];

const report = {
  schema: 'framewright-r41-intel-hw-preflight-v1',
  timestamp: new Date().toISOString(),
  host: {
    hostname: run('hostname', []).stdout.trim() || null,
    cpuModel,
    node: process.version,
    uname: uname.stdout.trim() || null,
    renderNode,
    driEntries,
    chromeVersion: chrome.stdout.trim() || chrome.stderr.trim() || null,
  },
  checks,
  pass: hardRequirements.every(Boolean),
  diagnostics: {
    vainfo,
    ffmpegEncoders,
    ffmpegHwaccels,
    intelGpuTop,
    lspci,
    chrome,
  },
};

await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ schema: report.schema, host: report.host, checks, pass: report.pass }, null, 2));
if (!report.pass && process.env.R41_REQUIRE_HARDWARE === '1') process.exitCode = 2;
