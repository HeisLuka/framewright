import { createHash } from 'node:crypto';
import { assertAudioSpecId } from './audio-identity-v1.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function identityAsset(asset) {
  const out = { role: asset.role, sha256: asset.sha256 };
  if (asset.media_type) out.media_type = asset.media_type;
  return out;
}

function identityAssets(assets = []) {
  return assets
    .map(identityAsset)
    .sort((a, b) => a.role.localeCompare(b.role) || a.sha256.localeCompare(b.sha256));
}

export function creativeIdentityInput(spec) {
  const { creative_id: _creativeId, assets = [], ...rest } = spec;
  return { ...rest, assets: identityAssets(assets) };
}

export function renderIdentityInput(spec) {
  const {
    render_spec_id: _renderSpecId,
    artifact_policy: _artifactPolicy,
    assets = [],
    ...rest
  } = spec;
  return { ...rest, assets: identityAssets(assets) };
}

export function computeCreativeId(spec) {
  return `nvc1_${sha256Canonical(creativeIdentityInput(spec))}`;
}

export function computeRenderSpecId(spec) {
  return `nvr1_${sha256Canonical(renderIdentityInput(spec))}`;
}

function assertPlatformProvenance(delivery) {
  const hasProfile = typeof delivery?.platform_ui_profile === 'string' && delivery.platform_ui_profile.length > 0;
  const hasVersion = typeof delivery?.platform_ui_version === 'string' && delivery.platform_ui_version.length > 0;
  if (hasProfile !== hasVersion) {
    throw new Error('delivery platform provenance must include platform_ui_profile and platform_ui_version together');
  }
}

function assertRenderDuration(render) {
  if (!Number.isInteger(render.duration_ms) || render.duration_ms <= 0) {
    throw new Error(`render.duration_ms must be a positive integer, got ${render.duration_ms}`);
  }
  if (!Number.isInteger(render.frame_count) || render.frame_count <= 0) {
    throw new Error(`render.frame_count must be a positive integer, got ${render.frame_count}`);
  }
  if (render.delivery?.duration_ms !== render.duration_ms) {
    throw new Error(`duration mismatch: render.duration_ms ${render.duration_ms} != delivery.duration_ms ${render.delivery?.duration_ms}`);
  }
  const fps = render.delivery?.fps;
  if (!(typeof fps === 'number' && Number.isFinite(fps) && fps > 0)) {
    throw new Error(`render.delivery.fps must be positive, got ${fps}`);
  }
  const semanticDurationMs = Math.round(render.frame_count / fps * 1000);
  if (semanticDurationMs !== render.duration_ms) {
    throw new Error(`frame/duration mismatch: ${render.frame_count} frames @ ${fps} fps => ${semanticDurationMs}ms, render.duration_ms=${render.duration_ms}`);
  }
  assertPlatformProvenance(render.delivery);
  if (!render.audio) return;
  const audioDuration = render.audio.spec?.timing?.duration_ms;
  const muxDuration = render.audio.spec?.timing?.final_mux_duration_ms;
  if (audioDuration !== render.duration_ms || muxDuration !== render.duration_ms) {
    throw new Error(`audio duration mismatch: render=${render.duration_ms}, audio=${audioDuration}, final_mux=${muxDuration}`);
  }
}

function assertRenderAudio(render) {
  if (!render.audio) return;
  const audioSpecId = assertAudioSpecId(render.audio.spec);
  if (render.audio.artifact && render.audio.artifact.audio_spec_id !== audioSpecId) {
    throw new Error(`audio artifact identity mismatch: expected ${audioSpecId}, got ${render.audio.artifact.audio_spec_id}`);
  }
}

export function assertFactoryIds({ creative, render }) {
  const creativeId = computeCreativeId(creative);
  if (creative.creative_id !== creativeId) {
    throw new Error(`creative_id mismatch: expected ${creativeId}, got ${creative.creative_id}`);
  }
  if (render.creative_id !== creative.creative_id) {
    throw new Error(`render.creative_id ${render.creative_id} does not match creative.creative_id ${creative.creative_id}`);
  }
  assertRenderDuration(render);
  assertRenderAudio(render);
  const renderSpecId = computeRenderSpecId(render);
  if (render.render_spec_id !== renderSpecId) {
    throw new Error(`render_spec_id mismatch: expected ${renderSpecId}, got ${render.render_spec_id}`);
  }
  return { creativeId, renderSpecId };
}
