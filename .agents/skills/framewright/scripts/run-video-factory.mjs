#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileDeliveryPackage, serializeDeliveryPackage } from '../../../../contracts/c19-delivery-package-v1.mjs';
import { canonicalJson } from '../../../../contracts/factory-identity-v1.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const FAST = path.join(ROOT, '.agents/skills/framewright/scripts/render-factory-fast.mjs');
const INVOCATION_CWD = process.cwd();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

function sha256Buffer(value) { return createHash('sha256').update(value).digest('hex'); }
async function sha256File(filename) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('end', resolve);
    stream.once('error', reject);
  });
  return hash.digest('hex');
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}

async function atomicWrite(filename, content) {
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  const tmp = `${filename}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, content);
  await fsp.rename(tmp, filename);
}

function requireExecutionBinding(requestRow, compiledCreative) {
  const binding = requestRow.execution;
  if (!binding || typeof binding !== 'object') throw new Error(`${requestRow.selection_id}: execution binding is required`);
  if (!binding.html || !binding.payload) throw new Error(`${requestRow.selection_id}: execution.html and execution.payload are required`);
  if (binding.template_id !== compiledCreative.template?.id || binding.template_version !== compiledCreative.template?.version) {
    throw new Error(`${requestRow.selection_id}: execution template identity does not match CreativeSpec`);
  }
  return binding;
}

async function verifyPhysicalBinding(requestRow, compiledCreative, binding) {
  const html = path.resolve(INVOCATION_CWD, binding.html);
  const payloadPath = path.resolve(INVOCATION_CWD, binding.payload);
  if (!fs.existsSync(html)) throw new Error(`${requestRow.selection_id}: missing HTML ${html}`);
  if (!fs.existsSync(payloadPath)) throw new Error(`${requestRow.selection_id}: missing payload ${payloadPath}`);

  const payloadSha = await sha256File(payloadPath);
  const templateSha = await sha256File(html);
  if (payloadSha !== compiledCreative.payload_sha256) {
    throw new Error(`${requestRow.selection_id}: physical payload SHA does not match CreativeSpec payload_sha256`);
  }
  if (templateSha !== compiledCreative.template?.sha256) {
    throw new Error(`${requestRow.selection_id}: physical HTML SHA does not match CreativeSpec template.sha256`);
  }

  const payload = JSON.parse(await fsp.readFile(payloadPath, 'utf8'));
  if (String(payload.book_id) !== String(compiledCreative.book_id)) {
    throw new Error(`${requestRow.selection_id}: physical payload book_id does not match CreativeSpec`);
  }
  if (String(payload.hook) !== String(compiledCreative.hook?.text)) {
    throw new Error(`${requestRow.selection_id}: physical payload hook does not match CreativeSpec hook`);
  }
  const audioPath = binding.audio ? path.resolve(INVOCATION_CWD, binding.audio) : null;
  if (audioPath && !fs.existsSync(audioPath)) throw new Error(`${requestRow.selection_id}: missing canonical audio ${audioPath}`);
  return { html, payloadPath, payloadSha, templateSha, audioPath };
}

const options = parseArgs(process.argv.slice(2));
const requestPath = path.resolve(INVOCATION_CWD, String(options.request || ''));
if (!requestPath || !fs.existsSync(requestPath)) throw new Error('--request must point to a campaign request JSON');
const outDir = path.resolve(INVOCATION_CWD, String(options['out-dir'] || '.factory-run'));
const artifactDir = path.resolve(INVOCATION_CWD, String(options['artifact-dir'] || path.join(outDir, 'canonical-artifacts')));
await fsp.mkdir(outDir, { recursive: true });
await fsp.mkdir(artifactDir, { recursive: true });

const request = JSON.parse(await fsp.readFile(requestPath, 'utf8'));
const packageManifest = compileDeliveryPackage(request);
const packageBytes = serializeDeliveryPackage(request);
const packageSha256 = sha256Buffer(packageBytes);
await atomicWrite(path.join(outDir, 'delivery-package.json'), packageBytes);

const requestBySelection = new Map(request.selected.map(row => [row.selection_id, row]));
const creativeBySelection = new Map(packageManifest.selected.map(row => [row.selection_id, row.creative]));
const stableArtifacts = [];
const runArtifacts = [];

async function processRender(row) {
  const requestRow = requestBySelection.get(row.selection_id);
  const creative = creativeBySelection.get(row.selection_id);
  if (!requestRow || !creative) throw new Error(`${row.selection_id}: package/request selection mismatch`);
  const binding = requireExecutionBinding(requestRow, creative);
  const physical = await verifyPhysicalBinding(requestRow, creative, binding);
  if (row.render.audio && !physical.audioPath && !process.env.CANONICAL_AUDIO_PATH) {
    throw new Error(`${row.selection_id}: RenderSpec declares audio but execution.audio / CANONICAL_AUDIO_PATH is missing`);
  }

  const bundle = {
    schema: 'newboo-video-factory-bundle-v1',
    creative,
    render: row.render,
  };
  const bundlePath = path.join(outDir, 'bundles', `${row.render.render_spec_id}.json`);
  await atomicWrite(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);

  const output = path.join(outDir, 'video', `${row.render.render_spec_id}.mp4`);
  const receiptPath = path.join(outDir, 'receipts', `${row.render.render_spec_id}.json`);
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await fsp.mkdir(path.dirname(receiptPath), { recursive: true });

  const fastArgs = [
    FAST,
    '--bundle', bundlePath,
    '--out', output,
    '--artifact-dir', artifactDir,
    '--receipt-out', receiptPath,
  ];
  if (row.render.audio && physical.audioPath) fastArgs.push('--audio', physical.audioPath);
  await run(process.execPath, fastArgs, { HTML: physical.html, PAYLOAD: physical.payloadPath, CI: process.env.CI || '' });

  const receipt = JSON.parse(await fsp.readFile(receiptPath, 'utf8'));
  if (receipt.render_spec_id !== row.render.render_spec_id) throw new Error(`${row.render.render_spec_id}: receipt identity mismatch`);
  if (receipt.qa?.status !== 'pass') throw new Error(`${row.render.render_spec_id}: runtime QA did not pass`);

  return {
    stable: {
      selection_id: row.selection_id,
      delivery_profile_id: row.delivery_profile_id,
      creative_id: creative.creative_id,
      render_spec_id: row.render.render_spec_id,
      physical_binding: {
        payload_sha256: physical.payloadSha,
        template_sha256: physical.templateSha,
      },
      output: {
        sha256: receipt.output.sha256,
        bytes: receipt.output.bytes,
        mime_type: receipt.output.mime_type,
        duration_ms: receipt.output.duration_ms,
        frame_count: receipt.output.frame_count,
      },
      qa: {
        status: receipt.qa.status,
        checks: (receipt.qa.checks || []).map(check => ({ id: check.id, status: check.status, details: check.details || null })),
      },
    },
    run: {
      render_spec_id: row.render.render_spec_id,
      cache_hit: Boolean(receipt.invocation?.cache_hit),
      attempts: receipt.invocation?.attempts ?? null,
      runtime_pool: receipt.metrics?.runtime_pool || null,
    },
  };
}

const renderConcurrency = process.env.WEBCODECS_POOL_URL ? 2 : 1;
let cursor = 0;
async function renderWorker() {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= packageManifest.renders.length) return;
    const result = await processRender(packageManifest.renders[index]);
    stableArtifacts.push(result.stable);
    runArtifacts.push(result.run);
  }
}
await Promise.all(Array.from({ length: Math.min(renderConcurrency, Math.max(1, packageManifest.renders.length)) }, () => renderWorker()));

stableArtifacts.sort((a, b) => a.render_spec_id.localeCompare(b.render_spec_id));
runArtifacts.sort((a, b) => a.render_spec_id.localeCompare(b.render_spec_id));
const canonicalManifest = {
  schema: 'newboo-campaign-artifact-manifest-v1',
  campaign_id: packageManifest.campaign_id,
  delivery_package_sha256: packageSha256,
  selected_creatives: packageManifest.counts.selected_creatives,
  render_specs: packageManifest.counts.render_specs,
  reserves: packageManifest.counts.reserves,
  artifacts: stableArtifacts,
};
const canonicalBytes = `${canonicalJson(canonicalManifest)}\n`;
const canonicalSha256 = sha256Buffer(canonicalBytes);
await atomicWrite(path.join(outDir, 'canonical-artifacts.json'), canonicalBytes);
await atomicWrite(path.join(outDir, 'run.json'), `${JSON.stringify({
  schema: 'newboo-video-factory-run-v1',
  campaign_id: packageManifest.campaign_id,
  canonical_manifest_sha256: canonicalSha256,
  cache_hits: runArtifacts.filter(x => x.cache_hit).length,
  render_concurrency: renderConcurrency,
  runtime_pool_pids: [...new Set(runArtifacts.map(x => x.runtime_pool?.pid).filter(Number.isInteger))],
  artifacts: runArtifacts,
}, null, 2)}\n`);

console.log(JSON.stringify({
  campaign_id: packageManifest.campaign_id,
  package_sha256: packageSha256,
  canonical_manifest_sha256: canonicalSha256,
  selected_creatives: packageManifest.counts.selected_creatives,
  render_specs: packageManifest.counts.render_specs,
  reserves: packageManifest.counts.reserves,
  cache_hits: runArtifacts.filter(x => x.cache_hit).length,
  render_concurrency: renderConcurrency,
  runtime_pool_pids: [...new Set(runArtifacts.map(x => x.runtime_pool?.pid).filter(Number.isInteger))],
}, null, 2));
