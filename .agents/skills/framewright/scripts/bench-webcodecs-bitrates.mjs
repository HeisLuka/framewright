#!/usr/bin/env node
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
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
const seed = Math.round(Number(process.env.SEED) || 7);
const bitrates = String(process.env.BITRATES || (width >= 1000 ? "1000000,2000000,4000000,8000000" : "500000,1000000,2000000,4000000"))
  .split(",").map(Number).filter((value) => Number.isFinite(value) && value > 0);
if (bitrates.length < 2) throw new Error("BITRATES must contain at least two positive values");
bitrates.sort((a, b) => a - b);
const workDir = path.resolve(process.env.E24_DIR || `.bench/e24-bitrates-${width}`);
await fsp.mkdir(workDir, { recursive: true });

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(`${command} exited with ${code ?? signal}\n${stderr.slice(-4000)}`));
  });
});

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
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "POST" && requestUrl.pathname === "/__fw_h264") {
    const name = String(requestUrl.searchParams.get("name") || "output").replace(/[^a-zA-Z0-9_-]/g, "_");
    const target = path.join(workDir, `${name}.h264`);
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => { chunks.push(chunk); bytes += chunk.length; });
    request.on("end", async () => {
      try {
        await fsp.writeFile(target, Buffer.concat(chunks, bytes));
        response.writeHead(204); response.end();
      } catch (error) {
        response.writeHead(500); response.end(String(error?.message || error));
      }
    });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
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
if (!address || typeof address === "string") throw new Error("could not bind E24 server");
const origin = `http://127.0.0.1:${address.port}`;
const htmlRelative = path.relative(root, html).split(path.sep).map(encodeURIComponent).join("/");
const url = new URL(`/${htmlRelative}`, origin);
url.searchParams.set("f", "0");
url.searchParams.set("w", String(width));
url.searchParams.set("s", String(seed));

let browser;
const results = [];
try {
  browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 600000,
    args: process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  });
  const page = await browser.newPage();
  await page.goto(url.href, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction("window.__ready===true", { timeout: 120000 });

  for (const bitrate of bitrates) {
    const name = `b${bitrate}`;
    const h264Path = path.join(workDir, `${name}.h264`);
    const mp4Path = path.join(workDir, `${name}.mp4`);
    const metrics = await page.evaluate(async ({ width, seed, frames, bitrate, name }) => {
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
      if (!support.supported) throw new Error(`unsupported bitrate config ${bitrate}`);
      const chunks = [];
      let outputBytes = 0;
      let encodeError = null;
      const encoder = new VideoEncoder({
        output(chunk) {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          chunks.push(bytes);
          outputBytes += bytes.byteLength;
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
      const encodeMilliseconds = performance.now() - started;
      encoder.close();
      if (encodeError) throw new Error(encodeError);
      const all = new Uint8Array(outputBytes);
      let offset = 0;
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
      const uploadStarted = performance.now();
      const response = await fetch(`/__fw_h264?name=${encodeURIComponent(name)}`, { method: "POST", body: all });
      if (!response.ok) throw new Error(`H264 upload failed ${response.status}`);
      return {
        fps, frames: count, bitrate, outputBytes,
        encodeMilliseconds,
        encodedFramesPerSecond: count / Math.max(encodeMilliseconds / 1000, 1e-9),
        uploadMilliseconds: performance.now() - uploadStarted,
      };
    }, { width, seed, frames, bitrate, name });

    const muxStarted = performance.now();
    await run("ffmpeg", [
      "-y", "-v", "error", "-nostats", "-fflags", "+genpts",
      "-r", String(metrics.fps), "-i", h264Path,
      "-c:v", "copy", "-movflags", "+faststart", mp4Path,
    ]);
    const muxMilliseconds = performance.now() - muxStarted;
    results.push({
      ...metrics,
      muxMilliseconds,
      mp4Path,
      mp4Bytes: (await fsp.stat(mp4Path)).size,
    });
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}

const baseline = results[results.length - 1];
for (const item of results) {
  const psnrRun = await run("ffmpeg", [
    "-v", "info", "-nostats", "-i", baseline.mp4Path, "-i", item.mp4Path,
    "-lavfi", "psnr", "-f", "null", "-",
  ]);
  const ssimRun = await run("ffmpeg", [
    "-v", "info", "-nostats", "-i", baseline.mp4Path, "-i", item.mp4Path,
    "-lavfi", "ssim", "-f", "null", "-",
  ]);
  const psnrMatch = /average:([^\s]+)/.exec(`${psnrRun.stdout}\n${psnrRun.stderr}`);
  const ssimMatch = /All:([^\s]+)/.exec(`${ssimRun.stdout}\n${ssimRun.stderr}`);
  item.psnrVsHighest = psnrMatch ? Number(psnrMatch[1]) : null;
  item.ssimVsHighest = ssimMatch ? Number(ssimMatch[1]) : null;
  item.sizeVsHighest = item.mp4Bytes / Math.max(baseline.mp4Bytes, 1);
  item.speedupEncodeVsHighest = baseline.encodeMilliseconds / Math.max(item.encodeMilliseconds, 1e-9);
  delete item.mp4Path;
}

const candidates = results.filter((item) => (
  item.bitrate !== baseline.bitrate
  && item.sizeVsHighest <= 0.6
  && Number.isFinite(item.psnrVsHighest) && item.psnrVsHighest >= 40
  && Number.isFinite(item.ssimVsHighest) && item.ssimVsHighest >= 0.99
));
const bestCandidate = candidates.sort((a, b) => a.mp4Bytes - b.mp4Bytes)[0] || null;
const output = {
  experiment: "E24-webcodecs-bitrate-matrix",
  html,
  seed,
  width,
  frames,
  bitrates,
  baselineBitrate: baseline.bitrate,
  results,
  hypothesis: {
    statement: "WebCodecs output size can be materially reduced without obvious decoded quality loss if a lower bitrate produces <=60% of the highest-bitrate file while retaining PSNR >=40 dB and SSIM >=0.99 against that highest-bitrate WebCodecs baseline.",
    confirmed: Boolean(bestCandidate),
    bestCandidate: bestCandidate ? {
      bitrate: bestCandidate.bitrate,
      mp4Bytes: bestCandidate.mp4Bytes,
      sizeVsHighest: bestCandidate.sizeVsHighest,
      psnrVsHighest: bestCandidate.psnrVsHighest,
      ssimVsHighest: bestCandidate.ssimVsHighest,
    } : null,
  },
  caveat: "The quality reference is the highest-bitrate WebCodecs output, not uncompressed source or x264 CRF22. E23 already established that the highest-bitrate output was close to the x264 reference; a final production bitrate still needs visual QA.",
};
console.log(JSON.stringify(output, null, 2));
if (outS) {
  const out = path.resolve(outS);
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.writeFile(out, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}
