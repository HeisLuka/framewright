#!/usr/bin/env node
import puppeteer from "puppeteer";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const [,, outS = "", widthS = "720", countS = "120"] = process.argv;
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "examples/book-ad-v0/index.html"));
const width = Math.max(64, Math.round(Number(widthS) || 720));
const count = Math.max(2, Math.round(Number(countS) || 120));
const seed = Math.round(Number(process.env.SEED) || 7);

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
if (!address || typeof address === "string") throw new Error("could not bind WebCodecs encode benchmark server");
const origin = `http://127.0.0.1:${address.port}`;
const htmlRelative = path.relative(root, html).split(path.sep).map(encodeURIComponent).join("/");
const url = new URL(`/${htmlRelative}`, origin);
url.searchParams.set("f", "0");
url.searchParams.set("w", String(width));
url.searchParams.set("s", String(seed));

let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 600000,
    args: process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  });
  const page = await browser.newPage();
  await page.goto(url.href, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction("window.__ready===true", { timeout: 120000 });

  const result = await page.evaluate(async ({ width, seed, count }) => {
    const canvas = document.querySelector("canvas");
    const runtime = window.RISO;
    const fps = Number(runtime.fps || 30);
    const bitrate = canvas.width >= 1000 ? 8_000_000 : 4_000_000;
    const baseConfig = {
      codec: "avc1.420028",
      width: canvas.width,
      height: canvas.height,
      bitrate,
      framerate: fps,
      latencyMode: "realtime",
      avc: { format: "annexb" },
    };

    if (typeof VideoEncoder !== "function" || typeof VideoFrame !== "function") {
      return { supported: false, error: "VideoEncoder/VideoFrame unavailable", width: canvas.width, height: canvas.height };
    }

    let support;
    try {
      support = await VideoEncoder.isConfigSupported(baseConfig);
    } catch (error) {
      return { supported: false, error: `${error.name}: ${error.message}`, width: canvas.width, height: canvas.height };
    }
    if (!support.supported) return { supported: false, support, width: canvas.width, height: canvas.height };

    runtime.render(0, width, seed);
    const renderStarted = performance.now();
    for (let index = 0; index < count; index += 1) runtime.render(index, width, seed);
    const renderOnlyMilliseconds = performance.now() - renderStarted;

    let outputBytes = 0;
    let outputChunks = 0;
    let decoderConfig = null;
    let encodeError = null;
    let maxEncodeQueueSize = 0;
    const encoder = new VideoEncoder({
      output(chunk, metadata) {
        outputBytes += chunk.byteLength;
        outputChunks += 1;
        if (metadata?.decoderConfig) decoderConfig = metadata.decoderConfig;
      },
      error(error) { encodeError = `${error?.name || "Error"}: ${error?.message || error}`; },
    });
    encoder.configure(baseConfig);

    const waitForQueue = async (limit = 8) => {
      while (encoder.encodeQueueSize > limit) {
        await new Promise((resolve) => encoder.addEventListener("dequeue", resolve, { once: true }));
      }
    };

    const started = performance.now();
    for (let index = 0; index < count; index += 1) {
      runtime.render(index, width, seed);
      const frame = new VideoFrame(canvas, { timestamp: Math.trunc(index * 1_000_000 / fps) });
      try {
        encoder.encode(frame, { keyFrame: index === 0 || index % (fps * 2) === 0 });
        maxEncodeQueueSize = Math.max(maxEncodeQueueSize, encoder.encodeQueueSize);
      } finally {
        frame.close();
      }
      await waitForQueue();
    }
    await encoder.flush();
    const milliseconds = performance.now() - started;
    encoder.close();

    return {
      supported: !encodeError,
      error: encodeError,
      support,
      width: canvas.width,
      height: canvas.height,
      fps,
      bitrate,
      count,
      renderOnlyMilliseconds,
      renderOnlyMillisecondsPerFrame: renderOnlyMilliseconds / count,
      encodeWallMilliseconds: milliseconds,
      encodeMillisecondsPerFrame: milliseconds / count,
      encodedFramesPerSecond: count / Math.max(milliseconds / 1000, 1e-9),
      outputBytes,
      outputChunks,
      maxEncodeQueueSize,
      decoderConfig: decoderConfig ? {
        codec: decoderConfig.codec,
        codedWidth: decoderConfig.codedWidth,
        codedHeight: decoderConfig.codedHeight,
        descriptionBytes: decoderConfig.description?.byteLength || 0,
      } : null,
    };
  }, { width, seed, count });

  const output = {
    experiment: "E22-webcodecs-h264-encode",
    html,
    seed,
    ...result,
    hypothesis: {
      statement: "Direct browser H.264 encoding is a serious raw-transport replacement candidate if AVC is supported and the canvas render+encode path sustains at least 15 fps on the CPU runner.",
      confirmedAt15Fps: Boolean(result.supported && result.encodedFramesPerSecond >= 15),
    },
    caveat: "This produces encoded H.264 chunks but does not mux MP4/audio or prove hardware acceleration. A production path still needs container muxing, deterministic quality settings and decoded-frame quality comparison.",
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
