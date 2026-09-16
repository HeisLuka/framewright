import { createHash } from 'node:crypto';
import { compileDeliveryPackage, serializeDeliveryPackage } from './c19-delivery-package-v1.mjs';

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const H = c => c.repeat(64);

const request = {
  schema: 'framewright-c19-campaign-request-v1',
  campaign_id: 'c19-contract-fixture',
  compiler_policy_version: 'c19-delivery-package-v1',
  runtime: {
    class: 'FAST',
    scene_contract_version: 'canvas-scene-v1',
    environment_id: 'video-worker-chromium-v1',
    renderer: { id: 'webcodecs-h264', version: 'r35-standard-v1' },
    encoder: { video_codec: 'avc1.420028', bitrate_bps: 3000000, pixel_format: 'yuv420p' },
    muxer: { id: 'ffmpeg-stream-copy-aac', version: '6.1.1' },
  },
  delivery_profiles: [
    { id: 'vertical-generic-v1', width: 1080, height: 1920, fps: 30, safe_area_profile: 'c26-ui-safe-v1-2026-09-17:generic', platform_ui_profile: 'generic', platform_ui_version: 'c26-ui-safe-v1-2026-09-17' },
    { id: 'vertical-youtube-shorts-v1', width: 1080, height: 1920, fps: 30, safe_area_profile: 'c26-ui-safe-v1-2026-09-17:youtube_shorts', platform_ui_profile: 'youtube_shorts', platform_ui_version: 'c26-ui-safe-v1-2026-09-17' },
    { id: 'vertical-instagram-reels-v1', width: 1080, height: 1920, fps: 30, safe_area_profile: 'c26-ui-safe-v1-2026-09-17:instagram_reels', platform_ui_profile: 'instagram_reels', platform_ui_version: 'c26-ui-safe-v1-2026-09-17' },
  ],
  selected: [{
    selection_id: 'selected-a',
    creative: {
      schema: 'newboo-creative-spec-v1',
      book_id: 'book-a',
      payload_sha256: H('a'),
      template: { id: 'book-ad-systems', version: 'c26', sha256: H('1') },
      visual_system: { id: 'swiss', version: 'v1' },
      structural_variant: 'hook-first',
      hook: { source: 'human_verified', text: 'A verified hook.', source_ref: 'fixture:v1' },
      motion: { profile: 'finite-choreography', version: 'c22-v1' },
      art_direction: {
        mode: 'cover-derived', algorithm: 'c20-cover-adaptive-v1', source_cover_sha256: H('2'),
        palette: { background: '#F2EFE8', surface: '#FFFFFF', ink: '#101010', accent: '#D13C2F', secondary: '#315A7D' },
      },
      seed: 7,
      assets: [{ role: 'cover', sha256: H('2'), media_type: 'image/jpeg', uri: 'asset://book-a-cover' }],
    },
    timeline: { source: 'c24-semantic-timeline', policy_version: 'c24-reading-pacing-v1', duration_ms: 9000, frame_count: 270 },
    requested_delivery_profile_ids: ['vertical-youtube-shorts-v1', 'vertical-instagram-reels-v1'],
    render_assets: [],
  }],
  reserves: [{ reserve_id: 'reserve-b', reason: 'bounded-selection-reserve' }],
};

const first = compileDeliveryPackage(request);
const bytesA = serializeDeliveryPackage(request);
const bytesB = serializeDeliveryPackage(structuredClone(request));
assert(bytesA === bytesB, 'manifest is not byte-identical across deterministic rebuilds');
assert(first.counts.selected_creatives === 1, 'expected one selected creative');
assert(first.counts.render_specs === 2, 'expected exactly two requested RenderSpecs');
assert(first.counts.reserves === 1, 'expected one reserve');
assert(first.renders.every(x => x.render.creative_id === first.selected[0].creative.creative_id), 'creative_id changed across delivery profiles');
assert(new Set(first.renders.map(x => x.render.render_spec_id)).size === 2, 'delivery profiles did not produce distinct render_spec_id values');
assert(first.renders.every(x => x.render.duration_ms === 9000 && x.render.frame_count === 270), 'semantic timeline did not own render duration/frame count');
assert(first.renders.every(x => x.render.delivery.platform_ui_version === 'c26-ui-safe-v1-2026-09-17'), 'C26 platform provenance missing');
assert(first.renders.every(x => x.render.runtime.encoder.video_codec === 'avc1.420028' && x.render.runtime.encoder.bitrate_bps === 3000000), 'C19 fixture drifted from canonical R35 FAST encoder policy');
assert(first.renders.every(x => !('audio' in x.render)), 'compiler invented audio for a campaign without audio input');
assert(first.renders.every(x => x.selection_id !== 'reserve-b'), 'reserve received a RenderSpec');
assert(!bytesA.includes('"render":{"audio"'), 'serialized package unexpectedly contains audio');

const digest = createHash('sha256').update(bytesA).digest('hex');
console.log(JSON.stringify({
  schema: first.schema,
  selectedCreatives: first.counts.selected_creatives,
  renderSpecs: first.counts.render_specs,
  reserves: first.counts.reserves,
  creativeId: first.selected[0].creative.creative_id,
  renderSpecIds: first.renders.map(x => x.render.render_spec_id),
  manifestSha256: digest,
  byteIdentical: bytesA === bytesB,
  audioInvented: false,
  canonicalFastCodec: first.renders[0].render.runtime.encoder.video_codec,
}, null, 2));
