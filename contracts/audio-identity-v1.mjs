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

function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Canonical(value) {
  return sha256(canonicalJson(value));
}

export function audioIdentityInput(spec) {
  const {
    schema: _schema,
    audio_spec_id: _audioSpecId,
    ...rest
  } = spec;
  return rest;
}

export function computeAudioSpecId(spec) {
  return `fwa1_${sha256Canonical(audioIdentityInput(spec))}`;
}

export function assertAudioSpecId(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('audio spec is required');
  const expected = computeAudioSpecId(spec);
  if (spec.audio_spec_id !== expected) {
    throw new Error(`audio_spec_id mismatch: expected ${expected}, got ${spec.audio_spec_id}`);
  }
  return expected;
}

export function assertCanonicalAudioArtifact(spec, artifact, artifactBytes) {
  const audioSpecId = assertAudioSpecId(spec);
  if (!artifact || typeof artifact !== 'object') throw new Error('canonical audio artifact is required');
  if (artifact.audio_spec_id !== audioSpecId) {
    throw new Error(`audio artifact identity mismatch: expected ${audioSpecId}, got ${artifact.audio_spec_id}`);
  }
  if (artifactBytes !== undefined) {
    const actual = sha256(artifactBytes);
    if (artifact.sha256 !== actual) {
      throw new Error(`canonical audio cache corruption: expected ${artifact.sha256}, got ${actual}`);
    }
  }
  return { audioSpecId, artifactSha256: artifact.sha256 };
}
