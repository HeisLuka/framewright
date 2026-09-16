#!/usr/bin/env node
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

const [,, outS = "", widthS = "720", framesS = "450", tabsS = "2"] = process.argv;
const root = process.cwd();
const html = path.resolve(process.env.HTML || path.join(root, "examples/book-ad-v0/index.html"));
const renderRaw = path.join(root, ".agents/skills/framewright/scripts/render-raw.mjs");
const width = Math.max(64, Math.round(Number(widthS) || 720));
const frames = Math.max(1, Math.round(Number(framesS) || 450));
const tabs = Math.max(1, Math.round(Number(tabsS) || 2));
const seed = Math.round(Number(process.env.SEED) || 7);
const crf = String(process.env.CRF || "22");
const presets = String(process.env.PRESETS || "slow,medium,fast,veryfast")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const baseDir = path.resolve(process.env.PRESET_DIR || ".bench/e18-presets");
await fsp.mkdir(baseDir, { recursive: true });

const runPreset = (preset) => new Promise((resolve, reject) => {
  const output = path.join(baseDir, `${preset}.mp4`);
  const metricsPath = path.join(baseDir, `${preset}.json`);
  const started = performance.now();
  const child = spawn(process.execPath, [renderRaw, output, String(seed), String(width), String(tabs)], {
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
      METRICS_OUT: metricsPath,
    },
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", async (code, signal) => {
    if (code !== 0) {
      reject(new Error(`${preset} exited with ${code ?? signal}`));
      return;
    }
    try {
      const metrics = JSON.parse(await fsp.readFile(metricsPath, "utf8"));
      resolve({
        preset,
        wallSeconds: (performance.now() - started) / 1000,
        framesPerSecond: metrics.framesPerSecond,
        outputBytes: metrics.outputBytes,
        metrics,
      });
    } catch (error) {
      reject(error);
    }
  });
});

const results = [];
for (const preset of presets) {
  console.log(`\n=== preset ${preset} ===`);
  results.push(await runPreset(preset));
}
const slow = results.find((item) => item.preset === "slow") || results[0];
const fastest = [...results].sort((a, b) => a.wallSeconds - b.wallSeconds)[0];
const result = {
  experiment: "E18-encoder-preset-matrix",
  html,
  width,
  frames,
  tabs,
  seed,
  crf,
  results: results.map((item) => ({
    ...item,
    speedupVsSlow: slow.wallSeconds / Math.max(item.wallSeconds, 1e-9),
    outputSizeVsSlow: item.outputBytes / Math.max(slow.outputBytes, 1),
  })),
  fastest: {
    preset: fastest.preset,
    wallSeconds: fastest.wallSeconds,
    speedupVsSlow: slow.wallSeconds / Math.max(fastest.wallSeconds, 1e-9),
  },
  interpretation: {
    caveat: "This measures full render+encode wall time at constant CRF. Output size is recorded; subjective/perceptual quality still needs a visual gate before changing production defaults.",
  },
};

console.log(JSON.stringify(result, null, 2));
if (outS) {
  const out = path.resolve(outS);
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.writeFile(out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
