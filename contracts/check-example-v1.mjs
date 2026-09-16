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
if (!schema.$defs.AudioSpec || !schema.$defs.CanonicalAudioArtifact) {
  throw new Error('canonical audio definitions missing from schema');
}
if (example.render.duration_ms !== example.render.delivery.duration_ms) {
  throw new Error('example render duration differs from delivery duration');
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
  artifactLinked: Boolean(example.artifact),
}, null, 2));
