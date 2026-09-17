#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson } from './factory-identity-v1.mjs';
import { computeContextHash } from './creative-proposal-v1.mjs';
import { loadContextPackForProposal } from './i09-local-video-job-v1.mjs';
import {
  buildTrustedInputBundle,
  installTrustedInputBundle,
  validateTrustedInputBundle,
} from './i21-trusted-input-bundle-v1.mjs';

const clone = value => structuredClone(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function recomputeContext(pack) {
  pack.context_hash = computeContextHash(pack);
  return pack;
}

async function expectCode(promise, code, detailCode = null) {
  try {
    await promise;
    assert.fail(`expected ${code}`);
  } catch (error) {
    if (error?.code === 'ERR_ASSERTION') throw error;
    assert.equal(error?.code, code, `expected ${code}, got ${error?.code}: ${error?.message}`);
    if (detailCode) assert.ok((error.details || []).some(row => row.code === detailCode), `expected detail ${detailCode}: ${JSON.stringify(error.details)}`);
  }
}

async function writeBundle(root, bundle, bytesById) {
  await fsp.mkdir(path.join(root, 'assets'), { recursive: true });
  await fsp.writeFile(path.join(root, 'bundle.json'), `${canonicalJson(bundle)}\n`, 'utf8');
  for (const asset of bundle.assets) {
    const ext = ({ 'image/webp': '.webp', 'image/png': '.png', 'image/jpeg': '.jpg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'video/mp4': '.mp4', 'application/json': '.json' })[asset.media_type];
    await fsp.writeFile(path.join(root, 'assets', `${asset.sha256}${ext}`), bytesById.get(asset.asset_id));
  }
  return path.join(root, 'bundle.json');
}

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'i21-'));
try {
  const stateRoot = path.join(tmp, 'state');
  const example = JSON.parse(await fsp.readFile(new URL('./examples/context-pack-v1.example.json', import.meta.url), 'utf8'));
  const coverBytes = Buffer.from('i21 deterministic cover bytes v1', 'utf8');
  const pack1 = clone(example);
  pack1.context_pack_id = 'ctx_i21_demo';
  pack1.revision = 1;
  pack1.books[0].assets[0].sha256 = sha256(coverBytes);
  pack1.books[0].assets[0].media_type = 'image/webp';
  recomputeContext(pack1);
  const bytes = new Map([[pack1.books[0].assets[0].asset_id, coverBytes]]);
  const bundle1 = buildTrustedInputBundle({ contextPack: pack1, assetBytesById: bytes });
  assert.equal(validateTrustedInputBundle(bundle1).valid, true);

  const bundle1File = await writeBundle(path.join(tmp, 'bundle-1'), bundle1, bytes);
  const first = await installTrustedInputBundle({ bundleFile: bundle1File, stateRoot });
  assert.equal(first.context_action, 'installed');
  assert.equal(first.installed_assets, 1);
  assert.equal(first.reused_assets, 0);
  assert.equal(first.asset_count, 1);

  const loaded1 = await loadContextPackForProposal({ contextDir: path.join(stateRoot, 'context-packs'), proposal: { context_pack_id: pack1.context_pack_id } });
  assert.equal(loaded1.contextPack.context_hash, pack1.context_hash, 'I09 must consume I21-installed ContextPack unchanged');
  assert.equal(loaded1.contextPack.revision, 1);

  const second = await installTrustedInputBundle({ bundleFile: bundle1File, stateRoot });
  assert.equal(second.context_action, 'reused');
  assert.equal(second.installed_assets, 0);
  assert.equal(second.reused_assets, 1);
  assert.equal(second.context_file, first.context_file, 'idempotent install must keep the same context path');

  const pack2 = clone(pack1);
  pack2.revision = 2;
  pack2.account.brand_name = 'NEwBOO I21 revision 2';
  recomputeContext(pack2);
  const bundle2 = buildTrustedInputBundle({ contextPack: pack2, assetBytesById: bytes });
  const bundle2File = await writeBundle(path.join(tmp, 'bundle-2'), bundle2, bytes);
  const upgraded = await installTrustedInputBundle({ bundleFile: bundle2File, stateRoot });
  assert.equal(upgraded.context_action, 'updated');
  assert.equal(upgraded.context_file, first.context_file, 'revision update must atomically replace the existing context file');
  const loaded2 = await loadContextPackForProposal({ contextDir: path.join(stateRoot, 'context-packs'), proposal: { context_pack_id: pack2.context_pack_id } });
  assert.equal(loaded2.contextPack.revision, 2);
  assert.equal(loaded2.contextPack.context_hash, pack2.context_hash);

  await expectCode(installTrustedInputBundle({ bundleFile: bundle1File, stateRoot }), 'CONTEXT_REVISION_ROLLBACK');

  const conflicting = clone(pack2);
  conflicting.account.brand_name = 'same revision, different content';
  recomputeContext(conflicting);
  const conflictBundle = buildTrustedInputBundle({ contextPack: conflicting, assetBytesById: bytes });
  const conflictFile = await writeBundle(path.join(tmp, 'bundle-conflict'), conflictBundle, bytes);
  await expectCode(installTrustedInputBundle({ bundleFile: conflictFile, stateRoot }), 'CONTEXT_REVISION_CONFLICT');

  const badId = clone(bundle2);
  badId.bundle_id = `nbtib1_${'f'.repeat(64)}`;
  const badIdFile = await writeBundle(path.join(tmp, 'bundle-bad-id'), badId, bytes);
  await expectCode(installTrustedInputBundle({ bundleFile: badIdFile, stateRoot }), 'TRUSTED_INPUT_BUNDLE_REJECTED', 'BUNDLE_ID_MISMATCH');

  const missingDescriptor = clone(bundle2);
  missingDescriptor.assets = [];
  missingDescriptor.bundle_id = `nbtib1_${'0'.repeat(64)}`;
  const missingReport = validateTrustedInputBundle(missingDescriptor);
  assert.equal(missingReport.valid, false);
  assert.ok(missingReport.errors.some(row => row.code === 'BUNDLE_ASSET_SET_MISMATCH'));
  assert.ok(missingReport.errors.some(row => row.code === 'BUNDLE_ASSET_MISSING'));

  const pack3 = clone(pack2);
  pack3.revision = 3;
  pack3.account.brand_name = 'must not install after asset tamper';
  recomputeContext(pack3);
  const bundle3 = buildTrustedInputBundle({ contextPack: pack3, assetBytesById: bytes });
  const bundle3Dir = path.join(tmp, 'bundle-3-tampered');
  const bundle3File = await writeBundle(bundle3Dir, bundle3, bytes);
  const bundle3Asset = path.join(bundle3Dir, 'assets', `${bundle3.assets[0].sha256}.webp`);
  await fsp.writeFile(bundle3Asset, 'tampered', 'utf8');
  await expectCode(installTrustedInputBundle({ bundleFile: bundle3File, stateRoot }), 'BUNDLE_ASSET_SIZE_MISMATCH');
  const afterTamper = await loadContextPackForProposal({ contextDir: path.join(stateRoot, 'context-packs'), proposal: { context_pack_id: pack2.context_pack_id } });
  assert.equal(afterTamper.contextPack.revision, 2, 'failed asset verification must not switch ContextPack');
  assert.equal(afterTamper.contextPack.context_hash, pack2.context_hash);

  const symlinkDir = path.join(tmp, 'bundle-symlink');
  const symlinkFile = await writeBundle(symlinkDir, bundle3, bytes);
  const symlinkAsset = path.join(symlinkDir, 'assets', `${bundle3.assets[0].sha256}.webp`);
  const realAsset = path.join(symlinkDir, 'real.webp');
  await fsp.rename(symlinkAsset, realAsset);
  await fsp.symlink(realAsset, symlinkAsset);
  await expectCode(installTrustedInputBundle({ bundleFile: symlinkFile, stateRoot }), 'BUNDLE_ASSET_FILE_INVALID');

  const installedAsset = path.join(stateRoot, 'assets', `${bundle2.assets[0].sha256}.webp`);
  await fsp.writeFile(installedAsset, Buffer.alloc(coverBytes.length, 0));
  await expectCode(installTrustedInputBundle({ bundleFile: bundle2File, stateRoot }), 'INSTALLED_ASSET_HASH_MISMATCH');
  await fsp.writeFile(installedAsset, coverBytes);

  const contextPath = path.join(stateRoot, upgraded.context_file);
  const duplicatePath = path.join(stateRoot, 'context-packs', 'manual-duplicate.json');
  await fsp.copyFile(contextPath, duplicatePath);
  await expectCode(installTrustedInputBundle({ bundleFile: bundle2File, stateRoot }), 'CONTEXT_PACK_AMBIGUOUS');
  await fsp.rm(duplicatePath);

  const receipts = (await fsp.readdir(path.join(stateRoot, 'trusted-input-receipts'))).filter(name => name.endsWith('.json'));
  assert.ok(receipts.includes(`${bundle1.bundle_id}.json`));
  assert.ok(receipts.includes(`${bundle2.bundle_id}.json`));

  console.log(JSON.stringify({
    status: 'PASS',
    bundle_schema: bundle1.schema,
    initial_bundle_id: bundle1.bundle_id,
    upgraded_bundle_id: bundle2.bundle_id,
    installed_context_pack_id: pack2.context_pack_id,
    final_revision: 2,
    asset_count: bundle2.assets.length,
    positive_cases: 3,
    negative_cases: 8,
    i09_store_compatibility: true,
    context_switch_after_asset_verification: true,
  }, null, 2));
} finally {
  await fsp.rm(tmp, { recursive: true, force: true });
}
