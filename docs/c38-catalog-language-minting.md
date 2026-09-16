# C38 — Catalog Language Minting

## Question

Can NEwBOO turn authoritative catalog data into C32-compatible creative language automatically, without adding an LLM to production runtime and without inventing semantic facts that the catalog does not contain?

## Answer

Yes, with a hard boundary: deterministic minting can safely produce facts and surface forms from exact structured fields, exact source spans, tiny declared transforms, and immutable pre-approved artifacts. It must **not** infer `premise`, `conflict`, `question`, or other semantic narrative roles from raw description text on its own.

The resulting path is:

```text
NEwBOO catalog snapshot
  -> C38 CatalogLanguageMinting
     -> ContextPack facts
     -> CopyLanguage surface_forms + global templates
     -> structured provenance manifest
  -> existing C32/C35 ingress
  -> user-side LLM chooses IDs
  -> deterministic validator/compiler/renderer
```

There is no model call in C38 or below it.

## Backend authority used

The reference source shape mirrors fields currently accepted and normalized by `HeisLuka/newboo`:

- `backend/app/repositories/book_repository.py`: `title`, `description`, `subtitle`, `author_name`, `original_title`, languages, `year`, `catalog_section`, `alt_titles`, `age_rating`, `status_label`, `total_chapters`, `release_note`;
- `backend/app/repositories/book_taxonomy_repository.py`: canonical `genres`, `tags`, and `fandoms`.

URLs, pricing/monetization, visibility/access flags, and operational state are deliberately not minted into creative language v1.

This is a reference-layer implementation in `nightwill`; `newboo` itself is not modified because that repository requires its Gortex task/impact-analysis edit guard.

## Four provenance primitives

### `exact_field`

The emitted fact value and surface text are byte-for-byte the canonical server field value. The source snapshot validator rejects leading/trailing whitespace on string fields so the compiler cannot silently call `trim()` while claiming exact provenance.

Examples: title, author, genre, tag, fandom, subtitle.

### `exact_span`

Description text is segmented deterministically only at `.`, `!`, or `?` followed by whitespace/end. Accepted spans are 20–180 characters. The compiler records `start`/`end`; verification checks:

```js
source.book.description.slice(start, end) === fact.value
```

No paraphrase, shortening, grammar repair, or semantic classification occurs.

### `deterministic_transform`

Only an explicitly named, mechanically reversible/inspectable transform is allowed in v1:

```text
number_to_decimal_string_v1
```

It is used for numeric metadata such as `year` and `total_chapters` so the transformation is not mislabeled as an exact field copy.

### `verified_artifact`

Richer language can enter only as an immutable artifact whose canonical content hash is verified before minting. This is the offline enrichment boundary: a human workflow or an AI-assisted workflow may create/approve it elsewhere, but production receives only a content-addressed artifact.

This is how semantically typed material such as `premise: clause` can scale without putting an LLM inside rendering or pretending that raw synopsis extraction is semantic proof.

## Semantic honesty boundary

C38 intentionally emits raw description sentences as `description_span`, **not** `premise`, `conflict`, `world`, or `character`.

That distinction matters. Exact provenance can prove where text came from; it cannot prove the narrative role of the text. Narrative typing must come from an authoritative annotation or a verified artifact.

Structured catalog facts *can* be typed directly where their meaning is already declared by the backend, e.g. `genre`, `tag`, `fandom`, `title`, and `author`.

## Global templates

Templates are server-owned and global, not authored per book. C38 v1 includes six deliberately small templates:

- safe identity templates over `title`/`genre`/`author`;
- generic semantic templates for already-verified `premise`, `conflict`, and `question` forms.

The compiler does not manufacture a premise just to make the premise template usable. A book without an approved premise simply has no compatible premise form.

This is the key scaling property: templates scale across the catalog while book-specific language is minted from authoritative data.

## Identity and replay

The source, ContextPack, CopyLanguage, verified artifacts, and manifest are all content-addressed or carry content hashes. The same source snapshot + ContextPack draft + template library produces the same facts, forms, hashes, and manifest ID.

Changing a source field changes downstream ContextPack, CopyLanguage, and manifest identity.

## Reference result

The fixture modeled on the current `newboo` catalog shape produces:

```text
20 total ContextPack facts (1 pre-existing + 19 minted)
19 minted surface forms
6 global templates
3 exact description spans
4/4 provenance classes exercised
```

The isolated self-test also checks deterministic replay, source tamper detection, verified-artifact hash binding, preservation of pre-existing facts, and identity invalidation after a source mutation.

In repository CI the same bundle is additionally passed through the existing C32 `validateContextPack()` and `validateCopyLanguage()` implementations. That is the compatibility gate; C38 does not define a parallel creative-language validator.

## What C38 proves / does not prove

C38 proves that the catalog can automatically supply a large trusted substrate for the user-side creative LLM, and that richer semantics can enter through an immutable offline approval boundary.

It does **not** prove that raw catalog metadata alone yields strong viral copy. The remaining semantic-enrichment problem is explicit rather than hidden: producing high-quality typed `premise/conflict/question/...` artifacts at catalog scale is a separate upstream workflow.

That is desirable. The runtime stays deterministic and the trust boundary remains auditable.
