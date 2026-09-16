#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../../../..');

const STEPS = [
  ['prepare-e12-motion-template.mjs'],
  ['prepare-c22-motion-quality.mjs'],
  ['prepare-e17-responsive-template.mjs'],
  ['prepare-e14-variant-template.mjs'],
  ['prepare-e18-responsive-variants.mjs'],
  ['prepare-c20-cover-adaptive.mjs'],
  ['prepare-c21-hook-grammar.mjs'],
  ['prepare-c23-cover-composition.mjs'],
  ['prepare-c24-reading-pacing.mjs'],
  ['prepare-c25-typography-axis.mjs'],
  ['prepare-c26-platform-safe.mjs', 'examples/book-ad-systems/platform-ui-profiles.v1.json'],
  ['prepare-c27-narrative-template.mjs'],
];

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
async function shaFile(filename) { return sha256(await fsp.readFile(filename)); }

async function runNode(script, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(script)} exited with ${code ?? signal}`)));
  });
}

async function sourceFingerprint() {
  const files = [path.join(ROOT, 'examples/book-ad-systems/index.html')];
  for (const [scriptName, extra] of STEPS) {
    files.push(path.join(SCRIPT_DIR, scriptName));
    if (extra) files.push(path.join(ROOT, extra));
  }
  const rows = [];
  for (const filename of files) {
    if (!fs.existsSync(filename)) throw new Error(`missing local-template source: ${filename}`);
    rows.push([path.relative(ROOT, filename).split(path.sep).join('/'), await shaFile(filename)]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return { rows, build_id: `i09tpl_${sha256(JSON.stringify(rows))}` };
}

export async function ensureLocalVideoTemplate({ outDir = path.join(ROOT, '.local-video-console/runtime') } = {}) {
  const absoluteOut = path.resolve(outDir);
  const output = path.join(absoluteOut, 'index-c27.html');
  const manifestPath = path.join(absoluteOut, 'template-manifest.json');
  const fingerprint = await sourceFingerprint();

  if (fs.existsSync(output) && fs.existsSync(manifestPath)) {
    try {
      const prior = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
      if (prior.build_id === fingerprint.build_id && prior.output_sha256 === await shaFile(output)) {
        return { template_path: output, ...prior, cache_hit: true };
      }
    } catch {}
  }

  await fsp.mkdir(absoluteOut, { recursive: true });
  const stageDir = path.join(absoluteOut, `.stages-${process.pid}`);
  await fsp.rm(stageDir, { recursive: true, force: true });
  await fsp.mkdir(stageDir, { recursive: true });
  let input = path.join(ROOT, 'examples/book-ad-systems/index.html');
  try {
    for (let index = 0; index < STEPS.length; index += 1) {
      const [scriptName, extra] = STEPS[index];
      const script = path.join(SCRIPT_DIR, scriptName);
      const stage = path.join(stageDir, `${String(index + 1).padStart(2, '0')}-${path.basename(scriptName, '.mjs')}.html`);
      const args = [input, stage];
      if (extra) args.push(path.join(ROOT, extra));
      await runNode(script, args);
      input = stage;
    }
    const tmp = `${output}.tmp-${process.pid}`;
    await fsp.copyFile(input, tmp);
    await fsp.rename(tmp, output);
  } finally {
    await fsp.rm(stageDir, { recursive: true, force: true });
  }

  const manifest = {
    schema: 'newboo-i09-local-template-v1',
    build_id: fingerprint.build_id,
    sources: fingerprint.rows.map(([file, sha256]) => ({ file, sha256 })),
    output_sha256: await shaFile(output),
  };
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { template_path: output, ...manifest, cache_hit: false };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i += 1; } else out[key] = true;
  }
  return out;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outcome = await ensureLocalVideoTemplate({ outDir: options['out-dir'] ? path.resolve(String(options['out-dir'])) : undefined });
  console.log(JSON.stringify(outcome, null, 2));
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
