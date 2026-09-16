#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { crtCoreReference } from "./crt-core-reference.mjs";

const [,, binaryS = "artifacts/crt-core"] = process.argv;
process.env.CRT_NATIVE_BIN = path.resolve(binaryS);
const native = await import(pathToFileURL(path.resolve(
  ".agents/skills/framewright/scripts/post-native-crt-core.mjs",
)).href);

const width = 96;
const height = 54;
const rgba = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    rgba[index] = (x * 13 + y * 7) & 255;
    rgba[index + 1] = (x * 3 + y * 17) & 255;
    rgba[index + 2] = (x * 19 + y * 5) & 255;
    rgba[index + 3] = 255;
  }
}

const cases = [
  { frame: 0, seed: 7, post: {} },
  {
    frame: 17,
    seed: 7,
    post: {
      bloom: 0.4,
      vig: 0.21,
      flick: 0.82,
      grainMultiplier: 1.4,
      wobble: 0.002,
    },
  },
  {
    frame: 88,
    seed: 12,
    post: {
      barrel: 0.08,
      ca: 0.003,
      caX: 1.1,
      gain: 1.2,
      grain: 13,
      grainMultiplier: 0.7,
      wobble: 0.004,
    },
  },
  { frame: 91, seed: 12, post: { skip: true } },
];

const results = [];
try {
  for (const item of cases) {
    const metadata = {
      frame: item.frame,
      seed: item.seed,
      controls: { post: item.post },
    };
    const packet = { rgba, metadata };
    const reference = crtCoreReference(rgba, width, height, metadata);
    const actual = await native.processFrame(packet, {
      frame: item.frame,
      width,
      height,
      fps: 30,
    });
    let mismatchBytes = 0;
    let maxDelta = 0;
    for (let index = 0; index < reference.length; index += 1) {
      const delta = Math.abs(reference[index] - actual[index]);
      if (delta) mismatchBytes += 1;
      if (delta > maxDelta) maxDelta = delta;
    }
    const result = { frame: item.frame, mismatchBytes, maxDelta };
    results.push(result);
    if (mismatchBytes !== 0) {
      throw new Error(
        `native CRT parity failed at frame ${item.frame}: ${mismatchBytes} bytes differ, max delta ${maxDelta}`,
      );
    }
  }
} finally {
  await native.close();
}

console.log(JSON.stringify({
  parity: "byte-identical",
  width,
  height,
  cases: results,
}, null, 2));
