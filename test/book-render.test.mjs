import assert from "node:assert/strict";
import test from "node:test";

import {
  createBookAdV0Job,
  decodeBookRenderJob,
  encodeBookRenderJob,
  newbooBookToRenderPayload,
} from "../src/book-render.mjs";

test("maps public Newboo BookResponse without inventing cover identity", () => {
  const payload = newbooBookToRenderPayload({
    book_id: "storage-book-1",
    public_id: "public-book-1",
    title: "Glass Orchard",
    subtitle: "A dangerous orchard remembers every name.",
    description: "She was sent to burn the orchard. By midnight the trees answered back.",
    author_name: "Mara Vale",
    genres: ["Gothic Fantasy"],
    cover_url: "https://books.example/i/public.webp",
  });

  assert.equal(payload.id, "public-book-1");
  assert.equal(payload.storageBookId, "storage-book-1");
  assert.equal(payload.title, "Glass Orchard");
  assert.equal(payload.author, "Mara Vale");
  assert.equal(payload.genre, "Gothic Fantasy");
  assert.equal(payload.hook, "A dangerous orchard remembers every name.");
  assert.equal(payload.quoteLabel, "ABOUT THE BOOK");
  assert.equal(payload.cover.asset, null);
  assert.equal(payload.cover.publicUrl, "https://books.example/i/public.webp");
  assert.equal(payload.metadata.year, undefined);
});

test("maps admin BookRepositoryRow cover_id to canonical Newboo source key", () => {
  const payload = newbooBookToRenderPayload({
    book: {
      book_id: "2f6985ce-2ec5-46dc-a60b-e514ebd9d1bb",
      public_id: "2f6985ce-2ec5-46dc-a60b-e514ebd9d1bb",
      title: "Book",
      description: "Existing copy.",
      cover_id: "slot-1-abc123",
      cover_url: "/i/public.webp",
    },
    is_visible: true,
    block_reason: null,
  }, { bucket: "book-platform-iceberg" });

  assert.equal(payload.cover.asset.source.type, "s3");
  assert.equal(payload.cover.asset.source.bucket, "book-platform-iceberg");
  assert.equal(
    payload.cover.asset.source.key,
    "raw/books/2f6985ce-2ec5-46dc-a60b-e514ebd9d1bb/covers/slot-1-abc123/source",
  );
});

test("creative overrides are deterministic inputs rather than generated copy", () => {
  const book = {
    book_id: "book-2",
    public_id: "book-2",
    title: "Book Two",
    description: "Description from Newboo.",
  };
  const first = newbooBookToRenderPayload(book, {
    hook: "CURATED HOOK",
    quote: "CURATED EXCERPT",
    cta: "READ CHAPTER ONE",
    genre: "DARK FANTASY",
  });
  const second = newbooBookToRenderPayload(book, {
    hook: "CURATED HOOK",
    quote: "CURATED EXCERPT",
    cta: "READ CHAPTER ONE",
    genre: "DARK FANTASY",
  });

  assert.deepEqual(first, second);
  assert.equal(first.hook, "CURATED HOOK");
  assert.equal(first.quote, "CURATED EXCERPT");
  assert.equal(first.quoteLabel, "EXCERPT");
  assert.equal(first.cta, "READ CHAPTER ONE");
  assert.equal(first.genre, "DARK FANTASY");
});

test("book-ad-v0 job is 15 seconds at 30 fps and survives base64url transport", () => {
  const job = createBookAdV0Job({
    book_id: "book-3",
    public_id: "book-3",
    title: "Transport Test",
    description: "No model is needed to compile this payload.",
  });

  assert.equal(job.plan.fps, 30);
  assert.equal(job.plan.totalFrames, 450);
  assert.equal(job.plan.scenes.length, 4);

  const token = encodeBookRenderJob(job);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeBookRenderJob(token), JSON.parse(JSON.stringify(job)));
});
