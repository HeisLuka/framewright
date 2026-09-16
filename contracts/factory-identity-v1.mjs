import { createHash } from 'node:crypto';

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

export function assertFactoryIds({ creative, render }) {
  const creativeId = computeCreativeId(creative);
  if (creative.creative_id !== creativeId) {
    throw new Error(`creative_id mismatch: expected ${creativeId}, got ${creative.creative_id}`);
  }
  if (render.creative_id !== creative.creative_id) {
    throw new Error(`render.creative_id ${render.creative_id} does not match creative.creative_id ${creative.creative_id}`);
  }
  const renderSpecId = computeRenderSpecId(render);
  if (render.render_spec_id !== renderSpecId) {
    throw new Error(`render_spec_id mismatch: expected ${renderSpecId}, got ${render.render_spec_id}`);
  }
  return { creativeId, renderSpecId };
}
