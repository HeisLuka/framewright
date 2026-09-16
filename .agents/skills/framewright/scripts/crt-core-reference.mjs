const hash = (...parts) => {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const s = `${String(part)}|`;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
};

const firstSfc32 = (seed) => {
  let a = seed >>> 0;
  let b = 0x9e3779b9;
  let c = 0x6a09e667;
  let d = 0xbb67ae85;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i += 1) next();
  return next();
};

export const crtCoreReference = (rgba, width, height, metadata) => {
  const post = metadata?.controls?.post || {};
  if (post.skip) return new Uint8ClampedArray(rgba);
  const W = width;
  const H = height;
  const seed = Number(metadata?.seed || 0);
  const frame = Number(metadata?.frame || 0);
  const k = post.barrel ?? 0.06;
  const ca = post.ca ?? 0.0022;
  const caX = (post.caX ?? 0.9) * W / 1920;
  const vig = post.vig ?? 0.30;
  const gain = post.gain ?? 1.10;
  const p = firstSfc32(hash(seed, 'post', frame));
  const flick = (post.flick ?? 1) * (1 + (p - 0.5) * 0.045 + 0.015 * Math.sin(frame * 0.7));
  const grain = (post.grain ?? 9) * (post.grainMultiplier ?? 1);
  const wobble = (post.wobble ?? 0) * W;

  const map = new Float32Array(W * H * 2);
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const norm = 1 / (1 + k);
  for (let y = 0; y < H; y += 1) {
    const ny = (y - cy) / cy;
    for (let x = 0; x < W; x += 1) {
      const nx = (x - cx) / cx;
      const d = (1 + k * (nx * nx + ny * ny)) * norm;
      const i = (y * W + x) * 2;
      map[i] = nx * d * cx + cx;
      map[i + 1] = ny * d * cy + cy;
    }
  }

  const slP = Math.max(2, Math.round(H / 360));
  const slT = new Float32Array(slP);
  for (let i = 0; i < slP; i += 1) {
    slT[i] = 0.58 + 0.42 * Math.pow(Math.sin(Math.PI * (i + 0.5) / slP), 1.2);
  }

  const sd = rgba;
  const od = new Uint8ClampedArray(W * H * 4);
  let z = hash(seed, 'grain', frame) | 0;
  const W1 = W - 1;
  const H1 = H - 1;
  for (let y = 0; y < H; y += 1) {
    const ny = (y - cy) / cy;
    const sl = slT[y % slP];
    const wob = wobble
      ? Math.sin(y * 0.05 + frame * 0.9) * wobble * (0.5 + 0.5 * Math.sin(y * 0.0031 + frame * 0.21))
      : 0;
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      const o4 = i * 4;
      const mi = i * 2;
      const px = map[mi] + wob;
      const py = map[mi + 1];
      const nx = (x - cx) / cx;
      const r2 = nx * nx + ny * ny;
      let r = 0; let gc = 0; let b = 0;
      if (px >= 0 && px <= W1 && py >= 0 && py <= H1) {
        const x0 = px | 0; const y0 = py | 0; const fx = px - x0; const fy = py - y0;
        const x1 = x0 < W1 ? x0 + 1 : x0; const y1 = y0 < H1 ? y0 + 1 : y0;
        const a = (y0 * W + x0) * 4; const bq = (y0 * W + x1) * 4;
        const c = (y1 * W + x0) * 4; const d = (y1 * W + x1) * 4;
        gc = (sd[a + 1] * (1 - fx) + sd[bq + 1] * fx) * (1 - fy)
          + (sd[c + 1] * (1 - fx) + sd[d + 1] * fx) * fy;
      }
      const rx = (px - cx) * (1 + ca) + cx + caX;
      const ry = (py - cy) * (1 + ca) + cy;
      if (rx >= 0 && rx <= W1 && ry >= 0 && ry <= H1) {
        const x0 = rx | 0; const y0 = ry | 0; const fx = rx - x0; const fy = ry - y0;
        const x1 = x0 < W1 ? x0 + 1 : x0; const y1 = y0 < H1 ? y0 + 1 : y0;
        const a = (y0 * W + x0) * 4; const bq = (y0 * W + x1) * 4;
        const c = (y1 * W + x0) * 4; const d = (y1 * W + x1) * 4;
        r = (sd[a] * (1 - fx) + sd[bq] * fx) * (1 - fy)
          + (sd[c] * (1 - fx) + sd[d] * fx) * fy;
      }
      const bx = (px - cx) * (1 - ca) + cx - caX;
      const by = (py - cy) * (1 - ca) + cy;
      if (bx >= 0 && bx <= W1 && by >= 0 && by <= H1) {
        const x0 = bx | 0; const y0 = by | 0; const fx = bx - x0; const fy = by - y0;
        const x1 = x0 < W1 ? x0 + 1 : x0; const y1 = y0 < H1 ? y0 + 1 : y0;
        const a = (y0 * W + x0) * 4; const bq = (y0 * W + x1) * 4;
        const c = (y1 * W + x0) * 4; const d = (y1 * W + x1) * 4;
        b = (sd[a + 2] * (1 - fx) + sd[bq + 2] * fx) * (1 - fy)
          + (sd[c + 2] * (1 - fx) + sd[d + 2] * fx) * fy;
      }
      const v = (1 - vig * Math.pow(r2 * 0.5, 1.4)) * sl * flick * gain;
      z = (Math.imul(z, 1664525) + 1013904223) | 0;
      const gn = ((z >>> 24) / 255 - 0.5) * grain;
      r = r * v + gn; gc = gc * v + gn; b = b * v + gn;
      od[o4] = r < 0 ? 0 : r > 255 ? 255 : r;
      od[o4 + 1] = gc < 0 ? 0 : gc > 255 ? 255 : gc;
      od[o4 + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      od[o4 + 3] = 255;
    }
  }
  return od;
};
