const DEFAULT_FPS = 30;
const DEFAULT_SHORT_SIDE = 1080;

export const clamp = (value, min = 0, max = 1) => (
  value < min ? min : value > max ? max : value
);

export const lerp = (from, to, t) => from + (to - from) * t;

export const easing = Object.freeze({
  linear: (t) => clamp(t),
  in: (t) => Math.pow(clamp(t), 3),
  out: (t) => 1 - Math.pow(1 - clamp(t), 3),
  inOut: (t) => {
    const p = clamp(t);
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  },
  sine: (t) => 0.5 - Math.cos(clamp(t) * Math.PI) / 2,
  back: (t) => {
    const p = clamp(t);
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
  },
});

export const hash = (...parts) => {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const text = `${String(part)}|`;
    for (let index = 0; index < text.length; index += 1) {
      h ^= text.charCodeAt(index);
      h = Math.imul(h, 16777619);
    }
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
};

export const createRng = (seed) => {
  let a = seed >>> 0;
  let b = 0x9e3779b9;
  let c = 0x6a09e667;
  let d = 0xbb67ae85;
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let index = 0; index < 12; index += 1) next();
  return Object.freeze({
    next,
    float: (min = 0, max = 1) => min + (max - min) * next(),
    int: (max) => Math.floor(next() * max),
    pick: (items) => items[Math.floor(next() * items.length)],
    sign: () => next() < 0.5 ? -1 : 1,
  });
};

const parseAspect = (value) => {
  if (Array.isArray(value) && value.length === 2) {
    const width = Number(value[0]);
    const height = Number(value[1]);
    if (width > 0 && height > 0) return width / height;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  const match = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i.exec(String(value || ""));
  if (!match) return 9 / 16;
  return Number(match[1]) / Number(match[2]);
};

const cleanScene = (scene, fps, startFrame, index) => {
  const seconds = Number(scene.seconds);
  const frames = Number(scene.frames);
  const durationFrames = Number.isFinite(frames) && frames > 0
    ? Math.round(frames)
    : Math.max(1, Math.round((Number.isFinite(seconds) && seconds > 0 ? seconds : 1) * fps));
  return Object.freeze({
    id: String(scene.id || `scene-${index + 1}`),
    recipe: String(scene.recipe || ""),
    params: Object.freeze({ ...(scene.params || {}) }),
    transitionFrames: Math.max(0, Math.round(Number(scene.transitionFrames ?? 4))),
    startFrame,
    endFrame: startFrame + durationFrames,
    durationFrames,
  });
};

export const compileRenderPlan = (source = {}) => {
  const fps = Math.max(1, Math.round(Number(source.fps) || DEFAULT_FPS));
  const aspect = parseAspect(source.aspect || "9:16");
  const shortSide = Math.max(64, Math.round(Number(source.shortSide) || DEFAULT_SHORT_SIDE));
  const logicalWidth = aspect >= 1 ? Math.round(shortSide * aspect) : shortSide;
  const logicalHeight = aspect >= 1 ? shortSide : Math.round(shortSide / aspect);
  const scenes = [];
  let cursor = 0;
  for (const [index, rawScene] of (source.scenes || []).entries()) {
    const scene = cleanScene(rawScene, fps, cursor, index);
    if (!scene.recipe) throw new Error(`scene ${scene.id} has no recipe`);
    scenes.push(scene);
    cursor = scene.endFrame;
  }
  if (!scenes.length) throw new Error("render plan must contain at least one scene");
  return Object.freeze({
    id: String(source.id || "motion-plan"),
    fps,
    aspect,
    shortSide,
    logicalWidth,
    logicalHeight,
    totalFrames: cursor,
    background: String(source.background || "#0b1320"),
    style: Object.freeze({ ...(source.style || {}) }),
    scenes: Object.freeze(scenes),
  });
};

const sceneForFrame = (plan, frame) => {
  const normalized = ((Math.trunc(frame) % plan.totalFrames) + plan.totalFrames) % plan.totalFrames;
  for (const scene of plan.scenes) {
    if (normalized < scene.endFrame) return { scene, frame: normalized };
  }
  return { scene: plan.scenes[plan.scenes.length - 1], frame: normalized };
};

export const createFrameState = (plan, frame, seed = 7) => {
  const located = sceneForFrame(plan, frame);
  const scene = located.scene;
  const localFrame = located.frame - scene.startFrame;
  const progress = scene.durationFrames <= 1 ? 1 : localFrame / (scene.durationFrames - 1);
  const sceneSeed = hash(seed, plan.id, scene.id);
  return Object.freeze({
    frame: located.frame,
    localFrame,
    progress: clamp(progress),
    time: located.frame / plan.fps,
    localTime: localFrame / plan.fps,
    fps: plan.fps,
    seed,
    sceneSeed,
    scene,
    plan,
    stableRng: () => createRng(sceneSeed),
    frameRng: () => createRng(hash(sceneSeed, located.frame)),
  });
};

const plainObject = (value) => (
  value && typeof value === "object" && !Array.isArray(value) ? value : null
);

export const normalizeFrameControls = (recipeResult) => {
  const controlsSource = plainObject(recipeResult)?.controls;
  const controls = plainObject(controlsSource) || {};
  const postSource = plainObject(controls.post) || {};
  return Object.freeze({
    ...controls,
    post: Object.freeze({ ...postSource }),
  });
};

export const compactFrameState = (state) => Object.freeze({
  frame: state.frame,
  localFrame: state.localFrame,
  progress: state.progress,
  time: state.time,
  localTime: state.localTime,
  fps: state.fps,
  seed: state.seed,
  sceneId: state.scene?.id || state.sceneId || "",
  controls: state.controls || Object.freeze({ post: Object.freeze({}) }),
});

export const windowedProgress = (progress, start = 0, end = 1, ease = "linear") => {
  const span = Math.max(1e-9, end - start);
  const raw = clamp((progress - start) / span);
  const fn = easing[ease] || easing.linear;
  return fn(raw);
};

export const strokePolylineProgress = (context, points, progress) => {
  if (!context || !Array.isArray(points) || points.length < 2) return;
  const lengths = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index][0] - points[index - 1][0];
    const dy = points[index][1] - points[index - 1][1];
    const length = Math.hypot(dx, dy);
    lengths.push(length);
    total += length;
  }
  let remaining = total * clamp(progress);
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length && remaining > 0; index += 1) {
    const length = lengths[index - 1];
    const from = points[index - 1];
    const to = points[index];
    if (remaining >= length) {
      context.lineTo(to[0], to[1]);
      remaining -= length;
    } else {
      const t = length ? remaining / length : 1;
      context.lineTo(lerp(from[0], to[0], t), lerp(from[1], to[1], t));
      remaining = 0;
    }
  }
  context.stroke();
};

const drawTransition = (context, state) => {
  const edge = state.scene.transitionFrames;
  if (!edge) return;
  const enter = clamp(state.localFrame / edge);
  const exit = clamp((state.scene.durationFrames - 1 - state.localFrame) / edge);
  const alpha = 1 - Math.min(enter, exit);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = state.plan.background;
  context.fillRect(0, 0, state.plan.logicalWidth, state.plan.logicalHeight);
  context.restore();
};

export const createMotionRuntime = ({ canvas, plan: sourcePlan, recipes, afterScene = null }) => {
  if (!canvas) throw new Error("canvas is required");
  const plan = sourcePlan?.totalFrames ? sourcePlan : compileRenderPlan(sourcePlan);
  const recipeMap = recipes instanceof Map ? recipes : new Map(Object.entries(recipes || {}));
  const render = (frame, outputWidth = 1080, seed = 7) => {
    const baseState = createFrameState(plan, frame, seed);
    const recipe = recipeMap.get(baseState.scene.recipe);
    if (typeof recipe !== "function") throw new Error(`unknown recipe: ${baseState.scene.recipe}`);
    const width = Math.max(64, Math.round(Number(outputWidth) || 1080));
    let height = Math.round(width / plan.aspect);
    if (height % 2) height += 1;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d", { alpha: false });
    const scale = width / plan.logicalWidth;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = plan.background;
    context.fillRect(0, 0, plan.logicalWidth, plan.logicalHeight);
    const recipeResult = recipe(context, baseState, baseState.scene.params, {
      clamp,
      lerp,
      easing,
      windowedProgress,
      createRng,
      hash,
      strokePolylineProgress,
    });
    const state = Object.freeze({
      ...baseState,
      controls: normalizeFrameControls(recipeResult),
    });
    if (typeof afterScene === "function") afterScene(context, state);
    drawTransition(context, state);
    context.setTransform(1, 0, 0, 1, 0, 0);
    return state;
  };
  return Object.freeze({ plan, render });
};

export const installRisoBridge = ({ runtime, canvas, defaultWidth = 1080, defaultSeed = 7 }) => {
  let lastFrame = null;
  const renderAndRemember = (frame, width = defaultWidth, seed = defaultSeed) => {
    const state = runtime.render(frame, width, seed);
    lastFrame = compactFrameState(state);
    return state;
  };
  const bridge = {
    fps: runtime.plan.fps,
    get total() { return runtime.plan.totalFrames; },
    get plates() {
      return runtime.plan.scenes.map((scene) => ({ name: scene.id, len: scene.durationFrames }));
    },
    get lastFrame() { return lastFrame; },
    render(frame, width = defaultWidth, seed = defaultSeed) {
      return renderAndRemember(frame, width, seed);
    },
    frame(frame, width = defaultWidth, seed = defaultSeed) {
      renderAndRemember(frame, width, seed);
      return canvas.toDataURL("image/png");
    },
    contact(count = 24, cellWidth = 360, seed = defaultSeed) {
      const n = Math.max(1, Math.round(Number(count) || 24));
      const width = Math.max(96, Math.round(Number(cellWidth) || 360));
      const cellHeight = Math.round(width / runtime.plan.aspect);
      const columns = runtime.plan.aspect < 1 ? 4 : 6;
      const rows = Math.ceil(n / columns);
      const gap = 8;
      const labelHeight = 28;
      const sheet = document.createElement("canvas");
      sheet.width = columns * (width + gap) + gap;
      sheet.height = rows * (cellHeight + labelHeight + gap) + gap;
      const context = sheet.getContext("2d", { alpha: false });
      context.fillStyle = "#181818";
      context.fillRect(0, 0, sheet.width, sheet.height);
      for (let index = 0; index < n; index += 1) {
        const frame = n === 1
          ? 0
          : Math.round(index * (runtime.plan.totalFrames - 1) / (n - 1));
        const state = runtime.render(frame, width, seed);
        const x = gap + (index % columns) * (width + gap);
        const y = gap + Math.floor(index / columns) * (cellHeight + labelHeight + gap);
        context.drawImage(canvas, x, y, width, cellHeight);
        context.fillStyle = "#ddd";
        context.font = "12px Menlo, monospace";
        context.textBaseline = "top";
        context.fillText(
          `f=${frame} ${state.scene.id} t=${state.progress.toFixed(2)}`,
          x + 2,
          y + cellHeight + 6,
        );
      }
      canvas.width = sheet.width;
      canvas.height = sheet.height;
      canvas.getContext("2d", { alpha: false }).drawImage(sheet, 0, 0);
      return canvas.toDataURL("image/png");
    },
  };
  window.RISO = bridge;
  return bridge;
};
