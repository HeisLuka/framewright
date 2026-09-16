import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  CATALOG_SOURCE_SCHEMA,
  computeCatalogSourceHash,
  computeVerifiedArtifactHash,
  extractExactSentenceSpans,
  mintCatalogLanguage,
  verifyMintManifest,
} from './catalog-language-minting-v1.mjs';

function makeArtifact() {
  const artifact = {
    artifact_id: 'approved_premise_1',
    artifact_hash: '',
    fact_kind: 'premise',
    fact_value: 'The protagonist receives a message from tomorrow.',
    spoiler_level: 0,
    composition_groups: ['core_arc'],
    forms: [
      { surface_type: 'clause', text: 'a message arrives from tomorrow' },
    ],
  };
  artifact.artifact_hash = computeVerifiedArtifactHash(artifact);
  return artifact;
}

function makeSource() {
  const source = {
    schema: CATALOG_SOURCE_SCHEMA,
    source_id: 'catalog_book_42_revision_7',
    source_hash: '',
    revision: 7,
    locale: 'en-US',
    policies: {
      structured_spoiler_level: 0,
      description_spoiler_level: 1,
      release_note_spoiler_level: 0,
    },
    book: {
      book_id: '42',
      title: 'Tomorrow Writes Back',
      author_name: 'A. Example',
      subtitle: 'Letters From a Future Self',
      original_title: '',
      language_original: 'English',
      language_translation: '',
      year: 2026,
      catalog_section: 'Fiction',
      alt_titles: ['Letters From Tomorrow'],
      genres: ['Psychological thriller', 'Science fiction'],
      tags: ['time loop', 'moral dilemma'],
      fandoms: [],
      age_rating: '16+',
      status_label: 'Completed',
      total_chapters: 24,
      release_note: 'Complete edition',
      description: 'Every evening, a letter arrives from tomorrow. The letters soon begin to contain instructions. Nothing here is rewritten by the compiler.',
    },
    verified_artifacts: [makeArtifact()],
  };
  source.source_hash = computeCatalogSourceHash(source);
  return source;
}

function makeContextDraft(source) {
  return {
    schema: 'newboo-context-pack-v1',
    context_pack_id: 'ctx_catalog_book_42_revision_7',
    context_hash: '0'.repeat(64),
    revision: source.revision,
    account: { account_id: 'account_example', brand_name: 'NEwBOO', locale: source.locale },
    books: [{
      book_id: source.book.book_id,
      title: source.book.title,
      author: source.book.author_name,
      facts: [{ fact_id: 'fact_existing', kind: 'editorial', value: 'Existing server fact survives minting.', source_ref: 'server:editorial:v1' }],
      creative_atoms: [{ atom_id: 'atom_existing', role: 'hook', angle_types: ['identity'], text: source.book.title, source_fact_ids: ['fact_existing'], spoiler_level: 0 }],
      assets: [{ asset_id: 'asset_cover', role: 'cover', sha256: 'a'.repeat(64), media_type: 'image/webp' }],
    }],
    ctas: [{ cta_id: 'cta_read', text: 'Read it in NEwBOO', treatments: ['intent', 'direct'] }],
    capabilities: {
      angle_types: ['identity', 'premise', 'conflict', 'question'],
      visual_systems: ['swiss'],
      duration_seconds: [9],
      fps: [30],
      reveal_timings: ['late'],
      cta_treatments: ['none', 'intent'],
      delivery_profiles: ['youtube_shorts'],
    },
    constraints: { max_spoiler_level: 1, max_body_atoms: 2 },
  };
}

const sourceSchemaPath = new URL('./catalog-creative-source-v1.schema.json', import.meta.url);
const manifestSchemaPath = new URL('./catalog-language-mint-manifest-v1.schema.json', import.meta.url);
const exampleSourcePath = new URL('./examples/catalog-creative-source-v1.example.json', import.meta.url);
JSON.parse(readFileSync(sourceSchemaPath, 'utf8'));
JSON.parse(readFileSync(manifestSchemaPath, 'utf8'));
const exampleSource = JSON.parse(readFileSync(exampleSourcePath, 'utf8'));
assert.equal(computeCatalogSourceHash(exampleSource), exampleSource.source_hash, 'example source hash must be current');

const source = makeSource();
assert.deepEqual(exampleSource, source, 'checked-in source fixture must match self-test source');
const draft = makeContextDraft(source);
const first = mintCatalogLanguage({ source, contextPackDraft: draft });
const second = mintCatalogLanguage({ source, contextPackDraft: draft });

assert.deepEqual(first, second, 'same source + same draft must mint byte-equivalent data');
assert.equal(verifyMintManifest({ source, bundle: first }), true);
assert.match(first.manifest.manifest_id, /^nbmint1_[a-f0-9]{64}$/);
assert.match(first.copyLanguage.copy_language_hash, /^[a-f0-9]{64}$/);
assert.match(first.contextPack.context_hash, /^[a-f0-9]{64}$/);
assert.notEqual(first.contextPack.context_hash, draft.context_hash);

const provenanceKinds = new Set(first.manifest.provenance_entries.map((entry) => entry.provenance.kind));
assert.deepEqual([...provenanceKinds].sort(), ['deterministic_transform', 'exact_field', 'exact_span', 'verified_artifact']);

const descriptionForms = first.copyLanguage.books[0].surface_forms.filter((form) => {
  const fact = first.contextPack.books[0].facts.find((x) => x.fact_id === form.fact_id);
  return fact?.kind === 'description_span';
});
assert.equal(descriptionForms.length, 3);
for (const form of descriptionForms) assert.ok(source.book.description.includes(form.text), 'description form must be an exact source substring');

const spans = extractExactSentenceSpans(source.book.description);
assert.deepEqual(spans.map((x) => x.text).sort(), descriptionForms.map((x) => x.text).sort());

const titleFact = first.contextPack.books[0].facts.find((fact) => fact.kind === 'title');
const genreFacts = first.contextPack.books[0].facts.filter((fact) => fact.kind === 'genre');
assert.equal(titleFact.value, source.book.title);
assert.deepEqual(genreFacts.map((x) => x.value).sort(), [...source.book.genres].sort());
assert.ok(first.contextPack.books[0].facts.some((fact) => fact.fact_id === 'fact_existing'), 'pre-existing server facts must survive');

const premiseForm = first.copyLanguage.books[0].surface_forms.find((form) => {
  const fact = first.contextPack.books[0].facts.find((x) => x.fact_id === form.fact_id);
  return fact?.kind === 'premise';
});
assert.equal(premiseForm.text, 'a message arrives from tomorrow');

const tampered = structuredClone(first);
const spanEntry = tampered.manifest.provenance_entries.find((entry) => entry.provenance.kind === 'exact_span');
const tamperedFact = tampered.contextPack.books[0].facts.find((fact) => fact.fact_id === spanEntry.fact_id);
tamperedFact.value = 'invented text';
assert.throws(() => verifyMintManifest({ source, bundle: tampered }), /context hash is stale|exact_span mismatch/);

const c32ModulePath = new URL('./compositional-copy-v1.mjs', import.meta.url);
const contextModulePath = new URL('./creative-proposal-v1.mjs', import.meta.url);
let c32_compatibility = 'not_available_in_isolated_selftest';
if (existsSync(c32ModulePath) && existsSync(contextModulePath)) {
  const [{ validateCopyLanguage }, { validateContextPack }] = await Promise.all([
    import('./compositional-copy-v1.mjs'),
    import('./creative-proposal-v1.mjs'),
  ]);
  const contextReport = validateContextPack(first.contextPack);
  assert.equal(contextReport.valid, true, JSON.stringify(contextReport.errors));
  const languageReport = validateCopyLanguage(first.contextPack, first.copyLanguage);
  assert.equal(languageReport.valid, true, JSON.stringify(languageReport.errors));
  c32_compatibility = 'validated';
}

const changedSource = structuredClone(source);
changedSource.book.title = 'Changed title';
changedSource.source_hash = computeCatalogSourceHash(changedSource);
const changed = mintCatalogLanguage({ source: changedSource, contextPackDraft: draft });
assert.notEqual(changed.contextPack.context_hash, first.contextPack.context_hash);
assert.notEqual(changed.copyLanguage.copy_language_hash, first.copyLanguage.copy_language_hash);
assert.notEqual(changed.manifest.manifest_id, first.manifest.manifest_id);

console.log(JSON.stringify({
  valid: true,
  source_hash: source.source_hash,
  context_hash: first.contextPack.context_hash,
  copy_language_hash: first.copyLanguage.copy_language_hash,
  manifest_id: first.manifest.manifest_id,
  facts_total: first.contextPack.books[0].facts.length,
  minted_forms: first.copyLanguage.books[0].surface_forms.length,
  templates: first.copyLanguage.books[0].templates.length,
  provenance_kinds: [...provenanceKinds].sort(),
  exact_description_spans: descriptionForms.length,
  c32_compatibility,
}, null, 2));
