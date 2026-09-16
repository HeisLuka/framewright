const nonEmpty = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
};

const safeIdPart = (value, label) => {
  const text = nonEmpty(value, label);
  if (text.includes("/")) throw new Error(`${label} must not contain '/'`);
  return text;
};

export const normalizeAssetDescriptor = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("asset descriptor must be an object");
  }
  const source = input.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("asset source must be an object");
  }
  const type = nonEmpty(source.type, "asset source.type");
  const normalizedSource = Object.freeze({
    ...source,
    type,
    key: source.key == null ? undefined : nonEmpty(source.key, "asset source.key"),
    bucket: source.bucket == null ? undefined : String(source.bucket),
    etag: source.etag == null ? undefined : String(source.etag),
    version: source.version == null ? undefined : String(source.version),
  });
  return Object.freeze({
    id: nonEmpty(input.id, "asset id"),
    kind: String(input.kind || "image"),
    role: input.role == null ? undefined : String(input.role),
    width: Number(input.width) > 0 ? Number(input.width) : undefined,
    height: Number(input.height) > 0 ? Number(input.height) : undefined,
    contentType: input.contentType == null ? undefined : String(input.contentType),
    source: normalizedSource,
  });
};

export const assetCacheKey = (descriptor) => {
  const asset = normalizeAssetDescriptor(descriptor);
  const source = asset.source;
  return [
    asset.kind,
    source.type,
    source.bucket || "",
    source.key || "",
    source.etag || "",
    source.version || "",
  ].join("|");
};

/**
 * Stable descriptor for the cover contract already used by Newboo's image-worker.
 *
 * source target:
 *   raw/books/{book_id}/covers/{cover_id}/source
 *
 * processed target:
 *   public/books/{book_id}/covers/{cover_id}/{target}.webp
 *
 * The descriptor is identity, not transport. A renderer-side resolver turns the
 * S3 key into a local/same-origin URL before the first frame is rendered.
 */
export const newbooCoverAsset = ({
  bookId,
  coverId,
  target = "source",
  bucket,
  etag,
  version,
  id = "book-cover",
  width,
  height,
} = {}) => {
  const book = safeIdPart(bookId, "bookId");
  const cover = safeIdPart(coverId, "coverId");
  const cleanTarget = String(target || "source").trim();
  const isSource = cleanTarget === "source";
  const key = isSource
    ? `raw/books/${book}/covers/${cover}/source`
    : `public/books/${book}/covers/${cover}/${safeIdPart(cleanTarget, "target")}.webp`;
  return normalizeAssetDescriptor({
    id,
    kind: "image",
    role: "cover",
    width,
    height,
    contentType: isSource ? undefined : "image/webp",
    source: {
      type: "s3",
      bucket,
      key,
      etag,
      version,
    },
  });
};

const loadImage = async (url, { crossOrigin = "anonymous" } = {}) => {
  const source = nonEmpty(url, "resolved asset URL");
  const image = new Image();
  image.decoding = "async";
  if (/^https?:/i.test(source) && crossOrigin) image.crossOrigin = crossOrigin;
  image.src = source;
  if (typeof image.decode === "function") {
    try {
      await image.decode();
      return image;
    } catch {
      // Some browsers reject decode() for formats they still load normally.
    }
  }
  if (image.complete && image.naturalWidth > 0) return image;
  await new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error(`failed to load asset: ${source}`)), { once: true });
  });
  return image;
};

/**
 * Browser-side decoded asset cache.
 *
 * resolve(descriptor) may return:
 *   - a URL string
 *   - { url, crossOrigin }
 *   - null/undefined when an asset is unavailable
 *
 * The resolver owns transport/authentication. This module deliberately knows
 * nothing about AWS/Yandex credentials or presigned URLs.
 */
export const createBrowserAssetStore = ({ resolve } = {}) => {
  if (typeof resolve !== "function") throw new Error("asset resolver callback is required");
  const byId = new Map();
  const byCacheKey = new Map();

  const preload = async (input) => {
    if (!input) return null;
    const descriptor = normalizeAssetDescriptor(input);
    const key = assetCacheKey(descriptor);
    if (byCacheKey.has(key)) {
      const existing = byCacheKey.get(key);
      byId.set(descriptor.id, existing);
      return existing;
    }
    const resolution = await resolve(descriptor);
    if (!resolution) return null;
    const options = typeof resolution === "string" ? { url: resolution } : resolution;
    const image = await loadImage(options.url, options);
    const entry = Object.freeze({
      descriptor,
      image,
      width: image.naturalWidth || descriptor.width || 0,
      height: image.naturalHeight || descriptor.height || 0,
    });
    byCacheKey.set(key, entry);
    byId.set(descriptor.id, entry);
    return entry;
  };

  const preloadAll = async (descriptors = []) => Promise.all(
    descriptors.filter(Boolean).map((descriptor) => preload(descriptor))
  );

  return Object.freeze({
    preload,
    preloadAll,
    get: (id) => byId.get(String(id)) || null,
    image: (id) => byId.get(String(id))?.image || null,
    has: (id) => byId.has(String(id)),
    clear() {
      byId.clear();
      byCacheKey.clear();
    },
  });
};
