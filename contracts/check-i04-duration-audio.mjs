import { createHash } from 'node:crypto';
import {
  assertAudioSpecId,
  assertCanonicalAudioArtifact,
  computeAudioSpecId,
} from './audio-identity-v1.mjs';
import {
  assertFactoryIds,
  computeCreativeId,
  computeRenderSpecId,
} from './factory-identity-v1.mjs';

function expectThrow(fn, pattern) {
  try {
    fn();
  } catch (error) {
    if (pattern.test(String(error.message))) return;
    throw error;
  }
  throw new Error(`expected error matching ${pattern}`);
}

const sourceSha256 = '5'.repeat(64);
const audioSpec = {
  schema: 'framewright-audio-spec-v1',
  audio_spec_id: '',
  version: 1,
  source_sha256: sourceSha256,
  timing: {
    trim_start_ms: 0,
    duration_ms: 12000,
    final_mux_duration_ms: 12000,
  },
  mix: { gain_db: 0, fades: null },
  codec: {
    name: 'aac',
    bitrate_bps: 192000,
    container: 'm4a',
    policy: 'aac-lc-ffmpeg-192k-v2-explicit-duration',
  },
};
audioSpec.audio_spec_id = computeAudioSpecId(audioSpec);
assertAudioSpecId(audioSpec);

const canonicalBytes = Buffer.from('canonical-aac-fixture-v1');
const canonicalSha256 = createHash('sha256').update(canonicalBytes).digest('hex');
const audioArtifact = {
  schema: 'framewright-canonical-audio-v1',
  audio_spec_id: audioSpec.audio_spec_id,
  sha256: canonicalSha256,
  bytes: canonicalBytes.byteLength,
  media_type: 'audio/mp4',
  provenance: {
    encoder: 'ffmpeg-6.1.1',
    policy: audioSpec.codec.policy,
  },
};
assertCanonicalAudioArtifact(audioSpec, audioArtifact, canonicalBytes);
expectThrow(
  () => assertCanonicalAudioArtifact(audioSpec, audioArtifact, Buffer.from('corrupt')),
  /cache corruption/,
);

const driftedAudio = structuredClone(audioSpec);
driftedAudio.codec.policy = 'aac-lc-ffmpeg-192k-v3';
if (computeAudioSpecId(driftedAudio) === audioSpec.audio_spec_id) {
  throw new Error('audio identity did not change when codec policy changed');
}
expectThrow(() => assertAudioSpecId(driftedAudio), /audio_spec_id mismatch/);

const creative = {
  schema: 'newboo-creative-spec-v1',
  creative_id: '',
  book_id: 'i04-fixture',
  payload_sha256: 'a'.repeat(64),
  template: { id: 'fixture', version: '1', sha256: '1'.repeat(64) },
  visual_system: { id: 'swiss', version: '1' },
  structural_variant: 'hook-first',
  hook: { source: 'payload_field', text: 'Fixture' },
  motion: { profile: 'active', version: '1' },
  art_direction: {
    mode: 'template-default',
    algorithm: 'fixture-v1',
    palette: {
      background: '#000000',
      surface: '#111111',
      ink: '#FFFFFF',
      accent: '#FF0000',
      secondary: '#00FF00',
    },
  },
  seed: 1,
  assets: [{ role: 'cover', sha256: '2'.repeat(64), media_type: 'image/jpeg' }],
};
creative.creative_id = computeCreativeId(creative);

const render = {
  schema: 'newboo-render-spec-v1',
  render_spec_id: '',
  creative_id: creative.creative_id,
  duration_ms: 12000,
  delivery: {
    id: 'vertical-1080x1920-v1',
    width: 1080,
    height: 1920,
    fps: 30,
    duration_ms: 12000,
  },
  runtime: {
    class: 'FAST',
    scene_contract_version: 'canvas-scene-v1',
    environment_id: 'fixture',
    renderer: { id: 'webcodecs-h264', version: '1' },
    encoder: { video_codec: 'avc1.42001f', bitrate_bps: 2000000 },
  },
  assets: [],
  audio: { spec: audioSpec, artifact: audioArtifact },
  artifact_policy: { reuse: 'prefer-existing', canonical_key: 'render_spec_id' },
};
render.render_spec_id = computeRenderSpecId(render);
assertFactoryIds({ creative, render });

const retry = structuredClone(render);
retry.artifact_policy.reuse = 'force-render';
if (computeRenderSpecId(retry) !== render.render_spec_id) {
  throw new Error('retry policy changed canonical render identity');
}

const durationMismatch = structuredClone(render);
durationMismatch.delivery.duration_ms = 11999;
expectThrow(() => assertFactoryIds({ creative, render: durationMismatch }), /duration mismatch/);

const audioDurationMismatch = structuredClone(render);
audioDurationMismatch.audio.spec.timing.final_mux_duration_ms = 11999;
expectThrow(() => assertFactoryIds({ creative, render: audioDurationMismatch }), /audio duration mismatch/);

const changedAudio = structuredClone(render);
changedAudio.audio.spec.codec.bitrate_bps = 128000;
changedAudio.audio.spec.audio_spec_id = computeAudioSpecId(changedAudio.audio.spec);
changedAudio.audio.artifact.audio_spec_id = changedAudio.audio.spec.audio_spec_id;
if (computeRenderSpecId(changedAudio) === render.render_spec_id) {
  throw new Error('render_spec_id did not change transitively with audio identity');
}

console.log(JSON.stringify({
  audioSpecId: audioSpec.audio_spec_id,
  renderSpecId: render.render_spec_id,
  checks: [
    'audio identity drift',
    'cache corruption',
    'render/delivery duration mismatch',
    'audio/final-mux duration mismatch',
    'retry idempotency',
    'transitive render identity',
  ],
}, null, 2));
