import { assertFactoryIds, canonicalJson } from './factory-identity-v1.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function compileRuntimeExecutionPlan(bundle) {
  if (!bundle || typeof bundle !== 'object') throw new Error('factory bundle is required');
  const { creative, render } = bundle;
  const ids = assertFactoryIds({ creative, render });
  if (render.runtime?.class !== 'FAST') {
    throw new Error(`runtime consumer v1 supports FAST only, got ${render.runtime?.class}`);
  }

  const rendererId = requiredString(render.runtime?.renderer?.id, 'render.runtime.renderer.id');
  const rendererVersion = requiredString(render.runtime?.renderer?.version, 'render.runtime.renderer.version');
  const codec = requiredString(render.runtime?.encoder?.video_codec, 'render.runtime.encoder.video_codec');
  const bitrateBps = render.runtime?.encoder?.bitrate_bps;
  if (!Number.isInteger(bitrateBps) || bitrateBps <= 0) {
    throw new Error(`render.runtime.encoder.bitrate_bps must be a positive integer, got ${bitrateBps}`);
  }

  const audio = render.audio ? {
    audio_spec_id: requiredString(render.audio.spec?.audio_spec_id, 'render.audio.spec.audio_spec_id'),
    expected_sha256: render.audio.artifact?.sha256 || null,
    bytes: render.audio.artifact?.bytes || null,
    media_type: render.audio.artifact?.media_type || null,
    storage_uri: render.audio.artifact?.storage_uri || null,
    codec: clone(render.audio.spec.codec),
    timing: clone(render.audio.spec.timing),
    provenance: clone(render.audio.artifact?.provenance || null),
  } : null;

  return {
    schema: 'framewright-runtime-execution-plan-v1',
    render_spec_id: ids.renderSpecId,
    creative_id: ids.creativeId,
    canonical_artifact_key: ids.renderSpecId,
    delivery: {
      id: render.delivery.id,
      width: render.delivery.width,
      height: render.delivery.height,
      fps: render.delivery.fps,
      duration_ms: render.duration_ms,
      frame_count: render.frame_count,
      safe_area_profile: render.delivery.safe_area_profile || null,
      platform_ui_profile: render.delivery.platform_ui_profile || null,
      platform_ui_version: render.delivery.platform_ui_version || null,
    },
    video: {
      renderer_id: rendererId,
      renderer_version: rendererVersion,
      codec,
      bitrate_bps: bitrateBps,
      pixel_format: render.runtime.encoder.pixel_format || null,
      scene_contract_version: render.runtime.scene_contract_version,
      environment_id: render.runtime.environment_id,
    },
    muxer: render.runtime.muxer ? clone(render.runtime.muxer) : null,
    audio,
    assets: clone(render.assets || []),
    artifact_policy: clone(render.artifact_policy),
  };
}

export function assertRuntimeObservedTimeline(plan, observed) {
  if (!plan || plan.schema !== 'framewright-runtime-execution-plan-v1') throw new Error('runtime execution plan v1 required');
  const observedFrames = Number(observed?.frame_count);
  const observedFps = Number(observed?.fps);
  if (observedFrames !== plan.delivery.frame_count) {
    throw new Error(`runtime frame count mismatch: expected ${plan.delivery.frame_count}, got ${observedFrames}`);
  }
  if (observedFps !== plan.delivery.fps) {
    throw new Error(`runtime fps mismatch: expected ${plan.delivery.fps}, got ${observedFps}`);
  }
  const observedDurationMs = Math.round(observedFrames / observedFps * 1000);
  if (observedDurationMs !== plan.delivery.duration_ms) {
    throw new Error(`runtime duration mismatch: expected ${plan.delivery.duration_ms}, observed ${observedDurationMs}`);
  }
  return true;
}

export function serializeRuntimeExecutionPlan(bundle) {
  return `${canonicalJson(compileRuntimeExecutionPlan(bundle))}\n`;
}
