#!/usr/bin/env node
import fs from "node:fs";

export const estimateRenderCost = ({
  framesPerSecond,
  videoSeconds = 15,
  outputFps = 30,
  hourlyUsd,
}) => {
  const renderFps = Number(framesPerSecond);
  const duration = Number(videoSeconds);
  const fps = Number(outputFps);
  const hourly = Number(hourlyUsd);
  if (!(renderFps > 0)) throw new Error("framesPerSecond must be > 0");
  if (!(duration > 0)) throw new Error("videoSeconds must be > 0");
  if (!(fps > 0)) throw new Error("outputFps must be > 0");
  if (!(hourly >= 0)) throw new Error("hourlyUsd must be >= 0");

  const frames = duration * fps;
  const renderSeconds = frames / renderFps;
  const videosPerHour = 3600 / renderSeconds;
  const costPerVideoUsd = renderSeconds / 3600 * hourly;
  return Object.freeze({
    frames,
    renderSeconds,
    videosPerHour,
    costPerVideoUsd,
    costPerThousandUsd: costPerVideoUsd * 1_000,
    costPerHundredThousandUsd: costPerVideoUsd * 100_000,
  });
};

export const estimateFromMetrics = (metrics, options = {}) => estimateRenderCost({
  framesPerSecond: metrics?.framesPerSecond,
  ...options,
});

const parseInput = (value) => {
  const split = value.indexOf("=");
  if (split <= 0 || split === value.length - 1) {
    throw new Error(`expected label=metrics.json, got ${value}`);
  }
  return { label: value.slice(0, split), filename: value.slice(split + 1) };
};

const isCli = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (isCli) {
  const hourlyUsd = Number(process.env.HOURLY_USD);
  const videoSeconds = Number(process.env.VIDEO_SECONDS || 15);
  const outputFps = Number(process.env.OUTPUT_FPS || 30);
  if (!(hourlyUsd >= 0)) {
    throw new Error("set HOURLY_USD to the actual or scenario compute price");
  }
  const inputs = process.argv.slice(2).map(parseInput);
  if (!inputs.length) throw new Error("pass at least one label=metrics.json input");

  const scenarios = inputs.map(({ label, filename }) => {
    const metrics = JSON.parse(fs.readFileSync(filename, "utf8"));
    return {
      label,
      source: filename,
      measuredFramesPerSecond: metrics.framesPerSecond,
      ...estimateFromMetrics(metrics, { hourlyUsd, videoSeconds, outputFps }),
    };
  });
  const cheapest = Math.min(...scenarios.map((item) => item.costPerVideoUsd));
  for (const scenario of scenarios) {
    scenario.incrementalVsCheapestPerVideoUsd = scenario.costPerVideoUsd - cheapest;
    scenario.incrementalVsCheapestPerHundredThousandUsd =
      scenario.incrementalVsCheapestPerVideoUsd * 100_000;
  }
  console.log(JSON.stringify({
    assumptions: { hourlyUsd, videoSeconds, outputFps },
    scenarios,
  }, null, 2));
}
