#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { installTrustedInputBundle } from '../../../../contracts/i21-trusted-input-bundle-v1.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../../../..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) throw new Error(`--${key} requires a value`);
    out[key] = next;
    i += 1;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.bundle) throw new Error('usage: install-trusted-input-bundle.mjs --bundle <bundle.json> [--state <state-root>]');
  const stateRoot = path.resolve(args.state || path.join(ROOT, '.local-video-console'));
  const receipt = await installTrustedInputBundle({ bundleFile: path.resolve(args.bundle), stateRoot });
  process.stdout.write(`${JSON.stringify({ ok: true, ...receipt }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code || 'TRUSTED_INPUT_INSTALL_FAILED',
    message: String(error?.message || error),
    details: error?.details || null,
  }, null, 2)}\n`);
  process.exitCode = 1;
});
