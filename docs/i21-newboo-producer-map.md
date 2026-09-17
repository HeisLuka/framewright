# I21 — Newboo producer map (read-only)

This note maps the producer side required to emit `newboo-video-trusted-input-bundle-v1` from the existing `HeisLuka/newboo` backend. It is an implementation map, not a claim that the Newboo exporter already exists.

No Newboo backend files were changed during I21. The Newboo repository requires an active `tasks/*` scope with explicit `Allowed files` plus its Gortex impact/guard/contract workflow before backend edits. I21 therefore freezes the receiving/wire contract in `nightwill` and records the smallest producer task that remains.

## Existing authoritative book read path

Newboo already has the correct application/read path for books. A video exporter should reuse it rather than query YDB tables directly or invent a second book model.

The v1 book API calls the existing service layer:

- `app.services.book_service.get_book_by_id_async(db, book_id)` for one book;
- `app.services.book_service.list_books_owned_by_user_async(db, current_user.user_id)` for the authenticated user's books.

The repository layer explicitly disables synchronous YDB reads when YDB is active and directs callers to the async repository/provider path. A video exporter must preserve that boundary.

The existing `BookResponse` / book read model already exposes authoritative material useful to a ContextPack, including:

- `book_id`;
- `title`;
- `description`;
- `author_name` / author identity;
- publication/access state;
- age limit/rating;
- genre/tag taxonomy;
- `cover_url` and cover presentation metadata.

The underlying book repository also carries richer canonical metadata such as subtitle, original title, source URL, language fields, year, catalog section, fandoms, release note and lifecycle/visibility state. The producer should select only fields intentionally exposed to the creative contract; it should not dump the database row wholesale.

## Account identity

The authenticated API boundary already supplies `current_user.user_id`. That is sufficient for the required ContextPack `account.account_id` binding.

`brand_name` and `locale` are optional in ContextPack v1. The exporter should populate them only if an existing authoritative profile/read model supplies them. It must not infer locale from request headers or invent a brand name merely to fill optional fields.

## Deterministic facts available now

A Newboo producer can mint `Fact` records without any model call from canonical book fields. Examples include:

- title/subtitle/original title;
- description/premise material;
- author name;
- genre/tag/fandom membership;
- language/year/catalog metadata;
- age/access/publication/lifecycle state where product policy says those facts are creative-relevant.

Each emitted fact needs a stable `fact_id`, `kind`, exact `value`, and a `source_ref` that identifies the authoritative Newboo source/revision policy. The exporter must define that revision/source-ref policy explicitly; a fact must not become "trusted" merely because an LLM restated it.

## Cover asset authority is not closed yet

The current book model stores `cover_url` as a string. During the I21 read-only pass no first-class media/upload/storage API, repository, or blob resolver was found in the backend API/service/repository surface that turns that field into authoritative cover bytes.

That distinction matters. `cover_url` is useful metadata, but it is **not** by itself a trusted content-addressed asset. The bundle contract requires exact bytes, media type, byte length and SHA-256.

The producer task therefore needs one controlled cover resolver with a narrow contract:

```text
book.cover_url / owned cover reference
        -> verify approved/owned origin
        -> fetch/read bounded bytes
        -> detect/validate media type
        -> sha256(bytes)
        -> ContextPack Asset + bundle blob
```

It must not implement "HTTP GET whatever string is in `cover_url`". Arbitrary remote fetching would turn an authoritative book row into an SSRF/content-substitution boundary and would make the SHA-bound trusted bundle meaningless.

If Newboo already owns the cover in infrastructure not represented in this repository, the producer task should adapt that storage abstraction. If it does not, introducing an explicit owned/approved cover-asset abstraction is part of the producer work.

## Trusted creative atoms are also not closed yet

ContextPack v1's autopublish-safe path requires at least one server-owned `creative_atom` per book. The current Newboo book read model exposes descriptive/book metadata, but the I21 read-only pass did not find a persisted `creative_atoms`, hook/tension/payoff, tagline, marketing headline, or equivalent approved-copy registry.

Therefore a producer cannot honestly do this:

```text
BookResponse -> call LLM -> label result as trusted creative_atom
```

That would erase the C32 trust distinction we deliberately created.

The future producer task must choose an explicit authority policy. Safe options include:

1. deterministic server templates over exact canonical facts, with the template/version captured in provenance;
2. a human/editor-approved atom registry stored by Newboo;
3. a separate verification/approval artifact whose ID/hash authorizes externally generated copy to become a trusted atom.

C33 free-copy remains the expressive alternative when arbitrary LLM prose is desired. It must retain its lower trust/autopublish semantics instead of being silently promoted into C32 trusted atoms.

## Minimal producer task

The remaining Newboo implementation can stay narrow. It does not need a second renderer, a second creative proposal schema, or direct YDB coupling.

The intended composition is:

```text
authenticated user/account
        +
existing async book read service
        +
explicit trusted-atom authority
        +
controlled cover-byte resolver
        |
        v
ContextPack v1
        + exact owned asset bytes
        |
        v
newboo-video-trusted-input-bundle-v1
```

The bundle can then be transported by filesystem, authenticated download, object storage or another controlled channel. I21 installation in `nightwill` remains unchanged because transport is outside the trust/identity contract.

## Acceptance criteria for the future Newboo task

Before calling the producer complete, require at least:

- exporter uses the existing async book service/provider path, not direct table reads;
- account scope is bound to authenticated user identity;
- every fact has deterministic source provenance;
- every trusted atom has an explicit non-LLM-by-default authority/provenance policy;
- every asset byte comes from a controlled resolver and matches the emitted hash/size/media type;
- arbitrary `cover_url` fetching is rejected;
- unauthorized/cross-account book export is rejected;
- identical authoritative input produces byte-identical ContextPack/bundle identity;
- an authoritative book/atom/asset change produces a new revision/hash/bundle identity;
- the emitted directory installs successfully through the existing I21 installer and is immediately consumable by I09/I10/I19 without contract translation.
