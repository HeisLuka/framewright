import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAudioSpecId } from './audio-identity-v1.mjs';
import { assertFactoryIds } from './factory-identity-v1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, 'video-factory-v1.schema.json');
const examplePath = path.join(here, 'examples/video-factory-v1.example.json');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));

if (schema.$id !== 'https://newboo.dev/contracts/video-factory-v1.schema.json') {
  throw new Error(`unexpected schema id: ${schema.$id}`);
}
if (example.schema !== 'newboo-video-factory-bundle-v1') {
  throw new Error(`unexpected bundle schema: ${example.schema}`);
}
if (!schema.$defs.RenderSpec.required.includes('duration_ms')) {
  throw new Error('RenderSpec.duration_ms is not required by schema');
}
if (!schema.$defs.RenderSpec.required.includes('frame_count')) {
  throw new Error('RenderSpec.frame_count is not required by schema');
}
if (!schema.$defs.DeliveryProfile.properties.platform_ui_profile || !schema.$defs.DeliveryProfile.properties.platform_ui_version) {
  throw new Error('DeliveryProfile platform UI provenance fields are missing from schema');
}
if (!schema.$defs.AudioSpec || !schema.$defs.CanonicalAudioArtifact) {
  throw new Error('canonical audio definitions missing from schema');
}
if (example.render.duration_ms !== example.render.delivery.duration_ms) {
  throw new Error('example render duration differs from delivery duration');
}
const expectedFrames = Math.round(example.render.duration_ms / 1000 * example.render.delivery.fps);
if (example.render.frame_count !== expectedFrames) {
  throw new Error(`example render frame_count ${example.render.frame_count} != expected ${expectedFrames}`);
}
if (example.render.audio) assertAudioSpecId(example.render.audio.spec);

const ids = assertFactoryIds(example);
if (example.artifact && example.artifact.render_spec_id !== ids.renderSpecId) {
  throw new Error('artifact.render_spec_id does not match render.render_spec_id');
}

console.log(JSON.stringify({
  schema: example.schema,
  creativeId: ids.creativeId,
  renderSpecId: ids.renderSpecId,
  audioSpecId: example.render.audio?.spec?.audio_spec_id || null,
  durationMs: example.render.duration_ms,
  frameCount: example.render.frame_count,
  artifactLinked: Boolean(example.artifact),
}, null, 2));
