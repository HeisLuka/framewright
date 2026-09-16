import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { compileDeliveryPackage } from './c19-delivery-package-v1.mjs';
import { canonicalJson } from './factory-identity-v1.mjs';
import { compileCreativeProposal } from './compile-creative-proposal-v1.mjs';
import {
  computeProposalId,
  validateContextPack,
  validateCreativeProposal,
} from './creative-proposal-v1.mjs';

export const LOCAL_VIDEO_REQUEST_SCHEMA = 'newboo-local-video-request-v1';
export const LOCAL_ASSET_LAYOUT = 'sha256-filename-v1';

const DEFAULT_RUNTIME = Object.freeze({
  class: 'FAST',
  scene_contract_version: 'canvas-scene-v1',
  environment_id: 'video-worker-chromium-v1',
  renderer: { id: 'webcodecs-h264', version: 'r35-standard-v1' },
  encoder: { video_codec: 'avc1.420028', bitrate_bps: 3000000, pixel_format: 'yuv420p' },
  muxer: { id: 'ffmpeg-stream-copy-aac', version: '6.1.1' },
});

const DEFAULT_PALETTE = Object.freeze({
  background: '#f2eee6',
  surface: '#ffffff',
  ink: '#111111',
  accent: '#315a7d',
  secondary: '#d0c5b8',
});

const DELIVERY = Object.freeze({
  youtube_shorts: {
    id: 'vertical-youtube-shorts-v1', width: 1080, height: 1920, fps: 30,
    safe_area_profile: 'c26-ui-safe-v1-2026-09-17:youtube_shorts',
    platform_ui_profile: 'youtube_shorts', platform_ui_version: 'c26-ui-safe-v1-2026-09-17',
  },
  instagram_reels: {
    id: 'vertical-instagram-reels-v1', width: 1080, height: 1920, fps: 30,
    safe_area_profile: 'c26-ui-safe-v1-2026-09-17:instagram_reels',
    platform_ui_profile: 'instagram_reels', platform_ui_version: 'c26-ui-safe-v1-2026-09-17',
  },
  tiktok: {
    id: 'vertical-tiktok-v1', width: 1080, height: 1920, fps: 30,
    safe_area_profile: 'c26-ui-safe-v1-2026-09-17:tiktok',
    platform_ui_profile: 'tiktok', platform_ui_version: 'c26-ui-safe-v1-2026-09-17',
  },
});

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

function fail(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function assertObject(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, message);
}

function roleText(plan, roleName) {
  const role = (plan.roles || []).find(item => item.role === roleName);
  if (!role) return '';
  return (role.atoms || [])
    .filter(atom => atom && atom.source?.kind !== 'reserved_affordance')
    .map(atom => String(atom.text || '').trim())
    .filter(Boolean)
    .join(' ');
}

function mediaExtension(mediaType) {
  const normalized = String(mediaType || '').toLowerCase();
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/jpeg') return '.jpg';
  if (normalized === 'image/webp') return '.webp';
  fail('UNSUPPORTED_COVER_MEDIA_TYPE', `unsupported cover media type: ${mediaType || '(missing)'}`);
}

function inside(root, filename) {
  const relative = path.relative(path.resolve(root), path.resolve(filename));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function repoRelative(repoRoot, filename) {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(filename));
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    fail('LOCAL_STATE_OUTSIDE_REPO', `I09 local state must live inside the repository: ${filename}`);
  }
  return relative.split(path.sep).join('/');
}

async function atomicWrite(filename, bytes) {
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  const tmp = `${filename}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, bytes);
  await fsp.rename(tmp, filename);
}

async function assertRegularTrustedFile(filename, code) {
  let stat;
  try { stat = await fsp.lstat(filename); }
  catch (error) {
    if (error?.code === 'ENOENT') fail(code, `missing trusted file: ${filename}`);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code, `trusted file must be a regular non-symlink file: ${filename}`);
}

export function normalizeOperatorProposal(proposal) {
  assertObject(proposal, 'PROPOSAL_OBJECT_REQUIRED', 'CreativeProposal must be a JSON object');
  const normalized = structuredClone(proposal);
  if (normalized.proposal_id == null || normalized.proposal_id === '' || normalized.proposal_id === 'auto') {
    delete normalized.proposal_id;
    normalized.proposal_id = computeProposalId(normalized);
  }
  return normalized;
}

export function parseProposalJson(raw) {
  if (typeof raw !== 'string') fail('PROPOSAL_TEXT_REQUIRED', 'proposal JSON must be supplied as text');
  if (Buffer.byteLength(raw, 'utf8') > 512 * 1024) fail('PROPOSAL_TOO_LARGE', 'proposal JSON exceeds the 512 KiB local-console limit');
  try {
    const parsed = JSON.parse(raw);
    assertObject(parsed, 'PROPOSAL_OBJECT_REQUIRED', 'CreativeProposal must be a JSON object');
    return parsed;
  } catch (error) {
    if (error?.code) throw error;
    fail('JSON_PARSE_ERROR', `invalid CreativeProposal JSON: ${error.message}`);
  }
}

export async function loadContextPackForProposal({ contextDir, proposal }) {
  const wanted = String(proposal?.context_pack_id || '');
  if (!wanted) fail('CONTEXT_PACK_ID_REQUIRED', 'proposal.context_pack_id is required');
  await fsp.mkdir(contextDir, { recursive: true });
  const entries = (await fsp.readdir(contextDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const matches = [];
  for (const entry of entries) {
    const filename = path.join(contextDir, entry.name);
    const stat = await fsp.stat(filename);
    if (stat.size > 4 * 1024 * 1024) continue;
    let value;
    try { value = JSON.parse(await fsp.readFile(filename, 'utf8')); }
    catch { continue; }
    if (value?.context_pack_id === wanted) matches.push({ filename, value });
  }
  if (matches.length === 0) fail('CONTEXT_PACK_NOT_FOUND', `trusted ContextPack ${wanted} was not found in ${contextDir}`);
  if (matches.length > 1) fail('CONTEXT_PACK_AMBIGUOUS', `multiple trusted ContextPacks claim ${wanted}`);
  const report = validateContextPack(matches[0].value);
  if (!report.valid) fail('INVALID_TRUSTED_CONTEXT', `trusted ContextPack ${wanted} is invalid`, report.errors);
  return { contextPack: matches[0].value, contextPath: matches[0].filename };
}

function contextIndexes(pack) {
  const books = new Map((pack.books || []).map(book => [book.book_id, book]));
  const ctas = new Map((pack.ctas || []).map(cta => [cta.cta_id, cta]));
  return { books, ctas };
}

function selectedCover(pack, proposal) {
  const book = (pack.books || []).find(row => row.book_id === proposal.book_id);
  if (!book) fail('UNKNOWN_BOOK', `book ${proposal.book_id} is absent from ContextPack`);
  const allowed = new Set(proposal.selected_asset_ids || []);
  const cover = (book.assets || []).find(asset => asset.role === 'cover' && allowed.has(asset.asset_id));
  if (!cover) fail('COVER_ASSET_REQUIRED', 'proposal must select a trusted cover asset');
  return { book, cover };
}

export async function resolveTrustedAsset({ assetDir, asset }) {
  const ext = mediaExtension(asset.media_type);
  const filename = path.resolve(assetDir, `${asset.sha256}${ext}`);
  if (!inside(assetDir, filename)) fail('ASSET_PATH_ESCAPE', 'derived asset path escaped trusted asset directory');
  await assertRegularTrustedFile(filename, 'TRUSTED_ASSET_MISSING');
  const observed = await sha256File(filename);
  if (observed !== asset.sha256) {
    fail('TRUSTED_ASSET_HASH_MISMATCH', `trusted asset hash mismatch for ${asset.asset_id}: expected ${asset.sha256}, got ${observed}`);
  }
  return filename;
}

export async function preflightLocalVideo({ contextPack, proposal, assetDir, templatePath }) {
  const contextReport = validateContextPack(contextPack);
  if (!contextReport.valid) return { ok: false, code: 'INVALID_TRUSTED_CONTEXT', errors: contextReport.errors };
  const proposalReport = validateCreativeProposal(contextPack, proposal);
  if (!proposalReport.valid) return { ok: false, code: proposalReport.code || 'CREATIVE_PROPOSAL_REJECTED', errors: proposalReport.errors };

  let program;
  try { program = compileCreativeProposal(contextPack, proposal); }
  catch (error) {
    return { ok: false, code: 'CREATIVE_COMPILE_FAILED', errors: [{ code: 'CREATIVE_COMPILE_FAILED', path: '', message: error.message }] };
  }

  try {
    await assertRegularTrustedFile(templatePath, 'TRUSTED_TEMPLATE_MISSING');
    const { cover } = selectedCover(contextPack, proposal);
    const coverPath = await resolveTrustedAsset({ assetDir, asset: cover });
    return {
      ok: true,
      program,
      binding: {
        template_path: path.resolve(templatePath),
        template_sha256: await sha256File(templatePath),
        cover_asset_id: cover.asset_id,
        cover_path: coverPath,
        cover_sha256: cover.sha256,
      },
    };
  } catch (error) {
    return { ok: false, code: error.code || 'LOCAL_PREFLIGHT_FAILED', errors: [{ code: error.code || 'LOCAL_PREFLIGHT_FAILED', path: '', message: error.message }] };
  }
}

function outputProfile(proposal) {
  const profile = DELIVERY[proposal.presentation.delivery_profile];
  if (!profile) fail('DELIVERY_PROFILE_UNSUPPORTED', `local executor does not know ${proposal.presentation.delivery_profile}`);
  if (profile.fps !== proposal.presentation.fps) fail('DELIVERY_FPS_MISMATCH', `profile ${profile.id} requires ${profile.fps} fps`);
  return structuredClone(profile);
}

export async function prepareLocalVideoRequest({
  repoRoot,
  stateRoot,
  contextPack,
  proposal,
  rawProposalJson = null,
  assetDir,
  templatePath,
}) {
  const preflight = await preflightLocalVideo({ contextPack, proposal, assetDir, templatePath });
  if (!preflight.ok) fail(preflight.code, preflight.errors?.[0]?.message || preflight.code, preflight.errors);
  const { program } = preflight;
  const plan = program.narrative_plan;
  const { book, cover } = selectedCover(contextPack, proposal);
  const ids = contextIndexes(contextPack);
  const cta = proposal.narrative.cta_id ? ids.ctas.get(proposal.narrative.cta_id) : null;
  const profile = outputProfile(proposal);

  const jobDir = path.resolve(stateRoot, 'jobs', program.program_id);
  if (!inside(repoRoot, jobDir)) fail('LOCAL_STATE_OUTSIDE_REPO', `stateRoot must be inside repository: ${stateRoot}`);
  const bindingDir = path.join(jobDir, 'binding');
  const assetsDir = path.join(bindingDir, 'assets');
  await fsp.mkdir(assetsDir, { recursive: true });

  const templateCopy = path.join(bindingDir, 'template.html');
  const coverExt = mediaExtension(cover.media_type);
  const coverCopy = path.join(assetsDir, `cover${coverExt}`);
  await fsp.copyFile(templatePath, templateCopy);
  await fsp.copyFile(preflight.binding.cover_path, coverCopy);
  if (await sha256File(coverCopy) !== cover.sha256) fail('RUNTIME_COVER_HASH_DRIFT', 'cover copy hash changed while preparing local job');

  const hookText = roleText(plan, 'hook');
  if (!hookText) fail('NARRATIVE_HOOK_MISSING', 'compiled NarrativePlan has no rendered hook text');
  const ctaText = roleText(plan, 'cta') || cta?.text || '';
  const payload = {
    book_id: book.book_id,
    title: book.title,
    author: book.author,
    hook: hookText,
    cta: ctaText,
    eyebrow: 'NEWBOO',
    brand: contextPack.account.brand_name || 'NEWBOO',
    cover_url: `./assets/cover${coverExt}`,
    accent: DEFAULT_PALETTE.accent,
    background: DEFAULT_PALETTE.background,
    ink: DEFAULT_PALETTE.ink,
    visual_system: proposal.presentation.visual_system,
    creative_variant: 'hook-first',
    delivery_profile: 'vertical',
    art_direction_mode: 'cover',
    cover_composition_mode: 'adaptive',
    opening_grammar: 'hook-led',
    motion_density: 'choreography-v2',
    typography_system: 'baseline',
    pacing_mode: 'c27-narrative-v1',
    narrative_plan: plan,
  };
  const payloadBytes = Buffer.from(`${canonicalJson(payload)}\n`, 'utf8');
  const payloadPath = path.join(bindingDir, 'payload.json');
  await atomicWrite(payloadPath, payloadBytes);
  const payloadSha256 = sha256Bytes(payloadBytes);
  const templateSha256 = await sha256File(templateCopy);

  const selectionId = `i09_${proposal.proposal_id}`;
  const creative = {
    schema: 'newboo-creative-spec-v1',
    book_id: book.book_id,
    payload_sha256: payloadSha256,
    template: { id: 'book-ad-systems', version: 'c27-narrative-v1', sha256: templateSha256 },
    visual_system: { id: proposal.presentation.visual_system, version: 'v1' },
    structural_variant: 'hook-first',
    hook: { source: 'context_atom', text: hookText, source_ref: `${plan.narrative_plan_id}:hook` },
    motion: { profile: 'finite-choreography', version: 'c22-v1' },
    art_direction: {
      mode: 'cover-derived', algorithm: 'c20-cover-adaptive-v1', source_cover_sha256: cover.sha256,
      palette: structuredClone(DEFAULT_PALETTE),
    },
    seed: plan.seed,
    assets: [{ role: 'cover', sha256: cover.sha256, media_type: cover.media_type, uri: `asset://i09/${cover.sha256}` }],
  };

  const request = {
    schema: 'framewright-c19-campaign-request-v1',
    campaign_id: `i09-${program.program_id}`,
    compiler_policy_version: 'c19-delivery-package-v1',
    runtime: structuredClone(DEFAULT_RUNTIME),
    delivery_profiles: [profile],
    selected: [{
      selection_id: selectionId,
      creative,
      timeline: {
        source: `c27:${plan.narrative_plan_id}`,
        policy_version: plan.policy_version,
        duration_ms: plan.duration_seconds * 1000,
        frame_count: plan.total_frames,
      },
      requested_delivery_profile_ids: [profile.id],
      render_assets: [{ role: 'scene_payload', sha256: payloadSha256, media_type: 'application/json', uri: `execution://${selectionId}/payload` }],
      execution: {
        html: repoRelative(repoRoot, templateCopy),
        payload: repoRelative(repoRoot, payloadPath),
        template_id: 'book-ad-systems',
        template_version: 'c27-narrative-v1',
      },
    }],
    reserves: [],
  };

  const packageManifest = compileDeliveryPackage(request);
  if (packageManifest.counts.render_specs !== 1) fail('I09_RENDER_COUNT_DRIFT', `expected exactly one RenderSpec, got ${packageManifest.counts.render_specs}`);

  const requestPath = path.join(jobDir, 'request.json');
  const programPath = path.join(jobDir, 'accepted-program.json');
  const normalizedProposalPath = path.join(jobDir, 'proposal.json');
  await atomicWrite(requestPath, Buffer.from(`${canonicalJson(request)}\n`, 'utf8'));
  await atomicWrite(programPath, Buffer.from(`${canonicalJson(program)}\n`, 'utf8'));
  await atomicWrite(normalizedProposalPath, Buffer.from(`${canonicalJson(proposal)}\n`, 'utf8'));
  if (rawProposalJson != null) await atomicWrite(path.join(jobDir, 'proposal.raw.json'), Buffer.from(String(rawProposalJson), 'utf8'));

  return {
    schema: LOCAL_VIDEO_REQUEST_SCHEMA,
    proposal_id: proposal.proposal_id,
    program_id: program.program_id,
    narrative_plan_id: plan.narrative_plan_id,
    request_path: requestPath,
    job_dir: jobDir,
    render_spec_id: packageManifest.renders[0].render.render_spec_id,
    creative_id: packageManifest.selected[0].creative.creative_id,
    delivery_profile_id: profile.id,
    physical: {
      payload_sha256: payloadSha256,
      template_sha256: templateSha256,
      cover_sha256: cover.sha256,
    },
  };
}
