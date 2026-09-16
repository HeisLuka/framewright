#!/usr/bin/env node
// Benchmark the current PNG/dataURL pipeline against the raw RGBA stream using
// the same HTML, seed, actual frame range, encoder settings, and visual code.
//
//   node bench-render.mjs [html=examples/ris-tv/index.html] [frames=300] [width=720] [tabs=5] [outBase=.bench/render]
//
// Env is forwarded, including FW_QUERY, AR, PRESET, CRF, MAXRATE, BUFSIZE,
// VIDEO_CODEC and SEED.
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const [
  ,,
  htmlS = "examples/ris-tv/index.html",
  framesS = "300",
  widthS = "720",
  tabsS = "5",
  outBaseS = ".bench/render",
] = process.argv;

const html = path.resolve(htmlS);
const requestedFrames = Math.max(1, Math.round(Number(framesS) || 300));
const width = Math.max(64, Math.round(Number(widthS) || 720));
const tabs = Math.max(1, Math.round(Number(tabsS) || 5));
const seed = Math.round(Number(process.env.SEED) || 7);
const outBase = path.resolve(outBaseS);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outBase, `${stamp}-${process.pid}`);
const framesDir = path.join(runDir, "png-frames");
const referenceMp4 = path.join(runDir, "reference.mp4");
const rawMp4 = path.join(runDir, "raw.mp4");
const referenceMetricsPath = path.join(runDir, "reference-render.json");
const rawMetricsPath = path.join(runDir, "raw-render.json");
const benchmarkPath = path.join(runDir, "benchmark.json");
const noAudioPath = path.join(runDir, "__no_audio__.wav");

const renderScript = path.join(ROOT, ".agents/skills/framewright/scripts/render.mjs");
const rawScript = path.join(ROOT, ".agents/skills/framewright/scripts/render-raw.mjs");
const buildScript = path.join(ROOT, ".agents/skills/framewright/scripts/build.sh");

await fsp.mkdir(framesDir, { recursive: true });

const elapsed = async (fn) => {
  const start = performance.now();
  await fn();
  return (performance.now() - start) / 1000;
};

const run = (command, args, extraEnv = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} exited with ${code ?? signal}`));
  });
});

const capture = (command, args, extraEnv = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(`${command} exited with ${code ?? signal}\n${stderr.slice(-4000)}`));
  });
});

const referenceEnv = {
  HTML: html,
  FW_ROOT: ROOT,
  START: "0",
  END: String(requestedFrames),
};

console.log(`benchmark: ${html}`);
console.log(`requested range: 0..${requestedFrames - 1}, width=${width}, tabs=${tabs}, seed=${seed}`);
console.log(`run dir: ${runDir}`);

const referenceRenderWallSeconds = await elapsed(() => run(
  process.execPath,
  [renderScript, framesDir, String(seed), String(width), String(tabs)],
  { ...referenceEnv, METRICS_OUT: referenceMetricsPath },
));
const referenceMetrics = JSON.parse(await fsp.readFile(referenceMetricsPath, "utf8"));
const actualStart = Number(referenceMetrics.start);
const actualEnd = Number(referenceMetrics.end);
const actualFrames = actualEnd - actualStart;
if (!Number.isInteger(actualStart) || !Number.isInteger(actualEnd) || actualFrames <= 0) {
  throw new Error(`reference renderer returned invalid range ${actualStart}..${actualEnd}`);
}
if (referenceMetrics.failedFrames || referenceMetrics.successfulFrames !== actualFrames) {
  throw new Error(
    `reference renderer incomplete: successful=${referenceMetrics.successfulFrames} failed=${referenceMetrics.failedFrames} expected=${actualFrames}`,
  );
}

const referenceBuildWallSeconds = await elapsed(() => run(
  "bash",
  [buildScript, referenceMp4, framesDir, noAudioPath],
  { FPS: String(referenceMetrics.fps || 30) },
));

const rawEnv = {
  ...referenceEnv,
  START: String(actualStart),
  END: String(actualEnd),
};
const rawWallSeconds = await elapsed(() => run(
  process.execPath,
  [rawScript, rawMp4, String(seed), String(width), String(tabs)],
  { ...rawEnv, METRICS_OUT: rawMetricsPath, TRACK: noAudioPath },
));
const rawMetrics = JSON.parse(await fsp.readFile(rawMetricsPath, "utf8"));
if (
  Number(rawMetrics.start) !== actualStart
  || Number(rawMetrics.end) !== actualEnd
  || Number(rawMetrics.frames) !== actualFrames
) {
  throw new Error(
    `raw renderer range mismatch: got ${rawMetrics.start}..${rawMetrics.end} (${rawMetrics.frames}), expected ${actualStart}..${actualEnd} (${actualFrames})`,
  );
}

const psnrRun = await capture("ffmpeg", [
  "-v", "info", "-nostats",
  "-i", referenceMp4,
  "-i", rawMp4,
  "-lavfi", "psnr",
  "-f", "null", "-",
]);
const ssimRun = await capture("ffmpeg", [
  "-v", "info", "-nostats",
  "-i", referenceMp4,
  "-i", rawMp4,
  "-lavfi", "ssim",
  "-f", "null", "-",
]);
const psnrText = `${psnrRun.stdout}\n${psnrRun.stderr}`;
const ssimText = `${ssimRun.stdout}\n${ssimRun.stderr}`;
const psnrMatch = /average:([^\s]+)/.exec(psnrText);
const ssimMatch = /All:([^\s]+)/.exec(ssimText);

const referenceTotalWallSeconds = referenceRenderWallSeconds + referenceBuildWallSeconds;
const summary = {
  benchmark: "png-vs-raw-v0",
  html,
  runDir,
  seed,
  requestedFrames,
  frames: actualFrames,
  start: actualStart,
  end: actualEnd,
  width,
  tabs,
  encoder: {
    videoCodec: process.env.VIDEO_CODEC || "libx264",
    preset: process.env.PRESET || "slow",
    crf: process.env.CRF || "22",
    maxrate: process.env.MAXRATE || "14M",
    bufsize: process.env.BUFSIZE || "28M",
  },
  reference: {
    renderWallSeconds: referenceRenderWallSeconds,
    buildWallSeconds: referenceBuildWallSeconds,
    totalWallSeconds: referenceTotalWallSeconds,
    framesPerSecond: actualFrames / Math.max(referenceTotalWallSeconds, 1e-9),
    frameFileBytes: referenceMetrics.frameFileBytes,
    outputBytes: (await fsp.stat(referenceMp4)).size,
    metrics: referenceMetrics,
  },
  raw: {
    wallSeconds: rawWallSeconds,
    framesPerSecond: actualFrames / Math.max(rawWallSeconds, 1e-9),
    outputBytes: (await fsp.stat(rawMp4)).size,
    metrics: rawMetrics,
  },
  speedup: referenceTotalWallSeconds / Math.max(rawWallSeconds, 1e-9),
  visualComparison: {
    psnrAverage: psnrMatch ? psnrMatch[1] : null,
    ssimAll: ssimMatch ? ssimMatch[1] : null,
  },
};

await fsp.writeFile(benchmarkPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
console.log(`benchmark metrics: ${benchmarkPath}`);
