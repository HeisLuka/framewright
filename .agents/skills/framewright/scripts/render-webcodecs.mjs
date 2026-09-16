#!/usr/bin/env node
// Production-shaped STANDARD renderer: Canvas -> WebCodecs H.264 -> MP4.
//
//   node render-webcodecs.mjs [out=out.mp4] [seed=7] [width=1080]
//
// Env:
//   HTML=path/to/index.html
//   FW_ROOT=static server root (default cwd)
//   FW_QUERY='key=value&...'
//   AR=9:16
//   TRACK=track.wav                    optional audio track
//   WEBCODECS_BITRATE=2000000          optional policy override
//   WEBCODECS_RETRIES=1                retries after the first attempt
//   WEBCODECS_QUEUE=8                  max encoder queue before backpressure
//   MANIFEST_OUT=path/to/manifest.json local render receipt
//   FW_ARTIFACT_DIR=path               render_id keyed persistent artifact cache
//   FORCE=1                            bypass artifact cache
//   FFMPEG=ffmpeg FFMPEG_LOGLEVEL=error AUDIO_BITRATE=192k
//
// Determinism contract:
//   visual inputs/frames are deterministic for the same render_id inputs;
//   final H.264 bytes are NOT expected to be byte-identical (E26/E27).
//   Therefore a completed MP4 is stored and reused as an artifact by render_id.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WEBCODECS_BITRATE_POLICY_VERSION,
  WEBCODECS_RENDERER_VERSION,
  createWebCodecsRenderId,
  webCodecsBitrateForWidth,
} from "../../../../src/webcodecs-fast-path.mjs";

const [,, outS = "out.mp4", seedS = "7", widthS = "1080"] = process.argv;
const root = path.resolve(process.env.FW_ROOT || process.cwd());
const html = path.resolve(process.env.HTML || path.join(root, "index.html"));
const out = path.resolve(outS);
const seed = Number(seedS);
const width = Math.max(64, Math.round(Number(widthS) || 1080));
const bitrate = webCodecsBitrateForWidth(width, process.env.WEBCODECS_BITRATE);
const retries = Math.max(0, Math.min(5, Math.trunc(Number(process.env.WEBCODECS_RETRIES) || 1)));
const queueLimit = Math.max(1, Math.min(64, Math.trunc(Number(process.env.WEBCODECS_QUEUE) || 8)));
const force = ["1", "true", "yes", "on"].includes(String(process.env.FORCE || "").toLowerCase());
const track = path.resolve(process.env.TRACK || "track.wav");
const manifestOut = path.resolve(process.env.MANIFEST_OUT || `${out}.render.json`);
const artifactDir = process.env.FW_ARTIFACT_DIR ? path.resolve(process.env.FW_ARTIFACT_DIR) : null;
const ffmpeg = process.env.FFMPEG || "ffmpeg";
const ffprobe = process.env.FFPROBE || "ffprobe";

if (!Number.isFinite(seed)) throw new Error("seed must be numeric");
if (!fs.existsSync(html)) throw new Error(`no such HTML: ${html}`);
if (!html.startsWith(root + path.sep) && html !== root) {
  throw new Error(`HTML must be inside FW_ROOT (${root}); got ${html}`);
}
await fsp.mkdir(path.dirname(out), { recursive: true });
await fsp.mkdir(path.dirname(manifestOut), { recursive: true });
if (artifactDir) await fsp.mkdir(artifactDir, { recursive: true });

const hashFile = async (filename) => {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  return hash.digest("hex");
};

const runCapture = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
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

const atomicWriteJson = async (filename, value) => {
  const temp = `${filename}.tmp-${process.pid}-${Date.now()}`;
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(temp, filename);
};

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

const fwQuery = new URLSearchParams(process.env.FW_QUERY || "");
const originalJobToken = fwQuery.get("job") || "";
let stagedCoverPath = null;
const queryCoverUrl = fwQuery.get("coverUrl") || "";
if (queryCoverUrl.startsWith("file:")) {
  stagedCoverPath = fileURLToPath(queryCoverUrl);
  if (!fs.existsSync(stagedCoverPath)) throw new Error(`staged cover not found: ${stagedCoverPath}`);
  fwQuery.set("coverUrl", "/__fw_asset/cover");
  fwQuery.set("coverCrossOrigin", "off");
}

const hasTrack = fs.existsSync(track);
const [htmlSha256, coverSha256, audioSha256] = await Promise.all([
  hashFile(html),
  stagedCoverPath ? hashFile(stagedCoverPath) : Promise.resolve(null),
  hasTrack ? hashFile(track) : Promise.resolve(null),
]);
const identityQuery = [...fwQuery.entries()]
  .filter(([key]) => key !== "coverUrl" && key !== "job")
  .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
const renderId = createWebCodecsRenderId({
  html: path.relative(root, html).split(path.sep).join("/"),
  htmlSha256,
  job: originalJobToken || null,
  query: identityQuery,
  seed,
  width,
  aspect: process.env.AR || null,
  bitrate,
  coverSha256,
  audioSha256,
});
const artifactMp4 = artifactDir ? path.join(artifactDir, `${renderId}.mp4`) : out;
const artifactManifest = artifactDir ? path.join(artifactDir, `${renderId}.json`) : manifestOut;
const h264Temp = path.join(path.dirname(out), `.${path.basename(out)}.${process.pid}.h264`);
const mp4Temp = path.join(path.dirname(out), `.${path.basename(out)}.${process.pid}.tmp.mp4`);

const materializeCachedArtifact = async () => {
  if (force || !fs.existsSync(artifactMp4) || !fs.existsSync(artifactManifest)) return null;
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(artifactManifest, "utf8"));
  } catch {
    return null;
  }
  if (manifest?.renderId !== renderId) return null;
  const actualSha = await hashFile(artifactMp4);
  if (!manifest?.output?.sha256 || manifest.output.sha256 !== actualSha) return null;
  if (path.resolve(artifactMp4) !== out) await fsp.copyFile(artifactMp4, out);
  const receipt = {
    ...manifest,
    invocation: {
      cacheHit: true,
      output: out,
      artifact: artifactMp4,
      at: new Date().toISOString(),
    },
  };
  if (path.resolve(artifactManifest) !== manifestOut) await atomicWriteJson(manifestOut, receipt);
  console.log(`webcodecs cache hit ${renderId}`);
  console.log(JSON.stringify(receipt, null, 2));
  return receipt;
};

const cached = await materializeCachedArtifact();
if (cached) process.exit(0);

let uploadedBytes = 0;
const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "POST" && requestUrl.pathname === "/__fw_h264") {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => { chunks.push(chunk); bytes += chunk.length; });
    request.on("end", async () => {
      try {
        const body = Buffer.concat(chunks, bytes);
        await fsp.writeFile(h264Temp, body);
        uploadedBytes = body.byteLength;
        response.writeHead(204, { "Cache-Control": "no-store" });
        response.end();
      } catch (error) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(String(error?.message || error));
      }
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
  const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    response.writeHead(403); response.end(); return;
  }
  fs.stat(filename, (error, stat) => {
    if (error || !stat.isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": contentType(filename), "Cache-Control": "no-store" });
    if (request.method === "HEAD") { response.end(); return; }
    fs.createReadStream(filename).pipe(response);
  });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let origin = null;
let encodeMetrics = null;
const attemptErrors = [];
const wallStarted = performance.now();

const encodeAttempt = async (attempt) => {
  const puppeteer = (await import("puppeteer")).default;
  let browser = null;
  const attemptStarted = performance.now();
  try {
    const launchArgs = [];
    if (process.env.CI || process.env.PUPPETEER_NO_SANDBOX === "1") {
      launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
    }
    browser = await puppeteer.launch({ headless: true, protocolTimeout: 600000, args: launchArgs });
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error(`PAGE ERROR attempt ${attempt}`, error.message));
    const htmlRelative = path.relative(root, html).split(path.sep).map(encodeURIComponent).join("/");
    const url = new URL(`/${htmlRelative}`, origin);
    url.searchParams.set("f", "0");
    url.searchParams.set("w", String(width));
    url.searchParams.set("s", String(seed));
    if (process.env.AR) url.searchParams.set("ar", process.env.AR);
    for (const [key, value] of fwQuery) url.searchParams.set(key, value);

    const pageLoadStarted = performance.now();
    await page.goto(url.href, { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction("window.__ready===true", { timeout: 120000 });
    const pageLoadMilliseconds = performance.now() - pageLoadStarted;
    uploadedBytes = 0;

    const browserMetrics = await page.evaluate(async ({ width, seed, bitrate, queueLimit }) => {
      const canvas = document.querySelector("canvas");
      const runtime = window.RISO;
      if (!canvas || typeof runtime?.render !== "function") {
        throw new Error("WebCodecs renderer requires canvas + window.RISO.render");
      }
      if (typeof VideoEncoder !== "function" || typeof VideoFrame !== "function") {
        throw new Error("WebCodecs VideoEncoder/VideoFrame unavailable");
      }
      const total = Math.max(1, Math.trunc(Number(runtime.total || 1)));
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
      if (!support.supported) throw new Error(`unsupported WebCodecs config ${JSON.stringify(config)}`);

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
      const waitForQueue = async () => {
        while (encoder.encodeQueueSize > queueLimit) {
          await new Promise((resolve) => encoder.addEventListener("dequeue", resolve, { once: true }));
        }
      };

      const encodeStarted = performance.now();
      for (let frameIndex = 0; frameIndex < total; frameIndex += 1) {
        runtime.render(frameIndex, width, seed);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.trunc(frameIndex * 1_000_000 / fps),
        });
        try {
          encoder.encode(frame, {
            keyFrame: frameIndex === 0 || frameIndex % Math.max(1, Math.round(fps * 2)) === 0,
          });
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

      const body = new Uint8Array(outputBytes);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      const uploadStarted = performance.now();
      const response = await fetch("/__fw_h264", { method: "POST", body });
      if (!response.ok) throw new Error(`H264 upload ${response.status}: ${await response.text()}`);
      const uploadMilliseconds = performance.now() - uploadStarted;
      return {
        width: canvas.width,
        height: canvas.height,
        fps,
        frames: total,
        bitrate,
        encodeMilliseconds,
        encodeFramesPerSecond: total / Math.max(encodeMilliseconds / 1000, 1e-9),
        uploadMilliseconds,
        outputBytes,
        outputChunks,
        maxEncodeQueueSize,
        codec: config.codec,
      };
    }, { width, seed, bitrate, queueLimit });

    if (uploadedBytes !== browserMetrics.outputBytes) {
      throw new Error(`H264 upload mismatch browser=${browserMetrics.outputBytes} node=${uploadedBytes}`);
    }
    return {
      ...browserMetrics,
      attempt,
      pageLoadMilliseconds,
      attemptMilliseconds: performance.now() - attemptStarted,
    };
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
};

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not start WebCodecs render server");
  origin = `http://127.0.0.1:${address.port}`;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      encodeMetrics = await encodeAttempt(attempt);
      break;
    } catch (error) {
      const message = String(error?.stack || error?.message || error);
      attemptErrors.push({ attempt, message: message.slice(0, 4000) });
      if (attempt > retries) throw error;
      console.warn(`WebCodecs attempt ${attempt} failed; retrying: ${error.message || error}`);
      await sleep(Math.min(2000, 250 * attempt));
    }
  }

  const muxStarted = performance.now();
  const ffmpegArgs = [
    "-y", "-v", process.env.FFMPEG_LOGLEVEL || "error", "-nostats",
    "-fflags", "+genpts",
    "-r", String(encodeMetrics.fps),
    "-i", h264Temp,
  ];
  if (hasTrack) ffmpegArgs.push("-i", track);
  ffmpegArgs.push("-map", "0:v:0");
  if (hasTrack) ffmpegArgs.push("-map", "1:a:0?");
  ffmpegArgs.push("-c:v", "copy");
  if (hasTrack) ffmpegArgs.push("-c:a", "aac", "-b:a", process.env.AUDIO_BITRATE || "192k", "-shortest");
  ffmpegArgs.push("-movflags", "+faststart", mp4Temp);
  await runCapture(ffmpeg, ffmpegArgs);
  const muxMilliseconds = performance.now() - muxStarted;
  await fsp.rename(mp4Temp, out);

  const { stdout: videoProbeText } = await runCapture(ffprobe, [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_read_frames",
    "-of", "json", out,
  ]);
  const videoProbe = JSON.parse(videoProbeText).streams?.[0] || {};
  const decodedFrames = Number(videoProbe.nb_read_frames || 0);
  if (decodedFrames !== encodeMetrics.frames) {
    throw new Error(`MP4 frame count mismatch expected=${encodeMetrics.frames} decoded=${decodedFrames}`);
  }
  const { stdout: audioProbeText } = await runCapture(ffprobe, [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=codec_name,sample_rate,channels",
    "-of", "json", out,
  ]);
  const audioProbe = JSON.parse(audioProbeText).streams?.[0] || null;
  if (hasTrack && !audioProbe) throw new Error("audio track was supplied but MP4 contains no audio stream");

  const outputBytes = (await fsp.stat(out)).size;
  const outputSha256 = await hashFile(out);
  const wallSeconds = (performance.now() - wallStarted) / 1000;
  const baseManifest = {
    kind: "framewright-render-artifact",
    version: 1,
    renderId,
    renderer: WEBCODECS_RENDERER_VERSION,
    bitratePolicy: WEBCODECS_BITRATE_POLICY_VERSION,
    deterministicContract: {
      visualFrames: true,
      compressedBitstreamByteIdentical: false,
      reuseCompletedArtifactByRenderId: true,
    },
    input: {
      html: path.relative(root, html).split(path.sep).join("/"),
      htmlSha256,
      seed,
      requestedWidth: width,
      width: encodeMetrics.width,
      height: encodeMetrics.height,
      fps: encodeMetrics.fps,
      frames: encodeMetrics.frames,
      bitrate,
      jobPresent: Boolean(originalJobToken),
      coverSha256,
      audioSha256,
    },
    output: {
      sha256: outputSha256,
      bytes: outputBytes,
      video: videoProbe,
      audio: audioProbe,
    },
    metrics: {
      wallSeconds,
      framesPerSecond: encodeMetrics.frames / Math.max(wallSeconds, 1e-9),
      encodeMilliseconds: encodeMetrics.encodeMilliseconds,
      encodeFramesPerSecond: encodeMetrics.encodeFramesPerSecond,
      pageLoadMilliseconds: encodeMetrics.pageLoadMilliseconds,
      uploadMilliseconds: encodeMetrics.uploadMilliseconds,
      muxMilliseconds,
      h264Bytes: encodeMetrics.outputBytes,
      outputChunks: encodeMetrics.outputChunks,
      maxEncodeQueueSize: encodeMetrics.maxEncodeQueueSize,
      attempts: encodeMetrics.attempt,
      priorAttemptErrors: attemptErrors,
    },
    createdAt: new Date().toISOString(),
  };

  if (artifactDir) {
    if (path.resolve(artifactMp4) !== out) await fsp.copyFile(out, artifactMp4);
    await atomicWriteJson(artifactManifest, baseManifest);
  }
  const receipt = {
    ...baseManifest,
    invocation: {
      cacheHit: false,
      output: out,
      artifact: artifactDir ? artifactMp4 : out,
      at: new Date().toISOString(),
    },
  };
  if (path.resolve(artifactManifest) !== manifestOut || !artifactDir) {
    await atomicWriteJson(manifestOut, receipt);
  }
  console.log(`webcodecs render ${encodeMetrics.frames} frames ${encodeMetrics.width}x${encodeMetrics.height} @ ${encodeMetrics.fps} fps`);
  console.log(`render_id ${renderId}`);
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  try { await fsp.rm(h264Temp, { force: true }); } catch {}
  try { await fsp.rm(mp4Temp, { force: true }); } catch {}
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
