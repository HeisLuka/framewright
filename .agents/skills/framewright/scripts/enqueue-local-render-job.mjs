#!/usr/bin/env node
import path from 'node:path';
import { enqueueLocalRenderJob } from './local-render-worker.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const options = parseArgs(process.argv.slice(2));
if (!options.request) throw new Error('--request must point to a canonical I03 campaign request JSON');
const result = await enqueueLocalRenderJob({
  queueRoot: path.resolve(String(options.queue || '.local-render-queue')),
  requestPath: path.resolve(String(options.request)),
  workspace: path.resolve(String(options.workspace || process.cwd())),
});
console.log(JSON.stringify(result, null, 2));
