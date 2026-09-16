const finite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cloneCursor = (cursor) => ({
  segmentIndex: Number(cursor?.segmentIndex || 0),
  graphemeIndex: Number(cursor?.graphemeIndex || 0),
});

export const sameCursor = (left, right) => (
  Number(left?.segmentIndex || 0) === Number(right?.segmentIndex || 0)
  && Number(left?.graphemeIndex || 0) === Number(right?.graphemeIndex || 0)
);

export const mergeIntervals = (intervals = []) => {
  const source = intervals
    .map((item) => ({
      left: Math.min(finite(item?.left), finite(item?.right)),
      right: Math.max(finite(item?.left), finite(item?.right)),
    }))
    .filter((item) => item.right > item.left)
    .sort((left, right) => left.left - right.left || left.right - right.right);
  const merged = [];
  for (const current of source) {
    const previous = merged[merged.length - 1];
    if (!previous || current.left > previous.right) {
      merged.push({ ...current });
    } else if (current.right > previous.right) {
      previous.right = current.right;
    }
  }
  return merged;
};

export const carveLineSlots = ({ left = 0, right, blocked = [], minWidth = 1 }) => {
  const min = Math.max(1, finite(minWidth, 1));
  const start = finite(left);
  const end = Math.max(start, finite(right));
  const slots = [];
  let cursor = start;
  for (const interval of mergeIntervals(blocked)) {
    const blockedLeft = Math.max(start, Math.min(end, interval.left));
    const blockedRight = Math.max(start, Math.min(end, interval.right));
    if (blockedRight <= cursor) continue;
    if (blockedLeft - cursor >= min) {
      slots.push({ left: cursor, right: blockedLeft, width: blockedLeft - cursor });
    }
    cursor = Math.max(cursor, blockedRight);
  }
  if (end - cursor >= min) {
    slots.push({ left: cursor, right: end, width: end - cursor });
  }
  return slots;
};

export const obstacleIntervalsForBand = (obstacles = [], top = 0, bottom = top) => {
  const bandTop = Math.min(finite(top), finite(bottom));
  const bandBottom = Math.max(finite(top), finite(bottom));
  const intervals = [];
  for (const obstacle of obstacles) {
    const type = String(obstacle?.type || "rect");
    const paddingX = Math.max(0, finite(obstacle?.paddingX ?? obstacle?.padding));
    const paddingY = Math.max(0, finite(obstacle?.paddingY ?? obstacle?.padding));
    if (type === "rect") {
      const left = finite(obstacle?.x ?? obstacle?.left) - paddingX;
      const topEdge = finite(obstacle?.y ?? obstacle?.top) - paddingY;
      const width = Math.max(0, finite(obstacle?.width));
      const height = Math.max(0, finite(obstacle?.height));
      const right = left + width + paddingX * 2;
      const bottomEdge = topEdge + height + paddingY * 2;
      if (bottomEdge >= bandTop && topEdge <= bandBottom) intervals.push({ left, right });
    } else if (type === "circle") {
      const cx = finite(obstacle?.cx ?? obstacle?.x);
      const cy = finite(obstacle?.cy ?? obstacle?.y);
      const radius = Math.max(0, finite(obstacle?.radius ?? obstacle?.r)) + Math.max(paddingX, paddingY);
      if (!radius || cy + radius < bandTop || cy - radius > bandBottom) continue;
      const nearestY = Math.max(bandTop, Math.min(bandBottom, cy));
      const dy = nearestY - cy;
      const halfWidth = Math.sqrt(Math.max(0, radius * radius - dy * dy));
      intervals.push({ left: cx - halfWidth, right: cx + halfWidth });
    }
  }
  return mergeIntervals(intervals);
};

export const buildLineBands = ({
  top = 0,
  height,
  lineHeight,
  left = 0,
  right,
  obstacles = [],
  minSlotWidth = 40,
}) => {
  const cleanLineHeight = Math.max(1, finite(lineHeight, 1));
  const cleanHeight = Math.max(cleanLineHeight, finite(height, cleanLineHeight));
  const count = Math.max(1, Math.ceil(cleanHeight / cleanLineHeight));
  const bands = [];
  for (let index = 0; index < count; index += 1) {
    const bandTop = finite(top) + index * cleanLineHeight;
    const bandBottom = Math.min(finite(top) + cleanHeight, bandTop + cleanLineHeight);
    const blocked = obstacleIntervalsForBand(obstacles, bandTop, bandBottom);
    bands.push({
      top: bandTop,
      bottom: bandBottom,
      left: finite(left),
      right: finite(right),
      blocked,
      slots: carveLineSlots({ left, right, blocked, minWidth: minSlotWidth }),
    });
  }
  return bands;
};

const summarize = ({ complete, reason = "complete", cursor, lines, bands }) => ({
  complete,
  reason,
  cursor,
  lines,
  lineCount: lines.length,
  height: lines.length && bands.length
    ? Math.max(...lines.map((line) => line.bottom)) - bands[0].top
    : 0,
});

export const layoutIntoBands = ({
  prepared,
  bands = [],
  startCursor = { segmentIndex: 0, graphemeIndex: 0 },
  nextLineRange,
  materializeLine,
}) => {
  if (typeof nextLineRange !== "function") throw new Error("nextLineRange callback is required");
  if (typeof materializeLine !== "function") throw new Error("materializeLine callback is required");
  let cursor = cloneCursor(startCursor);
  const lines = [];
  for (const band of bands) {
    for (const slot of band.slots || []) {
      const range = nextLineRange(prepared, cursor, slot.width);
      if (!range) return summarize({ complete: true, cursor, lines, bands });
      if (sameCursor(cursor, range.end)) {
        return summarize({ complete: false, reason: "no_progress", cursor, lines, bands });
      }
      const materialized = materializeLine(prepared, range);
      lines.push({
        ...materialized,
        x: slot.left,
        y: band.top,
        top: band.top,
        bottom: band.bottom,
        slotWidth: slot.width,
      });
      cursor = cloneCursor(range.end);
    }
  }
  const tail = nextLineRange(prepared, cursor, Number.MAX_SAFE_INTEGER);
  return summarize({
    complete: tail === null,
    reason: tail === null ? "complete" : "overflow",
    cursor,
    lines,
    bands,
  });
};
