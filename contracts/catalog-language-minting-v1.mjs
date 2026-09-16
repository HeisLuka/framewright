import { createHash } from 'node:crypto';

export const CATALOG_SOURCE_SCHEMA = 'newboo-catalog-creative-source-v1';
export const CATALOG_MANIFEST_SCHEMA = 'newboo-catalog-language-mint-manifest-v1';
export const COPY_LANGUAGE_SCHEMA = 'newboo-copy-language-v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function withoutKey(value, key) {
  const { [key]: _ignored, ...rest } = value || {};
  return rest;
}

export function computeCatalogSourceHash(source) {
  return sha256Canonical(withoutKey(source, 'source_hash'));
}

export function computeVerifiedArtifactHash(artifact) {
  return sha256Canonical(withoutKey(artifact, 'artifact_hash'));
}

function fail(message) {
  throw new Error(message);
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
}

function requireSha(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(`${label} must be lowercase sha256 hex`);
}

function requireInteger(value, label, min = 0) {
  if (!Number.isInteger(value) || value < min) fail(`${label} must be an integer >= ${min}`);
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireCanonicalOptionalString(value, label) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') fail(`${label} must be a string when present`);
  if (value !== value.trim()) fail(`${label} must already be canonical (no leading/trailing whitespace)`);
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const text = cleanString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

export function extractExactSentenceSpans(text, { minChars = 20, maxChars = 180 } = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const spans = [];
  let segmentStart = 0;

  const push = (rawStart, rawEnd) => {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && /\s/u.test(text[start])) start += 1;
    while (end > start && /\s/u.test(text[end - 1])) end -= 1;
    if (end <= start) return;
    const exact = text.slice(start, end);
    if (exact.length < minChars || exact.length > maxChars) return;
    spans.push({ start, end, text: exact });
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    const next = text[i + 1];
    if (next !== undefined && !/\s/u.test(next)) continue;
    push(segmentStart, i + 1);
    segmentStart = i + 1;
  }
  if (segmentStart < text.length) push(segmentStart, text.length);
  return spans;
}

const STRUCTURED_FIELDS = [
  { field: 'title', kind: 'title', surface_type: 'noun_phrase', group: 'catalog_identity' },
  { field: 'author_name', kind: 'author', surface_type: 'noun_phrase', group: 'catalog_identity' },
  { field: 'subtitle', kind: 'subtitle', surface_type: 'fragment', group: 'catalog_identity' },
  { field: 'original_title', kind: 'original_title', surface_type: 'noun_phrase', group: 'catalog_identity' },
  { field: 'catalog_section', kind: 'catalog_section', surface_type: 'noun_phrase', group: 'catalog_taxonomy' },
  { field: 'age_rating', kind: 'age_rating', surface_type: 'fragment', group: 'catalog_metadata' },
  { field: 'status_label', kind: 'status', surface_type: 'fragment', group: 'catalog_metadata' },
  { field: 'language_original', kind: 'language_original', surface_type: 'noun_phrase', group: 'catalog_metadata' },
  { field: 'language_translation', kind: 'language_translation', surface_type: 'noun_phrase', group: 'catalog_metadata' },
  { field: 'release_note', kind: 'release_note', surface_type: 'fragment', group: 'catalog_release' },
];

const STRUCTURED_ARRAY_FIELDS = [
  { field: 'alt_titles', kind: 'alt_title', surface_type: 'noun_phrase', group: 'catalog_identity' },
  { field: 'genres', kind: 'genre', surface_type: 'noun_phrase', group: 'catalog_taxonomy' },
  { field: 'tags', kind: 'tag', surface_type: 'noun_phrase', group: 'catalog_taxonomy' },
  { field: 'fandoms', kind: 'fandom', surface_type: 'noun_phrase', group: 'catalog_taxonomy' },
];

const NUMERIC_FIELDS = [
  { field: 'year', kind: 'year', surface_type: 'fragment', group: 'catalog_metadata' },
  { field: 'total_chapters', kind: 'total_chapters', surface_type: 'fragment', group: 'catalog_metadata' },
];

export const CATALOG_TEMPLATES_V1 = Object.freeze([
  {
    template_id: 'tpl_catalog_identity_genre_title_v1',
    role: 'hook',
    angle_types: ['identity'],
    parts: [
      { kind: 'literal', text: 'A ' },
      { kind: 'slot', slot_id: 'genre', fact_kinds: ['genre'], surface_types: ['noun_phrase'] },
      { kind: 'literal', text: ' story: ' },
      { kind: 'slot', slot_id: 'title', fact_kinds: ['title'], surface_types: ['noun_phrase'] },
      { kind: 'literal', text: '.' },
    ],
    require_shared_group: false,
    allow_fact_reuse: false,
    max_output_chars: 140,
  },
  {
    template_id: 'tpl_catalog_identity_title_v1',
    role: 'hook',
    angle_types: ['identity'],
    parts: [
      { kind: 'slot', slot_id: 'title', fact_kinds: ['title'], surface_types: ['noun_phrase'] },
    ],
    require_shared_group: false,
    allow_fact_reuse: false,
    max_output_chars: 120,
  },
  {
    template_id: 'tpl_catalog_identity_author_v1',
    role: 'payoff',
    angle_types: ['identity'],
    parts: [
      { kind: 'literal', text: 'By ' },
      { kind: 'slot', slot_id: 'author', fact_kinds: ['author'], surface_types: ['noun_phrase'] },
      { kind: 'literal', text: '.' },
    ],
    require_shared_group: false,
    allow_fact_reuse: false,
    max_output_chars: 100,
  },
  {
    template_id: 'tpl_verified_premise_what_if_v1',
    role: 'hook',
    angle_types: ['premise'],
    parts: [
      { kind: 'literal', text: 'What if ' },
      { kind: 'slot', slot_id: 'premise', fact_kinds: ['premise'], surface_types: ['clause'] },
      { kind: 'literal', text: '?' },
    ],
    require_shared_group: false,
    allow_fact_reuse: false,
    max_output_chars: 100,
  },
  {
    template_id: 'tpl_verified_conflict_then_v1',
    role: 'tension',
    angle_types: ['conflict'],
    parts: [
      { kind: 'literal', text: 'Then ' },
      { kind: 'slot', slot_id: 'conflict', fact_kinds: ['conflict'], surface_types: ['clause'] },
      { kind: 'literal', text: '.' },
    ],
    require_shared_group: false,
    allow_fact_reuse: false,
    max_output_chars: 120,
  },
  {
    template_id: 'tpl_verified_question_payoff_v1',
    role: 'payoff',
    angle_types: ['question'],
    parts: [
      { kind: 'slot', slot_id: 'question', fact_kinds: ['question'], surface_types: ['question_body'] },
      { kind: 'literal', text: '?' },
    ],
    require_shared_group: false,
    allow_fact_reuse: false,
    max_output_chars: 120,
  },
]);

function pointer(field, index = null) {
  return index === null ? `/book/${field}` : `/book/${field}/${index}`;
}

function id(prefix, identity) {
  return `${prefix}_${sha256Canonical(identity).slice(0, 24)}`;
}

function makeFactAndForm({ bookId, source, kind, value, surfaceType, spoilerLevel, group, sourcePointer, provenance }) {
  const factId = id('fact_cat', { book_id: bookId, kind, source_pointer: sourcePointer, value });
  const formId = id('form_cat', { fact_id: factId, surface_type: surfaceType, text: value });
  const sourceRef = `catalog:${source.source_id}:${source.source_hash}${sourcePointer}`;
  return {
    fact: { fact_id: factId, kind, value, source_ref: sourceRef },
    form: { form_id: formId, fact_id: factId, surface_type: surfaceType, text: value, spoiler_level: spoilerLevel, composition_groups: [group] },
    manifestEntry: { fact_id: factId, form_ids: [formId], kind, provenance },
  };
}

export function validateCatalogSource(source) {
  requireObject(source, 'source');
  if (source.schema !== CATALOG_SOURCE_SCHEMA) fail(`source.schema must be ${CATALOG_SOURCE_SCHEMA}`);
  requireString(source.source_id, 'source.source_id');
  requireSha(source.source_hash, 'source.source_hash');
  requireInteger(source.revision, 'source.revision', 1);
  requireString(source.locale, 'source.locale');
  requireObject(source.book, 'source.book');
  requireString(source.book.book_id, 'source.book.book_id');
  requireString(source.book.title, 'source.book.title');
  requireString(source.book.author_name, 'source.book.author_name');
  for (const spec of STRUCTURED_FIELDS) requireCanonicalOptionalString(source.book[spec.field], `source.book.${spec.field}`);
  requireCanonicalOptionalString(source.book.description, 'source.book.description');
  for (const spec of STRUCTURED_ARRAY_FIELDS) {
    const values = source.book[spec.field];
    if (values === undefined || values === null) continue;
    if (!Array.isArray(values)) fail(`source.book.${spec.field} must be an array when present`);
    values.forEach((value, index) => {
      if (typeof value !== 'string' || value !== value.trim() || value.length === 0) fail(`source.book.${spec.field}[${index}] must be a canonical non-empty string`);
    });
  }
  requireObject(source.policies, 'source.policies');
  requireInteger(source.policies.structured_spoiler_level, 'source.policies.structured_spoiler_level', 0);
  requireInteger(source.policies.description_spoiler_level, 'source.policies.description_spoiler_level', 0);
  requireInteger(source.policies.release_note_spoiler_level, 'source.policies.release_note_spoiler_level', 0);
  const expected = computeCatalogSourceHash(source);
  if (expected !== source.source_hash) fail(`source_hash mismatch: expected ${expected}, got ${source.source_hash}`);

  for (const [index, artifact] of (source.verified_artifacts || []).entries()) {
    requireObject(artifact, `source.verified_artifacts[${index}]`);
    requireString(artifact.artifact_id, `source.verified_artifacts[${index}].artifact_id`);
    requireSha(artifact.artifact_hash, `source.verified_artifacts[${index}].artifact_hash`);
    requireString(artifact.fact_kind, `source.verified_artifacts[${index}].fact_kind`);
    requireString(artifact.fact_value, `source.verified_artifacts[${index}].fact_value`);
    requireInteger(artifact.spoiler_level, `source.verified_artifacts[${index}].spoiler_level`, 0);
    if (!Array.isArray(artifact.forms) || artifact.forms.length === 0) fail(`source.verified_artifacts[${index}].forms must be non-empty`);
    const expectedArtifactHash = computeVerifiedArtifactHash(artifact);
    if (expectedArtifactHash !== artifact.artifact_hash) fail(`verified artifact ${artifact.artifact_id} hash mismatch: expected ${expectedArtifactHash}, got ${artifact.artifact_hash}`);
  }
  return true;
}

function appendUniqueFacts(existingFacts, mintedFacts) {
  const byId = new Map();
  for (const fact of [...(existingFacts || []), ...mintedFacts]) {
    const prior = byId.get(fact.fact_id);
    if (prior && canonicalJson(prior) !== canonicalJson(fact)) fail(`fact id collision for ${fact.fact_id}`);
    byId.set(fact.fact_id, fact);
  }
  return [...byId.values()].sort((a, b) => a.fact_id.localeCompare(b.fact_id));
}

function computeContextHash(pack) {
  return sha256Canonical(withoutKey(pack, 'context_hash'));
}

function computeCopyLanguageHash(language) {
  return sha256Canonical(withoutKey(language, 'copy_language_hash'));
}

export function mintCatalogLanguage({ source, contextPackDraft, templates = CATALOG_TEMPLATES_V1 }) {
  validateCatalogSource(source);
  requireObject(contextPackDraft, 'contextPackDraft');
  if (contextPackDraft.schema !== 'newboo-context-pack-v1') fail('contextPackDraft.schema must be newboo-context-pack-v1');
  if (contextPackDraft.revision !== source.revision) fail(`revision mismatch: context=${contextPackDraft.revision}, source=${source.revision}`);
  const sourceBookId = source.book.book_id;
  const bookIndex = (contextPackDraft.books || []).findIndex((book) => book.book_id === sourceBookId);
  if (bookIndex < 0) fail(`book ${sourceBookId} is not present in contextPackDraft`);
  if (!(contextPackDraft.capabilities?.angle_types || []).includes('identity')) fail('contextPackDraft must expose identity angle');

  const mintedFacts = [];
  const surfaceForms = [];
  const manifestEntries = [];
  const structuredSpoiler = source.policies.structured_spoiler_level;

  const add = (triple) => {
    mintedFacts.push(triple.fact);
    surfaceForms.push(triple.form);
    manifestEntries.push(triple.manifestEntry);
  };

  for (const spec of STRUCTURED_FIELDS) {
    const value = cleanString(source.book[spec.field]);
    if (!value) continue;
    const spoiler = spec.field === 'release_note' ? source.policies.release_note_spoiler_level : structuredSpoiler;
    const sourcePointer = pointer(spec.field);
    add(makeFactAndForm({
      bookId: sourceBookId, source, kind: spec.kind, value, surfaceType: spec.surface_type, spoilerLevel: spoiler, group: spec.group, sourcePointer,
      provenance: { kind: 'exact_field', source_pointer: sourcePointer, source_hash: source.source_hash },
    }));
  }

  for (const spec of STRUCTURED_ARRAY_FIELDS) {
    const values = cleanStringArray(source.book[spec.field]);
    values.forEach((value, index) => {
      const sourcePointer = pointer(spec.field, index);
      add(makeFactAndForm({
        bookId: sourceBookId, source, kind: spec.kind, value, surfaceType: spec.surface_type, spoilerLevel: structuredSpoiler, group: spec.group, sourcePointer,
        provenance: { kind: 'exact_field', source_pointer: sourcePointer, source_hash: source.source_hash },
      }));
    });
  }

  for (const spec of NUMERIC_FIELDS) {
    const raw = source.book[spec.field];
    if (raw === null || raw === undefined || raw === '') continue;
    if (!Number.isInteger(raw) || raw < 0) fail(`source.book.${spec.field} must be a non-negative integer when present`);
    const value = String(raw);
    const sourcePointer = pointer(spec.field);
    add(makeFactAndForm({
      bookId: sourceBookId, source, kind: spec.kind, value, surfaceType: spec.surface_type, spoilerLevel: structuredSpoiler, group: spec.group, sourcePointer,
      provenance: { kind: 'deterministic_transform', source_pointer: sourcePointer, source_hash: source.source_hash, transform: 'number_to_decimal_string_v1' },
    }));
  }

  const description = typeof source.book.description === 'string' ? source.book.description : '';
  if (description) {
    for (const span of extractExactSentenceSpans(description)) {
      const sourcePointer = `/book/description@${span.start}:${span.end}`;
      const triple = makeFactAndForm({
        bookId: sourceBookId,
        source,
        kind: 'description_span',
        value: span.text,
        surfaceType: 'sentence',
        spoilerLevel: source.policies.description_spoiler_level,
        group: 'catalog_description',
        sourcePointer,
        provenance: { kind: 'exact_span', source_pointer: '/book/description', source_hash: source.source_hash, start: span.start, end: span.end },
      });
      add(triple);
    }
  }

  for (const artifact of source.verified_artifacts || []) {
    const factId = id('fact_verified', { book_id: sourceBookId, artifact_id: artifact.artifact_id, artifact_hash: artifact.artifact_hash, fact_kind: artifact.fact_kind, fact_value: artifact.fact_value });
    const sourceRef = `verified:${artifact.artifact_id}:${artifact.artifact_hash}`;
    const fact = { fact_id: factId, kind: artifact.fact_kind, value: artifact.fact_value, source_ref: sourceRef };
    mintedFacts.push(fact);
    const formIds = [];
    for (const form of artifact.forms) {
      requireString(form.surface_type, `verified artifact ${artifact.artifact_id} form.surface_type`);
      requireString(form.text, `verified artifact ${artifact.artifact_id} form.text`);
      const formId = id('form_verified', { fact_id: factId, surface_type: form.surface_type, text: form.text });
      formIds.push(formId);
      surfaceForms.push({
        form_id: formId,
        fact_id: factId,
        surface_type: form.surface_type,
        text: form.text,
        spoiler_level: artifact.spoiler_level,
        composition_groups: cleanStringArray(artifact.composition_groups).length ? cleanStringArray(artifact.composition_groups) : ['verified_artifact'],
      });
    }
    manifestEntries.push({
      fact_id: factId,
      form_ids: formIds.sort(),
      kind: artifact.fact_kind,
      provenance: { kind: 'verified_artifact', artifact_id: artifact.artifact_id, artifact_hash: artifact.artifact_hash },
    });
  }

  if (surfaceForms.length === 0) fail('catalog source produced no surface forms');

  const contextPack = structuredClone(contextPackDraft);
  const contextBook = contextPack.books[bookIndex];
  contextBook.title = cleanString(source.book.title);
  contextBook.author = cleanString(source.book.author_name);
  contextBook.facts = appendUniqueFacts(contextBook.facts, mintedFacts);
  contextPack.context_hash = computeContextHash(contextPack);

  const copyLanguageId = id('nbcl1', {
    source_hash: source.source_hash,
    context_hash: contextPack.context_hash,
    template_ids: templates.map((x) => x.template_id).sort(),
  });
  const copyLanguage = {
    schema: COPY_LANGUAGE_SCHEMA,
    copy_language_id: copyLanguageId,
    copy_language_hash: '',
    context_pack_id: contextPack.context_pack_id,
    context_hash: contextPack.context_hash,
    locale: source.locale,
    books: [{
      book_id: sourceBookId,
      surface_forms: surfaceForms.sort((a, b) => a.form_id.localeCompare(b.form_id)),
      templates: structuredClone(templates).sort((a, b) => a.template_id.localeCompare(b.template_id)),
    }],
  };
  copyLanguage.copy_language_hash = computeCopyLanguageHash(copyLanguage);

  const manifestBase = {
    schema: CATALOG_MANIFEST_SCHEMA,
    source_id: source.source_id,
    source_hash: source.source_hash,
    book_id: sourceBookId,
    context_pack_id: contextPack.context_pack_id,
    context_hash: contextPack.context_hash,
    copy_language_id: copyLanguage.copy_language_id,
    copy_language_hash: copyLanguage.copy_language_hash,
    provenance_entries: manifestEntries.sort((a, b) => a.fact_id.localeCompare(b.fact_id)),
  };
  const manifest = {
    ...manifestBase,
    manifest_id: `nbmint1_${sha256Canonical(manifestBase)}`,
  };

  return { contextPack, copyLanguage, manifest };
}

export function verifyMintManifest({ source, bundle }) {
  validateCatalogSource(source);
  requireObject(bundle, 'bundle');
  if (bundle.manifest?.source_hash !== source.source_hash) fail('manifest/source hash mismatch');
  if (bundle.copyLanguage?.context_hash !== bundle.contextPack?.context_hash) fail('copy language/context hash mismatch');
  if (computeContextHash(bundle.contextPack) !== bundle.contextPack.context_hash) fail('context hash is stale');
  if (computeCopyLanguageHash(bundle.copyLanguage) !== bundle.copyLanguage.copy_language_hash) fail('copy language hash is stale');

  const book = source.book;
  for (const entry of bundle.manifest.provenance_entries || []) {
    const fact = bundle.contextPack.books.flatMap((x) => x.facts || []).find((x) => x.fact_id === entry.fact_id);
    if (!fact) fail(`manifest references missing fact ${entry.fact_id}`);
    const p = entry.provenance;
    if (p.kind === 'exact_span') {
      const exact = book.description.slice(p.start, p.end);
      if (exact !== fact.value) fail(`exact_span mismatch for ${entry.fact_id}`);
    } else if (p.kind === 'verified_artifact') {
      const artifact = (source.verified_artifacts || []).find((x) => x.artifact_id === p.artifact_id);
      if (!artifact || artifact.artifact_hash !== p.artifact_hash) fail(`verified_artifact mismatch for ${entry.fact_id}`);
      if (artifact.fact_value !== fact.value) fail(`verified_artifact fact mismatch for ${entry.fact_id}`);
    } else if (p.kind === 'exact_field' || p.kind === 'deterministic_transform') {
      if (p.source_hash !== source.source_hash) fail(`source hash mismatch for ${entry.fact_id}`);
      const match = /^\/book\/([^/]+)(?:\/(\d+))?$/.exec(p.source_pointer || '');
      if (!match) fail(`unsupported source pointer ${p.source_pointer}`);
      const [, field, rawIndex] = match;
      const raw = rawIndex === undefined ? book[field] : book[field]?.[Number(rawIndex)];
      const expected = p.kind === 'deterministic_transform' && p.transform === 'number_to_decimal_string_v1' ? String(raw) : raw;
      if (expected !== fact.value) fail(`${p.kind} mismatch for ${entry.fact_id}`);
    } else {
      fail(`unsupported provenance kind ${p.kind}`);
    }
  }
  return true;
}
