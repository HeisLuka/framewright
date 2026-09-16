#!/usr/bin/env node
// Render Canvas frames as raw RGBA and stream them directly into ffmpeg.
//
//   node render-raw.mjs [out=out.mp4] [seed=7] [width=1920] [tabs=5]
//
// Env:
//   HTML=path/to/index.html
//   FW_ROOT=static server root (default cwd)
//   FW_QUERY='key=value&...'
//   AR=9:16
//   START=0 END=120 RESUME is intentionally unsupported
//   FPS=30 PRESET=slow CRF=22 MAXRATE=14M TRACK=track.wav
//   METRICS_OUT=path/to/metrics.json
//
// The browser never returns PNG/base64 through CDP. Each worker renders a
// deterministic frame, reads Canvas RGBA once, and POSTs the bytes to a local
// same-origin endpoint. The Node receiver only acknowledges a worker after its
// frame has been written to ffmpeg in frame order. Therefore out-of-order
// buffering is bounded by roughly tabs * bytesPerFrame.
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [,, outS = "out.mp4", seedS = "7", widthS = "1920", tabsS = "5"] = process.argv;
const out = path.resolve(outS);
const seed = Number(seedS);
const width = Math.max(64, Math.round(Number(widthS) || 1920));
const tabs = Math.max(1, Math.round(Number(tabsS) || 5));
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "index.html"));
const start = Math.max(0, Math.trunc(Number(process.env.START) || 0));
const requestedEnd = process.env.END == null ? null : Math.max(start, Math.trunc(Number(process.env.END)));
const preset = String(process.env.PRESET || "slow");
const crf = String(process.env.CRF || "22");
const maxrate = String(process.env.MAXRATE || "14M");
const track = path.resolve(process.env.TRACK || "track.wav");
const metricsOut = process.env.METRICS_OUT ? path.resolve(process.env.METRICS_OUT) : null;

if (!Number.isFinite(seed)) throw new Error("seed must be numeric");
if (!fs.existsSync(html)) throw new Error(`no such HTML: ${html}`);
if (!html.startsWith(root + path.sep) && html !== root) {
  throw new Error(`HTML must be inside FW_ROOT (${root}); got ${html}`);
}
await fsp.mkdir(path.dirname(out), { recursive: true });

const fwQuery = new URLSearchParams(process.env.FW_QUERY || "");
let stagedCoverPath = null;
const queryCoverUrl = fwQuery.get("coverUrl") || "";
if (queryCoverUrl.startsWith("file:")) {
  stagedCoverPath = fileURLToPath(queryCoverUrl);
  if (!fs.existsSync(stagedCoverPath)) throw new Error(`staged cover not found: ${stagedCoverPath}`);
  fwQuery.set("coverUrl", "/__fw_asset/cover");
  fwQuery.set("coverCrossOrigin", "off");
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

let expectedFrameBytes = null;
let nextWrite = start;
let ffmpeg = null;
let flushPromise = Promise.resolve();
const pending = new Map();
let receivedFrames = 0;
let writtenFrames = 0;
let rawBytes = 0;

const streamWrite = async (stream, buffer) => {
  if (stream.destroyed) throw new Error("ffmpeg stdin is closed");
  if (stream.write(buffer)) return;
  await once(stream, "drain");
};

const flushPending = () => {
  flushPromise = flushPromise.then(async () => {
    while (pending.has(nextWrite)) {
      const item = pending.get(nextWrite);
      pending.delete(nextWrite);
      try {
        await streamWrite(ffmpeg.stdin, item.buffer);
        rawBytes += item.buffer.length;
        writtenFrames += 1;
        item.response.writeHead(204, { "Cache-Control": "no-store" });
        item.response.end();
        nextWrite += 1;
      } catch (error) {
        item.response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        item.response.end(String(error.message || error));
        throw error;
      }
    }
  });
  return flushPromise;
};

const staticPath = (pathname) => {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  return candidate;
};

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");

  if (request.method === "POST" && requestUrl.pathname === "/__fw_frame") {
    const frame = Number(requestUrl.searchParams.get("n"));
    if (!Number.isInteger(frame) || frame < start) {
      response.writeHead(400); response.end("invalid frame"); return;
    }
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => { chunks.push(chunk); size += chunk.length; });
    request.on("error", (error) => {
      response.writeHead(400); response.end(String(error.message || error));
    });
    request.on("end", () => {
      if (expectedFrameBytes != null && size !== expectedFrameBytes) {
        response.writeHead(400);
        response.end(`frame ${frame}: expected ${expectedFrameBytes} bytes, got ${size}`);
        return;
      }
      if (pending.has(frame) || frame < nextWrite) {
        response.writeHead(409); response.end(`duplicate frame ${frame}`); return;
      }
      pending.set(frame, { buffer: Buffer.concat(chunks, size), response });
      receivedFrames += 1;
      flushPending().catch((error) => {
        console.error("raw frame flush failed:", error.stack || error);
      });
    });
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && requestUrl.pathname === "/__fw_asset/cover") {
    if (!stagedCoverPath) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, {
      "Content-Type": contentType(stagedCoverPath),
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    if (request.method === "HEAD") { response.end(); return; }
    fs.createReadStream(stagedCoverPath).pipe(response);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405); response.end(); return;
  }
  const filename = staticPath(requestUrl.pathname);
  if (!filename) { response.writeHead(403); response.end(); return; }
  fs.stat(filename, (statError, stat) => {
    if (statError || !stat.isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, {
      "Content-Type": contentType(filename),
      "Cache-Control": "no-store",
    });
    if (request.method === "HEAD") { response.end(); return; }
    fs.createReadStream(filename).pipe(response);
  });
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("could not start local render server");
const origin = `http://127.0.0.1:${address.port}`;
const htmlRelative = path.relative(root, html).split(path.sep).map(encodeURIComponent).join("/");

const buildPageUrl = () => {
  const url = new URL(`/${htmlRelative}`, origin);
  url.searchParams.set("f", "0");
  url.searchParams.set("w", "320");
  url.searchParams.set("s", String(seed));
  if (process.env.AR) url.searchParams.set("ar", process.env.AR);
  for (const [key, value] of fwQuery) url.searchParams.set(key, value);
  return url.href;
};
const pageUrl = buildPageUrl();

const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 600000,
});

const renderIntoCanvas = async (page, frame) => page.evaluate(({ frame, width, seed }) => {
  const canvas = document.querySelector("canvas");
  if (!canvas) throw new Error("render page has no canvas");
  if (window.RISO && typeof window.RISO.render === "function") {
    window.RISO.render(frame, width, seed);
  } else if (typeof window.renderFrame === "function") {
    window.renderFrame(frame, width, seed, canvas);
  } else {
    throw new Error("raw renderer needs window.RISO.render() or window.renderFrame()");
  }
  return { width: canvas.width, height: canvas.height };
}, { frame, width, seed });

const postCanvas = async (page, frame) => page.evaluate(async (frame) => {
  const canvas = document.querySelector("canvas");
  if (!canvas) throw new Error("render page has no canvas");
  const context = canvas.getContext("2d", { alpha: false });
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const response = await fetch(`/__fw_frame?n=${frame}`, {
    method: "POST",
    body: rgba,
  });
  if (!response.ok) throw new Error(`frame upload ${response.status}: ${await response.text()}`);
}, frame);

let total;
let fps;
let frameWidth;
let frameHeight;
let plates;
try {
  const probe = await browser.newPage();
  probe.on("pageerror", (error) => console.error("PAGE ERROR", error.message));
  await probe.goto(pageUrl, { waitUntil: "load", timeout: 120000 });
  await probe.waitForFunction("window.__ready===true", { timeout: 120000 });
  const info = await probe.evaluate(() => ({
    total: window.RISO?.total,
    fps: window.RISO?.fps,
    plates: window.RISO?.plates,
  }));
  total = Math.max(1, Math.trunc(Number(info.total) || 1));
  fps = Math.max(1, Number(process.env.FPS || info.fps || 30));
  plates = Array.isArray(info.plates) ? info.plates : [];
  const dimensions = await renderIntoCanvas(probe, start);
  frameWidth = dimensions.width;
  frameHeight = dimensions.height;
  expectedFrameBytes = frameWidth * frameHeight * 4;
  await probe.close();

  const end = Math.min(total, requestedEnd == null ? total : requestedEnd);
  if (end <= start) throw new Error(`empty frame range ${start}..${end}`);
  const count = end - start;

  const ffmpegArgs = [
    "-y", "-v", process.env.FFMPEG_LOGLEVEL || "error", "-nostats",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s:v", `${frameWidth}x${frameHeight}`,
    "-r", String(fps),
    "-i", "pipe:0",
  ];
  const hasTrack = fs.existsSync(track) && start === 0 && end === total;
  if (hasTrack) ffmpegArgs.push("-i", track);
  ffmpegArgs.push(
    "-c:v", process.env.VIDEO_CODEC || "libx264",
    "-preset", preset,
    "-crf", crf,
    "-maxrate", maxrate,
    "-bufsize", process.env.BUFSIZE || "28M",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
  );
  if (hasTrack) ffmpegArgs.push("-c:a", "aac", "-b:a", process.env.AUDIO_BITRATE || "192k", "-shortest");
  ffmpegArgs.push(out);

  ffmpeg = spawn(process.env.FFMPEG || "ffmpeg", ffmpegArgs, {
    cwd: root,
    stdio: ["pipe", "inherit", "inherit"],
  });
  const ffmpegExit = new Promise((resolve, reject) => {
    ffmpeg.once("error", reject);
    ffmpeg.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code ?? signal}`));
    });
  });

  console.log(`raw render ${start}..${end - 1}/${total - 1}  ${frameWidth}x${frameHeight} @ ${fps} fps  tabs ${tabs}`);
  if (plates.length) console.log(plates.map((plate) => `${plate.name}:${plate.len}`).join("  "));
  console.log(`raw frame ${(expectedFrameBytes / 1024 / 1024).toFixed(2)} MiB; bounded reorder <= ~${(expectedFrameBytes * tabs / 1024 / 1024).toFixed(1)} MiB`);

  let nextFrame = start;
  let completed = 0;
  const t0 = performance.now();
  const worker = async (workerIndex) => {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error(`PAGE ${workerIndex} ERROR`, error.message));
    await page.goto(pageUrl, { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction("window.__ready===true", { timeout: 120000 });
    try {
      while (true) {
        const frame = nextFrame++;
        if (frame >= end) break;
        const dimensions = await renderIntoCanvas(page, frame);
        if (dimensions.width !== frameWidth || dimensions.height !== frameHeight) {
          throw new Error(`frame ${frame} changed dimensions to ${dimensions.width}x${dimensions.height}`);
        }
        await postCanvas(page, frame);
        completed += 1;
        if (completed % 60 === 0 || completed === count) {
          const seconds = (performance.now() - t0) / 1000;
          const rate = completed / Math.max(seconds, 1e-9);
          console.log(`${completed}/${count}  ${seconds.toFixed(1)} s  ${rate.toFixed(1)} fps`);
        }
      }
    } finally {
      await page.close();
    }
  };

  await Promise.all(Array.from({ length: tabs }, (_, index) => worker(index + 1)));
  await flushPromise;
  if (writtenFrames !== count || receivedFrames !== count || pending.size) {
    throw new Error(`raw stream incomplete: received=${receivedFrames} written=${writtenFrames} expected=${count} pending=${pending.size}`);
  }
  ffmpeg.stdin.end();
  await ffmpegExit;

  const elapsedSeconds = (performance.now() - t0) / 1000;
  const outputBytes = (await fsp.stat(out)).size;
  const metrics = {
    renderer: "raw-rgba-http-v0",
    html,
    output: out,
    seed,
    width: frameWidth,
    height: frameHeight,
    fps,
    tabs,
    start,
    end,
    frames: count,
    seconds: elapsedSeconds,
    framesPerSecond: count / elapsedSeconds,
    bytesPerFrame: expectedFrameBytes,
    rawBytes,
    outputBytes,
    preset,
    crf,
    videoCodec: process.env.VIDEO_CODEC || "libx264",
    audio: hasTrack ? track : null,
  };
  console.log(JSON.stringify(metrics, null, 2));
  if (metricsOut) {
    await fsp.mkdir(path.dirname(metricsOut), { recursive: true });
    await fsp.writeFile(metricsOut, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  }
} finally {
  try { if (ffmpeg?.stdin && !ffmpeg.stdin.destroyed) ffmpeg.stdin.destroy(); } catch {}
  try { await browser.close(); } catch {}
  await new Promise((resolve) => server.close(resolve));
}
