import {
  layoutNextLineRange,
  layoutWithLines,
  materializeLineRange,
  prepareWithSegments,
} from "@chenglou/pretext";
import { buildLineBands, layoutIntoBands } from "./layout-core.mjs";

const fontString = ({ weight = 700, size, family = "Arial, sans-serif", style = "normal" }) => (
  `${style} ${weight} ${size}px ${family}`
);

const prepareBlock = ({ text, font, letterSpacing = 0, wordBreak = "normal", whiteSpace = "normal" }) => (
  prepareWithSegments(String(text || ""), font, { letterSpacing, wordBreak, whiteSpace })
);

export const fitTextBlock = ({
  text,
  width,
  maxHeight = Number.POSITIVE_INFINITY,
  maxLines = Number.POSITIVE_INFINITY,
  minSize = 20,
  maxSize = 180,
  lineHeightRatio = 1.05,
  family = "Arial, sans-serif",
  weight = 700,
  style = "normal",
  letterSpacing = 0,
  wordBreak = "normal",
  whiteSpace = "normal",
  align = "left",
}) => {
  const source = String(text || "");
  const cleanWidth = Math.max(1, Number(width) || 1);
  let low = Math.max(1, Math.round(minSize));
  let high = Math.max(low, Math.round(maxSize));
  let best = null;

  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    const font = fontString({ weight, size, family, style });
    const lineHeight = Math.max(1, size * lineHeightRatio);
    const prepared = prepareBlock({ text: source, font, letterSpacing, wordBreak, whiteSpace });
    const layout = layoutWithLines(prepared, cleanWidth, lineHeight);
    const fits = layout.lineCount <= maxLines && layout.height <= maxHeight;
    if (fits) {
      best = { prepared, layout, font, size, lineHeight };
      low = size + 1;
    } else {
      high = size - 1;
    }
  }

  if (!best) {
    const size = Math.max(1, Math.round(minSize));
    const font = fontString({ weight, size, family, style });
    const lineHeight = Math.max(1, size * lineHeightRatio);
    const prepared = prepareBlock({ text: source, font, letterSpacing, wordBreak, whiteSpace });
    best = { prepared, layout: layoutWithLines(prepared, cleanWidth, lineHeight), font, size, lineHeight };
  }

  const lines = best.layout.lines.map((line, index) => ({
    ...line,
    x: 0,
    y: index * best.lineHeight,
    lineHeight: best.lineHeight,
  }));

  return Object.freeze({
    text: source,
    width: cleanWidth,
    height: best.layout.height,
    lineCount: best.layout.lineCount,
    font: best.font,
    fontSize: best.size,
    lineHeight: best.lineHeight,
    letterSpacing,
    align,
    lines: Object.freeze(lines),
    overflow: best.layout.lineCount > maxLines || best.layout.height > maxHeight,
  });
};

export const compileTextFlow = ({
  text,
  fontSize,
  family = "Arial, sans-serif",
  weight = 400,
  style = "normal",
  letterSpacing = 0,
  lineHeightRatio = 1.25,
  region,
  obstacles = [],
  minSlotWidth = 80,
  wordBreak = "normal",
  whiteSpace = "normal",
}) => {
  const font = fontString({ weight, size: fontSize, family, style });
  const lineHeight = Math.max(1, Number(fontSize) * lineHeightRatio);
  const prepared = prepareBlock({ text, font, letterSpacing, wordBreak, whiteSpace });
  const bands = buildLineBands({
    top: region.y,
    height: region.height,
    lineHeight,
    left: region.x,
    right: region.x + region.width,
    obstacles,
    minSlotWidth,
  });
  const layout = layoutIntoBands({
    prepared,
    bands,
    nextLineRange: layoutNextLineRange,
    materializeLine: materializeLineRange,
  });
  return Object.freeze({
    ...layout,
    text: String(text || ""),
    font,
    fontSize,
    lineHeight,
    letterSpacing,
    region: Object.freeze({ ...region }),
    obstacles: Object.freeze(obstacles.map((item) => Object.freeze({ ...item }))),
    bands: Object.freeze(bands.map((band) => Object.freeze({
      ...band,
      blocked: Object.freeze(band.blocked.map((item) => Object.freeze({ ...item }))),
      slots: Object.freeze(band.slots.map((item) => Object.freeze({ ...item }))),
    }))),
    lines: Object.freeze(layout.lines.map((line) => Object.freeze({ ...line }))),
  });
};

const measurementContext = () => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(8, 8).getContext("2d");
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  return canvas.getContext("2d");
};

export const buildGlyphHomes = (compiled, {
  originX = 0,
  originY = 0,
  align = compiled.align || "left",
  baselineRatio = 0.82,
  maxGlyphs = 1200,
} = {}) => {
  const context = measurementContext();
  context.font = compiled.font;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const glyphs = [];
  const letterSpacing = Number(compiled.letterSpacing || 0);

  for (let lineIndex = 0; lineIndex < compiled.lines.length; lineIndex += 1) {
    const line = compiled.lines[lineIndex];
    const lineText = String(line.text || "");
    const measuredWidth = Number(line.width || context.measureText(lineText).width);
    const slotWidth = Number(line.slotWidth || compiled.width || measuredWidth);
    const baseX = Number(line.x || 0) + originX + (
      align === "center" ? (slotWidth - measuredWidth) / 2
        : align === "right" ? slotWidth - measuredWidth : 0
    );
    const top = Number(line.y ?? line.top ?? lineIndex * compiled.lineHeight) + originY;
    let prefix = "";
    let previousMeasured = 0;
    let graphemeIndex = 0;
    for (const part of segmenter.segment(lineText)) {
      if (glyphs.length >= maxGlyphs) return Object.freeze(glyphs);
      prefix += part.segment;
      const currentMeasured = context.measureText(prefix).width;
      const advance = Math.max(0, currentMeasured - previousMeasured);
      const startX = previousMeasured + graphemeIndex * letterSpacing;
      glyphs.push(Object.freeze({
        text: part.segment,
        x: baseX + startX + advance / 2,
        y: top + compiled.lineHeight * baselineRatio,
        advance,
        lineIndex,
        index: glyphs.length,
        font: compiled.font,
      }));
      previousMeasured = currentMeasured;
      graphemeIndex += 1;
    }
  }
  return Object.freeze(glyphs);
};

export const drawCompiledText = (context, compiled, {
  x = 0,
  y = 0,
  color = "#fff",
  alpha = 1,
  align = compiled.align || "left",
  baselineRatio = 0.82,
  revealLines = Number.POSITIVE_INFINITY,
} = {}) => {
  context.save();
  context.font = compiled.font;
  context.fillStyle = color;
  context.globalAlpha *= alpha;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  for (let index = 0; index < compiled.lines.length && index < revealLines; index += 1) {
    const line = compiled.lines[index];
    const slotWidth = Number(line.slotWidth || compiled.width || line.width || 0);
    const lineWidth = Number(line.width || context.measureText(line.text).width);
    const offset = align === "center" ? (slotWidth - lineWidth) / 2
      : align === "right" ? slotWidth - lineWidth : 0;
    context.fillText(
      line.text,
      x + Number(line.x || 0) + offset,
      y + Number(line.y ?? line.top ?? index * compiled.lineHeight) + compiled.lineHeight * baselineRatio,
    );
  }
  context.restore();
};
