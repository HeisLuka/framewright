import assert from "node:assert/strict";
import test from "node:test";

import {
  compactFrameState,
  compileRenderPlan,
  createFrameState,
  normalizeFrameControls,
} from "../src/motion-core.mjs";

test("normalizes recipe controls into compact serializable frame metadata", () => {
  const plan = compileRenderPlan({
    id: "plan",
    fps: 30,
    scenes: [{ id: "scene", recipe: "recipe", frames: 10 }],
  });
  const baseState = createFrameState(plan, 4, 9);
  const controls = normalizeFrameControls({
    controls: {
      post: { grain: 0.7, bloom: 0.2 },
      cue: "hit",
    },
  });
  const compact = compactFrameState({ ...baseState, controls });

  assert.deepEqual(compact, {
    frame: 4,
    localFrame: 4,
    progress: 4 / 9,
    time: 4 / 30,
    localTime: 4 / 30,
    fps: 30,
    seed: 9,
    sceneId: "scene",
    controls: {
      post: { grain: 0.7, bloom: 0.2 },
      cue: "hit",
    },
  });
  assert.equal(JSON.stringify(compact).includes("plan"), false);
});

test("missing controls produce an empty post object", () => {
  assert.deepEqual(normalizeFrameControls(undefined), { post: {} });
});
