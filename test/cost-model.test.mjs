import assert from "node:assert/strict";
import test from "node:test";

import { estimateRenderCost, estimateFromMetrics } from "../.agents/skills/framewright/scripts/cost-model.mjs";

test("cost model converts render fps into wall time and unit economics", () => {
  const result = estimateRenderCost({
    framesPerSecond: 5,
    videoSeconds: 15,
    outputFps: 30,
    hourlyUsd: 0.072,
  });
  assert.equal(result.frames, 450);
  assert.equal(result.renderSeconds, 90);
  assert.equal(result.videosPerHour, 40);
  assert.equal(result.costPerVideoUsd, 0.0018);
  assert.equal(result.costPerThousandUsd, 1.8);
  assert.equal(result.costPerHundredThousandUsd, 180);
});

test("cost model reads framesPerSecond from renderer metrics", () => {
  const result = estimateFromMetrics(
    { framesPerSecond: 10 },
    { videoSeconds: 40, outputFps: 30, hourlyUsd: 0.1 },
  );
  assert.equal(result.frames, 1200);
  assert.equal(result.renderSeconds, 120);
  assert.ok(Math.abs(result.costPerVideoUsd - (0.1 / 30)) < 1e-12);
});

test("cost model rejects invalid throughput", () => {
  assert.throws(() => estimateRenderCost({
    framesPerSecond: 0,
    videoSeconds: 15,
    outputFps: 30,
    hourlyUsd: 0.1,
  }), /framesPerSecond/);
});
