import { createHash } from "node:crypto";

export const WEBCODECS_RENDERER_VERSION = "webcodecs-h264-v1";
export const WEBCODECS_BITRATE_POLICY_VERSION = "book-ad-standard-v1";

const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

/**
 * Conservative bitrate policy derived from E24.
 * 720-wide vertical ads use 1 Mbps; 1080-wide ads use 2 Mbps.
 * Larger sizes scale approximately with pixel area.
 */
export const webCodecsBitrateForWidth = (width, override = null) => {
  const explicit = positiveNumber(override);
  if (explicit) return Math.max(250_000, Math.round(explicit));

  const resolvedWidth = Math.max(64, Math.round(positiveNumber(width) || 1080));
  if (resolvedWidth <= 720) return 1_000_000;
  if (resolvedWidth <= 1080) return 2_000_000;
  return Math.max(2_000_000, Math.round(2_000_000 * (resolvedWidth / 1080) ** 2));
};

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    output[key] = canonicalValue(value[key]);
  }
  return output;
};

export const canonicalJson = (value) => JSON.stringify(canonicalValue(value));

export const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

/**
 * render_id identifies deterministic visual inputs and encoding policy.
 * It deliberately does NOT hash the final H.264/MP4 bytes because E26/E27
 * established that Chromium WebCodecs H.264 is not byte-identical across
 * repeated encodes of identical frames.
 */
export const createWebCodecsRenderId = (spec) => {
  const payload = canonicalJson({
    renderer: WEBCODECS_RENDERER_VERSION,
    bitratePolicy: WEBCODECS_BITRATE_POLICY_VERSION,
    ...spec,
  });
  return `fwc1_${sha256Hex(payload)}`;
};
