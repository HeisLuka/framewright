#!/usr/bin/env node
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

const [,, outS = "", widthS = "720", framesS = "450"] = process.argv;
const root = process.cwd();
const html = path.resolve(process.env.HTML || path.join(root, "examples/book-ad-v0/index.html"));
const renderRaw = path.join(root, ".agents/skills/framewright/scripts/render-raw.mjs");
const width = Math.max(64, Math.round(Number(widthS) || 720));
const frames = Math.max(1, Math.round(Number(framesS) || 450));
const seed = Math.round(Number(process.env.SEED) || 7);
const preset = String(process.env.PRESET || "slow");
const crf = String(process.env.CRF || "22");
const matrix = [
  { label: "1video-4tabs", videos: 1, tabs: 4 },
  { label: "2videos-2tabs", videos: 2, tabs: 2 },
  { label: "4videos-1tab", videos: 4, tabs: 1 },
];

const baseDir = path.resolve(process.env.THROUGHPUT_DIR || ".bench/e17-throughput");
await fsp.mkdir(baseDir, { recursive: true });

const runOne = ({ label, index, tabs }) => new Promise((resolve, reject) => {
  const output = path.join(baseDir, `${preset}-${label}-${index}.mp4`);
  const metrics = path.join(baseDir, `${preset}-${label}-${index}.json`);
  const started = performance.now();
  const child = spawn(process.execPath, [renderRaw, output, String(seed + index), String(width), String(tabs)], {
    cwd: root,
    env: {
      ...process.env,
      HTML: html,
      FW_ROOT: root,
      START: "0",
      END: String(frames),
      TRACK: path.join(baseDir, "__no_audio__.wav"),
      PRESET: preset,
      CRF: crf,
      METRICS_OUT: metrics,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    process.stdout.write(`[${label}/${index}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(`[${label}/${index}] ${chunk}`);
  });
  child.once("error", reject);
  child.once("exit", async (code, signal) => {
    if (code !== 0) {
      reject(new Error(`${label}/${index} exited with ${code ?? signal}\n${stderr.slice(-4000)}`));
      return;
    }
    try {
      const parsed = JSON.parse(await fsp.readFile(metrics, "utf8"));
      resolve({
        index,
        tabs,
        wallSeconds: (performance.now() - started) / 1000,
        framesPerSecond: parsed.framesPerSecond,
        outputBytes: parsed.outputBytes,
        metrics: parsed,
        stdoutTail: stdout.slice(-1000),
      });
    } catch (error) {
      reject(error);
    }
  });
});

const scenarios = [];
for (const scenario of matrix) {
  console.log(`\n=== ${scenario.label} preset=${preset} ===`);
  const started = performance.now();
  const jobs = await Promise.all(
    Array.from({ length: scenario.videos }, (_, index) => runOne({
      label: scenario.label,
      index: index + 1,
      tabs: scenario.tabs,
    })),
  );
  const wallSeconds = (performance.now() - started) / 1000;
  const completedFrames = scenario.videos * frames;
  scenarios.push({
    ...scenario,
    preset,
    width,
    framesPerVideo: frames,
    wallSeconds,
    aggregateFramesPerSecond: completedFrames / Math.max(wallSeconds, 1e-9),
    videosPerHour: scenario.videos * 3600 / Math.max(wallSeconds, 1e-9),
    secondsPerCompletedVideoAtSteadyState: wallSeconds / scenario.videos,
    jobs,
  });
}

const best = [...scenarios].sort((a, b) => b.videosPerHour - a.videosPerHour)[0];
const baseline = scenarios[0];
const result = {
  experiment: "E17-video-level-throughput",
  html,
  width,
  framesPerVideo: frames,
  seed,
  preset,
  crf,
  scenarios,
  best: {
    label: best.label,
    videosPerHour: best.videosPerHour,
    throughputVsOneVideoFourTabs: best.videosPerHour / Math.max(baseline.videosPerHour, 1e-9),
  },
  interpretation: {
    metric: "videosPerHour on one runner, not latency of one video",
    caveat: "GitHub Actions runner results characterize this runner only; rerun on the production SKU before capacity planning.",
  },
};

console.log(JSON.stringify(result, null, 2));
if (outS) {
  const out = path.resolve(outS);
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.writeFile(out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
