(() => {
  'use strict';

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

  const affinePowers = () => {
    const mul = new Uint32Array(24);
    const add = new Uint32Array(24);
    mul[0] = 1664525 >>> 0;
    add[0] = 1013904223 >>> 0;
    for (let i = 1; i < mul.length; i += 1) {
      add[i] = (Math.imul(mul[i - 1], add[i - 1]) + add[i - 1]) >>> 0;
      mul[i] = Math.imul(mul[i - 1], mul[i - 1]) >>> 0;
    }
    return { mul, add };
  };
  const LCG = affinePowers();

  const VERTEX = `#version 300 es
  precision highp float;
  const vec2 POS[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
  void main() { gl_Position = vec4(POS[gl_VertexID], 0.0, 1.0); }
  `;

  const FRAGMENT = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp usampler2D;

  uniform sampler2D uTex;
  uniform int uW;
  uniform int uH;
  uniform float uBarrel;
  uniform float uCa;
  uniform float uCaX;
  uniform float uVig;
  uniform float uGain;
  uniform float uFlick;
  uniform float uGrain;
  uniform float uWobble;
  uniform float uFrame;
  uniform int uScanPeriod;
  uniform uint uGrainSeed;
  uniform uint uLcgMul[24];
  uniform uint uLcgAdd[24];
  out vec4 fragColor;

  float sourceChannel(ivec2 p, int channel) {
    ivec2 tp = ivec2(p.x, uH - 1 - p.y);
    vec4 v = texelFetch(uTex, tp, 0) * 255.0;
    return channel == 0 ? v.r : channel == 1 ? v.g : v.b;
  }

  float bilinearChannel(vec2 p, int channel) {
    float W1 = float(uW - 1);
    float H1 = float(uH - 1);
    if (p.x < 0.0 || p.x > W1 || p.y < 0.0 || p.y > H1) return 0.0;
    ivec2 p0 = ivec2(floor(p));
    ivec2 p1 = min(p0 + ivec2(1), ivec2(uW - 1, uH - 1));
    vec2 f = p - vec2(p0);
    float a = sourceChannel(p0, channel);
    float b = sourceChannel(ivec2(p1.x, p0.y), channel);
    float c = sourceChannel(ivec2(p0.x, p1.y), channel);
    float d = sourceChannel(p1, channel);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  uint lcgAt(uint steps) {
    uint z = uGrainSeed;
    for (int bit = 0; bit < 24; bit++) {
      uint mask = 1u << uint(bit);
      if ((steps & mask) != 0u) z = uLcgMul[bit] * z + uLcgAdd[bit];
    }
    return z;
  }

  float clampByte(float value) {
    return roundEven(clamp(value, 0.0, 255.0));
  }

  void main() {
    int xb = int(floor(gl_FragCoord.x));
    int yb = int(floor(gl_FragCoord.y));
    int x = xb;
    int y = uH - 1 - yb;

    float cx = float(uW - 1) * 0.5;
    float cy = float(uH - 1) * 0.5;
    float nx = (float(x) - cx) / cx;
    float ny = (float(y) - cy) / cy;
    float d = (1.0 + uBarrel * (nx * nx + ny * ny)) / (1.0 + uBarrel);
    float px = nx * d * cx + cx;
    float py = ny * d * cy + cy;
    if (uWobble != 0.0) {
      px += sin(float(y) * 0.05 + uFrame * 0.9) * uWobble
        * (0.5 + 0.5 * sin(float(y) * 0.0031 + uFrame * 0.21));
    }

    float r = bilinearChannel(vec2((px - cx) * (1.0 + uCa) + cx + uCaX,
                                   (py - cy) * (1.0 + uCa) + cy), 0);
    float g = bilinearChannel(vec2(px, py), 1);
    float b = bilinearChannel(vec2((px - cx) * (1.0 - uCa) + cx - uCaX,
                                   (py - cy) * (1.0 - uCa) + cy), 2);

    float scanIndex = float(y % uScanPeriod);
    float sl = 0.58 + 0.42 * pow(sin(3.141592653589793 * (scanIndex + 0.5) / float(uScanPeriod)), 1.2);
    float r2 = nx * nx + ny * ny;
    float v = (1.0 - uVig * pow(r2 * 0.5, 1.4)) * sl * uFlick * uGain;

    uint index = uint(y * uW + x + 1);
    uint z = lcgAt(index);
    float gn = (float((z >> 24) & 255u) / 255.0 - 0.5) * uGrain;

    vec3 rgb = vec3(clampByte(r * v + gn), clampByte(g * v + gn), clampByte(b * v + gn));
    fragColor = vec4(rgb / 255.0, 1.0);
  }
  `;

  const compile = (gl, type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`WebGL CRT shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  };

  class WebGLCrtCore {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.gl = this.canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true,
        premultipliedAlpha: false,
      });
      if (!this.gl) throw new Error('WebGL2 is unavailable');
      const gl = this.gl;
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`WebGL CRT program link failed: ${gl.getProgramInfoLog(program)}`);
      }
      this.program = program;
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.width = 0;
      this.height = 0;
      this.uniform = {};
      for (const name of [
        'uTex','uW','uH','uBarrel','uCa','uCaX','uVig','uGain','uFlick','uGrain',
        'uWobble','uFrame','uScanPeriod','uGrainSeed','uLcgMul[0]','uLcgAdd[0]',
      ]) this.uniform[name] = gl.getUniformLocation(program, name);
    }

    resize(width, height) {
      if (this.width === width && this.height === height) return;
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0,
        this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
    }

    render(src, dst, state, controls = {}) {
      const W = src.width;
      const H = src.height;
      if (controls.skip) {
        if (dst.width !== W || dst.height !== H) { dst.width = W; dst.height = H; }
        const dg = dst.getContext('2d', { alpha: false });
        dg.setTransform(1, 0, 0, 1, 0, 0);
        dg.globalCompositeOperation = 'copy';
        dg.drawImage(src, 0, 0);
        dg.globalCompositeOperation = 'source-over';
        return;
      }
      this.resize(W, H);
      const gl = this.gl;
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);

      const frame = Number(state?.f || 0);
      const seed = Number(state?.seed || 0);
      const barrel = controls.barrel ?? 0.06;
      const ca = controls.ca ?? 0.0022;
      const caX = (controls.caX ?? 0.9) * W / 1920;
      const vig = controls.vig ?? 0.30;
      const gain = controls.gain ?? 1.10;
      const postRandom = firstSfc32(hash(seed, 'post', frame));
      const flick = (controls.flick ?? 1)
        * (1 + (postRandom - 0.5) * 0.045 + 0.015 * Math.sin(frame * 0.7));
      const grain = (controls.grain ?? 9) * (state?.grain ?? 1);
      const wobble = (state?.wobble ?? 0) * W;
      const scanPeriod = Math.max(2, Math.round(H / 360));
      const grainSeed = hash(seed, 'grain', frame) >>> 0;

      gl.uniform1i(this.uniform.uTex, 0);
      gl.uniform1i(this.uniform.uW, W);
      gl.uniform1i(this.uniform.uH, H);
      gl.uniform1f(this.uniform.uBarrel, barrel);
      gl.uniform1f(this.uniform.uCa, ca);
      gl.uniform1f(this.uniform.uCaX, caX);
      gl.uniform1f(this.uniform.uVig, vig);
      gl.uniform1f(this.uniform.uGain, gain);
      gl.uniform1f(this.uniform.uFlick, flick);
      gl.uniform1f(this.uniform.uGrain, grain);
      gl.uniform1f(this.uniform.uWobble, wobble);
      gl.uniform1f(this.uniform.uFrame, frame);
      gl.uniform1i(this.uniform.uScanPeriod, scanPeriod);
      gl.uniform1ui(this.uniform.uGrainSeed, grainSeed);
      gl.uniform1uiv(this.uniform['uLcgMul[0]'], LCG.mul);
      gl.uniform1uiv(this.uniform['uLcgAdd[0]'], LCG.add);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.finish();

      if (dst.width !== W || dst.height !== H) { dst.width = W; dst.height = H; }
      const dg = dst.getContext('2d', { alpha: false });
      dg.setTransform(1, 0, 0, 1, 0, 0);
      dg.globalCompositeOperation = 'copy';
      dg.drawImage(this.canvas, 0, 0);
      dg.globalCompositeOperation = 'source-over';
    }

    info() {
      const gl = this.gl;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      };
    }
  }

  let singleton = null;
  const getCore = () => (singleton ||= new WebGLCrtCore());
  window.FWWebGLCrtCore = (src, dst, state, controls = {}) => getCore().render(src, dst, state, controls);
  window.FWWebGLCrtInfo = () => getCore().info();
})();
