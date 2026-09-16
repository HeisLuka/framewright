import assert from "node:assert/strict";
import test from "node:test";

import {
  compactLegacyRisFrameState,
  createFramePacket,
  decodeFrameMetadataHeader,
  encodeFrameMetadataHeader,
  normalizeFrameMetadata,
} from "../.agents/skills/framewright/scripts/frame-packet.mjs";

test("legacy RIS state becomes the exact compact CRT control surface", () => {
  const metadata = compactLegacyRisFrameState({
    f: 91,
    i: 31,
    t: 0.5,
    seed: 7,
    name: "count",
    post: { bloom: 0.4, grain: 11, flick: 0.8, skip: false },
    grain: 1.6,
    wobble: 0.003,
  });

  assert.equal(metadata.frame, 91);
  assert.equal(metadata.localFrame, 31);
  assert.equal(metadata.sceneId, "count");
  assert.equal(metadata.seed, 7);
  assert.deepEqual(metadata.controls.post, {
    bloom: 0.4,
    grain: 11,
    flick: 0.8,
    skip: false,
    grainMultiplier: 1.6,
    wobble: 0.003,
  });
});

test("metadata header round-trips compact controls including unicode cues", () => {
  const source = normalizeFrameMetadata({
    frame: 12,
    localFrame: 2,
    progress: 0.25,
    fps: 30,
    seed: 9,
    sceneId: "cover",
    controls: {
      cue: "обложка",
      post: { vignette: 0.2, bloom: 0.3 },
    },
  });
  const decoded = decodeFrameMetadataHeader(encodeFrameMetadataHeader(source), { expectedFrame: 12 });
  assert.deepEqual(decoded, source);
});

test("frame metadata cannot silently drift away from RGBA frame id", () => {
  const encoded = encodeFrameMetadataHeader({ frame: 8, controls: { post: {} } });
  assert.throws(
    () => decodeFrameMetadataHeader(encoded, { expectedFrame: 9 }),
    /metadata mismatch/,
  );
});

test("frame packet keeps RGBA and controls as one ordered value", () => {
  const rgba = Buffer.alloc(16, 7);
  const packet = createFramePacket(
    rgba,
    { frame: 4, seed: 3, controls: { post: { wobble: 0.001 } } },
    { expectedBytes: 16 },
  );
  assert.equal(packet.rgba, rgba);
  assert.equal(packet.metadata.frame, 4);
  assert.equal(packet.metadata.controls.post.wobble, 0.001);
});
