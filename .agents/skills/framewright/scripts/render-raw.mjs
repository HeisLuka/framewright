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
// same-origin endpoint. A producer is acknowledged only after its frame has
// actually been written to ffmpeg in frame order. With one in-flight frame per
// worker, out-of-order buffering is bounded by roughly tabs * bytesPerFrame.
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OrderedFrameSink } from "./ordered-frame-sink.mjs";

const [,, outS = "out.mp4", seedS = "7", widthS = "1920", tabsS = "5"] = process.argv;
const out = path.resolve(outS);
const seed = Number(seedS);
const width = Math.max(64, Math.round(Number(widthS) || 1920));
const tabs = Math.max(1, Math.round(Number(tabsS) || 5));
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "index.html"));
const start = Math.max(0, Math.trunc(Number(process.env.START) || 0));
const requestedEnd = process.env.END == null
  ? null
  : Math.max(start, Math.trunc(Number(process.env.END)));
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
  if (!fs.existsSync(stagedCoverPath)) {
    throw new Error(`staged cover not found: ${stagedCoverPath}`);
  }
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
let frameSink = null;
let browser = null;
let ffmpeg = null;
let ffmpegExited = false;
let ffmpegInputEnded = false;
let fatalError = null;
let receivedFrames = 0;
let writtenFrames = 0;
let rawBytes = 0;

const asError = (value) => (
  value instanceof Error ? value : new Error(String(value || "raw render failed"))
);
const failRender = (error) => {
  const failure = asError(error);
  if (!fatalError) fatalError = failure;
  if (frameSink) frameSink.fail(fatalError);
  return fatalError;
};

const waitForDrain = (stream) => new Promise((resolve, reject) => {
  const cleanup = () => {
    stream.off("drain", onDrain);
    stream.off("error", onError);
    stream.off("close", onClose);
  };
  const onDrain = () => { cleanup(); resolve(); };
  const onError = (error) => { cleanup(); reject(error); };
  const onClose = () => { cleanup(); reject(new Error("ffmpeg stdin closed before drain")); };
  stream.once("drain", onDrain);
  stream.once("error", onError);
  stream.once("close", onClose);
});

const streamWrite = async (stream, buffer) => {
  if (!stream || stream.destroyed || stream.writableEnded) {
    throw new Error("ffmpeg stdin is closed");
  }
  let accepted;
  try {
    accepted = stream.write(buffer);
  } catch (error) {
    throw asError(error);
  }
  if (!accepted) await waitForDrain(stream);
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
      response.writeHead(400);
      response.end("invalid frame");
      return;
    }
    if (!frameSink) {
      response.writeHead(503);
      response.end("encoder not ready");
      return;
    }

    const chunks = [];
    let size = 0;
    let requestFailed = false;
    request.on("data", (chunk) => {
      if (requestFailed) return;
      chunks.push(chunk);
      size += chunk.length;
      if (expectedFrameBytes != null && size > expectedFrameBytes) {
        requestFailed = true;
        response.writeHead(413);
        response.end(`frame ${frame} exceeds ${expectedFrameBytes} bytes`);
        request.destroy();
      }
    });
    request.on("error", (error) => {
      requestFailed = true;
      if (!response.headersSent) response.writeHead(400);
      if (!response.writableEnded) response.end(String(error.message || error));
    });
    request.on("end", async () => {
      if (requestFailed) return;
      if (expectedFrameBytes != null && size !== expectedFrameBytes) {
        response.writeHead(400);
        response.end(`frame ${frame}: expected ${expectedFrameBytes} bytes, got ${size}`);
        return;
      }
      receivedFrames += 1;
      try {
        await frameSink.submit(frame, Buffer.concat(chunks, size));
        response.writeHead(204, { "Cache-Control": "no-store" });
        response.end();
      } catch (error) {
        const failure = asError(error);
        if (!response.headersSent) {
          response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        }
        if (!response.writableEnded) response.end(failure.message);
      }
    });
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && requestUrl.pathname === "/__fw_asset/cover") {
    if (!stagedCoverPath) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType(stagedCoverPath),
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(stagedCoverPath).pipe(response);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end();
    return;
  }
  const filename = staticPath(requestUrl.pathname);
  if (!filename) {
    response.writeHead(403);
    response.end();
    return;
  }
  fs.stat(filename, (statError, stat) => {
    if (statError || !stat.isFile()) {
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
  if (!response.ok) {
    throw new Error(`frame upload ${response.status}: ${await response.text()}`);
  }
}, frame);

let total;
let fps;
let frameWidth;
let frameHeight;
let plates;

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("could not start local render server");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  const htmlRelative = path.relative(root, html).split(path.sep).map(encodeURIComponent).join("/");
  const pageUrl = (() => {
    const url = new URL(`/${htmlRelative}`, origin);
    url.searchParams.set("f", "0");
    url.searchParams.set("w", "320");
    url.searchParams.set("s", String(seed));
    if (process.env.AR) url.searchParams.set("ar", process.env.AR);
    for (const [key, value] of fwQuery) url.searchParams.set(key, value);
    return url.href;
  })();

  browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 600000,
  });

  const probe = await browser.newPage();
  probe.on("pageerror", (error) => console.error("PAGE ERROR", error.message));
  try {
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
  } finally {
    await probe.close();
  }

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
  if (hasTrack) {
    ffmpegArgs.push("-c:a", "aac", "-b:a", process.env.AUDIO_BITRATE || "192k", "-shortest");
  }
  ffmpegArgs.push(out);

  ffmpeg = spawn(process.env.FFMPEG || "ffmpeg", ffmpegArgs, {
    cwd: root,
    stdio: ["pipe", "inherit", "inherit"],
  });
  frameSink = new OrderedFrameSink({
    start,
    write: async (_frame, buffer) => {
      await streamWrite(ffmpeg.stdin, buffer);
      rawBytes += buffer.length;
      writtenFrames += 1;
    },
  });
  const ffmpegExit = new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    ffmpeg.once("error", (error) => {
      ffmpegExited = true;
      const failure = failRender(error);
      finish({ ok: false, error: failure });
    });
    ffmpeg.once("exit", (code, signal) => {
      ffmpegExited = true;
      if (code === 0 && ffmpegInputEnded) {
        finish({ ok: true });
        return;
      }
      const failure = failRender(new Error(
        code === 0
          ? "ffmpeg exited before raw input completed"
          : `ffmpeg exited with ${code ?? signal}`,
      ));
      finish({ ok: false, error: failure });
    });
  });

  console.log(
    `raw render ${start}..${end - 1}/${total - 1}  ${frameWidth}x${frameHeight} @ ${fps} fps  tabs ${tabs}`,
  );
  if (plates.length) {
    console.log(plates.map((plate) => `${plate.name}:${plate.len}`).join("  "));
  }
  console.log(
    `raw frame ${(expectedFrameBytes / 1024 / 1024).toFixed(2)} MiB; `
    + `bounded reorder <= ~${(expectedFrameBytes * tabs / 1024 / 1024).toFixed(1)} MiB`,
  );

  let nextFrame = start;
  let completed = 0;
  const t0 = performance.now();
  const worker = async (workerIndex) => {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error(`PAGE ${workerIndex} ERROR`, error.message));
    try {
      await page.goto(pageUrl, { waitUntil: "load", timeout: 120000 });
      await page.waitForFunction("window.__ready===true", { timeout: 120000 });
      while (!fatalError) {
        const frame = nextFrame++;
        if (frame >= end) break;
        const dimensions = await renderIntoCanvas(page, frame);
        if (dimensions.width !== frameWidth || dimensions.height !== frameHeight) {
          throw new Error(
            `frame ${frame} changed dimensions to ${dimensions.width}x${dimensions.height}`,
          );
        }
        await postCanvas(page, frame);
        completed += 1;
        if (completed % 60 === 0 || completed === count) {
          const seconds = (performance.now() - t0) / 1000;
          const rate = completed / Math.max(seconds, 1e-9);
          console.log(`${completed}/${count}  ${seconds.toFixed(1)} s  ${rate.toFixed(1)} fps`);
        }
      }
      if (fatalError) throw fatalError;
    } finally {
      await page.close();
    }
  };

  try {
    await Promise.all(Array.from({ length: tabs }, (_, index) => worker(index + 1)));
    await frameSink.finish(end);
  } catch (error) {
    throw failRender(error);
  }

  if (writtenFrames !== count || receivedFrames !== count) {
    throw failRender(new Error(
      `raw stream incomplete: received=${receivedFrames} written=${writtenFrames} expected=${count}`,
    ));
  }

  ffmpegInputEnded = true;
  ffmpeg.stdin.end();
  const ffmpegResult = await ffmpegExit;
  if (!ffmpegResult.ok) throw ffmpegResult.error;

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
    framesPerSecond: count / Math.max(elapsedSeconds, 1e-9),
    bytesPerFrame: expectedFrameBytes,
    peakReorderBytesUpperBound: expectedFrameBytes * tabs,
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
  if (!ffmpegInputEnded && frameSink && !frameSink.failed) {
    frameSink.fail(fatalError || new Error("raw render terminated before completion"));
  }
  try {
    if (ffmpeg?.stdin && !ffmpeg.stdin.destroyed && !ffmpeg.stdin.writableEnded) {
      ffmpeg.stdin.destroy();
    }
  } catch {}
  try {
    if (ffmpeg && !ffmpegExited) ffmpeg.kill("SIGTERM");
  } catch {}
  try {
    if (browser) await browser.close();
  } catch {}
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
}
