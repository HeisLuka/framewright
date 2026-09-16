#!/usr/bin/env node
import puppeteer from "puppeteer";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const [,, outS = "", widthS = "720", frameCountS = "120", transportCountS = "24"] = process.argv;
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "examples/book-ad-v0/index.html"));
const width = Math.max(64, Math.round(Number(widthS) || 720));
const frameCount = Math.max(1, Math.round(Number(frameCountS) || 120));
const transportCount = Math.max(1, Math.min(60, Math.round(Number(transportCountS) || 24)));
const seed = Number(process.env.SEED || 7);
const rounds = Math.max(1, Math.min(5, Math.round(Number(process.env.ROUNDS) || 2)));

if (!Number.isFinite(seed)) throw new Error("SEED must be numeric");
if (!fs.existsSync(html)) throw new Error(`no such HTML: ${html}`);
if (html !== root && !html.startsWith(root + path.sep)) {
  throw new Error(`HTML must be inside FW_ROOT (${root})`);
}

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

let sinkBytes = 0;
let sinkRequests = 0;
const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "POST" && requestUrl.pathname === "/__fw_probe_sink") {
    let bytes = 0;
    request.on("data", (chunk) => { bytes += chunk.length; });
    request.on("end", () => {
      sinkBytes += bytes;
      sinkRequests += 1;
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
    });
    request.on("error", () => {
      if (!response.headersSent) response.writeHead(400);
      if (!response.writableEnded) response.end();
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end();
    return;
  }
  const decoded = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  const filename = path.resolve(root, decoded);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end();
    return;
  }
  fs.stat(filename, (error, stat) => {
    if (error || !stat.isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType(filename),
      "Cache-Control": "no-store",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(filename).pipe(response);
  });
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("failed to bind stage profiler server");
const origin = `http://127.0.0.1:${address.port}`;
const htmlRelative = path.relative(root, html).split(path.sep).map(encodeURIComponent).join("/");
const pageUrl = (() => {
  const url = new URL(`/${htmlRelative}`, origin);
  url.searchParams.set("f", "0");
  url.searchParams.set("w", String(width));
  url.searchParams.set("s", String(seed));
  return url.href;
})();

let browser = null;
try {
  const launchStarted = performance.now();
  browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 600000,
    args: process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  });
  const browserLaunchMilliseconds = performance.now() - launchStarted;

  const loadPage = async () => {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error("PAGE ERROR", error.message));
    const started = performance.now();
    await page.goto(pageUrl, { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction("window.__ready===true", { timeout: 120000 });
    return { page, milliseconds: performance.now() - started };
  };

  const coldPage = await loadPage();
  const page = coldPage.page;
  const warmPage = await loadPage();
  const warmPageReadyMilliseconds = warmPage.milliseconds;
  await warmPage.page.close();

  const info = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return {
      total: Number(window.RISO?.total || 0),
      fps: Number(window.RISO?.fps || 30),
      width: canvas?.width || 0,
      height: canvas?.height || 0,
      hasRiso: Boolean(window.RISO && typeof window.RISO.render === "function"),
    };
  });
  if (!info.hasRiso) throw new Error("stage profiler requires window.RISO.render()");
  const total = Math.max(1, Math.trunc(info.total || 1));
  const actualFrameCount = Math.min(total, frameCount);
  const frames = Array.from({ length: actualFrameCount }, (_, index) => index);

  const profileRound = async () => page.evaluate(async ({ frames, width, seed, transportCount }) => {
    const canvas = document.querySelector("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    const runtime = window.RISO;
    const render = (frame) => runtime.render(frame, width, seed);

    render(frames[0]);
    context.getImageData(0, 0, canvas.width, canvas.height);

    let checksum = 0;
    let started = performance.now();
    for (const frame of frames) render(frame);
    const renderOnlyMilliseconds = performance.now() - started;

    started = performance.now();
    for (const frame of frames) {
      render(frame);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      checksum = (checksum + rgba[(frame * 97) % rgba.length]) >>> 0;
    }
    const renderReadbackMilliseconds = performance.now() - started;

    render(frames[0]);
    started = performance.now();
    for (let index = 0; index < transportCount; index += 1) {
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      checksum = (checksum + rgba[(index * 131) % rgba.length]) >>> 0;
    }
    const readbackOnlyMilliseconds = performance.now() - started;

    const reusable = context.getImageData(0, 0, canvas.width, canvas.height).data;
    started = performance.now();
    for (let index = 0; index < transportCount; index += 1) {
      const response = await fetch("/__fw_probe_sink", { method: "POST", body: reusable });
      if (!response.ok) throw new Error(`probe upload failed with ${response.status}`);
    }
    const uploadOnlyMilliseconds = performance.now() - started;

    started = performance.now();
    for (let index = 0; index < transportCount; index += 1) {
      const frame = frames[index % frames.length];
      render(frame);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const response = await fetch("/__fw_probe_sink", { method: "POST", body: rgba });
      if (!response.ok) throw new Error(`probe pipeline upload failed with ${response.status}`);
    }
    const renderReadbackUploadMilliseconds = performance.now() - started;

    return {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      renderOnlyMilliseconds,
      renderReadbackMilliseconds,
      readbackOnlyMilliseconds,
      uploadOnlyMilliseconds,
      renderReadbackUploadMilliseconds,
      checksum,
    };
  }, { frames, width, seed, transportCount });

  const samples = [];
  for (let round = 0; round < rounds; round += 1) samples.push(await profileRound());
  const pick = (key) => median(samples.map((sample) => sample[key]));
  const bytesPerFrame = info.width * info.height * 4;
  const renderMs = pick("renderOnlyMilliseconds");
  const renderReadbackMs = pick("renderReadbackMilliseconds");
  const readbackMs = pick("readbackOnlyMilliseconds");
  const uploadMs = pick("uploadOnlyMilliseconds");
  const combinedMs = pick("renderReadbackUploadMilliseconds");

  const result = {
    experiment: "E16-stage-profile",
    html,
    width: info.width,
    height: info.height,
    fps: info.fps,
    totalFrames: total,
    profileFrames: actualFrameCount,
    transportFrames: transportCount,
    rounds,
    bytesPerFrame,
    lifecycle: {
      browserLaunchMilliseconds,
      coldPageReadyMilliseconds: coldPage.milliseconds,
      warmPageReadyMilliseconds,
    },
    browserStages: {
      compositionMillisecondsTotal: renderMs,
      compositionMillisecondsPerFrame: renderMs / actualFrameCount,
      renderPlusReadbackMillisecondsTotal: renderReadbackMs,
      renderPlusReadbackMillisecondsPerFrame: renderReadbackMs / actualFrameCount,
      estimatedReadbackIncrementMillisecondsPerFrame: Math.max(0, renderReadbackMs - renderMs) / actualFrameCount,
      staticReadbackMillisecondsPerFrame: readbackMs / transportCount,
      localhostUploadRoundTripMillisecondsPerFrame: uploadMs / transportCount,
      renderReadbackUploadMillisecondsPerFrame: combinedMs / transportCount,
    },
    transport: {
      requests: sinkRequests,
      bytes: sinkBytes,
      expectedBytes: transportCount * rounds * 2 * bytesPerFrame,
    },
    samples,
    interpretation: {
      note: "Stage timings are microbenchmarks. They overlap in the production raw pipeline and must not be summed into end-to-end wall time.",
      warmPoolUpperBoundMilliseconds: browserLaunchMilliseconds,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (outS) {
    const out = path.resolve(outS);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
