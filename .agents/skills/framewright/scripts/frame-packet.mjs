export const FRAME_PACKET_VERSION = 1;
export const FRAME_METADATA_HEADER = "x-fw-frame-meta";
export const DEFAULT_FRAME_METADATA_MAX_BYTES = 12 * 1024;

const plainObject = (value) => (
  value && typeof value === "object" && !Array.isArray(value) ? value : null
);

const finiteNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const jsonClone = (value, label) => {
  let json;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw new Error(`${label} must be JSON serializable: ${error.message}`);
  }
  if (json == null) throw new Error(`${label} must be JSON serializable`);
  return JSON.parse(json);
};

export const normalizeFrameMetadata = (input, { expectedFrame = null } = {}) => {
  const source = plainObject(input);
  if (!source) throw new Error("frame metadata must be an object");

  const frame = Number(source.frame);
  if (!Number.isInteger(frame) || frame < 0) {
    throw new Error("frame metadata.frame must be a non-negative integer");
  }
  if (expectedFrame != null && frame !== expectedFrame) {
    throw new Error(`frame metadata mismatch: expected ${expectedFrame}, got ${frame}`);
  }

  const fps = Math.max(1, finiteNumber(source.fps, 30));
  const localFrame = Math.max(0, Math.trunc(finiteNumber(source.localFrame, frame)));
  const controlsSource = jsonClone(plainObject(source.controls) || {}, "frame metadata.controls");
  const post = plainObject(controlsSource.post) || {};
  const controls = Object.freeze({
    ...controlsSource,
    post: Object.freeze({ ...post }),
  });

  return Object.freeze({
    version: FRAME_PACKET_VERSION,
    frame,
    localFrame,
    progress: finiteNumber(source.progress, 0),
    time: finiteNumber(source.time, frame / fps),
    localTime: finiteNumber(source.localTime, localFrame / fps),
    fps,
    seed: finiteNumber(source.seed, 0),
    sceneId: String(source.sceneId || ""),
    controls,
  });
};

export const compactLegacyRisFrameState = (state, { fps = 30 } = {}) => {
  const source = plainObject(state);
  if (!source) throw new Error("legacy RIS frame state must be an object");
  const post = plainObject(source.post) || {};
  const frame = Math.max(0, Math.trunc(finiteNumber(source.f, 0)));
  const localFrame = Math.max(0, Math.trunc(finiteNumber(source.i, frame)));
  const resolvedFps = Math.max(1, finiteNumber(fps, 30));

  return normalizeFrameMetadata({
    frame,
    localFrame,
    progress: finiteNumber(source.t, 0),
    time: frame / resolvedFps,
    localTime: localFrame / resolvedFps,
    fps: resolvedFps,
    seed: finiteNumber(source.seed, 0),
    sceneId: source.name || "",
    controls: {
      post: {
        ...post,
        grainMultiplier: finiteNumber(source.grain, 1),
        wobble: finiteNumber(source.wobble, 0),
        skip: Boolean(post.skip),
      },
    },
  });
};

export const encodeFrameMetadataHeader = (metadata) => (
  encodeURIComponent(JSON.stringify(normalizeFrameMetadata(metadata)))
);

export const decodeFrameMetadataHeader = (
  value,
  { expectedFrame = null, maxBytes = DEFAULT_FRAME_METADATA_MAX_BYTES } = {},
) => {
  if (typeof value !== "string" || !value) {
    throw new Error("missing frame metadata header");
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`frame metadata header exceeds ${maxBytes} bytes`);
  }
  let parsed;
  try {
    parsed = JSON.parse(decodeURIComponent(value));
  } catch (error) {
    throw new Error(`invalid frame metadata header: ${error.message}`);
  }
  return normalizeFrameMetadata(parsed, { expectedFrame });
};

export const createFramePacket = (rgba, metadata, { expectedBytes = null } = {}) => {
  if (!(rgba instanceof Uint8Array)) {
    throw new Error("frame packet rgba must be a Uint8Array");
  }
  if (expectedBytes != null && rgba.byteLength !== expectedBytes) {
    throw new Error(`frame packet expected ${expectedBytes} RGBA bytes, got ${rgba.byteLength}`);
  }
  return Object.freeze({
    rgba,
    metadata: normalizeFrameMetadata(metadata),
  });
};
