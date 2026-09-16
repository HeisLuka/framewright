#!/usr/bin/env node
import puppeteer from "puppeteer";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const [,, outS = "", widthS = "720", framesS = "450", repeatsS = "3"] = process.argv;
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "examples/book-ad-v0/index.html"));
const width = Math.max(64, Math.round(Number(widthS) || 720));
const frames = Math.max(2, Math.round(Number(framesS) || 450));
const repeats = Math.max(2, Math.min(6, Math.round(Number(repeatsS) || 3)));
const seed = Math.round(Number(process.env.SEED) || 7);
const bitrate = Math.max(250_000, Math.round(Number(process.env.WEBCODECS_BITRATE) || (width >= 1000 ? 2_000_000 : 1_000_000)));

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
if (!address || typeof address === "string") throw new Error("could not bind E26 server");
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

  const runs = await page.evaluate(async ({ width, seed, frames, repeats, bitrate }) => {
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

    const encodeOnce = async () => {
      const chunks = [];
      let totalBytes = 0;
      let encodeError = null;
      const encoder = new VideoEncoder({
        output(chunk) {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          chunks.push(bytes);
          totalBytes += bytes.byteLength;
        },
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
        } finally {
          frame.close();
        }
        await waitForQueue();
      }
      await encoder.flush();
      const milliseconds = performance.now() - started;
      encoder.close();
      if (encodeError) throw new Error(encodeError);
      const all = new Uint8Array(totalBytes);
      let offset = 0;
      const chunkSizes = [];
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.byteLength;
        chunkSizes.push(chunk.byteLength);
      }
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
      const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return { milliseconds, totalBytes, chunkCount: chunks.length, chunkSizes, sha256 };
    };

    const output = [];
    for (let index = 0; index < repeats; index += 1) output.push(await encodeOnce());
    return { width: canvas.width, height: canvas.height, fps, frames: count, bitrate, runs: output };
  }, { width, seed, frames, repeats, bitrate });

  const hashes = new Set(runs.runs.map((item) => item.sha256));
  const sizes = new Set(runs.runs.map((item) => item.totalBytes));
  const chunkShapes = new Set(runs.runs.map((item) => JSON.stringify(item.chunkSizes)));
  const output = {
    experiment: "E26-webcodecs-determinism",
    html,
    seed,
    repeats,
    ...runs,
    hypothesis: {
      statement: "Within the same pinned Chromium/runtime and encoder configuration, deterministic scene input produces byte-identical H.264 Annex-B output across repeated encodes.",
      byteIdentical: hashes.size === 1,
      sizeIdentical: sizes.size === 1,
      chunkShapeIdentical: chunkShapes.size === 1,
      confirmed: hashes.size === 1 && sizes.size === 1 && chunkShapes.size === 1,
    },
    caveat: "Same-runtime bitstream determinism does not guarantee identical H.264 bytes across Chromium versions, operating systems, CPUs or encoder implementations. Production cache identity should include the renderer/codec runtime version unless cross-runtime parity is separately proven.",
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
