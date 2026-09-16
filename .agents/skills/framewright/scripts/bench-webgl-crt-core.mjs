#!/usr/bin/env node
import puppeteer from "puppeteer";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { crtCoreReference } from "./crt-core-reference.mjs";

const [,, outS = "", widthS = "720", countS = "90", seedS = "7"] = process.argv;
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "examples/ris-tv/index.html"));
const browserScript = path.resolve(
  process.env.WEBGL_CRT_SCRIPT
    || path.join(root, ".agents/skills/framewright/scripts/webgl-crt-core-browser.js"),
);
const width = Math.max(64, Math.round(Number(widthS) || 720));
const requestedCount = Math.max(1, Math.round(Number(countS) || 90));
const seed = Number(seedS);
const rounds = Math.max(1, Math.min(5, Math.round(Number(process.env.ROUNDS) || 2)));
const aspect = String(process.env.AR || "9:16");
const parityWidth = Math.max(64, Math.round(Number(process.env.PARITY_WIDTH) || 96));

if (!Number.isFinite(seed)) throw new Error("seed must be numeric");
await fsp.access(html);
await fsp.access(browserScript);

const query = new URLSearchParams({ f: "0", w: "320", s: String(seed), ar: aspect });
const pageUrl = `${pathToFileURL(html).href}?${query}`;
const launchArgs = ["--enable-webgl", "--ignore-gpu-blocklist"];
if (process.env.CI || process.env.PUPPETEER_NO_SANDBOX === "1") {
  launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
}
const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 600000,
  args: launchArgs,
});

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const representativeFrames = (plates, total) => {
  if (!plates.length) return [0, Math.floor((total - 1) / 2), total - 1];
  const frames = new Set();
  let cursor = 0;
  for (const plate of plates) {
    const len = Math.max(1, Math.trunc(Number(plate.len) || 1));
    frames.add(cursor);
    frames.add(cursor + Math.floor((len - 1) / 2));
    frames.add(cursor + len - 1);
    cursor += len;
  }
  return [...frames].filter((frame) => frame >= 0 && frame < total).slice(0, 24);
};

const benchmarkMode = async (page, frames, mode) => page.evaluate(
  ({ frames, width, seed, mode }) => {
    const canvas = document.querySelector("canvas");
    if (!canvas || typeof window.renderFrame !== "function") {
      throw new Error("RIS TV renderFrame is unavailable");
    }
    window.__FW_LEGACY_CRT ||= window.crt;
    const copyComposition = (src, dst) => {
      if (dst.width !== src.width || dst.height !== src.height) {
        dst.width = src.width;
        dst.height = src.height;
      }
      const context = dst.getContext("2d", { alpha: false });
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = "copy";
      context.drawImage(src, 0, 0);
      context.globalCompositeOperation = "source-over";
    };
    if (mode === "legacy") window.crt = window.__FW_LEGACY_CRT;
    else if (mode === "composition") window.crt = copyComposition;
    else if (mode === "webgl") window.crt = window.FWWebGLCrtCore;
    else throw new Error(`unknown mode ${mode}`);
    const t0 = performance.now();
    for (const frame of frames) window.renderFrame(frame, width, seed, canvas);
    return performance.now() - t0;
  },
  { frames, width, seed, mode },
);

const compositionProbe = async (page, frame) => page.evaluate(
  ({ frame, width, seed }) => {
    const canvas = document.querySelector("canvas");
    window.__FW_LEGACY_CRT ||= window.crt;
    window.crt = (src, dst) => {
      if (dst.width !== src.width || dst.height !== src.height) {
        dst.width = src.width;
        dst.height = src.height;
      }
      const context = dst.getContext("2d", { alpha: false });
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = "copy";
      context.drawImage(src, 0, 0);
      context.globalCompositeOperation = "source-over";
    };
    const state = window.renderFrame(frame, width, seed, canvas);
    const data = canvas.getContext("2d", { alpha: false })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      width: canvas.width,
      height: canvas.height,
      rgba: Array.from(data),
      state: {
        frame: state?.f ?? frame,
        seed: state?.seed ?? seed,
        post: { ...(state?.post || {}) },
        grain: Number.isFinite(state?.grain) ? state.grain : 1,
        wobble: Number.isFinite(state?.wobble) ? state.wobble : 0,
      },
    };
  },
  { frame, width: parityWidth, seed },
);

const webglProbe = async (page, frame) => page.evaluate(
  ({ frame, width, seed }) => {
    const canvas = document.querySelector("canvas");
    window.crt = window.FWWebGLCrtCore;
    window.renderFrame(frame, width, seed, canvas);
    const data = canvas.getContext("2d", { alpha: false })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      width: canvas.width,
      height: canvas.height,
      rgba: Array.from(data),
    };
  },
  { frame, width: parityWidth, seed },
);

const compare = (expected, actual) => {
  if (expected.length !== actual.length) throw new Error("parity byte length mismatch");
  let mismatchBytes = 0;
  let maxDelta = 0;
  let absSum = 0;
  let squaredSum = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const delta = Math.abs(expected[index] - actual[index]);
    if (delta) mismatchBytes += 1;
    maxDelta = Math.max(maxDelta, delta);
    absSum += delta;
    squaredSum += delta * delta;
  }
  const meanAbsDelta = absSum / expected.length;
  const mse = squaredSum / expected.length;
  return {
    mismatchBytes,
    mismatchRatio: mismatchBytes / expected.length,
    maxDelta,
    meanAbsDelta,
    mse,
    psnr: mse === 0 ? null : 10 * Math.log10((255 * 255) / mse),
  };
};

let page;
try {
  page = await browser.newPage();
  page.on("pageerror", (error) => console.error("PAGE ERROR", error.message));
  await page.goto(pageUrl, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction("window.__ready===true", { timeout: 120000 });
  await page.addScriptTag({ path: browserScript });
  const info = await page.evaluate(() => ({
    total: Number(window.RISO?.total || 0),
    plates: Array.isArray(window.RISO?.plates) ? window.RISO.plates : [],
    webgl: window.FWWebGLCrtInfo(),
  }));
  const total = Math.max(1, Math.trunc(info.total || 1));
  const count = Math.min(total, requestedCount);
  const frames = Array.from({ length: count }, (_, index) => index);

  await benchmarkMode(page, [frames[0]], "legacy");
  await benchmarkMode(page, [frames[0]], "composition");
  await benchmarkMode(page, [frames[0]], "webgl");

  const times = { legacy: [], composition: [], webgl: [] };
  for (let round = 0; round < rounds; round += 1) {
    for (const mode of ["legacy", "composition", "webgl"]) {
      times[mode].push(await benchmarkMode(page, frames, mode));
    }
  }

  const parity = [];
  for (const frame of representativeFrames(info.plates, total)) {
    const composition = await compositionProbe(page, frame);
    const metadata = {
      frame: composition.state.frame,
      seed: composition.state.seed,
      controls: {
        post: {
          ...composition.state.post,
          grainMultiplier: composition.state.grain,
          wobble: composition.state.wobble,
        },
      },
    };
    const expected = crtCoreReference(
      Uint8Array.from(composition.rgba),
      composition.width,
      composition.height,
      metadata,
    );
    const actualProbe = await webglProbe(page, frame);
    const metrics = compare(expected, Uint8Array.from(actualProbe.rgba));
    parity.push({ frame, ...metrics });
  }

  const aggregate = parity.reduce((acc, item) => {
    acc.mismatchBytes += item.mismatchBytes;
    acc.maxDelta = Math.max(acc.maxDelta, item.maxDelta);
    acc.meanAbsDelta += item.meanAbsDelta;
    acc.mse += item.mse;
    return acc;
  }, { mismatchBytes: 0, maxDelta: 0, meanAbsDelta: 0, mse: 0 });
  aggregate.meanAbsDelta /= Math.max(1, parity.length);
  aggregate.mse /= Math.max(1, parity.length);
  aggregate.psnr = aggregate.mse === 0 ? null : 10 * Math.log10((255 * 255) / aggregate.mse);

  const result = {
    experiment: "E14-webgl-crt-core",
    html,
    width,
    parityWidth,
    seed,
    frames: count,
    rounds,
    webgl: info.webgl,
    performance: Object.fromEntries(Object.entries(times).map(([mode, values]) => {
      const milliseconds = median(values);
      return [mode, {
        roundMilliseconds: values,
        medianMilliseconds: milliseconds,
        framesPerSecond: count / Math.max(milliseconds / 1000, 1e-9),
      }];
    })),
    parity: {
      note: "WebGL core only; Chromium bloom/glass are intentionally excluded",
      aggregate,
      frames: parity,
    },
  };
  console.log(JSON.stringify(result, null, 2));
  if (outS) {
    const out = path.resolve(outS);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
} finally {
  try { if (page) await page.close(); } catch {}
  await browser.close();
}
