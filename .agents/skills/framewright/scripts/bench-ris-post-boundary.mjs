#!/usr/bin/env node
import puppeteer from "puppeteer";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [,, outS = "", widthS = "720", countS = "90", seedS = "7"] = process.argv;
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "examples/ris-tv/index.html"));
const width = Math.max(64, Math.round(Number(widthS) || 720));
const requestedCount = Math.max(1, Math.round(Number(countS) || 90));
const seed = Number(seedS);
const start = Math.max(0, Math.trunc(Number(process.env.START) || 0));
const rounds = Math.max(1, Math.min(7, Math.round(Number(process.env.ROUNDS) || 2)));
const aspect = String(process.env.AR || "9:16");

if (!Number.isFinite(seed)) throw new Error("seed must be numeric");
await fsp.access(html);

const query = new URLSearchParams({ f: "0", w: "320", s: String(seed), ar: aspect });
const pageUrl = `${pathToFileURL(html).href}?${query}`;
const browser = await puppeteer.launch({ headless: true, protocolTimeout: 600000 });

const openPage = async () => {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("PAGE ERROR", error.message));
  await page.goto(pageUrl, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction("window.__ready===true", { timeout: 120000 });
  return page;
};

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
    if (!canvas || typeof window.renderFrame !== "function" || typeof window.crt !== "function") {
      throw new Error("RIS TV renderFrame/crt boundary is unavailable");
    }
    const originalCrt = window.crt;
    const copyComposition = (src, dst) => {
      if (dst.width !== src.width || dst.height !== src.height) {
        dst.width = src.width;
        dst.height = src.height;
      }
      const context = dst.getContext("2d", { alpha: false });
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "copy";
      context.drawImage(src, 0, 0);
      context.globalCompositeOperation = "source-over";
    };
    window.crt = mode === "composition" ? copyComposition : originalCrt;
    const t0 = performance.now();
    for (const frame of frames) window.renderFrame(frame, width, seed, canvas);
    const milliseconds = performance.now() - t0;
    window.crt = originalCrt;
    return milliseconds;
  },
  { frames, width, seed, mode },
);

const parityProbe = async (page, frame) => page.evaluate(
  ({ frame, width, seed }) => {
    const canvas = document.querySelector("canvas");
    if (!canvas || typeof window.renderFrame !== "function" || typeof window.crt !== "function") {
      throw new Error("RIS TV renderFrame/crt boundary is unavailable");
    }
    const originalCrt = window.crt;
    const baselineState = window.renderFrame(frame, width, seed, canvas);
    const baseline = canvas.getContext("2d", { alpha: false })
      .getImageData(0, 0, canvas.width, canvas.height).data.slice();
    let capturedState = null;
    window.crt = (src, dst, state, controls) => {
      capturedState = {
        f: state?.f,
        i: state?.i,
        t: state?.t,
        seed: state?.seed,
        name: state?.name,
        post: { ...(controls || state?.post || {}) },
        grain: state?.grain,
        wobble: state?.wobble,
      };
      return originalCrt(src, dst, state, controls);
    };
    const delegatedState = window.renderFrame(frame, width, seed, canvas);
    const delegated = canvas.getContext("2d", { alpha: false })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    window.crt = originalCrt;
    let mismatchBytes = 0;
    for (let index = 0; index < baseline.length; index += 1) {
      if (baseline[index] !== delegated[index]) mismatchBytes += 1;
    }
    const state = capturedState || delegatedState || baselineState;
    return {
      frame,
      width: canvas.width,
      height: canvas.height,
      bytes: baseline.length,
      mismatchBytes,
      metadata: {
        version: 1,
        frame: state?.f ?? frame,
        localFrame: state?.i ?? frame,
        progress: state?.t ?? 0,
        time: (state?.f ?? frame) / 30,
        localTime: (state?.i ?? frame) / 30,
        fps: 30,
        seed: state?.seed ?? seed,
        sceneId: String(state?.name || ""),
        controls: {
          post: {
            ...(state?.post || {}),
            grainMultiplier: Number.isFinite(state?.grain) ? state.grain : 1,
            wobble: Number.isFinite(state?.wobble) ? state.wobble : 0,
            skip: Boolean(state?.post?.skip),
          },
        },
      },
    };
  },
  { frame, width, seed },
);

let page;
try {
  page = await openPage();
  const info = await page.evaluate(() => ({
    total: Number(window.RISO?.total || 0),
    plates: Array.isArray(window.RISO?.plates) ? window.RISO.plates : [],
  }));
  const total = Math.max(1, Math.trunc(info.total || 1));
  const end = Math.min(total, start + requestedCount);
  if (end <= start) throw new Error(`empty frame range ${start}..${end}`);
  const frames = Array.from({ length: end - start }, (_, index) => start + index);
  const parityFrames = representativeFrames(info.plates, total);

  // Warm canvas allocation, crtMap and both dispatch paths before timing.
  await benchmarkMode(page, [frames[0]], "legacy");
  await benchmarkMode(page, [frames[0]], "composition");

  const legacyMs = [];
  const compositionMs = [];
  for (let round = 0; round < rounds; round += 1) {
    legacyMs.push(await benchmarkMode(page, frames, "legacy"));
    compositionMs.push(await benchmarkMode(page, frames, "composition"));
  }

  const parity = [];
  for (const frame of parityFrames) parity.push(await parityProbe(page, frame));
  const parityMismatchBytes = parity.reduce((sum, item) => sum + item.mismatchBytes, 0);
  const legacyMedianMs = median(legacyMs);
  const compositionMedianMs = median(compositionMs);
  const frameCount = frames.length;
  const estimatedPostMs = Math.max(0, legacyMedianMs - compositionMedianMs);

  const result = {
    experiment: "E11-post-processing-boundary-proof",
    html,
    aspect,
    width,
    seed,
    start,
    end,
    frames: frameCount,
    rounds,
    legacyFull: {
      roundMilliseconds: legacyMs,
      medianMilliseconds: legacyMedianMs,
      framesPerSecond: frameCount / Math.max(legacyMedianMs / 1000, 1e-9),
    },
    compositionOnly: {
      roundMilliseconds: compositionMs,
      medianMilliseconds: compositionMedianMs,
      framesPerSecond: frameCount / Math.max(compositionMedianMs / 1000, 1e-9),
    },
    estimatedLegacyCrt: {
      milliseconds: estimatedPostMs,
      shareOfLegacyWallTime: estimatedPostMs / Math.max(legacyMedianMs, 1e-9),
      upperBoundSpeedupIfPostWereFree: legacyMedianMs / Math.max(compositionMedianMs, 1e-9),
    },
    boundaryParity: {
      framesChecked: parity.length,
      mismatchBytes: parityMismatchBytes,
      exact: parityMismatchBytes === 0,
      samples: parity,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (outS) {
    const out = path.resolve(outS);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (parityMismatchBytes !== 0) process.exitCode = 2;
} finally {
  try { if (page) await page.close(); } catch {}
  await browser.close();
}
