import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const ids = assertFactoryIds(example);
if (example.artifact && example.artifact.render_spec_id !== ids.renderSpecId) {
  throw new Error('artifact.render_spec_id does not match render.render_spec_id');
}

console.log(JSON.stringify({
  schema: example.schema,
  creativeId: ids.creativeId,
  renderSpecId: ids.renderSpecId,
  artifactLinked: Boolean(example.artifact),
}, null, 2));
