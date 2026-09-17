import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from './factory-identity-v1.mjs';
import { validateContextPack } from './creative-proposal-v1.mjs';

export const TRUSTED_INPUT_BUNDLE_SCHEMA = 'newboo-video-trusted-input-bundle-v1';
export const TRUSTED_INPUT_BUNDLE_LAYOUT = 'sha256-filename-v1';
export const TRUSTED_INPUT_BUNDLE_PREFIX = 'nbtib1_';

const MAX_BUNDLE_JSON_BYTES = 16 * 1024 * 1024;
const MAX_ASSET_BYTES = 512 * 1024 * 1024;
const ALLOWED_BUNDLE_KEYS = new Set(['schema', 'bundle_id', 'asset_layout', 'context_pack', 'assets']);
const ALLOWED_ASSET_KEYS = new Set(['asset_id', 'book_id', 'role', 'sha256', 'media_type', 'bytes']);
const MEDIA_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['audio/mpeg', '.mp3'],
  ['audio/mp4', '.m4a'],
  ['video/mp4', '.mp4'],
  ['application/json', '.json'],
]);

function fail(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filename) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('end', resolve);
    stream.once('error', reject);
  });
  return hash.digest('hex');
}

function unknownKeys(value, allowed) {
  return Object.keys(value || {}).filter(key => !allowed.has(key)).sort();
}

function assertRegularFileStat(stat, filename, code) {
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code, `expected regular non-symlink file: ${filename}`);
}

async function assertRegularFile(filename, code) {
  let stat;
  try { stat = await fsp.lstat(filename); }
  catch (error) {
    if (error?.code === 'ENOENT') fail(code, `missing file: ${filename}`);
    throw error;
  }
  assertRegularFileStat(stat, filename, code);
  return stat;
}

function extensionFor(mediaType) {
  const ext = MEDIA_EXTENSIONS.get(String(mediaType || '').toLowerCase());
  if (!ext) fail('BUNDLE_ASSET_MEDIA_TYPE_UNSUPPORTED', `unsupported asset media_type: ${mediaType || '(missing)'}`);
  return ext;
}

function assetDescriptorsFromContext(pack) {
  const out = [];
  for (const book of pack.books || []) {
    for (const asset of book.assets || []) {
      if (typeof asset.media_type !== 'string' || !asset.media_type) {
        fail('BUNDLE_ASSET_MEDIA_TYPE_REQUIRED', `ContextPack asset ${asset.asset_id || '(missing id)'} needs media_type for local sync`);
      }
      extensionFor(asset.media_type);
      out.push({
        asset_id: asset.asset_id,
        book_id: book.book_id,
        role: asset.role,
        sha256: asset.sha256,
        media_type: asset.media_type,
      });
    }
  }
  return out.sort((a, b) => a.asset_id.localeCompare(b.asset_id) || a.book_id.localeCompare(b.book_id));
}

function normalizedBundleAssets(assets) {
  return [...assets]
    .map(asset => ({
      asset_id: asset.asset_id,
      book_id: asset.book_id,
      role: asset.role,
      sha256: asset.sha256,
      media_type: asset.media_type,
      bytes: asset.bytes,
    }))
    .sort((a, b) => a.asset_id.localeCompare(b.asset_id) || a.book_id.localeCompare(b.book_id));
}

function bundleIdentityInput(bundle) {
  return {
    schema: bundle.schema,
    asset_layout: bundle.asset_layout,
    context_pack_id: bundle.context_pack?.context_pack_id,
    context_hash: bundle.context_pack?.context_hash,
    context_revision: bundle.context_pack?.revision,
    assets: normalizedBundleAssets(bundle.assets || []),
  };
}

export function computeTrustedInputBundleId(bundle) {
  return `${TRUSTED_INPUT_BUNDLE_PREFIX}${sha256Bytes(Buffer.from(canonicalJson(bundleIdentityInput(bundle)), 'utf8'))}`;
}

export function validateTrustedInputBundle(bundle) {
  const errors = [];
  const add = (code, field, message) => errors.push({ code, field, message });
  if (!isObject(bundle)) return { valid: false, errors: [{ code: 'BUNDLE_OBJECT_REQUIRED', field: '', message: 'bundle must be an object' }] };

  for (const key of unknownKeys(bundle, ALLOWED_BUNDLE_KEYS)) add('BUNDLE_UNKNOWN_FIELD', key, `unknown bundle field ${key}`);
  if (bundle.schema !== TRUSTED_INPUT_BUNDLE_SCHEMA) add('BUNDLE_SCHEMA_MISMATCH', 'schema', `expected ${TRUSTED_INPUT_BUNDLE_SCHEMA}`);
  if (bundle.asset_layout !== TRUSTED_INPUT_BUNDLE_LAYOUT) add('BUNDLE_LAYOUT_MISMATCH', 'asset_layout', `expected ${TRUSTED_INPUT_BUNDLE_LAYOUT}`);
  if (typeof bundle.bundle_id !== 'string' || !/^nbtib1_[a-f0-9]{64}$/.test(bundle.bundle_id)) add('BUNDLE_ID_INVALID', 'bundle_id', 'bundle_id must match nbtib1_<sha256>');

  const contextReport = validateContextPack(bundle.context_pack);
  if (!contextReport.valid) add('BUNDLE_CONTEXT_INVALID', 'context_pack', 'embedded ContextPack is invalid');

  if (!Array.isArray(bundle.assets)) add('BUNDLE_ASSETS_INVALID', 'assets', 'assets must be an array');
  const assets = Array.isArray(bundle.assets) ? bundle.assets : [];
  const seen = new Set();
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    if (!isObject(asset)) { add('BUNDLE_ASSET_OBJECT_REQUIRED', `assets/${index}`, 'asset descriptor must be an object'); continue; }
    for (const key of unknownKeys(asset, ALLOWED_ASSET_KEYS)) add('BUNDLE_ASSET_UNKNOWN_FIELD', `assets/${index}/${key}`, `unknown asset field ${key}`);
    for (const key of ['asset_id', 'book_id', 'role', 'sha256', 'media_type']) {
      if (typeof asset[key] !== 'string' || !asset[key]) add('BUNDLE_ASSET_FIELD_INVALID', `assets/${index}/${key}`, `${key} must be a non-empty string`);
    }
    if (typeof asset.sha256 === 'string' && !/^[a-f0-9]{64}$/.test(asset.sha256)) add('BUNDLE_ASSET_SHA256_INVALID', `assets/${index}/sha256`, 'sha256 must be lowercase hex');
    if (!Number.isInteger(asset.bytes) || asset.bytes < 0 || asset.bytes > MAX_ASSET_BYTES) add('BUNDLE_ASSET_BYTES_INVALID', `assets/${index}/bytes`, `bytes must be an integer between 0 and ${MAX_ASSET_BYTES}`);
    if (typeof asset.media_type === 'string' && asset.media_type && !MEDIA_EXTENSIONS.has(asset.media_type.toLowerCase())) add('BUNDLE_ASSET_MEDIA_TYPE_UNSUPPORTED', `assets/${index}/media_type`, `unsupported media_type ${asset.media_type}`);
    if (typeof asset.asset_id === 'string') {
      if (seen.has(asset.asset_id)) add('BUNDLE_ASSET_DUPLICATE', `assets/${index}/asset_id`, `duplicate asset_id ${asset.asset_id}`);
      seen.add(asset.asset_id);
    }
  }

  if (contextReport.valid) {
    let expected = [];
    try { expected = assetDescriptorsFromContext(bundle.context_pack); }
    catch (error) { add(error.code || 'BUNDLE_CONTEXT_ASSET_INVALID', 'context_pack', error.message); }
    const actualById = new Map(assets.filter(isObject).map(asset => [asset.asset_id, asset]));
    if (assets.length !== expected.length) add('BUNDLE_ASSET_SET_MISMATCH', 'assets', `expected ${expected.length} asset descriptors, got ${assets.length}`);
    for (const wanted of expected) {
      const actual = actualById.get(wanted.asset_id);
      if (!actual) { add('BUNDLE_ASSET_MISSING', 'assets', `missing asset descriptor ${wanted.asset_id}`); continue; }
      for (const key of ['book_id', 'role', 'sha256', 'media_type']) {
        if (actual[key] !== wanted[key]) add('BUNDLE_ASSET_CONTEXT_MISMATCH', `assets/${wanted.asset_id}/${key}`, `expected ${wanted[key]}, got ${actual[key]}`);
      }
    }
  }

  if (typeof bundle.bundle_id === 'string' && /^nbtib1_[a-f0-9]{64}$/.test(bundle.bundle_id)) {
    const expectedId = computeTrustedInputBundleId(bundle);
    if (bundle.bundle_id !== expectedId) add('BUNDLE_ID_MISMATCH', 'bundle_id', `expected ${expectedId}`);
  }

  errors.sort((a, b) => a.field.localeCompare(b.field) || a.code.localeCompare(b.code));
  return { valid: errors.length === 0, errors };
}

export function buildTrustedInputBundle({ contextPack, assetBytesById }) {
  const contextReport = validateContextPack(contextPack);
  if (!contextReport.valid) fail('BUNDLE_CONTEXT_INVALID', 'cannot build bundle from invalid ContextPack', contextReport.errors);
  if (!(assetBytesById instanceof Map)) fail('BUNDLE_ASSET_BYTES_MAP_REQUIRED', 'assetBytesById must be a Map keyed by asset_id');
  const assets = assetDescriptorsFromContext(contextPack).map(asset => {
    const bytes = assetBytesById.get(asset.asset_id);
    if (!Buffer.isBuffer(bytes)) fail('BUNDLE_ASSET_BYTES_MISSING', `missing Buffer for ${asset.asset_id}`);
    const observed = sha256Bytes(bytes);
    if (observed !== asset.sha256) fail('BUNDLE_ASSET_HASH_MISMATCH', `asset ${asset.asset_id} expected ${asset.sha256}, got ${observed}`);
    return { ...asset, bytes: bytes.length };
  });
  const bundle = {
    schema: TRUSTED_INPUT_BUNDLE_SCHEMA,
    bundle_id: `${TRUSTED_INPUT_BUNDLE_PREFIX}${'0'.repeat(64)}`,
    asset_layout: TRUSTED_INPUT_BUNDLE_LAYOUT,
    context_pack: structuredClone(contextPack),
    assets,
  };
  bundle.bundle_id = computeTrustedInputBundleId(bundle);
  return bundle;
}

export function bundleAssetFilename(bundleDir, asset) {
  return path.resolve(bundleDir, 'assets', `${asset.sha256}${extensionFor(asset.media_type)}`);
}

function canonicalContextFilename(contextDir, contextPackId) {
  return path.join(contextDir, `ctx_${sha256Bytes(Buffer.from(contextPackId, 'utf8'))}.json`);
}

async function readJsonRegular(filename, maxBytes, code) {
  const stat = await assertRegularFile(filename, code);
  if (stat.size > maxBytes) fail(`${code}_TOO_LARGE`, `${filename} exceeds ${maxBytes} bytes`);
  try { return JSON.parse(await fsp.readFile(filename, 'utf8')); }
  catch (error) { fail(`${code}_JSON_INVALID`, `invalid JSON in ${filename}: ${error.message}`); }
}

async function atomicWrite(filename, bytes) {
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  const tmp = `${filename}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, bytes, { flag: 'wx' });
  await fsp.rename(tmp, filename);
}

async function scanExistingContexts(contextDir, contextPackId) {
  await fsp.mkdir(contextDir, { recursive: true });
  const matches = [];
  for (const entry of (await fsp.readdir(contextDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filename = path.join(contextDir, entry.name);
    const stat = await fsp.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BUNDLE_JSON_BYTES) continue;
    let value;
    try { value = JSON.parse(await fsp.readFile(filename, 'utf8')); }
    catch { continue; }
    if (value?.context_pack_id === contextPackId) matches.push({ filename, value });
  }
  return matches;
}

async function acquireInstallLock(stateRoot) {
  await fsp.mkdir(stateRoot, { recursive: true });
  const lockDir = path.join(stateRoot, '.i21-trusted-input-install.lock');
  try { await fsp.mkdir(lockDir); }
  catch (error) {
    if (error?.code === 'EEXIST') fail('TRUSTED_INPUT_INSTALL_BUSY', `trusted input install lock already exists: ${lockDir}`);
    throw error;
  }
  await fsp.writeFile(path.join(lockDir, 'owner.json'), `${JSON.stringify({ pid: process.pid })}\n`, 'utf8');
  return lockDir;
}

export async function readTrustedInputBundle(bundleFile) {
  const bundle = await readJsonRegular(path.resolve(bundleFile), MAX_BUNDLE_JSON_BYTES, 'BUNDLE_FILE_INVALID');
  const report = validateTrustedInputBundle(bundle);
  if (!report.valid) fail('TRUSTED_INPUT_BUNDLE_REJECTED', 'trusted input bundle failed structural validation', report.errors);
  return bundle;
}

export async function installTrustedInputBundle({ bundleFile, stateRoot }) {
  const resolvedBundleFile = path.resolve(bundleFile);
  const resolvedStateRoot = path.resolve(stateRoot);
  const bundle = await readTrustedInputBundle(resolvedBundleFile);
  const bundleDir = path.dirname(resolvedBundleFile);
  const contextDir = path.join(resolvedStateRoot, 'context-packs');
  const assetDir = path.join(resolvedStateRoot, 'assets');
  const receiptDir = path.join(resolvedStateRoot, 'trusted-input-receipts');

  const verified = [];
  for (const asset of bundle.assets) {
    const source = bundleAssetFilename(bundleDir, asset);
    const stat = await assertRegularFile(source, 'BUNDLE_ASSET_FILE_INVALID');
    if (stat.size !== asset.bytes) fail('BUNDLE_ASSET_SIZE_MISMATCH', `asset ${asset.asset_id} expected ${asset.bytes} bytes, got ${stat.size}`);
    const observed = await sha256File(source);
    if (observed !== asset.sha256) fail('BUNDLE_ASSET_HASH_MISMATCH', `asset ${asset.asset_id} expected ${asset.sha256}, got ${observed}`);
    verified.push({ asset, source });
  }

  const lockDir = await acquireInstallLock(resolvedStateRoot);
  try {
    await fsp.mkdir(contextDir, { recursive: true });
    await fsp.mkdir(assetDir, { recursive: true });
    await fsp.mkdir(receiptDir, { recursive: true });

    const existing = await scanExistingContexts(contextDir, bundle.context_pack.context_pack_id);
    if (existing.length > 1) fail('CONTEXT_PACK_AMBIGUOUS', `multiple installed ContextPacks claim ${bundle.context_pack.context_pack_id}`);
    const existingContext = existing[0] || null;
    if (existingContext) {
      const report = validateContextPack(existingContext.value);
      if (!report.valid) fail('INSTALLED_CONTEXT_INVALID', `installed ContextPack ${bundle.context_pack.context_pack_id} is invalid`, report.errors);
      const oldRevision = Number(existingContext.value.revision);
      const newRevision = Number(bundle.context_pack.revision);
      if (oldRevision > newRevision) fail('CONTEXT_REVISION_ROLLBACK', `refusing revision rollback ${oldRevision} -> ${newRevision}`);
      if (oldRevision === newRevision && existingContext.value.context_hash !== bundle.context_pack.context_hash) {
        fail('CONTEXT_REVISION_CONFLICT', `revision ${newRevision} already exists with a different context_hash`);
      }
    }

    let installedAssets = 0;
    let reusedAssets = 0;
    for (const { asset, source } of verified) {
      const destination = path.join(assetDir, `${asset.sha256}${extensionFor(asset.media_type)}`);
      try {
        const stat = await fsp.lstat(destination);
        assertRegularFileStat(stat, destination, 'INSTALLED_ASSET_INVALID');
        if (stat.size !== asset.bytes || await sha256File(destination) !== asset.sha256) {
          fail('INSTALLED_ASSET_HASH_MISMATCH', `existing content-addressed asset is corrupt: ${destination}`);
        }
        reusedAssets += 1;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        const tmp = `${destination}.tmp-${process.pid}-${Date.now()}`;
        await fsp.copyFile(source, tmp, fs.constants.COPYFILE_EXCL);
        const tmpStat = await assertRegularFile(tmp, 'INSTALLED_ASSET_TEMP_INVALID');
        if (tmpStat.size !== asset.bytes || await sha256File(tmp) !== asset.sha256) {
          await fsp.rm(tmp, { force: true });
          fail('INSTALLED_ASSET_COPY_MISMATCH', `asset changed during copy: ${asset.asset_id}`);
        }
        await fsp.rename(tmp, destination);
        installedAssets += 1;
      }
    }

    const contextBytes = Buffer.from(`${canonicalJson(bundle.context_pack)}\n`, 'utf8');
    const contextPath = existingContext?.filename || canonicalContextFilename(contextDir, bundle.context_pack.context_pack_id);
    const contextAction = existingContext?.value?.context_hash === bundle.context_pack.context_hash ? 'reused' : (existingContext ? 'updated' : 'installed');
    if (contextAction !== 'reused') await atomicWrite(contextPath, contextBytes);

    const receipt = {
      schema: 'newboo-video-trusted-input-install-receipt-v1',
      bundle_id: bundle.bundle_id,
      context_pack_id: bundle.context_pack.context_pack_id,
      context_hash: bundle.context_pack.context_hash,
      context_revision: bundle.context_pack.revision,
      context_action: contextAction,
      asset_layout: TRUSTED_INPUT_BUNDLE_LAYOUT,
      asset_count: bundle.assets.length,
      installed_assets: installedAssets,
      reused_assets: reusedAssets,
      context_file: path.relative(resolvedStateRoot, contextPath).split(path.sep).join('/'),
    };
    const receiptPath = path.join(receiptDir, `${bundle.bundle_id}.json`);
    await atomicWrite(receiptPath, Buffer.from(`${canonicalJson(receipt)}\n`, 'utf8'));
    return { ...receipt, receipt_path: receiptPath };
  } finally {
    await fsp.rm(lockDir, { recursive: true, force: true });
  }
}
