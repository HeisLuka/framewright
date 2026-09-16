#!/usr/bin/env node
import puppeteer from "puppeteer";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const [,, outS = "", widthS = "720", framesS = "450"] = process.argv;
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "examples/book-ad-v0/index.html"));
const width = Math.max(64, Math.round(Number(widthS) || 720));
const frames = Math.max(2, Math.round(Number(framesS) || 450));
const baseSeed = Math.round(Number(process.env.SEED) || 7);
const bitrate = Math.max(250_000, Math.round(Number(process.env.WEBCODECS_BITRATE) || (width >= 1000 ? 2_000_000 : 1_000_000)));
const rounds = Math.max(1, Math.min(4, Math.round(Number(process.env.ROUNDS) || 2)));
const concurrencies = String(process.env.CONCURRENCIES || "1,2,4")
  .split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0);
if (!concurrencies.length) throw new Error("no valid CONCURRENCIES");

const contentType = (filename) => {
  switch (path.extname(filename).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js":
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const server = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  fs.stat(filename, (error, stat) => {
    if (error || !stat.isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": contentType(filename), "Cache-Control": "no-store" });
    if (request.method === "HEAD") { response.end(); return; }
    fs.createReadStream(filename).pipe(response);
  });
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("could not bind E25 server");
const origin = `http://127.0.0.1:${address.port}`;
const htmlRelative = path.relative(root, html).split(path.sep).map(encodeURIComponent).join("/");

let browser;
try {
  const launchStarted = performance.now();
  browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 600000,
    args: process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  });
  const browserLaunchMilliseconds = performance.now() - launchStarted;

  const runJob = async (jobIndex) => {
    const page = await browser.newPage();
    const seed = baseSeed + jobIndex;
    const url = new URL(`/${htmlRelative}`, origin);
    url.searchParams.set("f", "0");
    url.searchParams.set("w", String(width));
    url.searchParams.set("s", String(seed));
    const jobStarted = performance.now();
    const loadStarted = performance.now();
    await page.goto(url.href, { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction("window.__ready===true", { timeout: 120000 });
    const pageReadyMilliseconds = performance.now() - loadStarted;
    try {
      const encode = await page.evaluate(async ({ width, seed, frames, bitrate }) => {
        const canvas = document.querySelector("canvas");
        const runtime = window.RISO;
        const fps = Math.max(1, Number(runtime.fps || 30));
        const count = Math.min(Math.max(1, Number(runtime.total || 1)), frames);
        runtime.render(0, width, seed);
        const config = {
          codec: "avc1.420028",
          width: canvas.width,
          height: canvas.height,
          bitrate,
          framerate: fps,
          latencyMode: "realtime",
          avc: { format: "annexb" },
        };
        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) throw new Error("WebCodecs H264 unsupported");
        let outputBytes = 0;
        let outputChunks = 0;
        let encodeError = null;
        let maxQueue = 0;
        const encoder = new VideoEncoder({
          output(chunk) { outputBytes += chunk.byteLength; outputChunks += 1; },
          error(error) { encodeError = `${error?.name || "Error"}: ${error?.message || error}`; },
        });
        encoder.configure(config);
        const waitForQueue = async () => {
          while (encoder.encodeQueueSize > 8) {
            await new Promise((resolve) => encoder.addEventListener("dequeue", resolve, { once: true }));
          }
        };
        const started = performance.now();
        for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
          runtime.render(frameIndex, width, seed);
          const frame = new VideoFrame(canvas, { timestamp: Math.trunc(frameIndex * 1_000_000 / fps) });
          try {
            encoder.encode(frame, { keyFrame: frameIndex === 0 || frameIndex % Math.max(1, Math.round(fps * 2)) === 0 });
            maxQueue = Math.max(maxQueue, encoder.encodeQueueSize);
          } finally {
            frame.close();
          }
          await waitForQueue();
        }
        await encoder.flush();
        const encodeMilliseconds = performance.now() - started;
        encoder.close();
        if (encodeError) throw new Error(encodeError);
        return {
          frames: count,
          fps,
          width: canvas.width,
          height: canvas.height,
          encodeMilliseconds,
          outputBytes,
          outputChunks,
          maxQueue,
        };
      }, { width, seed, frames, bitrate });
      return {
        jobIndex,
        seed,
        pageReadyMilliseconds,
        wallMilliseconds: performance.now() - jobStarted,
        ...encode,
      };
    } finally {
      await page.close();
    }
  };

  // One warm-up job primes browser/V8/codec initialization and is not timed in scenarios.
  await runJob(10_000);

  const scenarioSamples = new Map(concurrencies.map((value) => [value, []]));
  for (let round = 0; round < rounds; round += 1) {
    const order = round % 2 === 0 ? [...concurrencies] : [...concurrencies].reverse();
    for (const concurrency of order) {
      const started = performance.now();
      const jobs = await Promise.all(Array.from({ length: concurrency }, (_, index) => (
        runJob(round * 100 + concurrency * 10 + index)
      )));
      const wallMilliseconds = performance.now() - started;
      scenarioSamples.get(concurrency).push({
        wallMilliseconds,
        videosPerHour: concurrency * 3_600_000 / Math.max(wallMilliseconds, 1e-9),
        aggregateFramesPerSecond: concurrency * frames / Math.max(wallMilliseconds / 1000, 1e-9),
        jobs,
      });
    }
  }

  const scenarios = concurrencies.map((concurrency) => {
    const samples = scenarioSamples.get(concurrency);
    return {
      concurrency,
      medianWallMilliseconds: median(samples.map((item) => item.wallMilliseconds)),
      medianVideosPerHour: median(samples.map((item) => item.videosPerHour)),
      medianAggregateFramesPerSecond: median(samples.map((item) => item.aggregateFramesPerSecond)),
      medianPageReadyMilliseconds: median(samples.flatMap((item) => item.jobs.map((job) => job.pageReadyMilliseconds))),
      medianJobWallMilliseconds: median(samples.flatMap((item) => item.jobs.map((job) => job.wallMilliseconds))),
      samples,
    };
  });
  const baseline = scenarios.find((item) => item.concurrency === 1) || scenarios[0];
  for (const scenario of scenarios) {
    scenario.throughputVsConcurrency1 = scenario.medianVideosPerHour / Math.max(baseline.medianVideosPerHour, 1e-9);
  }
  const best = [...scenarios].sort((a, b) => b.medianVideosPerHour - a.medianVideosPerHour)[0];
  const estimatedColdSingleMilliseconds = browserLaunchMilliseconds + baseline.medianJobWallMilliseconds;
  const warmPoolSpeedupForSingle = estimatedColdSingleMilliseconds / Math.max(baseline.medianJobWallMilliseconds, 1e-9);

  const output = {
    experiment: "E25-webcodecs-throughput",
    html,
    width,
    frames,
    bitrate,
    rounds,
    browserLaunchMilliseconds,
    scenarios,
    best: {
      concurrency: best.concurrency,
      medianVideosPerHour: best.medianVideosPerHour,
      throughputVsConcurrency1: best.throughputVsConcurrency1,
    },
    warmPool: {
      estimatedColdSingleMilliseconds,
      warmSingleMilliseconds: baseline.medianJobWallMilliseconds,
      estimatedSpeedup: warmPoolSpeedupForSingle,
    },
    hypotheses: {
      concurrency: {
        statement: "Concurrent WebCodecs jobs are a material batch lever if the best tested concurrency improves aggregate videos/hour by at least 50% over one warm job.",
        confirmedAt50Percent: best.throughputVsConcurrency1 >= 1.5,
      },
      warmPool: {
        statement: "A persistent Chromium process becomes material after raw transport removal if excluding browser launch improves single-job wall time by at least 15%.",
        confirmedAt15Percent: warmPoolSpeedupForSingle >= 1.15,
      },
    },
    caveat: "Encoded chunks are counted and discarded; MP4 mux/audio are excluded. E23 measured mux at roughly a tenth of a second, but production throughput must be rechecked with the final mux/audio path and real provider SKU.",
  };
  console.log(JSON.stringify(output, null, 2));
  if (outS) {
    const out = path.resolve(outS);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
