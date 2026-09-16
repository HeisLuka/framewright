import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  C27_ANGLE_TYPES,
  C27_CTA_TREATMENTS,
  C27_DURATION_PROFILES,
  C27_REVEAL_TIMINGS,
  planNarrative,
} from '../.agents/skills/framewright/scripts/c27-narrative-plan.mjs';

export const CONTEXT_SCHEMA = 'newboo-context-pack-v1';
export const PROPOSAL_SCHEMA = 'newboo-creative-proposal-v1';
export const PROGRAM_SCHEMA = 'newboo-accepted-creative-program-v1';
export const CREATIVE_ATOM_ROLES = ['hook', 'tension', 'payoff'];
export const PROPOSAL_REVEAL_TIMINGS = ['none', ...C27_REVEAL_TIMINGS];

const FORBIDDEN_PROPOSAL_KEYS = new Set([
  'text', 'copy', 'raw_text', 'prompt', 'url', 'uri', 'path', 'file', 'filename', 'html', 'script',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function add(errors, code, path, message) {
  errors.push({ code, path, message });
}

function sortedErrors(errors) {
  return errors.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

function checkUnknownKeys(errors, value, allowed, path) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value).sort()) {
    if (allowed.has(key)) continue;
    const childPath = `${path}/${key}`;
    if (FORBIDDEN_PROPOSAL_KEYS.has(key.toLowerCase())) {
      add(errors, 'FORBIDDEN_RAW_CONTENT', childPath, `proposal may not carry raw ${key}; reference trusted context IDs instead`);
    } else {
      add(errors, 'UNKNOWN_FIELD', childPath, `unknown field ${key}`);
    }
  }
}

function requireString(errors, value, path) {
  if (typeof value !== 'string' || value.length === 0) add(errors, 'INVALID_STRING', path, 'expected a non-empty string');
}

function requireInteger(errors, value, path, { min = Number.MIN_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min) add(errors, 'INVALID_INTEGER', path, `expected an integer >= ${min}`);
}

function requireStringArray(errors, value, path, { minItems = 0 } = {}) {
  if (!Array.isArray(value)) {
    add(errors, 'INVALID_ARRAY', path, 'expected an array');
    return [];
  }
  if (value.length < minItems) add(errors, 'ARRAY_TOO_SHORT', path, `expected at least ${minItems} item(s)`);
  value.forEach((item, index) => requireString(errors, item, `${path}/${index}`));
  return value;
}

function duplicateValues(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes].sort();
}

function requireUnique(errors, values, path) {
  for (const duplicate of duplicateValues(values)) add(errors, 'DUPLICATE_REFERENCE', path, `duplicate value ${duplicate}`);
}

function requireSubset(errors, values, allowed, path, code = 'CAPABILITY_DENIED') {
  for (let i = 0; i < values.length; i += 1) {
    if (!allowed.includes(values[i])) add(errors, code, `${path}/${i}`, `unsupported value ${values[i]}`);
  }
}

function contextIdentityInput(pack) {
  const { context_hash: _contextHash, ...rest } = pack || {};
  return rest;
}

export function computeContextHash(pack) {
  return sha256Canonical(contextIdentityInput(pack));
}

function proposalIdentityInput(proposal) {
  const { proposal_id: _proposalId, ...rest } = proposal || {};
  return rest;
}

export function computeProposalId(proposal) {
  return `nbp1_${sha256Canonical(proposalIdentityInput(proposal))}`;
}

function programIdentityInput(program) {
  const { program_id: _programId, ...rest } = program || {};
  return rest;
}

export function computeProgramId(program) {
  return `nbprog1_${sha256Canonical(programIdentityInput(program))}`;
}

export function validateContextPack(pack) {
  const errors = [];
  if (!isObject(pack)) {
    add(errors, 'TYPE_OBJECT_REQUIRED', '', 'ContextPack must be an object');
    return { valid: false, errors };
  }

  checkUnknownKeys(errors, pack, new Set(['schema', 'context_pack_id', 'context_hash', 'revision', 'account', 'books', 'ctas', 'capabilities', 'constraints']), '');
  if (pack.schema !== CONTEXT_SCHEMA) add(errors, 'SCHEMA_VERSION_MISMATCH', '/schema', `expected ${CONTEXT_SCHEMA}`);
  requireString(errors, pack.context_pack_id, '/context_pack_id');
  requireInteger(errors, pack.revision, '/revision', { min: 1 });

  if (!isObject(pack.account)) add(errors, 'TYPE_OBJECT_REQUIRED', '/account', 'account must be an object');
  else {
    checkUnknownKeys(errors, pack.account, new Set(['account_id', 'brand_name', 'locale']), '/account');
    requireString(errors, pack.account.account_id, '/account/account_id');
    if (hasOwn(pack.account, 'brand_name')) requireString(errors, pack.account.brand_name, '/account/brand_name');
    if (hasOwn(pack.account, 'locale')) requireString(errors, pack.account.locale, '/account/locale');
  }

  if (!Array.isArray(pack.books) || pack.books.length === 0) add(errors, 'INVALID_ARRAY', '/books', 'books must be a non-empty array');
  const globalFactIds = new Set();
  const globalAtomIds = new Set();
  const globalAssetIds = new Set();
  const bookIds = [];
  for (let bi = 0; bi < (Array.isArray(pack.books) ? pack.books.length : 0); bi += 1) {
    const book = pack.books[bi];
    const base = `/books/${bi}`;
    if (!isObject(book)) {
      add(errors, 'TYPE_OBJECT_REQUIRED', base, 'book must be an object');
      continue;
    }
    checkUnknownKeys(errors, book, new Set(['book_id', 'title', 'author', 'facts', 'creative_atoms', 'assets']), base);
    requireString(errors, book.book_id, `${base}/book_id`);
    requireString(errors, book.title, `${base}/title`);
    requireString(errors, book.author, `${base}/author`);
    if (typeof book.book_id === 'string') bookIds.push(book.book_id);

    const localFactIds = new Set();
    if (!Array.isArray(book.facts) || book.facts.length === 0) add(errors, 'INVALID_ARRAY', `${base}/facts`, 'facts must be a non-empty array');
    for (let fi = 0; fi < (Array.isArray(book.facts) ? book.facts.length : 0); fi += 1) {
      const fact = book.facts[fi];
      const fp = `${base}/facts/${fi}`;
      if (!isObject(fact)) { add(errors, 'TYPE_OBJECT_REQUIRED', fp, 'fact must be an object'); continue; }
      checkUnknownKeys(errors, fact, new Set(['fact_id', 'kind', 'value', 'source_ref']), fp);
      requireString(errors, fact.fact_id, `${fp}/fact_id`);
      requireString(errors, fact.kind, `${fp}/kind`);
      requireString(errors, fact.value, `${fp}/value`);
      requireString(errors, fact.source_ref, `${fp}/source_ref`);
      if (typeof fact.fact_id === 'string') {
        if (localFactIds.has(fact.fact_id) || globalFactIds.has(fact.fact_id)) add(errors, 'DUPLICATE_ID', `${fp}/fact_id`, `duplicate fact_id ${fact.fact_id}`);
        localFactIds.add(fact.fact_id); globalFactIds.add(fact.fact_id);
      }
    }

    if (!Array.isArray(book.creative_atoms) || book.creative_atoms.length === 0) add(errors, 'INVALID_ARRAY', `${base}/creative_atoms`, 'creative_atoms must be a non-empty array');
    for (let ai = 0; ai < (Array.isArray(book.creative_atoms) ? book.creative_atoms.length : 0); ai += 1) {
      const atom = book.creative_atoms[ai];
      const ap = `${base}/creative_atoms/${ai}`;
      if (!isObject(atom)) { add(errors, 'TYPE_OBJECT_REQUIRED', ap, 'creative atom must be an object'); continue; }
      checkUnknownKeys(errors, atom, new Set(['atom_id', 'role', 'angle_types', 'text', 'source_fact_ids', 'spoiler_level']), ap);
      requireString(errors, atom.atom_id, `${ap}/atom_id`);
      if (!CREATIVE_ATOM_ROLES.includes(atom.role)) add(errors, 'ATOM_ROLE_INVALID', `${ap}/role`, `role must be one of ${CREATIVE_ATOM_ROLES.join(',')}`);
      const angleTypes = requireStringArray(errors, atom.angle_types, `${ap}/angle_types`, { minItems: 1 });
      requireUnique(errors, angleTypes, `${ap}/angle_types`);
      requireSubset(errors, angleTypes, C27_ANGLE_TYPES, `${ap}/angle_types`, 'ANGLE_TYPE_UNSUPPORTED');
      requireString(errors, atom.text, `${ap}/text`);
      const sourceFacts = requireStringArray(errors, atom.source_fact_ids, `${ap}/source_fact_ids`, { minItems: 1 });
      requireUnique(errors, sourceFacts, `${ap}/source_fact_ids`);
      for (let sfi = 0; sfi < sourceFacts.length; sfi += 1) if (!localFactIds.has(sourceFacts[sfi])) add(errors, 'UNKNOWN_FACT', `${ap}/source_fact_ids/${sfi}`, `unknown fact ${sourceFacts[sfi]} for book ${book.book_id}`);
      requireInteger(errors, atom.spoiler_level, `${ap}/spoiler_level`, { min: 0 });
      if (typeof atom.atom_id === 'string') {
        if (globalAtomIds.has(atom.atom_id)) add(errors, 'DUPLICATE_ID', `${ap}/atom_id`, `duplicate atom_id ${atom.atom_id}`);
        globalAtomIds.add(atom.atom_id);
      }
    }

    if (!Array.isArray(book.assets) || book.assets.length === 0) add(errors, 'INVALID_ARRAY', `${base}/assets`, 'assets must be a non-empty array');
    for (let xi = 0; xi < (Array.isArray(book.assets) ? book.assets.length : 0); xi += 1) {
      const asset = book.assets[xi];
      const xp = `${base}/assets/${xi}`;
      if (!isObject(asset)) { add(errors, 'TYPE_OBJECT_REQUIRED', xp, 'asset must be an object'); continue; }
      checkUnknownKeys(errors, asset, new Set(['asset_id', 'role', 'sha256', 'media_type']), xp);
      requireString(errors, asset.asset_id, `${xp}/asset_id`);
      requireString(errors, asset.role, `${xp}/role`);
      if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) add(errors, 'INVALID_SHA256', `${xp}/sha256`, 'expected lowercase sha256 hex');
      if (hasOwn(asset, 'media_type')) requireString(errors, asset.media_type, `${xp}/media_type`);
      if (typeof asset.asset_id === 'string') {
        if (globalAssetIds.has(asset.asset_id)) add(errors, 'DUPLICATE_ID', `${xp}/asset_id`, `duplicate asset_id ${asset.asset_id}`);
        globalAssetIds.add(asset.asset_id);
      }
    }
  }
  requireUnique(errors, bookIds, '/books');

  if (!Array.isArray(pack.ctas)) add(errors, 'INVALID_ARRAY', '/ctas', 'ctas must be an array');
  const ctaIds = [];
  for (let ci = 0; ci < (Array.isArray(pack.ctas) ? pack.ctas.length : 0); ci += 1) {
    const cta = pack.ctas[ci], cp = `/ctas/${ci}`;
    if (!isObject(cta)) { add(errors, 'TYPE_OBJECT_REQUIRED', cp, 'CTA must be an object'); continue; }
    checkUnknownKeys(errors, cta, new Set(['cta_id', 'text', 'treatments']), cp);
    requireString(errors, cta.cta_id, `${cp}/cta_id`);
    requireString(errors, cta.text, `${cp}/text`);
    const treatments = requireStringArray(errors, cta.treatments, `${cp}/treatments`, { minItems: 1 });
    requireSubset(errors, treatments, ['intent', 'direct'], `${cp}/treatments`, 'CTA_TREATMENT_UNSUPPORTED');
    requireUnique(errors, treatments, `${cp}/treatments`);
    if (typeof cta.cta_id === 'string') ctaIds.push(cta.cta_id);
  }
  requireUnique(errors, ctaIds, '/ctas');

  if (!isObject(pack.capabilities)) add(errors, 'TYPE_OBJECT_REQUIRED', '/capabilities', 'capabilities must be an object');
  else {
    checkUnknownKeys(errors, pack.capabilities, new Set(['angle_types', 'visual_systems', 'duration_seconds', 'fps', 'reveal_timings', 'cta_treatments', 'delivery_profiles']), '/capabilities');
    const angles = requireStringArray(errors, pack.capabilities.angle_types, '/capabilities/angle_types', { minItems: 1 });
    requireSubset(errors, angles, C27_ANGLE_TYPES, '/capabilities/angle_types'); requireUnique(errors, angles, '/capabilities/angle_types');
    const visuals = requireStringArray(errors, pack.capabilities.visual_systems, '/capabilities/visual_systems', { minItems: 1 }); requireUnique(errors, visuals, '/capabilities/visual_systems');
    const durations = Array.isArray(pack.capabilities.duration_seconds) ? pack.capabilities.duration_seconds : [];
    if (!Array.isArray(pack.capabilities.duration_seconds) || durations.length === 0) add(errors, 'INVALID_ARRAY', '/capabilities/duration_seconds', 'duration_seconds must be a non-empty array');
    durations.forEach((v, i) => { requireInteger(errors, v, `/capabilities/duration_seconds/${i}`, { min: 1 }); if (!C27_DURATION_PROFILES.includes(v)) add(errors, 'CAPABILITY_DENIED', `/capabilities/duration_seconds/${i}`, `unsupported C27 duration ${v}`); });
    requireUnique(errors, durations, '/capabilities/duration_seconds');
    const fpsValues = Array.isArray(pack.capabilities.fps) ? pack.capabilities.fps : [];
    if (!Array.isArray(pack.capabilities.fps) || fpsValues.length === 0) add(errors, 'INVALID_ARRAY', '/capabilities/fps', 'fps must be a non-empty array');
    fpsValues.forEach((v, i) => requireInteger(errors, v, `/capabilities/fps/${i}`, { min: 1 })); requireUnique(errors, fpsValues, '/capabilities/fps');
    const reveals = requireStringArray(errors, pack.capabilities.reveal_timings, '/capabilities/reveal_timings', { minItems: 1 });
    requireSubset(errors, reveals, PROPOSAL_REVEAL_TIMINGS, '/capabilities/reveal_timings'); requireUnique(errors, reveals, '/capabilities/reveal_timings');
    const ctas = requireStringArray(errors, pack.capabilities.cta_treatments, '/capabilities/cta_treatments', { minItems: 1 });
    requireSubset(errors, ctas, C27_CTA_TREATMENTS, '/capabilities/cta_treatments'); requireUnique(errors, ctas, '/capabilities/cta_treatments');
    const delivery = requireStringArray(errors, pack.capabilities.delivery_profiles, '/capabilities/delivery_profiles', { minItems: 1 }); requireUnique(errors, delivery, '/capabilities/delivery_profiles');
  }

  if (!isObject(pack.constraints)) add(errors, 'TYPE_OBJECT_REQUIRED', '/constraints', 'constraints must be an object');
  else {
    checkUnknownKeys(errors, pack.constraints, new Set(['max_spoiler_level', 'max_body_atoms']), '/constraints');
    requireInteger(errors, pack.constraints.max_spoiler_level, '/constraints/max_spoiler_level', { min: 0 });
    requireInteger(errors, pack.constraints.max_body_atoms, '/constraints/max_body_atoms', { min: 0 });
  }

  if (typeof pack.context_hash !== 'string' || !/^[a-f0-9]{64}$/.test(pack.context_hash)) add(errors, 'INVALID_SHA256', '/context_hash', 'context_hash must be lowercase sha256 hex');
  else {
    const expected = computeContextHash(pack);
    if (pack.context_hash !== expected) add(errors, 'CONTEXT_HASH_MISMATCH', '/context_hash', `expected ${expected}`);
  }

  return { valid: errors.length === 0, errors: sortedErrors(errors) };
}

function indexes(pack) {
  const books = new Map();
  const atoms = new Map();
  const assets = new Map();
  const ctas = new Map((pack.ctas || []).map((cta) => [cta.cta_id, cta]));
  for (const book of pack.books || []) {
    books.set(book.book_id, book);
    for (const atom of book.creative_atoms || []) atoms.set(atom.atom_id, { atom, book_id: book.book_id });
    for (const asset of book.assets || []) assets.set(asset.asset_id, { asset, book_id: book.book_id });
  }
  return { books, atoms, assets, ctas };
}

function selectedAtom(errors, ids, bookId, atomId, expectedRole, angleType, path) {
  if (typeof atomId !== 'string' || !atomId) { add(errors, 'INVALID_STRING', path, 'expected a trusted atom ID'); return null; }
  const found = ids.atoms.get(atomId);
  if (!found) { add(errors, 'UNKNOWN_ATOM', path, `unknown atom ${atomId}`); return null; }
  if (found.book_id !== bookId) { add(errors, 'ATOM_SCOPE_MISMATCH', path, `atom ${atomId} belongs to ${found.book_id}, not ${bookId}`); return null; }
  if (found.atom.role !== expectedRole) add(errors, 'ATOM_ROLE_MISMATCH', path, `atom ${atomId} has role ${found.atom.role}, expected ${expectedRole}`);
  if (!found.atom.angle_types.includes(angleType)) add(errors, 'ATOM_ANGLE_MISMATCH', path, `atom ${atomId} does not allow angle ${angleType}`);
  return found.atom;
}

export function validateCreativeProposal(pack, proposal) {
  const contextReport = validateContextPack(pack);
  if (!contextReport.valid) return { valid: false, code: 'INVALID_SERVER_CONTEXT', errors: contextReport.errors };

  const errors = [];
  if (!isObject(proposal)) {
    add(errors, 'TYPE_OBJECT_REQUIRED', '', 'CreativeProposal must be an object');
    return { valid: false, code: 'CREATIVE_PROPOSAL_REJECTED', errors };
  }

  checkUnknownKeys(errors, proposal, new Set(['schema', 'proposal_id', 'context_pack_id', 'context_hash', 'account_id', 'book_id', 'narrative', 'presentation', 'selected_asset_ids']), '');
  if (proposal.schema !== PROPOSAL_SCHEMA) add(errors, 'SCHEMA_VERSION_MISMATCH', '/schema', `expected ${PROPOSAL_SCHEMA}`);
  requireString(errors, proposal.proposal_id, '/proposal_id');
  requireString(errors, proposal.context_pack_id, '/context_pack_id');
  requireString(errors, proposal.context_hash, '/context_hash');
  requireString(errors, proposal.account_id, '/account_id');
  requireString(errors, proposal.book_id, '/book_id');

  if (proposal.context_pack_id !== pack.context_pack_id) add(errors, 'CONTEXT_ID_MISMATCH', '/context_pack_id', `expected ${pack.context_pack_id}`);
  if (proposal.context_hash !== pack.context_hash) add(errors, 'CONTEXT_HASH_MISMATCH', '/context_hash', `expected ${pack.context_hash}`);
  if (proposal.account_id !== pack.account.account_id) add(errors, 'ACCOUNT_SCOPE_MISMATCH', '/account_id', `expected ${pack.account.account_id}`);

  const ids = indexes(pack);
  const book = ids.books.get(proposal.book_id);
  if (!book) add(errors, 'UNKNOWN_BOOK', '/book_id', `book ${proposal.book_id} is not in this ContextPack`);

  const narrative = proposal.narrative;
  if (!isObject(narrative)) add(errors, 'TYPE_OBJECT_REQUIRED', '/narrative', 'narrative must be an object');
  else {
    checkUnknownKeys(errors, narrative, new Set(['angle_type', 'hook_atom_id', 'tension_atom_id', 'payoff_atom_id', 'reveal_timing', 'cta_treatment', 'cta_id']), '/narrative');
    requireString(errors, narrative.angle_type, '/narrative/angle_type');
    requireString(errors, narrative.hook_atom_id, '/narrative/hook_atom_id');
    requireString(errors, narrative.reveal_timing, '/narrative/reveal_timing');
    requireString(errors, narrative.cta_treatment, '/narrative/cta_treatment');
    if (hasOwn(narrative, 'tension_atom_id')) requireString(errors, narrative.tension_atom_id, '/narrative/tension_atom_id');
    if (hasOwn(narrative, 'payoff_atom_id')) requireString(errors, narrative.payoff_atom_id, '/narrative/payoff_atom_id');
    if (hasOwn(narrative, 'cta_id')) requireString(errors, narrative.cta_id, '/narrative/cta_id');
    if (!pack.capabilities.angle_types.includes(narrative.angle_type)) add(errors, 'CAPABILITY_DENIED', '/narrative/angle_type', `angle ${narrative.angle_type} is not allowed`);
    if (!pack.capabilities.reveal_timings.includes(narrative.reveal_timing)) add(errors, 'CAPABILITY_DENIED', '/narrative/reveal_timing', `reveal timing ${narrative.reveal_timing} is not allowed`);
    if (!pack.capabilities.cta_treatments.includes(narrative.cta_treatment)) add(errors, 'CAPABILITY_DENIED', '/narrative/cta_treatment', `CTA treatment ${narrative.cta_treatment} is not allowed`);
  }

  const presentation = proposal.presentation;
  if (!isObject(presentation)) add(errors, 'TYPE_OBJECT_REQUIRED', '/presentation', 'presentation must be an object');
  else {
    checkUnknownKeys(errors, presentation, new Set(['duration_seconds', 'fps', 'visual_system', 'delivery_profile', 'seed']), '/presentation');
    requireInteger(errors, presentation.duration_seconds, '/presentation/duration_seconds', { min: 1 });
    requireInteger(errors, presentation.fps, '/presentation/fps', { min: 1 });
    requireString(errors, presentation.visual_system, '/presentation/visual_system');
    requireString(errors, presentation.delivery_profile, '/presentation/delivery_profile');
    requireInteger(errors, presentation.seed, '/presentation/seed', { min: 0 });
    if (!pack.capabilities.duration_seconds.includes(presentation.duration_seconds)) add(errors, 'CAPABILITY_DENIED', '/presentation/duration_seconds', `duration ${presentation.duration_seconds}s is not allowed`);
    if (!pack.capabilities.fps.includes(presentation.fps)) add(errors, 'CAPABILITY_DENIED', '/presentation/fps', `fps ${presentation.fps} is not allowed`);
    if (!pack.capabilities.visual_systems.includes(presentation.visual_system)) add(errors, 'CAPABILITY_DENIED', '/presentation/visual_system', `visual system ${presentation.visual_system} is not allowed`);
    if (!pack.capabilities.delivery_profiles.includes(presentation.delivery_profile)) add(errors, 'CAPABILITY_DENIED', '/presentation/delivery_profile', `delivery profile ${presentation.delivery_profile} is not allowed`);
  }

  const selectedAssets = requireStringArray(errors, proposal.selected_asset_ids, '/selected_asset_ids', { minItems: 1 });
  requireUnique(errors, selectedAssets, '/selected_asset_ids');
  let selectedCover = false;
  for (let i = 0; i < selectedAssets.length; i += 1) {
    const assetId = selectedAssets[i], found = ids.assets.get(assetId);
    if (!found) add(errors, 'UNKNOWN_ASSET', `/selected_asset_ids/${i}`, `unknown asset ${assetId}`);
    else if (found.book_id !== proposal.book_id) add(errors, 'ASSET_SCOPE_MISMATCH', `/selected_asset_ids/${i}`, `asset ${assetId} belongs to ${found.book_id}, not ${proposal.book_id}`);
    else if (found.asset.role === 'cover') selectedCover = true;
  }
  if (book && !selectedCover) add(errors, 'COVER_ASSET_REQUIRED', '/selected_asset_ids', 'at least one selected asset must be the scoped book cover');

  if (book && isObject(narrative)) {
    const selected = [];
    const hook = selectedAtom(errors, ids, proposal.book_id, narrative.hook_atom_id, 'hook', narrative.angle_type, '/narrative/hook_atom_id');
    if (hook) selected.push(hook);
    if (hasOwn(narrative, 'tension_atom_id')) {
      const tension = selectedAtom(errors, ids, proposal.book_id, narrative.tension_atom_id, 'tension', narrative.angle_type, '/narrative/tension_atom_id');
      if (tension) selected.push(tension);
    }
    if (hasOwn(narrative, 'payoff_atom_id')) {
      const payoff = selectedAtom(errors, ids, proposal.book_id, narrative.payoff_atom_id, 'payoff', narrative.angle_type, '/narrative/payoff_atom_id');
      if (payoff) selected.push(payoff);
    }
    requireUnique(errors, selected.map((atom) => atom.atom_id), '/narrative');
    const bodyCount = Number(hasOwn(narrative, 'tension_atom_id')) + Number(hasOwn(narrative, 'payoff_atom_id'));
    if (bodyCount > pack.constraints.max_body_atoms) add(errors, 'BODY_ATOM_LIMIT_EXCEEDED', '/narrative', `body atom count ${bodyCount} exceeds ${pack.constraints.max_body_atoms}`);
    for (const atom of selected) if (atom.spoiler_level > pack.constraints.max_spoiler_level) add(errors, 'SPOILER_BUDGET_EXCEEDED', '/narrative', `atom ${atom.atom_id} spoiler level ${atom.spoiler_level} exceeds ${pack.constraints.max_spoiler_level}`);

    if (presentation?.duration_seconds >= 7 && !hasOwn(narrative, 'tension_atom_id')) add(errors, 'TENSION_REQUIRED', '/narrative/tension_atom_id', '7s+ grammar requires a trusted tension atom');
    if (presentation?.duration_seconds < 7 && (hasOwn(narrative, 'tension_atom_id') || hasOwn(narrative, 'payoff_atom_id'))) add(errors, 'BODY_ATOM_FORBIDDEN', '/narrative', '3s/5s profiles do not accept tension/payoff atoms because C27 would not render them');
    if (presentation?.duration_seconds === 3 && narrative.cta_treatment !== 'none') add(errors, 'DURATION_CTA_CONFLICT', '/narrative/cta_treatment', '3s profile requires cta_treatment=none');
    if (presentation?.duration_seconds === 5 && !['none', 'soft_reveal'].includes(narrative.cta_treatment)) add(errors, 'DURATION_CTA_CONFLICT', '/narrative/cta_treatment', '5s profile supports only none/soft_reveal');
    if (presentation?.duration_seconds === 3 && narrative.reveal_timing !== 'none') add(errors, 'REVEAL_DURATION_CONFLICT', '/narrative/reveal_timing', '3s profile requires reveal_timing=none');
    if (presentation?.duration_seconds !== 3 && narrative.reveal_timing === 'none') add(errors, 'REVEAL_DURATION_CONFLICT', '/narrative/reveal_timing', 'reveal_timing=none is only valid for 3s');

    const explicitCta = ['intent', 'direct'].includes(narrative.cta_treatment);
    if (explicitCta && !hasOwn(narrative, 'cta_id')) add(errors, 'CTA_REQUIRED', '/narrative/cta_id', `${narrative.cta_treatment} requires cta_id`);
    if (!explicitCta && hasOwn(narrative, 'cta_id')) add(errors, 'CTA_FORBIDDEN', '/narrative/cta_id', `${narrative.cta_treatment} must not include cta_id`);
    if (explicitCta && hasOwn(narrative, 'cta_id')) {
      const cta = ids.ctas.get(narrative.cta_id);
      if (!cta) add(errors, 'UNKNOWN_CTA', '/narrative/cta_id', `unknown CTA ${narrative.cta_id}`);
      else if (!cta.treatments.includes(narrative.cta_treatment)) add(errors, 'CTA_TREATMENT_MISMATCH', '/narrative/cta_id', `CTA ${narrative.cta_id} does not allow ${narrative.cta_treatment}`);
    }
  }

  if (typeof proposal.proposal_id === 'string' && /^nbp1_[a-f0-9]{64}$/.test(proposal.proposal_id)) {
    const expected = computeProposalId(proposal);
    if (proposal.proposal_id !== expected) add(errors, 'PROPOSAL_ID_MISMATCH', '/proposal_id', `expected ${expected}`);
  } else if (typeof proposal.proposal_id === 'string' && proposal.proposal_id.length > 0) {
    add(errors, 'PROPOSAL_ID_INVALID', '/proposal_id', 'proposal_id must match nbp1_<sha256>');
  }

  return { valid: errors.length === 0, code: errors.length ? 'CREATIVE_PROPOSAL_REJECTED' : 'OK', errors: sortedErrors(errors) };
}

function atomSource(pack, atom) {
  return {
    kind: 'human_verified',
    text: atom.text,
    verification_id: `context:${pack.context_hash}:atom:${atom.atom_id}`,
  };
}

export class CreativeProposalValidationError extends Error {
  constructor(report) {
    super(`CreativeProposal rejected with ${report.errors.length} error(s)`);
    this.name = 'CreativeProposalValidationError';
    this.report = report;
  }
}

export function compileCreativeProposal(pack, proposal) {
  const report = validateCreativeProposal(pack, proposal);
  if (!report.valid) throw new CreativeProposalValidationError(report);

  const ids = indexes(pack);
  const book = ids.books.get(proposal.book_id);
  const hook = ids.atoms.get(proposal.narrative.hook_atom_id).atom;
  const tension = proposal.narrative.tension_atom_id ? ids.atoms.get(proposal.narrative.tension_atom_id).atom : null;
  const payoff = proposal.narrative.payoff_atom_id ? ids.atoms.get(proposal.narrative.payoff_atom_id).atom : null;
  const cta = proposal.narrative.cta_id ? ids.ctas.get(proposal.narrative.cta_id) : null;
  const angle = {
    id: proposal.proposal_id,
    type: proposal.narrative.angle_type,
    label: `external:${proposal.narrative.angle_type}`,
    source: {
      kind: 'creative_proposal',
      context_pack_id: pack.context_pack_id,
      context_hash: pack.context_hash,
      proposal_id: proposal.proposal_id,
    },
    hook: atomSource(pack, hook),
    ...(tension ? { tension: atomSource(pack, tension) } : {}),
    ...(payoff ? { payoff: atomSource(pack, payoff) } : {}),
  };
  const narrativePlan = planNarrative({
    book: { book_id: book.book_id, title: book.title, author: book.author, cta: cta?.text || '' },
    angle,
    duration_seconds: proposal.presentation.duration_seconds,
    fps: proposal.presentation.fps,
    reveal_timing: proposal.narrative.reveal_timing === 'none' ? 'mid' : proposal.narrative.reveal_timing,
    cta_treatment: proposal.narrative.cta_treatment,
    seed: proposal.presentation.seed,
  });
  const assets = proposal.selected_asset_ids.map((assetId) => {
    const asset = ids.assets.get(assetId).asset;
    return { asset_id: asset.asset_id, role: asset.role, sha256: asset.sha256, ...(asset.media_type ? { media_type: asset.media_type } : {}) };
  });
  const program = {
    schema: PROGRAM_SCHEMA,
    context_pack_id: pack.context_pack_id,
    context_hash: pack.context_hash,
    proposal_id: proposal.proposal_id,
    account_id: proposal.account_id,
    book_id: proposal.book_id,
    narrative_plan: narrativePlan,
    presentation: { ...proposal.presentation },
    assets,
  };
  program.program_id = computeProgramId(program);
  return program;
}
