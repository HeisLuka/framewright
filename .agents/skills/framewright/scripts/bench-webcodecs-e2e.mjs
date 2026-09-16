#!/usr/bin/env node
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const [,, outS = "", widthS = "720", framesS = "450", tabsS = "2"] = process.argv;
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "examples/book-ad-v0/index.html"));
const width = Math.max(64, Math.round(Number(widthS) || 720));
const requestedFrames = Math.max(2, Math.round(Number(framesS) || 450));
const tabs = Math.max(1, Math.round(Number(tabsS) || 2));
const seed = Math.round(Number(process.env.SEED) || 7);
const directBitrate = Math.max(500_000, Math.round(Number(process.env.WEBCODECS_BITRATE) || (width >= 1000 ? 8_000_000 : 4_000_000)));
const workDir = path.resolve(process.env.E23_DIR || `.bench/e23-webcodecs-${width}`);
const h264Path = path.join(workDir, "webcodecs.h264");
const directMp4 = path.join(workDir, "webcodecs.mp4");
const rawMp4 = path.join(workDir, "raw-reference.mp4");
const rawMetricsPath = path.join(workDir, "raw-reference.json");
const rawScript = path.join(root, ".agents/skills/framewright/scripts/render-raw.mjs");
await fsp.mkdir(workDir, { recursive: true });

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

const run = (command, args, extraEnv = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(`${command} exited with ${code ?? signal}\n${stderr.slice(-4000)}`));
  });
});

const capture = (command, args) => new Promise((resolve, reject) => {
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

let uploadedH264Bytes = 0;
const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "POST" && requestUrl.pathname === "/__fw_h264") {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => { chunks.push(chunk); bytes += chunk.length; });
    request.on("end", async () => {
      try {
        const body = Buffer.concat(chunks, bytes);
        await fsp.writeFile(h264Path, body);
        uploadedH264Bytes = body.byteLength;
        response.writeHead(204, { "Cache-Control": "no-store" });
        response.end();
      } catch (error) {
        response.writeHead(500);
        response.end(String(error?.message || error));
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
if (!address || typeof address === "string") throw new Error("could not bind E23 server");
const origin = `http://127.0.0.1:${address.port}`;
const htmlRelative = path.relative(root, html).split(path.sep).map(encodeURIComponent).join("/");
const url = new URL(`/${htmlRelative}`, origin);
url.searchParams.set("f", "0");
url.searchParams.set("w", String(width));
url.searchParams.set("s", String(seed));

let browser = null;
let directMetrics = null;
const directWallStarted = performance.now();
try {
  browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 600000,
    args: process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("PAGE ERROR", error.message));
  await page.goto(url.href, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction("window.__ready===true", { timeout: 120000 });

  directMetrics = await page.evaluate(async ({ width, seed, requestedFrames, bitrate }) => {
    const canvas = document.querySelector("canvas");
    const runtime = window.RISO;
    if (!canvas || !runtime?.render) throw new Error("E23 requires RISO.render");
    if (typeof VideoEncoder !== "function" || typeof VideoFrame !== "function") {
      throw new Error("WebCodecs VideoEncoder/VideoFrame unavailable");
    }
    const total = Math.max(1, Math.trunc(Number(runtime.total || 1)));
    const count = Math.min(total, requestedFrames);
    const fps = Math.max(1, Number(runtime.fps || 30));
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
    if (!support.supported) throw new Error(`WebCodecs config unsupported: ${JSON.stringify(config)}`);

    const chunks = [];
    let outputBytes = 0;
    let outputChunks = 0;
    let maxEncodeQueueSize = 0;
    let encodeError = null;
    const encoder = new VideoEncoder({
      output(chunk) {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        chunks.push(bytes);
        outputBytes += bytes.byteLength;
        outputChunks += 1;
      },
      error(error) { encodeError = `${error?.name || "Error"}: ${error?.message || error}`; },
    });
    encoder.configure(config);
    const waitForQueue = async (limit = 8) => {
      while (encoder.encodeQueueSize > limit) {
        await new Promise((resolve) => encoder.addEventListener("dequeue", resolve, { once: true }));
      }
    };

    const encodeStarted = performance.now();
    for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
      runtime.render(frameIndex, width, seed);
      const frame = new VideoFrame(canvas, { timestamp: Math.trunc(frameIndex * 1_000_000 / fps) });
      try {
        encoder.encode(frame, { keyFrame: frameIndex === 0 || frameIndex % Math.max(1, Math.round(fps * 2)) === 0 });
        maxEncodeQueueSize = Math.max(maxEncodeQueueSize, encoder.encodeQueueSize);
      } finally {
        frame.close();
      }
      await waitForQueue();
    }
    await encoder.flush();
    const encodeMilliseconds = performance.now() - encodeStarted;
    encoder.close();
    if (encodeError) throw new Error(encodeError);

    const all = new Uint8Array(outputBytes);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const uploadStarted = performance.now();
    const response = await fetch("/__fw_h264", { method: "POST", body: all });
    if (!response.ok) throw new Error(`H264 upload failed with ${response.status}: ${await response.text()}`);
    const uploadMilliseconds = performance.now() - uploadStarted;

    return {
      width: canvas.width,
      height: canvas.height,
      fps,
      total,
      frames: count,
      bitrate,
      support,
      encodeMilliseconds,
      encodeMillisecondsPerFrame: encodeMilliseconds / count,
      encodedFramesPerSecond: count / Math.max(encodeMilliseconds / 1000, 1e-9),
      uploadMilliseconds,
      outputBytes,
      outputChunks,
      maxEncodeQueueSize,
    };
  }, { width, seed, requestedFrames, bitrate: directBitrate });

  if (uploadedH264Bytes !== directMetrics.outputBytes) {
    throw new Error(`H264 upload mismatch browser=${directMetrics.outputBytes} node=${uploadedH264Bytes}`);
  }

  const muxStarted = performance.now();
  await run("ffmpeg", [
    "-y", "-v", "error", "-nostats",
    "-fflags", "+genpts",
    "-r", String(directMetrics.fps),
    "-i", h264Path,
    "-c:v", "copy",
    "-movflags", "+faststart",
    directMp4,
  ]);
  directMetrics.muxMilliseconds = performance.now() - muxStarted;
} finally {
  try { if (browser) await browser.close(); } catch {}
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
const directWallSeconds = (performance.now() - directWallStarted) / 1000;

const rawWallStarted = performance.now();
await run(process.execPath, [rawScript, rawMp4, String(seed), String(width), String(tabs)], {
  HTML: html,
  FW_ROOT: root,
  START: "0",
  END: String(directMetrics.frames),
  TRACK: path.join(workDir, "__no_audio__.wav"),
  METRICS_OUT: rawMetricsPath,
  PRESET: process.env.PRESET || "slow",
  CRF: process.env.CRF || "22",
});
const rawWallSeconds = (performance.now() - rawWallStarted) / 1000;
const rawMetrics = JSON.parse(await fsp.readFile(rawMetricsPath, "utf8"));

const probe = async (filename) => {
  const { stdout } = await capture("ffprobe", [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,nb_read_frames",
    "-of", "json", filename,
  ]);
  return JSON.parse(stdout).streams?.[0] || {};
};
const directProbe = await probe(directMp4);
const rawProbe = await probe(rawMp4);

const psnrRun = await capture("ffmpeg", [
  "-v", "info", "-nostats", "-i", rawMp4, "-i", directMp4,
  "-lavfi", "psnr", "-f", "null", "-",
]);
const ssimRun = await capture("ffmpeg", [
  "-v", "info", "-nostats", "-i", rawMp4, "-i", directMp4,
  "-lavfi", "ssim", "-f", "null", "-",
]);
const psnrMatch = /average:([^\s]+)/.exec(`${psnrRun.stdout}\n${psnrRun.stderr}`);
const ssimMatch = /All:([^\s]+)/.exec(`${ssimRun.stdout}\n${ssimRun.stderr}`);
const psnrAverage = psnrMatch ? Number(psnrMatch[1]) : null;
const ssimAll = ssimMatch ? Number(ssimMatch[1]) : null;

const directBytes = (await fsp.stat(directMp4)).size;
const rawBytes = (await fsp.stat(rawMp4)).size;
const directFrames = Number(directProbe.nb_read_frames || 0);
const rawFrames = Number(rawProbe.nb_read_frames || 0);
const speedup = rawWallSeconds / Math.max(directWallSeconds, 1e-9);
const result = {
  experiment: "E23-webcodecs-end-to-end",
  html,
  seed,
  width: directMetrics.width,
  height: directMetrics.height,
  frames: directMetrics.frames,
  fps: directMetrics.fps,
  tabs,
  directWebCodecs: {
    wallSeconds: directWallSeconds,
    framesPerSecond: directMetrics.frames / Math.max(directWallSeconds, 1e-9),
    encodeFramesPerSecond: directMetrics.encodedFramesPerSecond,
    encodeMilliseconds: directMetrics.encodeMilliseconds,
    uploadMilliseconds: directMetrics.uploadMilliseconds,
    muxMilliseconds: directMetrics.muxMilliseconds,
    h264Bytes: directMetrics.outputBytes,
    mp4Bytes: directBytes,
    bitrate: directBitrate,
    outputChunks: directMetrics.outputChunks,
    maxEncodeQueueSize: directMetrics.maxEncodeQueueSize,
    probe: directProbe,
  },
  rawReference: {
    wallSeconds: rawWallSeconds,
    framesPerSecond: rawMetrics.framesPerSecond,
    mp4Bytes: rawBytes,
    preset: rawMetrics.preset,
    crf: rawMetrics.crf,
    probe: rawProbe,
  },
  speedup,
  visualComparison: { psnrAverage, ssimAll },
  hypothesis: {
    statement: "Direct browser WebCodecs H.264 is a viable production-path candidate if it produces the full requested frame count, is at least 3x faster end-to-end than raw RGBA + x264 on the same runner, and preserves strong decoded similarity (PSNR >= 35 dB and SSIM >= 0.95).",
    frameCountExact: directFrames === directMetrics.frames && rawFrames === directMetrics.frames,
    speedupAtLeast3x: speedup >= 3,
    psnrAtLeast35: Number.isFinite(psnrAverage) && psnrAverage >= 35,
    ssimAtLeast0_95: Number.isFinite(ssimAll) && ssimAll >= 0.95,
  },
  caveat: "WebCodecs uses a fixed target bitrate while the reference uses x264 CRF, so quality/size are not rate-control equivalent. This experiment proves architecture viability, not final production encoding settings or hardware acceleration.",
};
result.hypothesis.confirmed = Object.values(result.hypothesis).slice(1).every(Boolean);
console.log(JSON.stringify(result, null, 2));
if (outS) {
  const out = path.resolve(outS);
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.writeFile(out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
