import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const payloadRel = 'examples/book-ad-v0/payload.example.json';
const htmlRel = 'examples/book-ad-v0/index.html';
const out = path.resolve(process.argv[2] || '.bench/i03/request.json');

function sha256File(filename) {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

const payloadPath = path.join(ROOT, payloadRel);
const htmlPath = path.join(ROOT, htmlRel);
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const payloadSha256 = sha256File(payloadPath);
const templateSha256 = sha256File(htmlPath);

const request = {
  schema: 'framewright-c19-campaign-request-v1',
  campaign_id: 'i03-e2e-fixture',
  compiler_policy_version: 'c19-delivery-package-v1',
  runtime: {
    class: 'FAST',
    scene_contract_version: 'canvas-scene-v1',
    environment_id: 'video-worker-chromium-v1',
    renderer: { id: 'webcodecs-h264', version: 'r39-standard-v1' },
    encoder: { video_codec: 'avc1.420028', bitrate_bps: 3000000, pixel_format: 'yuv420p' },
    muxer: { id: 'ffmpeg-stream-copy-aac', version: '6.1.1' },
  },
  delivery_profiles: [
    {
      id: 'vertical-generic-v1', width: 1080, height: 1920, fps: 30,
      safe_area_profile: 'generic-v1',
    },
  ],
  selected: [{
    selection_id: 'demo-001-primary',
    creative: {
      schema: 'newboo-creative-spec-v1',
      book_id: payload.book_id,
      payload_sha256: payloadSha256,
      template: { id: 'book-ad-v0', version: 'v0', sha256: templateSha256 },
      visual_system: { id: 'book-ad-v0', version: 'v0' },
      structural_variant: 'hook-first',
      hook: { source: 'human_verified', text: payload.hook, source_ref: `${payloadRel}#hook` },
      motion: { profile: 'book-ad-v0', version: 'v0' },
      art_direction: {
        mode: 'payload-pinned', algorithm: 'book-ad-v0', source_cover_sha256: null,
        palette: {
          background: payload.background,
          surface: payload.background,
          ink: payload.ink,
          accent: payload.accent,
          secondary: payload.accent,
        },
      },
      seed: 7,
      assets: [],
    },
    timeline: {
      source: 'book-ad-v0-canonical-timeline',
      policy_version: 'v0-12s-30fps',
      duration_ms: 12000,
      frame_count: 360,
    },
    requested_delivery_profile_ids: ['vertical-generic-v1'],
    render_assets: [],
    execution: {
      html: htmlRel,
      payload: payloadRel,
      template_id: 'book-ad-v0',
      template_version: 'v0',
    },
  }],
  reserves: [{ reserve_id: 'demo-001-reserve', reason: 'bounded-i03-proof' }],
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(request, null, 2)}\n`);
console.log(JSON.stringify({ out, payloadSha256, templateSha256 }, null, 2));
