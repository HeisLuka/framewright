import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileRuntimeExecutionPlan, assertRuntimeObservedTimeline, serializeRuntimeExecutionPlan } from './runtime-consumer-v1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(fs.readFileSync(path.join(here, 'examples/video-factory-v1.example.json'), 'utf8'));
const plan = compileRuntimeExecutionPlan(bundle);

assert.equal(plan.render_spec_id, bundle.render.render_spec_id);
assert.equal(plan.creative_id, bundle.creative.creative_id);
assert.equal(plan.canonical_artifact_key, bundle.render.render_spec_id);
assert.equal(plan.delivery.duration_ms, 12000);
assert.equal(plan.delivery.frame_count, 360);
assert.equal(plan.delivery.fps, 30);
assert.equal(plan.video.renderer_id, bundle.render.runtime.renderer.id);
assert.equal(plan.video.bitrate_bps, bundle.render.runtime.encoder.bitrate_bps);
assert.equal(plan.audio.audio_spec_id, bundle.render.audio.spec.audio_spec_id);
assert.equal(plan.audio.expected_sha256, bundle.render.audio.artifact.sha256);
assert.equal(plan.audio.storage_uri, bundle.render.audio.artifact.storage_uri);
assert.ok(assertRuntimeObservedTimeline(plan, { frame_count: 360, fps: 30 }));
assert.equal(serializeRuntimeExecutionPlan(bundle), serializeRuntimeExecutionPlan(structuredClone(bundle)));

const badFrames = structuredClone(plan);
assert.throws(() => assertRuntimeObservedTimeline(badFrames, { frame_count: 359, fps: 30 }), /frame count mismatch/);
const badFps = structuredClone(plan);
assert.throws(() => assertRuntimeObservedTimeline(badFps, { frame_count: 360, fps: 29 }), /fps mismatch/);

const noAudio = structuredClone(bundle);
delete noAudio.render.audio;
noAudio.render.render_spec_id = '';
import { computeRenderSpecId } from './factory-identity-v1.mjs';
noAudio.render.render_spec_id = computeRenderSpecId(noAudio.render);
const silentPlan = compileRuntimeExecutionPlan(noAudio);
assert.equal(silentPlan.audio, null);

const unsupported = structuredClone(bundle);
unsupported.render.runtime.class = 'SPECIAL';
unsupported.render.render_spec_id = computeRenderSpecId(unsupported.render);
assert.throws(() => compileRuntimeExecutionPlan(unsupported), /supports FAST only/);

console.log(JSON.stringify({
  renderSpecId: plan.render_spec_id,
  artifactKey: plan.canonical_artifact_key,
  durationMs: plan.delivery.duration_ms,
  frameCount: plan.delivery.frame_count,
  fps: plan.delivery.fps,
  audioSpecId: plan.audio.audio_spec_id,
  deterministic: true,
  silentRenderSupported: silentPlan.audio === null,
}, null, 2));
