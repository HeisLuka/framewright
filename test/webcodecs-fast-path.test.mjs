import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalJson,
  createWebCodecsRenderId,
  webCodecsBitrateForWidth,
} from "../src/webcodecs-fast-path.mjs";

test("WebCodecs bitrate policy keeps validated 720/1080 defaults", () => {
  assert.equal(webCodecsBitrateForWidth(540), 1_000_000);
  assert.equal(webCodecsBitrateForWidth(720), 1_000_000);
  assert.equal(webCodecsBitrateForWidth(1080), 2_000_000);
  assert.ok(webCodecsBitrateForWidth(1440) > 2_000_000);
  assert.equal(webCodecsBitrateForWidth(1080, 1_500_000), 1_500_000);
});

test("canonical JSON is independent of object key order", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, b: 3 } }),
    canonicalJson({ a: { b: 3, y: 2 }, z: 1 }),
  );
});

test("render id is stable for identical semantics and changes on visual inputs", () => {
  const base = {
    html: "examples/book-ad-v0/index.html",
    job: "abc",
    seed: 7,
    width: 720,
    bitrate: 1_000_000,
    coverSha256: "cover",
    audioSha256: "audio",
    query: [["strictAssets", "1"]],
  };
  const one = createWebCodecsRenderId(base);
  const two = createWebCodecsRenderId({ ...base });
  assert.equal(one, two);
  assert.match(one, /^fwc1_[a-f0-9]{64}$/);
  assert.notEqual(one, createWebCodecsRenderId({ ...base, seed: 8 }));
  assert.notEqual(one, createWebCodecsRenderId({ ...base, coverSha256: "other" }));
  assert.notEqual(one, createWebCodecsRenderId({ ...base, bitrate: 2_000_000 }));
});
